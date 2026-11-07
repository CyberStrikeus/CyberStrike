import { z } from "zod";

/** Portable ASCII identifier starting with a letter. */
export const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._\x2d]*$/u;

/** Stable evidence identifier, also admitting namespace and path separators. */
export const STABLE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:\x2f\x2d]*$/u;

// These rules are separate JSON Schema constraints. A single RE2-compatible
// regex for alphabet and quartet validity requires a repeated alphabet group;
// V8's Unicode-set engine overflows its regexp stack on that group near the
// provider's 32 MiB encoded-input budget. Wildcard quartets and literal bad
// token probes stay stack-safe at that size and compose exactly with `allOf`.
export const BASE64_QUARTET_LENGTH_PATTERN = /^(?:....)*$/;
export const INVALID_BASE64_CHARACTER_PATTERN = /[^A-Za-z0-9+\x2f=]/;
export const INVALID_BASE64_PADDING_PATTERN = /(?:=[^=]|===)/;
export const INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN =
  /(?:[^AQgw]==$|[BCDFGHJKLNOPRSTVWXZabdefhijlmnpqrtuvxyz1235679+\x2f]=$)/;

export const isPaddedBase64 = (value: string): boolean =>
  value.length % 4 === 0 &&
  !INVALID_BASE64_CHARACTER_PATTERN.test(value) &&
  !INVALID_BASE64_PADDING_PATTERN.test(value);

export const isCanonicalBase64 = (value: string): boolean =>
  isPaddedBase64(value) &&
  !INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN.test(value);

const paddedBase64SchemaRules = [
  { pattern: BASE64_QUARTET_LENGTH_PATTERN.source },
  { not: { pattern: INVALID_BASE64_CHARACTER_PATTERN.source } },
  { not: { pattern: INVALID_BASE64_PADDING_PATTERN.source } },
];

/** Canonical padded base64 with zero pad bits; invalid bytes never enter enclosing range checks. */
export const canonicalBase64Schema = z
  .string()
  .refine(isCanonicalBase64, {
    message: "Expected canonical padded base64",
    abort: true,
  })
  .meta({
    allOf: [
      ...paddedBase64SchemaRules,
      { not: { pattern: INVALID_CANONICAL_BASE64_PAD_BITS_PATTERN.source } },
    ],
  });
