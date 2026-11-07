import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../../filesystem/RegularFile.js";
import { fixedNativeAllowance } from "../../domain/native/nativeDeadlines.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { PeResourcesPort } from "../../application/binaryDiagnostics/PeResourcesPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import {
  MAX_INSPECT_PE_DIRECTORY_ENTRIES,
  MAX_INSPECT_PE_FILE_BYTES,
  type InspectPeResourcesInput,
} from "../../domain/native/peResources.js";
import { err, ok } from "../../domain/result.js";
import { PE_RESOURCES_PROVIDER } from "../../domain/investigationProviders.js";
import {
  parsePeResources,
  PE_RESOURCE_METADATA_BYTES,
} from "./PeResourceParser.js";

/** Portable parser over one bounded, identity-checked regular file. */
export class PeResourcesProvider implements PeResourcesPort {
  readonly identity = PE_RESOURCES_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        PE_RESOURCES_PROVIDER.id,
        "inspect_pe_resources",
      );
    }
  }

  async inspect(input: InspectPeResourcesInput, options?: ExecutionOptions) {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          input.max_file_bytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        return ok(
          await parsePeResources(
            snapshot.bytes,
            {
              path: input.path,
              sha256: snapshot.sha256,
              bytes: snapshot.bytes.length,
            },
            input,
            options?.signal,
          ),
        );
      });
    } catch (cause) {
      return err(peResourcesFailure(cause, input));
    }
  }
}

/**
 * Remediation for a caller-selected budget refusal. At the schema ceiling
 * there is no value left to raise the bound to, so the advice names the
 * ceiling instead of an impossible raise.
 */
export const inputBudgetRemediation = (
  boundary: "file-size" | "capacity",
  input: InspectPeResourcesInput,
): string =>
  boundary === "file-size"
    ? input.max_file_bytes >= MAX_INSPECT_PE_FILE_BYTES
      ? `The image exceeds the ${String(MAX_INSPECT_PE_FILE_BYTES)}-byte input ceiling this operation accepts. This release has no runtime override. Select a smaller artifact.`
      : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`
    : input.max_entries >= MAX_INSPECT_PE_DIRECTORY_ENTRIES
      ? `The image exceeds the ${String(MAX_INSPECT_PE_DIRECTORY_ENTRIES)}-entry resource-directory ceiling this operation accepts. This release has no runtime override. Select a smaller artifact.`
      : `Raise max_entries above ${String(input.max_entries)} or select a smaller artifact; the limit is the caller-selected resource directory entry budget.`;

const peResourcesFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectPeResourcesInput,
) => {
  const { cause, origin } = facts;
  const operation = "inspect_pe_resources";
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      operation,
      input.path,
      cause.message,
      { cause },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(operation, {
      cause: artifactFileCancellationCause(cause),
    });

  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    // An input byte budget is a file-size bound, not a memory constraint, and
    // an entry budget is a capacity bound. Report what was actually exceeded.
    if (cause.reason === "limit") {
      const metadata = cause.boundary === "memory";
      return new AnalysisResourceConstraintError(
        operation,
        cause.boundary ?? "memory",
        cause.message,
        {
          max_file_bytes: input.max_file_bytes,
          max_entries: input.max_entries,
          ...(metadata
            ? { maximum_metadata_bytes: PE_RESOURCE_METADATA_BYTES }
            : {}),
        },
        {
          cause,
          // Caller-selected budgets and the fixed metadata allowance are
          // deterministic for the same input, so waiting cannot help.
          ...(cause.boundary === undefined
            ? {}
            : metadata
              ? fixedNativeAllowance(
                  "The PE resource metadata allowance",
                  "parser",
                  `${String(PE_RESOURCE_METADATA_BYTES)} bytes (8 MiB)`,
                )
              : {
                  retryable: false as const,
                  remediationAction: inputBudgetRemediation(
                    cause.boundary,
                    input,
                  ),
                }),
        },
      );
    }
    if (cause.reason === "path" || cause.reason === "format")
      return new AnalysisInputError(operation, { cause }, [
        {
          path: ["path"],
          reason: "invalid_format",
          message: cause.message,
        },
      ]);
  }

  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(operation, input.path, cause.code, {
        cause,
      });
    if (isSelectedRegularFileError(cause))
      return new AnalysisInputError(operation, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected PE image could not be read (${cause.code}): ${input.path}.`,
        },
      ]);
  }

  return new ArtifactOperationError(
    operation,
    origin === "owned-or-classified" && cause instanceof ArtifactReaderFailure
      ? cause.reason
      : "io",
    undefined,
    cause instanceof Error ? cause.message : "PE artifact inspection failed.",
    { cause },
  );
};

const peResourcesFailure = (cause: unknown, input: InspectPeResourcesInput) => {
  const primary = peResourcesFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    PE_RESOURCES_PROVIDER.id,
    "inspect_pe_resources",
  );
};
