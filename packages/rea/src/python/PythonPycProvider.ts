import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../filesystem/RegularFile.js";
import {
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { PythonPycPort } from "../application/python/PythonPycPort.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  PYTHON_PYC_LIMIT_MAXIMA,
  type InspectPythonPycInput,
} from "../domain/python/pythonPyc.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok } from "../domain/result.js";
import {
  PythonPycFormatFailure,
  PythonPycResourceFailure,
} from "./PythonPyc.errors.js";
import { parsePythonPyc } from "./PythonPycParser.js";

/** Bundled reader identity. Header python_version is a separate observed mapping. */
export const PYTHON_PYC_PROVIDER_IDENTITY = {
  id: "rea-python-pyc",
  name: "REA CPython pyc parser",
  version: "1",
} as const;

const OPERATION = "inspect_python_pyc";

const parserLimitRecovery = (
  limits: PythonPycResourceFailure["reported_limits"],
) => {
  const actions = (
    Object.keys(
      PYTHON_PYC_LIMIT_MAXIMA,
    ) as (keyof typeof PYTHON_PYC_LIMIT_MAXIMA)[]
  ).flatMap((field) => {
    const selected = limits[field];
    if (selected === undefined) return [];
    const maximum = PYTHON_PYC_LIMIT_MAXIMA[field];
    const option = `--${field.replaceAll("_", "-")}`;
    return [
      selected < maximum
        ? `Raise ${field} (${option}) above ${selected}, up to ${maximum}, on the next call.`
        : `${field} (${option}) is at this operation's maximum of ${maximum}; select a complete artifact within that bound.`,
    ];
  });
  return {
    retryable: false as const,
    remediationAction: `${actions.join(" ")} Repeating the unchanged request fails the same way; waiting or adding host memory does not raise these parser limits.`,
  };
};

const failureForPrimary = (
  facts: ArtifactFilePrimaryFacts,
  input: InspectPythonPycInput,
) => {
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
  if (cause instanceof PythonPycResourceFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      cause.boundary === "depth" ? "capacity" : "memory",
      cause.message,
      cause.reported_limits,
      { cause, ...parserLimitRecovery(cause.reported_limits) },
    );
  if (cause instanceof PythonPycFormatFailure)
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
            message: `Selected pyc ${input.path}: ${cause.message}`,
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
          ...parserLimitRecovery({ max_file_bytes: input.max_file_bytes }),
        },
      );
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
          message: `Selected pyc could not be read (${String(cause.code)}): ${input.path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(PYTHON_PYC_PROVIDER_IDENTITY.id, OPERATION, {
    cause,
    diagnostics: {
      path: input.path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const failureFor = (cause: unknown, input: InspectPythonPycInput) => {
  const primary = failureForPrimary(artifactFilePrimaryFacts(cause), input);
  return projectStableArtifactFailure(
    cause,
    primary,
    input.path,
    PYTHON_PYC_PROVIDER_IDENTITY.id,
    OPERATION,
  );
};

/** Portable parser over one bounded, identity-checked regular file. */
export class PythonPycProvider implements PythonPycPort {
  readonly identity = PYTHON_PYC_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        PYTHON_PYC_PROVIDER_IDENTITY.id,
        OPERATION,
      );
    }
  }

  async inspect(input: InspectPythonPycInput, options?: ExecutionOptions) {
    try {
      const snapshot = await this.#resources.run(() =>
        readStableArtifact(
          input.path,
          input.max_file_bytes,
          options?.signal,
          undefined,
          this.#resources,
        ),
      );
      return ok(
        parsePythonPyc(
          snapshot.bytes,
          {
            path: input.path,
            sha256: snapshot.sha256,
            bytes: snapshot.bytes.length,
          },
          input,
        ),
      );
    } catch (cause) {
      return err(failureFor(cause, input));
    }
  }
}
