import {
  analysisCliErrorEnvelopeSchema,
  analysisErrorProjectionSchema,
} from "./contracts/errorSchemas.js";
import { AnalysisError } from "./domain/analysisErrorBase.js";
import {
  projectAnalysisError,
  type AnalysisErrorProjection,
} from "./domain/analysisErrorProjection.js";
import type { Logger } from "pino";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type CliFailureIdentity = Pick<
  AnalysisErrorProjection,
  "code" | "category" | "retryable"
>;
interface CliOperationFailure {
  readonly payload: unknown;
  readonly identity?: CliFailureIdentity;
}
const loggedFailures = new WeakMap<object, CliOperationFailure | undefined>();

const canonicalFailure = (
  projection: AnalysisErrorProjection,
): CliOperationFailure => ({
  payload: projection,
  identity: {
    code: projection.code,
    category: projection.category,
    retryable: projection.retryable,
  },
});

/** Return the canonical failure projection owned by the CLI result boundary. */
const projectCliOperationFailure = (
  value: unknown,
): AnalysisErrorProjection | undefined => {
  if (!isRecord(value)) return undefined;
  const direct = analysisErrorProjectionSchema.safeParse(value);
  if (direct.success) return value as AnalysisErrorProjection;
  const envelope = analysisCliErrorEnvelopeSchema.safeParse(value);
  if (envelope.success) {
    const {
      error: _label,
      input_path: inputPath,
      input_reason: inputReason,
      ...projection
    } = value;
    const parsed = projection as AnalysisErrorProjection;
    if (typeof inputPath !== "string" && typeof inputReason !== "string")
      return parsed;
    return {
      ...parsed,
      details: {
        ...parsed.details,
        ...(typeof inputPath === "string" ? { input_path: inputPath } : {}),
        ...(typeof inputReason === "string"
          ? { input_reason: inputReason }
          : {}),
      },
    };
  }
  if (isRecord(value.error)) {
    const nested = analysisErrorProjectionSchema.safeParse(value.error);
    if (nested.success) return value.error as AnalysisErrorProjection;
  }
  return undefined;
};

/** Keep the classified payload and its canonical identity under one owner. */
const inferCliOperationFailure = (
  value: unknown,
): CliOperationFailure | undefined => {
  const projection = projectCliOperationFailure(value);
  if (projection !== undefined) return canonicalFailure(projection);
  if (isRecord(value) && value.healthy === false) return { payload: value };
  return undefined;
};

export const cliOperationFailurePayload = (
  value: unknown,
): unknown | undefined => {
  if (isRecord(value) && loggedFailures.has(value))
    return loggedFailures.get(value)?.payload;
  const failure = inferCliOperationFailure(value);
  if (failure !== undefined && isRecord(value))
    loggedFailures.set(value, failure);
  return failure?.payload;
};

/** Identify caller-visible CLI outcomes that mean the requested operation failed. */
export const isCliOperationFailure = (value: unknown): boolean =>
  cliOperationFailurePayload(value) !== undefined;

/** Already classified identity, without traversing payloads during recovery. */
export const cliOperationFailureIdentity = (
  value: unknown,
): CliFailureIdentity | undefined =>
  isRecord(value) ? loggedFailures.get(value)?.identity : undefined;

/** Log one CLI command with duration and a stable success or failure status. */
export const logCliCommand = async <Value>(
  logger: Logger,
  command: string,
  execute: () => Promise<Value>,
  isCommandFailure?: (value: Value) => boolean,
): Promise<Value | AnalysisErrorProjection> => {
  const startedAt = performance.now();
  try {
    const value = await execute();
    const inferredFailure = inferCliOperationFailure(value);
    const failed = isCommandFailure?.(value) ?? inferredFailure !== undefined;
    if (isRecord(value))
      loggedFailures.set(
        value,
        failed ? (inferredFailure ?? { payload: value }) : undefined,
      );
    logger[failed ? "error" : "info"](
      {
        command,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        status: failed ? "error" : "ok",
      },
      failed ? "CLI command failed" : "CLI command completed",
    );
    if (failed) process.exitCode = 1;
    return value;
  } catch (cause: unknown) {
    process.exitCode = 1;
    logger.error(
      {
        command,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        status: "error",
      },
      "CLI command failed",
    );
    if (cause instanceof AnalysisError) {
      process.exitCode = 1;
      const projection = projectAnalysisError(cause);
      loggedFailures.set(projection, canonicalFailure(projection));
      return projection;
    }
    throw cause;
  }
};
