import { copyPlistUidIdentity, plistUidValue } from "./plistUid.js";
import type { JsonValue } from "../jsonValue.js";

/** Source element types needed to distinguish large integers from integral reals. */
export interface PlistNumberLiterals {
  readonly integers: ReadonlyMap<number, ReadonlySet<string>>;
  readonly reals: ReadonlySet<number>;
  /** Integer literals in the original serialized plist, not decoded graph slots. */
  readonly unsafeIntegerLiterals: number;
  /** Source numeric facts could not all be established. */
  readonly incomplete: boolean;
}

export const incompletePlistNumberLimitation =
  "Property-list number metadata could not be completely observed; decoded numbers may lose integer precision and exact integer/real association is unavailable.";

/** Collect facts at the decoder boundary before integer values are rounded. */
export const createPlistNumberCollector = () => {
  const integers = new Map<number, Set<string>>();
  const reals = new Set<number>();
  let unsafeIntegerLiterals = 0;
  return {
    integer: (exact: bigint) => {
      if (
        exact >= BigInt(Number.MIN_SAFE_INTEGER) &&
        exact <= BigInt(Number.MAX_SAFE_INTEGER)
      )
        return;
      unsafeIntegerLiterals++;
      const rounded = Number(exact);
      integers.set(
        rounded,
        (integers.get(rounded) ?? new Set()).add(exact.toString()),
      );
    },
    real: (value: number) => {
      reals.add(value);
    },
    result: (incomplete = false): PlistNumberLiterals => ({
      integers,
      reals,
      unsafeIntegerLiterals,
      incomplete,
    }),
  };
};

/** One association established from source literals, before adapter projection. */
type PlistNumberSource =
  | { readonly kind: "integer"; readonly decimal: string }
  | { readonly kind: "real" }
  | { readonly kind: "unknown" };

/**
 * Associate a decoded number with its source type. A retained JSON literal can
 * narrow integer candidates that otherwise collide after numeric rounding.
 * Missing or incomplete metadata never establishes a source type.
 */
export const resolvePlistNumberSource = (
  value: number,
  literals: PlistNumberLiterals | undefined,
  sourceDecimal?: string,
): PlistNumberSource => {
  if (literals === undefined || literals.incomplete) return { kind: "unknown" };
  const decimals = literals.integers.get(value);
  const real = literals.reals.has(value);
  const integer =
    sourceDecimal === undefined
      ? decimals !== undefined
      : decimals?.has(sourceDecimal) === true;
  if (real) return { kind: integer ? "unknown" : "real" };
  if (!integer) return { kind: "unknown" };
  const decimal =
    sourceDecimal ?? (decimals?.size === 1 ? [...decimals][0] : undefined);
  return decimal === undefined
    ? { kind: "unknown" }
    : { kind: "integer", decimal };
};

/** Preserve unambiguous exact integers; disclose rounded or unclassified numbers. */
export const createPlistNumberProjection = (literals: PlistNumberLiterals) => {
  let exactIntegerCount = 0;
  let ambiguousNumberCount = 0;
  const mapNumber = (item: number): JsonValue => {
    if (Number.isSafeInteger(item) || !Number.isInteger(item)) return item;
    const source = resolvePlistNumberSource(item, literals);
    if (source.kind !== "integer") {
      if (source.kind === "unknown") ambiguousNumberCount += 1;
      return item;
    }
    exactIntegerCount += 1;
    return { $plist_type: "integer", decimal: source.decimal };
  };
  const map = (item: JsonValue): JsonValue => {
    if (typeof item === "number") return mapNumber(item);
    if (Array.isArray(item)) return item.map(map);
    if (item !== null && typeof item === "object") {
      const marker = plistUidValue(item);
      const reference = marker !== undefined;
      if (reference) {
        // Keep malformed numeric reference markers recognizable by the graph reader.
        if (
          typeof marker === "number" &&
          !Number.isSafeInteger(marker) &&
          (literals.integers.has(marker) || !literals.reals.has(marker))
        )
          ambiguousNumberCount += 1;
        return item;
      }
      const projected = Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, map(child)]),
      );
      copyPlistUidIdentity(item, projected);
      return projected;
    }
    return item;
  };
  return {
    project: map,
    limitations: () => [
      ...(literals.incomplete ? [incompletePlistNumberLimitation] : []),
      ...(literals.unsafeIntegerLiterals === 0
        ? []
        : [
            `${String(literals.unsafeIntegerLiterals)} observed integer literal(s) in the original archive exceed the exact range of a JSON number. Decoded numbers may lose integer precision unless represented as { "$plist_type": "integer", "decimal": "<exact digits>" }; the original archive bytes retain those literals.`,
          ]),
      ...(exactIntegerCount === 0
        ? []
        : [
            `${String(exactIntegerCount)} unambiguous integer value(s) are reported with exact decimal text as { "$plist_type": "integer", "decimal": "<exact digits>" }.`,
          ]),
      ...(ambiguousNumberCount === 0
        ? []
        : [
            `${String(ambiguousNumberCount)} number(s) beyond the exact integer range remain as decoded because their source integer/real type or reference marker cannot be associated unambiguously; integer precision loss remains possible.`,
          ]),
    ],
  };
};
