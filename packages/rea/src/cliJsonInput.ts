import { addAbortListener } from "node:events";
import type { Readable } from "node:stream";
import { getHeapStatistics } from "node:v8";

import { absoluteCallerPath } from "./filesystem/callerPath.js";

import { sealOwnedJsonInput } from "./application/OwnedJsonInput.js";
import {
  JsonInputCancellationFailure,
  JsonInputPhysicalReadFailure,
  readJsonInputFile,
  nativeJsonParseRequiredBytes,
} from "./application/JsonInputFile.js";
import { NonRegularFileReadError } from "./filesystem/RegularFile.js";
import {
  AnalysisAccessDeniedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "./domain/analysisErrorCore.js";
import { projectAnalysisError } from "./domain/analysisErrorProjection.js";
import { err, ok, type Result } from "./domain/result.js";
import type { JsonValue } from "./domain/jsonValue.js";
import { safeParseJson } from "./domain/safeJson.js";
import {
  JSON_INPUT_RESOURCE_REMEDIATION,
  parseUtf8Json,
} from "./application/Utf8JsonInput.js";

/** Parse inline JSON, standard input ('-'), or one local JSON file, honoring optional caller cancellation. */
export const parseCliJsonInput = async (
  value: string,
  operation: string,
  signal?: AbortSignal,
  options?: {
    readonly snapshot?: boolean;
    readonly stdin?: Readable;
    readonly maxStdinBytes?: number;
  },
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: JsonValue }
> => {
  const cancelled = (cause: unknown) => ({
    ok: false as const,
    error: {
      error: "Application workflow failed",
      ...projectAnalysisError(
        new AnalysisCancelledError(operation, {
          cause,
        }),
      ),
    },
  });
  if (signal?.aborted) return cancelled(signal.reason);
  try {
    const inline = safeParseJson(value);
    if (inline.ok) {
      if (!options?.snapshot) return { ok: true, value: inline.value };
      const sealed = await sealOwnedJsonInput(inline.value, operation, signal);
      return sealed.ok
        ? { ok: true, value: sealed.value }
        : {
            ok: false,
            error: {
              error: "Application workflow failed",
              ...projectAnalysisError(sealed.error),
            },
          };
    }
    const parsed =
      value === "-"
        ? await readCliJsonStdin(operation, signal, options)
        : await readJsonInputFile(
            value,
            operation,
            signal,
            undefined,
            options?.snapshot ?? false,
          );
    if (parsed.ok && signal?.aborted) return cancelled(signal.reason);
    return parsed.ok
      ? { ok: true, value: parsed.value }
      : {
          ok: false,
          error: {
            error: "Application workflow failed",
            ...projectAnalysisError(parsed.error),
            input_path: value,
            input_reason:
              parsed.error._tag === "AnalysisInputError"
                ? "invalid-json"
                : "too-large",
          },
        };
  } catch (cause: unknown) {
    if (cause instanceof JsonInputCancellationFailure)
      return cancelled(cause.reason);
    if (cause instanceof JsonInputPhysicalReadFailure) {
      const physicalCause = cause.physicalCause;
      const systemCode = accessDeniedSystemCode(physicalCause);
      return systemCode === undefined
        ? jsonFileReadError(value, operation, physicalCause)
        : jsonAccessDeniedError(value, operation, systemCode, physicalCause);
    }
    if (signal?.aborted && isJsonInputCancellation(cause, signal))
      return cancelled(signal.reason);
    const systemCode = accessDeniedSystemCode(cause);
    if (systemCode !== undefined)
      return jsonAccessDeniedError(value, operation, systemCode, cause);
    if (
      ["{", "["].includes(value.trimStart()[0] ?? "") &&
      cannotBeAnExistingFile(cause) &&
      !hasExplicitJsonFileExtension(value)
    )
      return { ok: false, error: inputError(operation) };
    if (
      !(cause instanceof Error) ||
      !("code" in cause) ||
      typeof cause.code !== "string"
    )
      throw cause;
    return jsonFileReadError(value, operation, cause);
  }
};

const DEFAULT_MAX_STDIN_BYTES = 8 * 1024 * 1024;

const readCliJsonStdin = async (
  operation: string,
  signal?: AbortSignal,
  options?: {
    readonly snapshot?: boolean;
    readonly stdin?: Readable;
    readonly maxStdinBytes?: number;
  },
): Promise<
  Result<unknown, AnalysisInputError | AnalysisResourceConstraintError>
> => {
  const stream = options?.stdin ?? process.stdin;
  const maxBytes = options?.maxStdinBytes ?? DEFAULT_MAX_STDIN_BYTES;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const requireHeadroom = (): void => {
    const heap = getHeapStatistics();
    const requiredBytes = nativeJsonParseRequiredBytes(
      totalBytes,
      options?.snapshot,
    );
    if (requiredBytes > heap.total_available_size)
      throw new AnalysisResourceConstraintError(
        operation,
        "memory",
        "Insufficient heap headroom to read and parse the complete JSON stdin document",
        {
          input_path: "-",
          input_bytes: totalBytes,
          required_heap_bytes: requiredBytes,
          available_heap_bytes: heap.total_available_size,
          heap_size_limit_bytes: heap.heap_size_limit,
        },
        { remediationAction: JSON_INPUT_RESOURCE_REMEDIATION },
      );
  };
  // Destroying the reader wakes an idle next(); polling inside the loop cannot.
  const abort =
    signal === undefined
      ? undefined
      : addAbortListener(signal, () => {
          stream.destroy(new JsonInputCancellationFailure(signal.reason));
        });
  try {
    try {
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        totalBytes +=
          typeof chunk === "string"
            ? Buffer.byteLength(chunk)
            : chunk.byteLength;
        if (totalBytes > maxBytes)
          return err(
            new AnalysisResourceConstraintError(
              operation,
              "memory",
              "JSON input exceeds the maximum allowed stdin size",
              {
                input_path: "-",
                input_bytes: totalBytes,
                max_stdin_bytes: maxBytes,
              },
              { remediationAction: JSON_INPUT_RESOURCE_REMEDIATION },
            ),
          );
        requireHeadroom();
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    } catch (cause: unknown) {
      if (
        cause instanceof JsonInputCancellationFailure ||
        (signal?.aborted && isJsonInputCancellation(cause, signal))
      )
        throw cause;
      if (cause instanceof AnalysisResourceConstraintError) return err(cause);
      throw new JsonInputPhysicalReadFailure(cause);
    } finally {
      abort?.[Symbol.dispose]();
    }
    signal?.throwIfAborted();
    // Recheck live headroom before concatenation, UTF-8 decoding and JSON.parse.
    requireHeadroom();
    const parsed = parseUtf8Json(
      Buffer.concat(chunks, totalBytes),
      operation,
      "-",
    );
    if (!parsed.ok)
      return err(
        new AnalysisInputError(
          operation,
          {
            cause: parsed.cause,
            ...(parsed.userMessage === undefined
              ? {}
              : { userMessage: parsed.userMessage }),
          },
          [
            {
              path: [],
              reason: "invalid_format",
              expected: "JSON",
              ...(parsed.userMessage === undefined
                ? {}
                : { message: parsed.userMessage }),
            },
          ],
        ),
      );
    return options?.snapshot
      ? await sealOwnedJsonInput(parsed.value, operation, signal)
      : ok(parsed.value);
  } catch (cause: unknown) {
    if (cause instanceof AnalysisResourceConstraintError) return err(cause);
    throw cause;
  }
};

const isJsonInputCancellation = (
  cause: unknown,
  signal: AbortSignal,
): boolean =>
  cause === signal.reason ||
  (cause instanceof Error &&
    cause.name === "AbortError" &&
    "code" in cause &&
    cause.code === "ABORT_ERR" &&
    cause.cause === signal.reason);

const accessDeniedSystemCode = (
  cause: unknown,
): "EACCES" | "EPERM" | undefined => {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  return cause.code === "EACCES" || cause.code === "EPERM"
    ? cause.code
    : undefined;
};

/**
 * A `file:` URL or `scheme://` URL is not an operator-relative filesystem path.
 * One-letter prefixes stay paths so Windows drive paths resolve normally.
 */
const URL_REFERENCE = /^(?:file:|[A-Za-z][A-Za-z0-9+.-]+:\/\/)/iu;

/**
 * Resolve named string fields of CLI-supplied JSON against the operator
 * working directory. Each entry is a key path from the document root; only
 * fields holding nonblank, non-URL strings are resolved, everything else passes
 * through untouched so shared schemas can reject blank paths and URLs. Shared MCP
 * contracts reject relative paths, so CLI workflows resolve operator-relative
 * values before validation.
 */
export const resolveCliJsonPaths = (
  value: unknown,
  paths: ReadonlyArray<ReadonlyArray<string>>,
): unknown => {
  let resolved = value;
  for (const keys of paths) resolved = resolveJsonPath(resolved, keys);
  return resolved;
};

const resolveJsonPath = (
  value: unknown,
  keys: ReadonlyArray<string>,
): unknown => {
  const [head, ...tail] = keys;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return value;
  const entries = Object.entries(value).map(
    ([key, entry]: readonly [string, unknown]): readonly [string, unknown] => {
      if (key !== head) return [key, entry];
      if (tail.length === 0)
        return [
          key,
          typeof entry === "string" &&
          entry.trim().length > 0 &&
          !URL_REFERENCE.test(entry)
            ? absoluteCallerPath(entry)
            : entry,
        ];
      return [key, resolveJsonPath(entry, tail)];
    },
  );
  return Object.fromEntries(entries);
};

const cannotBeAnExistingFile = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause.code === "ENOENT" ||
    cause.code === "ENAMETOOLONG" ||
    cause.code === "ENOTDIR");

const hasExplicitJsonFileExtension = (value: string): boolean =>
  value.toLowerCase().endsWith(".json");

const inputError = (operation: string): JsonValue => ({
  error: "Application workflow failed",
  ...projectAnalysisError(
    new AnalysisInputError(operation, undefined, [
      { path: [], reason: "invalid_format", expected: "JSON" },
    ]),
  ),
});

const jsonFileReadError = (
  path: string,
  operation: string,
  cause: unknown,
) => ({
  ok: false as const,
  error: {
    error: "Application workflow failed",
    ...projectAnalysisError(
      new AnalysisInputError(operation, { cause }, [
        readFailureIssue(path, cause),
      ]),
    ),
    input_path: path,
    input_reason: "read-failed" as const,
  },
});

const jsonAccessDeniedError = (
  path: string,
  operation: string,
  systemCode: "EACCES" | "EPERM",
  cause: unknown,
) => ({
  ok: false as const,
  error: {
    error: "Application workflow failed",
    ...projectAnalysisError(
      new AnalysisAccessDeniedError(operation, path, systemCode, { cause }),
    ),
    input_path: path,
    input_reason: "read-failed" as const,
  },
});

/** Preserve file-selection and system failures alongside the requested path. */
const readFailureIssue = (path: string, cause: unknown) => {
  const code =
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
      ? ` (${cause.code})`
      : "";
  return {
    path: [],
    reason: "invalid_value" as const,
    message:
      cause instanceof NonRegularFileReadError && cause.code === "ENOTFILE"
        ? `The JSON input must be a regular file${code}: ${path}`
        : `The JSON input file could not be read${code}: ${path}`,
  };
};
