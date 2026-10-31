import {
  DEFAULT_ASAR_MAX_HEADER_BYTES,
  MAXIMUM_ASAR_MAX_HEADER_BYTES,
} from "../domain/analysisResourceLimits.js";
import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const ASAR_HEADER_ADMISSION_SETTING = "REA_ASAR_MAX_HEADER_BYTES";

/** Effective ASAR header/index admission and where its value came from. */
export interface AsarHeaderAdmission {
  readonly maximumBytes: number;
  readonly source: "default" | "setting" | "runtime";
}

export const DEFAULT_ASAR_HEADER_ADMISSION: AsarHeaderAdmission = {
  maximumBytes: DEFAULT_ASAR_MAX_HEADER_BYTES,
  source: "default",
};

export const asarMaxHeaderBytesConstraint = `${ASAR_HEADER_ADMISSION_SETTING} must be a positive decimal integer of at most ${String(MAXIMUM_ASAR_MAX_HEADER_BYTES)} bytes (256 MiB); the default is ${String(DEFAULT_ASAR_MAX_HEADER_BYTES)} bytes (16 MiB).`;

/** Optional decimal byte count for the ASAR header/index admission. */
export const asarMaxHeaderBytesSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, { error: asarMaxHeaderBytesConstraint })
  .transform(Number)
  .pipe(
    z.number().int().max(MAXIMUM_ASAR_MAX_HEADER_BYTES, {
      error: asarMaxHeaderBytesConstraint,
    }),
  );

/** Resolve the effective admission from one environment value. */
export const parseAsarHeaderAdmission = (
  value: string | undefined,
): Result<AsarHeaderAdmission, ConfigurationError> => {
  if (value === undefined) return ok(DEFAULT_ASAR_HEADER_ADMISSION);
  const parsed = asarMaxHeaderBytesSchema.safeParse(value);
  return parsed.success
    ? ok({ maximumBytes: parsed.data, source: "setting" })
    : err(
        new ConfigurationError(asarMaxHeaderBytesConstraint, {
          settings: [
            {
              setting: ASAR_HEADER_ADMISSION_SETTING,
              constraint: asarMaxHeaderBytesConstraint,
            },
          ],
        }),
      );
};
