import { z } from "zod";
import { addressCoordinate } from "./addressCoordinate.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { err, ok, type Result } from "../result.js";

/** Maximum matches delivered by one byte-search page. */
export const MAX_BYTE_SEARCH_MATCHES = 1000;

/** Exact grammar belongs to the object refinement, not a repeating advertised regex. */
export const bytePatternFields = {
  pattern: z
    .string()
    .describe(
      "Hexadecimal byte pairs or ?? whole-byte wildcards, with optional whitespace between complete pairs; no leading or trailing whitespace. At least one bit must be constrained after applying the mask.",
    ),
  mask: z
    .string()
    .optional()
    .describe(
      "Hexadecimal mask byte pairs, with optional whitespace between complete pairs; no leading or trailing whitespace. Must contain the same number of bytes as pattern.",
    ),
};

const hexDigit = (code: number): number | undefined => {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return undefined;
};

const readBytePair = (
  value: string,
  offset: number,
): number | "wildcard" | undefined => {
  if (value[offset] === "?" && value[offset + 1] === "?") return "wildcard";
  const high = hexDigit(value.charCodeAt(offset));
  const low = hexDigit(value.charCodeAt(offset + 1));
  return high === undefined || low === undefined ? undefined : high * 16 + low;
};

const nextPairOffset = (value: string, offset: number): number => {
  const end = offset + 2;
  let next = end;
  while (next < value.length && /\s/u.test(value[next]!)) next += 1;
  return next === value.length && next !== end ? -1 : next;
};

const countBytePairs = (
  value: string,
  field: "pattern" | "mask",
): number | undefined => {
  let count = 0;
  for (let offset = 0; offset < value.length;) {
    const byte = readBytePair(value, offset);
    if (byte === undefined || (field === "mask" && byte === "wildcard"))
      return undefined;
    count += 1;
    offset = nextPairOffset(value, offset);
    if (offset < 0) return undefined;
  }
  return count === 0 ? undefined : count;
};

/** Validate without materializing byte arrays or using size-dependent regexes. */
const validateBytePatternValue = (
  pattern: string,
  mask?: string,
): Result<null, AnalysisInputError> => {
  const invalid = (field: string, message: string) =>
    err(
      new AnalysisInputError("search_bytes", undefined, [
        { path: [field], reason: "invalid_value", message },
      ]),
    );
  const patternCount = countBytePairs(pattern, "pattern");
  if (patternCount === undefined)
    return invalid("pattern", "Use hexadecimal byte pairs or ?? wildcards");
  const maskCount =
    mask === undefined ? undefined : countBytePairs(mask, "mask");
  if (mask !== undefined && maskCount === undefined)
    return invalid("mask", "Use hexadecimal mask byte pairs");
  if (maskCount !== undefined && maskCount !== patternCount)
    return invalid("mask", "Mask length must equal pattern length");
  let patternOffset = 0;
  let maskOffset = 0;
  for (let index = 0; index < patternCount; index += 1) {
    const byte = readBytePair(pattern, patternOffset);
    const selected = mask === undefined ? 255 : readBytePair(mask, maskOffset);
    if (
      typeof byte === "number" &&
      typeof selected === "number" &&
      selected !== 0
    )
      return ok(null);
    patternOffset = nextPairOffset(pattern, patternOffset);
    if (mask !== undefined) maskOffset = nextPairOffset(mask, maskOffset);
  }
  return invalid("pattern", "Pattern must constrain at least one bit");
};

/** Shared semantic validation for public and provider inputs. */
export const validateBytePattern = (
  value: { pattern: string; mask?: string | undefined },
  context: z.RefinementCtx,
): void => {
  const parsed = validateBytePatternValue(value.pattern, value.mask);
  if (!parsed.ok)
    for (const issue of parsed.error.issues)
      context.addIssue({
        code: "custom",
        path: [...issue.path],
        message: issue.message ?? "Invalid byte pattern",
      });
};

const coverageBlock = z
  .strictObject({
    segment: z.string(),
    start: z.string(),
    end: z.string(),
    bytes: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((value, context) => {
    const start = addressCoordinate(value.start);
    const end = addressCoordinate(value.end);
    if (
      start === null ||
      end === null ||
      start.space !== end.space ||
      start.offset > end.offset ||
      end.offset - start.offset + 1n !== BigInt(value.bytes)
    )
      context.addIssue({
        code: "custom",
        message:
          "Byte coverage must equal its inclusive address range in one space",
      });
  });

/** Inclusive page coverage; matches never span memory blocks. */
export const byteSearchResultSchema = z
  .strictObject({
    matches: z
      .array(
        z.strictObject({
          address: z.string(),
          segment: z.string(),
          file_offset: z
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER)
            .nullable(),
          procedure: z
            .strictObject({ address: z.string(), name: z.string() })
            .nullable(),
        }),
      )
      .max(MAX_BYTE_SEARCH_MATCHES),
    searched: z.strictObject({
      blocks: z.array(coverageBlock),
      bytes: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      skipped_uninitialized: z.array(coverageBlock),
      skipped_not_loaded: z.array(coverageBlock),
    }),
    complete: z.boolean(),
    next_cursor: z.string().min(1).nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.complete !== (value.next_cursor === null) ||
      value.searched.bytes !==
        value.searched.blocks.reduce((sum, block) => sum + block.bytes, 0)
    )
      context.addIssue({
        code: "custom",
        message: "Byte search coverage and continuation disagree",
      });
    const ranges = value.searched.blocks.map((block) => ({
      segment: block.segment,
      start: addressCoordinate(block.start),
      end: addressCoordinate(block.end),
    }));
    for (const [index, match] of value.matches.entries()) {
      const address = addressCoordinate(match.address);
      if (
        address === null ||
        !ranges.some(
          (range) =>
            range.segment === match.segment &&
            range.start !== null &&
            range.end !== null &&
            range.start.space === address.space &&
            range.end.space === address.space &&
            range.start.offset <= address.offset &&
            address.offset <= range.end.offset,
        )
      )
        context.addIssue({
          code: "custom",
          path: ["matches", index, "address"],
          message:
            "Byte match must lie within reported searched coverage in the same segment and address space",
        });
    }
  });
