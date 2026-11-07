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
import type { PeImportsPort } from "../../application/binaryDiagnostics/PeImportsPort.js";
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
  MAX_INSPECT_PE_IMPORT_DLLS,
  MAX_INSPECT_PE_IMPORT_FILE_BYTES,
  MAX_INSPECT_PE_IMPORT_FUNCTIONS,
  MAX_INSPECT_PE_IMPORT_RETAINED_TEXT_BYTES,
  type InspectPeImportsInput,
} from "../../domain/native/peImports.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { err, ok } from "../../domain/result.js";
import { PE_IMPORTS_PROVIDER } from "../../domain/investigationProviders.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../metadata/BinaryContainer.js";
import {
  parsePeImports,
  PeImportLimitFailure,
  type PeImportLimit,
} from "./PeImportParser.js";

const OPERATION = "inspect_pe_imports";

/** Portable import-table reader over one bounded, identity-checked regular file. */
export class PeImportsProvider implements PeImportsPort {
  readonly identity = PE_IMPORTS_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        PE_IMPORTS_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectPeImportsInput, options?: ExecutionOptions) {
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
        const report = await parsePeImports(
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
      return err(peImportsFailure(cause, input));
    }
  }
}

const fileSizeRemediation = (input: InspectPeImportsInput): string =>
  input.max_file_bytes >= MAX_INSPECT_PE_IMPORT_FILE_BYTES
    ? `The image exceeds the ${String(MAX_INSPECT_PE_IMPORT_FILE_BYTES)}-byte input ceiling this operation accepts. This release has no runtime override. Select a smaller artifact.`
    : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`;

const dllRemediation = (input: InspectPeImportsInput): string =>
  input.max_dlls >= MAX_INSPECT_PE_IMPORT_DLLS
    ? `The image exceeds the ${String(MAX_INSPECT_PE_IMPORT_DLLS)}-entry import-descriptor ceiling this operation accepts; select a smaller artifact.`
    : `Raise max_dlls above ${String(input.max_dlls)} or select a smaller artifact; the limit is the caller-selected DLL budget.`;

const functionRemediation = (input: InspectPeImportsInput): string =>
  input.max_functions >= MAX_INSPECT_PE_IMPORT_FUNCTIONS
    ? `The image exceeds the ${String(MAX_INSPECT_PE_IMPORT_FUNCTIONS)}-entry imported-function ceiling this operation accepts; select a smaller artifact.`
    : `Raise max_functions above ${String(input.max_functions)} or select a smaller artifact; the limit is the caller-selected function budget.`;

/** Recovery for one exhausted allowance, chosen from the parser's structured tag. */
const limitRecovery = (
  limit: PeImportLimit | null,
  input: InspectPeImportsInput,
): ResourceConstraintRecovery => {
  switch (limit) {
    case "dlls":
      return { retryable: false, remediationAction: dllRemediation(input) };
    case "functions":
      return {
        retryable: false,
        remediationAction: functionRemediation(input),
      };
    case "retained_text":
      return fixedAllowanceOptions(
        `The ${String(MAX_INSPECT_PE_IMPORT_RETAINED_TEXT_BYTES)}-byte PE import retained-text allowance (this release has no runtime override; max_file_bytes, max_dlls and max_functions do not raise it)`,
        "bytes",
      );
    case null:
      return fixedAllowanceOptions(
        "The PE structural decoding allowance",
        "parser",
      );
  }
};

const peImportsFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectPeImportsInput,
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
    const limit = cause instanceof PeImportLimitFailure ? cause.limit : null;
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
  return new ProviderAdapterError(PE_IMPORTS_PROVIDER.id, OPERATION, {
    cause,
    diagnostics: {
      path: input.path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const peImportsFailure = (
  cause: unknown,
  input: InspectPeImportsInput,
): AnalysisError => {
  const primary = peImportsFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    PE_IMPORTS_PROVIDER.id,
    OPERATION,
  );
};
