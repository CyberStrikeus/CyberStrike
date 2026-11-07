import { z } from "zod";

import { PWNTOOLS_LIMITS } from "./PwntoolsRelease.js";

// The artifact is read into one in-memory buffer and staged again as a private
// snapshot before the owned bridge parses it under a 3 GiB address-space
// reservation, so an override stays within a third of that reservation.
const MAXIMUM_INPUT_BYTES = 1024 * 1024 * 1024;

/** Optional caller-supplied input bound, in bytes, without a decimal point. */
export const pwntoolsInputBytesSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, "must be a positive decimal integer")
  .transform(Number)
  .pipe(z.int().safe().max(MAXIMUM_INPUT_BYTES));

const CONSTRAINT =
  `REA_PWNTOOLS_MAX_INPUT_BYTES must be a decimal integer from 1 to ` +
  `${String(MAXIMUM_INPUT_BYTES)} bytes, and REA never installs Python or packages.`;

/** Resolved input bound, or the reason the caller's override cannot be used. */
export type PwntoolsInputBytes =
  | { readonly configured: true; readonly bytes: number }
  | { readonly configured: false; readonly error: string };

/**
 * Resolve the admitted artifact size for the pwntools adapters. An unset value
 * keeps the shipped default, so the bound is only ever widened deliberately.
 */
export const pwntoolsInputBytes = (
  environment: Readonly<NodeJS.ProcessEnv>,
): PwntoolsInputBytes => {
  const value = environment.REA_PWNTOOLS_MAX_INPUT_BYTES;
  if (value === undefined)
    return { configured: true, bytes: PWNTOOLS_LIMITS.inputBytes };
  const parsed = pwntoolsInputBytesSchema.safeParse(value);
  return parsed.success
    ? { configured: true, bytes: parsed.data }
    : { configured: false, error: CONSTRAINT };
};
