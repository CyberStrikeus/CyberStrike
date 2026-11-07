import type { WebArtifactAcquisition as Acquisition } from "../../domain/webArtifactAcquisition.js";
import { z } from "zod";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  bindArtifactFileCleanup,
  type ArtifactFilePrimaryFacts,
} from "../../artifacts/ArtifactFileOperation.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  completedStableArtifact,
  readStableArtifact,
} from "../../artifacts/readStableArtifact.js";
import {
  AnalysisError,
  primaryAnalysisError,
} from "../../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { safeParseJson } from "../../domain/safeJson.js";

/** The selected artifact and input field owning a reader failure. */
export interface WebArtifactReadContext {
  readonly operation: "trace_web_module_imports" | "trace_web_source_location";
  readonly field: readonly (string | number)[];
  readonly targetPath: string;
  /** Whether the caller named this file, rather than a manifest deriving it. */
  readonly callerSelected: boolean;
}

/** A malformed producer document, distinct from host I/O failures. */
export class WebArtifactFormatFailure extends Error {}

/** Decode exact UTF-8 content, preserving a BOM for digest verification. */
export const decodeWebArtifact = (bytes: Buffer): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (cause: unknown) {
    throw new WebArtifactFormatFailure(
      "Selected artifact is not valid UTF-8.",
      { cause },
    );
  }
};

/** Own the independently completed physical reads throughout web acquisition. */
export class WebArtifactAcquisition {
  readonly files: Acquisition["files"] = [];

  record(
    role: Acquisition["files"][number]["role"],
    file: Acquisition["files"][number]["file"],
    admission: Acquisition["files"][number]["admission"] = "read",
  ): void {
    const previous = this.files.findIndex((entry) => entry.role === role);
    const receipt = { role, file, admission };
    if (previous < 0) this.files.push(receipt);
    else this.files[previous] = receipt;
  }

  async read(
    role: Acquisition["files"][number]["role"],
    path: string,
    maximumBytes: number,
    signal?: AbortSignal,
    scope?: ArtifactResourceScope,
  ) {
    try {
      const data = await readStableArtifact(
        path,
        maximumBytes,
        signal,
        undefined,
        scope,
      );
      this.record(role, {
        path,
        sha256: data.sha256,
        bytes: data.bytes.length,
      });
      return data;
    } catch (cause: unknown) {
      const completed = completedStableArtifact(cause);
      if (completed !== undefined)
        this.record(role, {
          path,
          sha256: completed.sha256,
          bytes: completed.bytes.length,
        });
      throw cause;
    }
  }

  async readJson(
    role: Acquisition["files"][number]["role"],
    path: string,
    maximumBytes: number,
    signal?: AbortSignal,
    scope?: ArtifactResourceScope,
  ) {
    const data = await this.read(role, path, maximumBytes, signal, scope);
    const value = safeParseJson(decodeWebArtifact(data.bytes));
    if (!value.ok) throw new WebArtifactFormatFailure(value.error);
    return { ...data, value: value.value };
  }

  retain(error: AnalysisError): AnalysisError {
    if (this.files.length > 0) {
      const observation: Acquisition = {
        kind: "web-artifact-acquisition",
        analysis: "not-performed",
        files: this.files.map((entry) => ({
          ...entry,
          file: { ...entry.file },
        })),
      };
      error.partialObservation = observation;
      primaryAnalysisError(error).partialObservation = observation;
    }
    return error;
  }
}

/** Preserve artifact format, integrity, OS I/O, and cancellation reasons. */
export const webArtifactReadError = (
  cause: unknown,
  context: WebArtifactReadContext,
  signal?: AbortSignal,
): AnalysisError => {
  const primary = webArtifactPrimaryError(
    artifactFilePrimaryFacts(cause),
    context,
    signal,
  );
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const cleanup = new ProviderCleanupError(
      "captured-web-artifacts",
      cause.cleanup.resources,
      { reason: cause.cleanup.reason },
      { cause, operation: context.operation },
    );
    bindArtifactFileCleanup(cause, cleanup);
    return analysisErrorWithCleanupFailure(
      primary,
      cleanup,
      context.operation,
    ).bindCleanupDependencies([primary, cleanup]);
  }
  return primary;
};

const webArtifactPrimaryError = (
  { cause, origin }: ArtifactFilePrimaryFacts,
  context: WebArtifactReadContext,
  signal?: AbortSignal,
): AnalysisError => {
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(context.operation, {
      cause: artifactFileCancellationCause(cause),
    });
  if (
    origin === "owned-or-classified" &&
    signal?.aborted === true &&
    (cause === signal.reason ||
      (cause instanceof Error &&
        cause.name === "AbortError" &&
        "code" in cause &&
        cause.code === "ABORT_ERR"))
  )
    return new AnalysisCancelledError(context.operation, {
      cause: signal.reason,
    });
  const selection = context.callerSelected
    ? selectedFileError({ cause, origin }, context)
    : undefined;
  if (selection !== undefined) return selection;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  )
    return new ArtifactOperationError(
      context.operation,
      cause.reason,
      cause.details,
      cause.message,
      { cause },
    );
  if (
    cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string" &&
    "syscall" in cause &&
    typeof cause.syscall === "string"
  )
    return new ArtifactOperationError(
      context.operation,
      "io",
      undefined,
      `${context.targetPath}: ${cause.code}: ${cause.message}`,
      { cause },
    );
  if (!context.callerSelected && cause instanceof WebArtifactFormatFailure)
    return new ArtifactOperationError(
      context.operation,
      "format",
      undefined,
      `${context.targetPath}: ${cause.message}`,
      { cause },
    );
  if (cause instanceof WebArtifactFormatFailure || cause instanceof z.ZodError)
    return new AnalysisInputError(context.operation, { cause }, [
      {
        path: context.field,
        reason: "invalid_format",
        message: `${context.targetPath}: ${cause.message}`,
      },
    ]);
  return new ProviderAdapterError("captured-web-artifacts", context.operation, {
    cause,
    diagnostics: {
      target_path: context.targetPath,
      field: context.field.join("."),
      error_message: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

/**
 * Report a missing, non-regular or unreadable caller-selected file as the
 * caller's selection or a host permission denial, not an artifact fault.
 */
const selectedFileError = (
  { cause, origin }: ArtifactFilePrimaryFacts,
  context: WebArtifactReadContext,
): AnalysisError | undefined => {
  const selected = (message: string) =>
    new AnalysisInputError(context.operation, { cause }, [
      { path: context.field, reason: "invalid_value", message },
    ]);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  )
    return cause.reason === "path" ? selected(cause.message) : undefined;
  const code =
    cause instanceof Error && "code" in cause ? String(cause.code) : "";
  if (code === "EACCES" || code === "EPERM")
    return new AnalysisAccessDeniedError(
      context.operation,
      context.targetPath,
      code,
      { cause },
    );
  if (code === "ENOENT" || code === "ENOTDIR")
    return selected(
      `Selected file could not be read (${code}): ${context.targetPath}`,
    );
  return undefined;
};
