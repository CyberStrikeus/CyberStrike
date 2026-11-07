import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import { WEB_RUNTIME_LIMITS } from "../../domain/webRuntime.js";

/** Enforce the retained runtime representation, separately from wire payloads. */
export const assertRuntimeRetention = (
  operation: string,
  kind: "metadata" | "requests" | "sources",
  retainedBytes: number,
): void => {
  const limit =
    kind === "sources"
      ? WEB_RUNTIME_LIMITS.sourceBytes
      : WEB_RUNTIME_LIMITS.retainedEventBytes;
  if (retainedBytes <= limit) return;
  const allowance = `Complete browser runtime ${kind} retention (${String(limit)} bytes)`;
  throw new AnalysisResourceConstraintError(
    operation,
    "capacity",
    `${allowance} exceeded; no partial runtime result is returned.`,
    {
      boundary: "browser-runtime-retention",
      kind,
      retained_bytes: retainedBytes,
      limit_bytes: limit,
    },
    fixedAllowanceOptions(allowance, "live"),
  );
};
