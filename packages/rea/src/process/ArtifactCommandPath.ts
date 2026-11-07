import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { realpath } from "node:fs/promises";

import {
  artifactSelectedPathErrno,
  assertArtifactReadActive,
} from "../artifacts/ArtifactFileOperation.js";
import type { AnalysisCapturedOutput } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
} from "../domain/analysisErrorCore.js";

/** The selected launch spelling and the physical file whose bytes are fingerprinted. */
export interface ArtifactCommandPath {
  readonly invocationPath: string;
  readonly resolvedPath: string;
}

/** Resolve identity without changing the caller's absolute executable selection. */
export const selectArtifactCommandPath = async (
  invocationPath: string,
  signal?: AbortSignal,
): Promise<ArtifactCommandPath> => {
  assertArtifactReadActive(signal);
  const resolvedPath = await realpath(invocationPath);
  assertArtifactReadActive(signal);
  return Object.freeze({ invocationPath, resolvedPath });
};

/** An invocation must still select the admitted physical executable. */
export const assertArtifactCommandPath = async (
  selected: ArtifactCommandPath,
  operation: string,
  options: {
    readonly signal?: AbortSignal | undefined;
    readonly capturedOutput?: AnalysisCapturedOutput;
  } = {},
): Promise<void> => {
  assertArtifactReadActive(options.signal);
  const changed = (cause?: unknown) =>
    new AnalysisArtifactChangedError(
      operation,
      selected.invocationPath,
      "Selected command no longer resolves to its admitted executable.",
      {
        cause,
        ...(options.capturedOutput === undefined
          ? {}
          : { capturedOutput: options.capturedOutput }),
      },
    );
  let current: string;
  try {
    current = await realpath(selected.invocationPath);
  } catch (cause: unknown) {
    if (artifactSelectedPathErrno(cause) !== undefined) throw changed(cause);
    const systemCode =
      cause instanceof Error && "code" in cause
        ? String(cause.code)
        : undefined;
    const failureOptions = { cause, capturedOutput: options.capturedOutput };
    if (systemCode === "EACCES" || systemCode === "EPERM")
      throw new AnalysisAccessDeniedError(
        operation,
        selected.invocationPath,
        systemCode,
        failureOptions,
      );
    throw new ProviderAdapterError("rea", operation, {
      ...failureOptions,
      diagnostics: {
        path: selected.invocationPath,
        reason: cause instanceof Error ? cause.message : String(cause),
        system_code: systemCode ?? null,
      },
    });
  }
  if (current !== selected.resolvedPath) throw changed();
  assertArtifactReadActive(options.signal);
};
