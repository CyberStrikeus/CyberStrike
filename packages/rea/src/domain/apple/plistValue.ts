import { types } from "node:util";
import { z } from "zod";

import type { JsonValue } from "../jsonValue.js";
import { copyPlistUidIdentity } from "./plistUid.js";
import { UnknownPlistScalar } from "./unknownPlistScalar.js";

const jsonScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * Default source-value nesting for archive consumers. Ordinary plist inspection
 * supplies its result-capacity allowance to both decode and projection.
 */
export const MAX_PLIST_DEPTH = 128;

/** Agent-visible refusal for nesting past the JSON projection allowance. */
export const plistNestingLimitMessage = (
  maximumDepth = MAX_PLIST_DEPTH,
): string =>
  `Plist exceeds ${String(maximumDepth)} nesting levels. This release has no runtime override for this ${String(maximumDepth)}-level nesting allowance.`;

/** A source-value depth refusal, distinct from malformed decoder output. */
export class PlistNestingLimitError extends RangeError {
  readonly _tag = "PlistNestingLimitError";

  constructor(readonly maximumDepth: number) {
    super(plistNestingLimitMessage(maximumDepth));
  }
}

/** A decoded plist projected into JSON, with values JSON cannot express. */
export interface ProjectedPlistValue {
  readonly value: JsonValue;
  /** Known non-finite values, rendered with canonical numeric labels. */
  readonly nonFiniteRealCount: number;
  /** Negative-zero reals, which a JSON number would report as positive zero. */
  readonly negativeZeroRealCount: number;
  /** Dates the decoder could not represent, reported without a timestamp. */
  readonly unknownDateCount: number;
  /** XML scalar literals retained explicitly because their values are unknown. */
  readonly unknownScalarCount: number;
}

/** Limitation for results whose plist held dates the decoder could not represent. */
export const unknownDateLimitation = (count: number): string =>
  `${String(count)} date value(s) are reported as { "$plist_type": "date", "iso8601": null } because the decoder could not represent their timestamps.`;

/** Limitation when shared binary bytes prevent safely normalizing date precision. */
export const binaryDatePrecisionOverlapLimitation = (count: number): string =>
  `${String(count)} date value(s) are reported with unknown timestamps because their sub-millisecond source records overlap another reachable binary object and the public date projection cannot express their exact instants.`;

/** Limitation for XML scalar literals whose values were not established. */
export const unknownScalarLimitation = (count: number): string =>
  `${String(count)} XML scalar value(s) could not be established; their exact literals and reasons are retained in { "$plist_type": "unknown", "element": ..., "literal": ..., "reason": ... } wrappers.`;

/** Limitation for known non-finite values; the labels do not imply XML provenance. */
export const nonFiniteRealLimitation = (count: number): string =>
  `${String(count)} non-finite real value(s) are reported as { "$plist_type": "real", "value": "<spelling>" } using canonical numeric labels nan, +infinity or -infinity because a JSON number cannot carry them.`;

/** The typed scalar that keeps a negative-zero real distinct from positive zero. */
export const negativeZeroReal = (): Record<string, JsonValue> => ({
  $plist_type: "real",
  value: "-0",
});

/** Limitation for results whose plist held negative-zero reals. */
export const negativeZeroRealLimitation = (count: number): string =>
  `${String(count)} negative-zero real value(s) are reported as { "$plist_type": "real", "value": "-0" } because a JSON number cannot carry the sign of zero.`;

/**
 * Project a decoded plist into JSON. Data, dates, retained big integers and
 * known non-finite reals become explicit `$plist_type` objects. Unresolved XML
 * numeric values remain explicit unknowns, and a negative-zero
 * real keeps its sign, which JSON serialization would drop.
 */
export const projectPlistValue = (
  value: unknown,
  /** Observe generated wrappers before consumers classify the JSON value tree. */
  onWrappedScalar?: (value: Record<string, JsonValue>) => void,
  maximumDepth = MAX_PLIST_DEPTH,
): ProjectedPlistValue => {
  let nonFiniteRealCount = 0;
  let negativeZeroRealCount = 0;
  let unknownDateCount = 0;
  let unknownScalarCount = 0;
  const scalar = (value: Record<string, JsonValue>): JsonValue => {
    onWrappedScalar?.(value);
    return value;
  };
  const project = (item: unknown, depth: number): JsonValue => {
    if (depth > maximumDepth) throw new PlistNestingLimitError(maximumDepth);
    if (item !== null && typeof item === "object" && types.isProxy(item))
      throw new TypeError("Plist values cannot contain proxies");
    if (item instanceof Uint8Array)
      return scalar({
        $plist_type: "data",
        base64: Buffer.from(item).toString("base64"),
      });
    if (item instanceof UnknownPlistScalar) {
      unknownScalarCount += 1;
      return scalar({
        $plist_type: "unknown",
        element: item.element,
        literal: item.rawLiteral,
        reason: item.reason,
      });
    }
    if (item instanceof Date) {
      if (!Number.isNaN(Date.prototype.getTime.call(item)))
        return scalar({
          $plist_type: "date",
          iso8601: Date.prototype.toISOString.call(item),
        });
      unknownDateCount += 1;
      return scalar({ $plist_type: "date", iso8601: null });
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      nonFiniteRealCount += 1;
      const label = Number.isNaN(item)
        ? "nan"
        : item > 0
          ? "+infinity"
          : "-infinity";
      return scalar({ $plist_type: "real", value: label });
    }
    // Integer decoders never yield -0, so a signed zero here is a real.
    if (typeof item === "number" && Object.is(item, -0)) {
      negativeZeroRealCount += 1;
      return scalar(negativeZeroReal());
    }
    if (typeof item === "bigint")
      return scalar({ $plist_type: "integer", decimal: item.toString() });
    if (Array.isArray(item)) {
      const result: JsonValue[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, index);
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
          throw new TypeError(
            "Plist arrays require dense data properties without accessors",
          );
        result.push(project(descriptor.value, depth + 1));
      }
      return result;
    }
    if (item !== null && typeof item === "object") {
      const entries: [string, JsonValue][] = [];
      for (const key of Reflect.ownKeys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (descriptor?.enumerable !== true) continue;
        if (typeof key !== "string" || !Object.hasOwn(descriptor, "value"))
          throw new TypeError(
            "Plist dictionary entries require string keys and data properties",
          );
        entries.push([key, project(descriptor.value, depth + 1)]);
      }
      const result = Object.fromEntries(entries);
      copyPlistUidIdentity(item, result);
      return result;
    }
    return jsonScalarSchema.parse(item);
  };
  const projected = project(value, 0);
  return {
    value: projected,
    nonFiniteRealCount,
    negativeZeroRealCount,
    unknownDateCount,
    unknownScalarCount,
  };
};
