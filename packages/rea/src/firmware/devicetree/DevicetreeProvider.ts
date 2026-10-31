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
import type { DevicetreePort } from "../../application/binaryDiagnostics/DevicetreePort.js";
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
import {
  MAX_DEVICETREE_FILE_BYTES,
  type InspectDevicetreeInput,
} from "../../domain/firmware/devicetree.js";
import { err, ok } from "../../domain/result.js";
import { DEVICETREE_PROVIDER } from "../../domain/investigationProviders.js";
import { BinaryFormatFailure } from "../../native/metadata/BinaryContainer.js";
import { DevicetreeLimitFailure, parseDevicetree } from "./DevicetreeParser.js";

const OPERATION = "inspect_devicetree";

/** Portable parser over one bounded, identity-checked regular file. */
export class DevicetreeProvider implements DevicetreePort {
  readonly identity = DEVICETREE_PROVIDER;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        DEVICETREE_PROVIDER.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectDevicetreeInput, options?: ExecutionOptions) {
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
          parseDevicetree(
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
      return err(devicetreeFailure(cause, input));
    }
  }
}

const devicetreeFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectDevicetreeInput,
) => {
  const { cause, origin } = facts;
  if (cause instanceof DevicetreeLimitFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      cause.limit === "decoded_bytes" ? "memory" : "capacity",
      cause.message,
      {
        limit: cause.limit,
        selected:
          cause.limit === "decoded_bytes" ? 33554432 : input[cause.limit],
      },
      { cause, retryable: false, remediationAction: cause.message },
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
      return new AnalysisResourceConstraintError(
        OPERATION,
        cause.boundary ?? "memory",
        cause.message,
        { max_file_bytes: input.max_file_bytes },
        {
          cause,
          retryable: false,
          remediationAction:
            input.max_file_bytes < MAX_DEVICETREE_FILE_BYTES
              ? "Raise max_file_bytes within its schema ceiling or select a smaller DTB."
              : "Select a smaller DTB; the fixed file-byte ceiling has been reached.",
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
          message: `Selected devicetree blob could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ArtifactOperationError(
    OPERATION,
    origin === "owned-or-classified" && cause instanceof ArtifactReaderFailure
      ? cause.reason
      : "io",
    undefined,
    cause instanceof Error ? cause.message : "devicetree inspection failed.",
    { cause },
  );
};

const devicetreeFailure = (cause: unknown, input: InspectDevicetreeInput) => {
  const primary = devicetreeFailurePrimary(
    artifactFilePrimaryFacts(cause),
    input,
  );
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    DEVICETREE_PROVIDER.id,
    OPERATION,
  );
};
