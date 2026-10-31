import { z } from "zod";

/**
 * Canonical digest and identifier shapes.
 *
 * These were previously a hand-copied regex in ~30 modules: 32 local
 * `digestSchema` definitions plus a distinct literal for each of roughly
 * thirty `prefix_hash` identifier families. Nothing kept them in step, so a
 * change to what counts as a digest had to be found and repeated by hand.
 *
 * One owner means the shape is stated once, and a new identifier family
 * cannot accidentally invent its own spelling of "lowercase sha256".
 */

/** Lowercase hex SHA-256, as every digest in the system is emitted. */
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** A bare artifact/content digest. */
export const digestSchema = z.string().regex(SHA256_PATTERN);

/**
 * A namespaced identifier: `<prefix>_<64 lowercase hex>`. Prefixes keep
 * identifiers from different families apart at a glance and make a
 * mis-pasted identifier from another family fail validation rather than
 * resolve to the wrong object.
 */
export const prefixedDigestSchema = (prefix: string): z.ZodString =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}_[a-f0-9]{64}$`, "u"),
      `Expected a ${prefix}_ prefixed lowercase sha256 digest`,
    );

/** True when `value` is a bare digest. */
export const isDigest = (value: unknown): value is string =>
  typeof value === "string" && SHA256_PATTERN.test(value);
