import {
  DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB,
  MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
  MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
} from "../domain/analysisResourceLimits.js";
import { positiveDecimalIntegerSchema } from "./positiveDecimalInteger.js";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const REGEX_WORKER_HEAP_REQUEST_SETTING =
  "REA_REGEX_WORKER_HEAP_REQUEST_MIB";

/** Effective regex worker heap request and where its value came from. */
export interface RegexWorkerHeapRequest {
  readonly heapMiB: number;
  readonly source: "default" | "setting" | "runtime";
}

export const DEFAULT_REGEX_WORKER_HEAP_REQUEST: RegexWorkerHeapRequest = {
  heapMiB: DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB,
  source: "default",
};

export const regexWorkerHeapRequestConstraint = `${REGEX_WORKER_HEAP_REQUEST_SETTING} must be a decimal integer from ${String(MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)} to ${String(MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)} MiB; the default is ${String(DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB)} MiB. A request below ${String(MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)} MiB aborts the worker during startup, and a larger value is refused.`;

/** Optional decimal mebibyte count for the regex worker old-generation request. */
export const regexWorkerHeapRequestMiBSchema = positiveDecimalIntegerSchema(
  MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
  MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
  regexWorkerHeapRequestConstraint,
);

/** Resolve the effective request from one environment value. */
export const parseRegexWorkerHeapRequest = (
  value: string | undefined,
): Result<RegexWorkerHeapRequest, ConfigurationError> => {
  if (value === undefined) return ok(DEFAULT_REGEX_WORKER_HEAP_REQUEST);
  const parsed = regexWorkerHeapRequestMiBSchema.safeParse(value);
  return parsed.success
    ? ok({ heapMiB: parsed.data, source: "setting" })
    : err(
        new ConfigurationError(regexWorkerHeapRequestConstraint, {
          settings: [
            {
              setting: REGEX_WORKER_HEAP_REQUEST_SETTING,
              constraint: regexWorkerHeapRequestConstraint,
            },
          ],
        }),
      );
};

/**
 * Resolve the request from a composition root's selected environment. An
 * invalid setting is refused, not ignored. Callers that already resolved it
 * at startup pass that value through instead of reading the environment again.
 */
export const resolveRegexWorkerHeapRequest = (
  environment: Readonly<Record<string, string | undefined>>,
): RegexWorkerHeapRequest => {
  const parsed = parseRegexWorkerHeapRequest(
    environment[REGEX_WORKER_HEAP_REQUEST_SETTING],
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** How to read and change the regex worker old-generation request. */
export const regexWorkerHeapRequestRecovery = (
  request: RegexWorkerHeapRequest,
): string =>
  [
    `The effective ${REGEX_WORKER_HEAP_REQUEST_SETTING} value is ${String(request.heapMiB)} MiB (source ${request.source}; default ${String(DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB)} MiB, floor ${String(MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)} MiB, maximum ${String(MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)} MiB).`,
    `Set ${REGEX_WORKER_HEAP_REQUEST_SETTING} in the environment that starts REA to a decimal integer from ${String(MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)} to ${String(MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB)}, then restart REA. In a running MCP server, use update_analysis_settings with setting regex.worker_heap_request_mib and action set instead; the new value applies to new work without a REA restart.`,
    "A positive Node --max-old-space-size, including NODE_OPTIONS, overrides this request and sets the effective heap. That flag is not limited by this setting's floor or maximum. Raising host memory alone does not raise the request.",
  ].join(" ");
