import {
  DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES,
  MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES,
} from "../domain/analysisResourceLimits.js";
import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const NATIVE_MATCHING_ALLOWANCE_SETTING =
  "REA_NATIVE_MATCHING_REPRESENTATION_BYTES";

/** Effective native function-matching representation allowance and its source. */
export interface NativeMatchingAllowance {
  readonly maximumBytes: number;
  readonly source: "default" | "setting" | "runtime";
}

export const DEFAULT_NATIVE_MATCHING_ALLOWANCE: NativeMatchingAllowance = {
  maximumBytes: DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES,
  source: "default",
};

export const nativeMatchingRepresentationBytesConstraint = `${NATIVE_MATCHING_ALLOWANCE_SETTING} must be a positive decimal integer of at most ${String(MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES)} bytes (1 GiB); the default is ${String(DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES)} bytes (96 MiB).`;

/** Optional decimal byte count for the native function-matching allowance. */
const nativeMatchingRepresentationBytesSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, {
    error: nativeMatchingRepresentationBytesConstraint,
  })
  .transform(Number)
  .pipe(
    z.number().int().max(MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES, {
      error: nativeMatchingRepresentationBytesConstraint,
    }),
  );

/** Resolve the effective allowance from one launch environment. */
export const parseNativeMatchingAllowance = (
  environment: Readonly<Record<string, string | undefined>>,
): Result<NativeMatchingAllowance, ConfigurationError> => {
  const value = environment[NATIVE_MATCHING_ALLOWANCE_SETTING];
  if (value === undefined) return ok(DEFAULT_NATIVE_MATCHING_ALLOWANCE);
  const parsed = nativeMatchingRepresentationBytesSchema.safeParse(value);
  return parsed.success
    ? ok({ maximumBytes: parsed.data, source: "setting" })
    : err(
        new ConfigurationError(nativeMatchingRepresentationBytesConstraint, {
          remediationAction: `On a running MCP session, call update_analysis_settings with ${JSON.stringify({ changes: [{ setting: "native.matching_representation_bytes", action: "set", value: DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES }] })}, then retry matching. This repairs the current session for the next operation. For CLI or future REA processes, correct ${NATIVE_MATCHING_ALLOWANCE_SETTING} in the launch environment.`,
          settings: [
            {
              setting: NATIVE_MATCHING_ALLOWANCE_SETTING,
              constraint: nativeMatchingRepresentationBytesConstraint,
            },
          ],
        }),
      );
};

const MEBIBYTE = 1024 * 1024;

/** Display one allowance in MiB and bytes, or bytes alone when not whole MiB. */
export const nativeMatchingByteAllowance = (bytes: number): string =>
  Number.isInteger(bytes / MEBIBYTE)
    ? `${String(bytes / MEBIBYTE)} MiB / ${String(bytes)} bytes`
    : `${String(bytes)} bytes`;

/** User-visible recovery for the effective matching representation allowance. */
export const nativeMatchingAllowanceRecovery = (
  allowance: NativeMatchingAllowance,
): string =>
  [
    `Native function matching is limited to ${nativeMatchingByteAllowance(allowance.maximumBytes)} of representation${allowance.source === "setting" ? ` by ${NATIVE_MATCHING_ALLOWANCE_SETTING}` : ""}.`,
    `On MCP, call update_analysis_settings with setting native.matching_representation_bytes, action set, and a value in bytes up to ${nativeMatchingByteAllowance(MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES)} (default ${nativeMatchingByteAllowance(DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES)}), then retry the original request. It applies to the next operation without restarting REA. For CLI or future REA processes, set ${NATIVE_MATCHING_ALLOWANCE_SETTING} in the launch environment.`,
    "This budget is not a bound on total process RSS; raising it lets matching retain more representation in the REA process.",
    "Splitting inventories into separate matches changes global name and body uniqueness, so it is not an equivalent workaround.",
    "Repeating the unchanged request fails the same way.",
  ].join(" ");
