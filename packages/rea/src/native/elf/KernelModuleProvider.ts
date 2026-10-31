import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { KernelModulePort } from "../../application/binaryDiagnostics/KernelModulePort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import {
  MAX_INSPECT_KERNEL_MODULE_ENTRIES,
  MAX_INSPECT_KERNEL_MODULE_FILE_BYTES,
  type InspectKernelModuleInput,
} from "../../domain/native/kernelModule.js";
import { err, ok } from "../../domain/result.js";
import { KERNEL_MODULE_PROVIDER } from "../../domain/investigationProviders.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../metadata/BinaryContainer.js";
import { parseKernelModule } from "./KernelModuleParser.js";

const OPERATION = "inspect_kernel_module";

/** Portable parser over one bounded, identity-checked regular file. */
export class KernelModuleProvider implements KernelModulePort {
  readonly identity = KERNEL_MODULE_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        KERNEL_MODULE_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectKernelModuleInput, options?: ExecutionOptions) {
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
          parseKernelModule(
            snapshot.bytes,
            {
              path: input.path,
              sha256: snapshot.sha256,
              bytes: snapshot.bytes.length,
            },
            input,
          ),
        );
      });
    } catch (cause) {
      return err(kernelModuleFailure(cause, input));
    }
  }
}

const TEXT_BUDGET =
  "The kernel-module entry text and hash budget fixed by the admitted image length";

const inputBudgetRemediation = (
  boundary: "file-size" | "capacity",
  input: InspectKernelModuleInput,
): string =>
  boundary === "file-size"
    ? input.max_file_bytes >= MAX_INSPECT_KERNEL_MODULE_FILE_BYTES
      ? `The image exceeds the ${String(MAX_INSPECT_KERNEL_MODULE_FILE_BYTES)}-byte input ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`
    : input.max_entries >= MAX_INSPECT_KERNEL_MODULE_ENTRIES
      ? `The image exceeds the ${String(MAX_INSPECT_KERNEL_MODULE_ENTRIES)}-entry kernel-module ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_entries above ${String(input.max_entries)} or select a smaller artifact; the limit is the caller-selected .modinfo and __versions entry budget.`;

const kernelModuleFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectKernelModuleInput,
) => {
  const { cause, origin } = facts;
  if (cause instanceof BinaryResourceFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      "memory",
      cause.message,
      { boundary: cause.boundary, maximum_bytes: cause.maximum_bytes },
      {
        cause,
        ...fixedAllowanceOptions(
          "The ELF structural decoding allowance",
          "parser",
        ),
      },
    );
  if (cause instanceof BinaryFormatFailure)
    return cause.kind === "unsupported"
      ? new AnalysisUnsupportedTargetError(
          OPERATION,
          input.path,
          cause.message,
          { cause },
        )
      : new AnalysisInputError(OPERATION, { cause }, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: cause.message,
          },
        ]);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      OPERATION,
      input.path,
      cause.message,
      {
        cause,
      },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit") {
      // Caller-selected read and entry budgets name the bound to raise.
      // Entry text and hashes are bounded by the admitted image, so host
      // memory cannot raise that ceiling.
      const textBudget = cause.boundary === "memory";
      return new AnalysisResourceConstraintError(
        OPERATION,
        cause.boundary ?? "memory",
        cause.message,
        {
          max_file_bytes: input.max_file_bytes,
          max_entries: input.max_entries,
        },
        {
          cause,
          ...(cause.boundary === undefined
            ? {}
            : textBudget
              ? fixedAllowanceOptions(TEXT_BUDGET, "parser")
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
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_format",
          message: cause.message,
        },
      ]);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, input.path, cause.code, {
        cause,
      });
    if (isSelectedRegularFileError(cause))
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected kernel module could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ArtifactOperationError(
    OPERATION,
    origin === "owned-or-classified" && cause instanceof ArtifactReaderFailure
      ? cause.reason
      : "io",
    undefined,
    cause instanceof Error ? cause.message : "Kernel module inspection failed.",
    { cause },
  );
};

const kernelModuleFailure = (
  cause: unknown,
  input: InspectKernelModuleInput,
) => {
  const primary = kernelModuleFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    KERNEL_MODULE_PROVIDER.id,
    OPERATION,
  );
};
