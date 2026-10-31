import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../artifacts/StableArtifactFailure.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactSelectedPathErrno,
  artifactFileCancellationCause,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { BeamPort } from "../application/erlang/BeamPort.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import { ArtifactOperationError } from "../domain/artifactOperationError.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import {
  MAX_INSPECT_ERLANG_BEAM_ATOMS,
  MAX_INSPECT_ERLANG_BEAM_CHUNKS,
  MAX_INSPECT_ERLANG_BEAM_FILE_BYTES,
  type InspectErlangBeamInput,
} from "../domain/erlang/beam.js";
import { err, ok } from "../domain/result.js";
import { BeamCapacityFailure, parseErlangBeam } from "./BeamParser.js";

/** Bundled format reader identity; module names are separate observed facts. */
export const ERLANG_BEAM_PROVIDER_IDENTITY = {
  id: "rea-erlang-beam",
  name: "REA Erlang BEAM reader",
  version: "1",
} as const;

const OPERATION = "inspect_erlang_beam";

/** Portable parser over one bounded, identity-checked regular file. */
export class BeamProvider implements BeamPort {
  readonly identity = ERLANG_BEAM_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        ERLANG_BEAM_PROVIDER_IDENTITY.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectErlangBeamInput, options?: ExecutionOptions) {
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
          parseErlangBeam(
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
      return err(beamFailure(cause, input));
    }
  }
}

const inputBudgetRemediation = (
  cause: ArtifactReaderFailure,
  input: InspectErlangBeamInput,
): string | undefined => {
  if (cause.boundary === "file-size")
    return input.max_file_bytes >= MAX_INSPECT_ERLANG_BEAM_FILE_BYTES
      ? `The file exceeds the ${String(MAX_INSPECT_ERLANG_BEAM_FILE_BYTES)}-byte input ceiling this operation accepts; select a smaller artifact.`
      : `Raise max_file_bytes above ${String(input.max_file_bytes)} bytes or select a smaller artifact; the limit is the caller-selected input read budget.`;
  if (!(cause instanceof BeamCapacityFailure)) return undefined;
  switch (cause.resource) {
    case "atoms":
      return cause.maximum >= MAX_INSPECT_ERLANG_BEAM_ATOMS
        ? `The file exceeds the ${String(MAX_INSPECT_ERLANG_BEAM_ATOMS)}-atom ceiling this operation accepts; select a smaller artifact.`
        : `Raise max_atoms above ${String(cause.maximum)} or select a smaller artifact; the limit is the caller-selected atom budget.`;
    case "table-rows":
      return `The file exceeds the ${String(cause.maximum)}-row ceiling this operation accepts; select a smaller artifact.`;
    case "chunks":
      return cause.maximum >= MAX_INSPECT_ERLANG_BEAM_CHUNKS
        ? `The file exceeds the ${String(MAX_INSPECT_ERLANG_BEAM_CHUNKS)}-chunk ceiling this operation accepts; select a smaller artifact.`
        : `Raise max_chunks above ${String(cause.maximum)} or select a smaller artifact; the limit is the caller-selected chunk budget.`;
  }
};

const beamFailurePrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectErlangBeamInput,
) => {
  const { cause, origin } = facts;
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
      const remediationAction = inputBudgetRemediation(cause, input);
      return new AnalysisResourceConstraintError(
        OPERATION,
        cause.boundary ?? "memory",
        cause.message,
        {
          max_file_bytes: input.max_file_bytes,
          max_chunks: input.max_chunks,
          max_atoms: input.max_atoms,
        },
        {
          cause,
          ...(remediationAction === undefined
            ? {}
            : {
                retryable: false,
                remediationAction,
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
    const pathErrno = artifactSelectedPathErrno(cause);
    if (pathErrno !== undefined)
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected BEAM file could not be read (${pathErrno}): ${input.path}.`,
        },
      ]);
  }
  return new ArtifactOperationError(
    OPERATION,
    origin === "owned-or-classified" && cause instanceof ArtifactReaderFailure
      ? cause.reason
      : "io",
    undefined,
    cause instanceof Error ? cause.message : "BEAM inspection failed.",
    { cause },
  );
};

const beamFailure = (cause: unknown, input: InspectErlangBeamInput) => {
  const primary = beamFailurePrimary(artifactFilePrimaryFacts(cause), input);
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    ERLANG_BEAM_PROVIDER_IDENTITY.id,
    OPERATION,
  );
};
