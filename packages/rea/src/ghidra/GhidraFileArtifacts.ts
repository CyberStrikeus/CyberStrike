import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { open } from "node:fs/promises";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  assertArtifactReadActive,
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  mapArtifactFileFailure,
  bindArtifactFileCleanup,
  withArtifactFileHandle,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import {
  readStableFileBytes,
  RegularFileCapacityError,
} from "../filesystem/readStableFileBytes.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { RegularFileChangedError } from "../filesystem/RegularFile.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { JsonValue } from "../domain/jsonValue.js";

/** Bounded serial read; the caller owns admission and final descriptor cleanup. */
export const readGhidraProfileArtifact = <Value>(
  path: string,
  maximumBytes: number,
  resources: ArtifactResourceScope,
  signal: AbortSignal | undefined,
  interpret: (bytes: Buffer) => Value,
): Promise<Value> =>
  withArtifactRegularFile(path, resources, signal, async ({ handle: file }) => {
    const bytes = await readStableFileBytes(file, path, maximumBytes, {
      symlinks: "reject",
      ...(signal === undefined ? {} : { signal }),
    });
    return interpret(bytes);
  });

/** Own the new private snapshot descriptor through write and final close. */
export const writeGhidraProfileArtifact = async (
  path: string,
  bytes: Buffer | string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<void> => {
  assertArtifactReadActive(signal);
  const file = await open(path, "wx", 0o600);
  await withArtifactFileHandle(path, file, resources, signal, (handle) =>
    handle.writeFile(bytes),
  );
};

/** Preserve physical failure, exact cancellation, and all retained file leases. */
export const ghidraFileFailure = (
  cause: unknown,
  operation: string,
  diagnostics: Readonly<Record<string, JsonValue>> = {},
): AnalysisError => {
  cause = mapArtifactFileFailure(cause, (primary) => {
    if (primary instanceof RegularFileCapacityError)
      return new AnalysisResourceConstraintError(
        operation,
        "file-size",
        primary.message,
        {
          maximum_bytes: primary.maximumBytes,
          observed_bytes: primary.observedBytes.toString(),
        },
        { cause: primary, diagnostics, retryable: false },
      );
    if (primary instanceof RegularFileChangedError)
      return new AnalysisArtifactChangedError(
        operation,
        primary.path,
        primary.message,
        { cause: primary, diagnostics },
      );
    if (
      primary instanceof Error &&
      "code" in primary &&
      (primary.code === "EACCES" || primary.code === "EPERM")
    ) {
      const path =
        "path" in primary && typeof primary.path === "string"
          ? primary.path
          : diagnostics.path;
      if (typeof path === "string")
        return new AnalysisAccessDeniedError(operation, path, primary.code, {
          cause: primary,
          diagnostics,
        });
    }
    return primary;
  });
  const { cause: primary, origin } = artifactFilePrimaryFacts(cause);
  const admission =
    primary instanceof GhidraAdmissionError ? primary : undefined;
  const reason =
    admission?.code ??
    (primary instanceof Error ? primary.message : String(primary));
  const systemCode =
    admission === undefined &&
    primary instanceof Error &&
    "code" in primary &&
    typeof primary.code === "string"
      ? primary.code
      : undefined;
  const cleanup =
    cause instanceof ArtifactReaderFailure ? cause.cleanup : undefined;
  if (origin === "owned-or-classified" && primary instanceof AnalysisError) {
    if (cleanup === undefined) return primary;
    const failure = new ProviderCleanupError(
      "ghidra",
      cleanup.resources,
      {
        reason: cleanup.reason,
      },
      { cause },
    );
    bindArtifactFileCleanup(cause, failure);
    return analysisErrorWithCleanupFailure(
      primary,
      failure,
      operation,
    ).bindCleanupDependencies([
      ...(primary.cleanupIncomplete ? [primary] : []),
      failure,
    ]);
  }
  const error =
    cause instanceof ArtifactReaderFailure && cause.reason === "cancelled"
      ? new AnalysisCancelledError(operation, {
          cause: artifactFileCancellationCause(cause),
          cleanup,
          diagnostics,
        })
      : new ProviderAdapterError("ghidra", operation, {
          cause,
          cleanup,
          diagnostics: {
            ...admission?.detail,
            ...diagnostics,
            ...(admission === undefined ? {} : { code: admission.code }),
            ...(systemCode === undefined ? {} : { system_code: systemCode }),
            ...(primary instanceof Error &&
            "syscall" in primary &&
            typeof primary.syscall === "string"
              ? { syscall: primary.syscall }
              : {}),
            reason,
          },
          userMessage: reason,
        });
  bindArtifactFileCleanup(cause, error);
  return error;
};
