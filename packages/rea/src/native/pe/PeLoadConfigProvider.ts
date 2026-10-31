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
  assertArtifactReadActive,
  artifactFileCancellationCause,
} from "../../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { PeLoadConfigPort } from "../../application/binaryDiagnostics/PeLoadConfigPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
  type ResourceConstraintRecovery,
} from "../../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import {
  MAX_INSPECT_PE_LOAD_CONFIG_FILE_BYTES,
  MAX_INSPECT_PE_LOAD_CONFIG_CALLBACKS,
  type InspectPeLoadConfigInput,
} from "../../domain/native/peLoadConfig.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { err, ok } from "../../domain/result.js";
import { PE_LOAD_CONFIG_PROVIDER } from "../../domain/investigationProviders.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../metadata/BinaryContainer.js";
import {
  parsePeLoadConfig,
  PeLoadConfigLimitFailure,
  type PeLoadConfigLimit,
} from "./PeLoadConfigParser.js";

const OPERATION = "inspect_pe_load_config";

/** Portable TLS/load-config reader over one bounded, identity-checked regular file. */
export class PeLoadConfigProvider implements PeLoadConfigPort {
  readonly identity = PE_LOAD_CONFIG_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        PE_LOAD_CONFIG_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectPeLoadConfigInput, options?: ExecutionOptions) {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          input.max_file_bytes,
          options?.signal,
          undefined,
          this.#resources,
        );
        assertArtifactReadActive(options?.signal);
        const report = await parsePeLoadConfig(
          snapshot.bytes,
          {
            path: input.path,
            sha256: snapshot.sha256,
            bytes: snapshot.bytes.length,
          },
          input,
          options?.signal,
        );
        assertArtifactReadActive(options?.signal);
        return ok(report);
      });
    } catch (cause) {
      return err(peLoadConfigFailure(cause, input));
    }
  }
}

const fileSizeRemediation = (input: InspectPeLoadConfigInput): string =>
  input.max_file_bytes >= MAX_INSPECT_PE_LOAD_CONFIG_FILE_BYTES
    ? `The image exceeds the ${String(MAX_INSPECT_PE_LOAD_CONFIG_FILE_BYTES)}-byte input ceiling this operation accepts. This release has no runtime override. Select a smaller artifact.`
    : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`;

const limitRecovery = (
  limit: PeLoadConfigLimit | null,
  input: InspectPeLoadConfigInput,
): ResourceConstraintRecovery =>
  limit === "callbacks"
    ? {
        retryable: false,
        remediationAction:
          input.max_callbacks >= MAX_INSPECT_PE_LOAD_CONFIG_CALLBACKS
            ? `The image exceeds the ${String(MAX_INSPECT_PE_LOAD_CONFIG_CALLBACKS)}-callback ceiling; select a smaller artifact.`
            : `Raise max_callbacks above ${String(input.max_callbacks)} or select a smaller artifact.`,
      }
    : fixedAllowanceOptions("The PE structural decoding allowance", "parser");

const peLoadConfigFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectPeLoadConfigInput,
): AnalysisError => {
  const { cause, origin } = facts;
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      OPERATION,
      input.path,
      cause.message,
      { cause },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (cause instanceof BinaryResourceFailure) {
    const limit =
      cause instanceof PeLoadConfigLimitFailure ? cause.limit : null;
    return new AnalysisResourceConstraintError(
      OPERATION,
      "capacity",
      `Selected artifact ${input.path}: ${cause.message}`,
      { boundary: cause.boundary, maximum: cause.maximum_bytes, limit },
      { cause, ...limitRecovery(limit, input) },
    );
  }
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
            message: `Selected artifact ${input.path}: ${cause.message}`,
          },
        ]);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        cause.message,
        { max_file_bytes: input.max_file_bytes },
        {
          cause,
          retryable: false,
          remediationAction: fileSizeRemediation(input),
        },
      );
    if (cause.reason === "path" || cause.reason === "format")
      return new AnalysisInputError(OPERATION, { cause }, [
        { path: ["path"], reason: "invalid_format", message: cause.message },
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
          message: `Selected image could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(PE_LOAD_CONFIG_PROVIDER.id, OPERATION, {
    cause,
    diagnostics: {
      path: input.path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const peLoadConfigFailure = (
  cause: unknown,
  input: InspectPeLoadConfigInput,
): AnalysisError => {
  const primary = peLoadConfigFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    PE_LOAD_CONFIG_PROVIDER.id,
    OPERATION,
  );
};
