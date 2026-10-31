import { hasStableNativeSymbol } from "./native/nativeSymbol.js";
import { canonicalJson } from "./comparisonSemantics.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import {
  nativeAddressCoordinateInputSchema,
  nativeAddressInputSchema,
} from "./native/nativeAddress.js";

import type {
  FunctionSnapshotCoordinateContext,
  FunctionSnapshot,
} from "./functionDossierEvidence.js";
import type { FunctionComparisonResult } from "./functionComparisonSchemas.js";

export const identityProjection = (snapshot: FunctionSnapshot) => ({
  name: snapshot.dossier.procedure.name,
  signature: snapshot.dossier.procedure.signature,
  locals: snapshot.dossier.procedure.locals
    .map(({ description }) => description)
    .sort(),
});

export const functionMatch = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  coordinateContext: FunctionSnapshotCoordinateContext,
): FunctionComparisonResult["function_match"] => {
  const leftName = left.dossier.procedure.name;
  const rightName = right.dossier.procedure.name;
  if (coordinateContext === "common") {
    const leftEntry = nativeAddressInputSchema.safeParse(
      left.dossier.procedure.address,
    );
    const rightEntry = nativeAddressInputSchema.safeParse(
      right.dossier.procedure.address,
    );
    if (leftEntry.success && rightEntry.success)
      return leftEntry.data === rightEntry.data
        ? {
            status: "matched",
            method: "same-entry",
            entry_address: leftEntry.data,
            left_name: leftName,
            right_name: rightName,
          }
        : {
            status: "mismatched",
            method: "explicit",
            left_name: leftName,
            right_name: rightName,
          };
    return {
      status: "ambiguous",
      method: "explicit",
      left_name: leftName,
      right_name: rightName,
    };
  }
  const stableNames =
    hasStableNativeSymbol(leftName, left.dossier.procedure.symbol) &&
    hasStableNativeSymbol(rightName, right.dossier.procedure.symbol);
  if (stableNames && leftName === rightName)
    return {
      status: "matched",
      method: "symbol",
      left_name: leftName,
      right_name: rightName,
    };
  return {
    status:
      stableNames && coordinateContext === "cross-artifact"
        ? "mismatched"
        : "ambiguous",
    method: "explicit",
    left_name: leftName,
    right_name: rightName,
  };
};

export const normalizeCfg = (
  blocks: FunctionSnapshot["dossier"]["basic_blocks"],
): readonly unknown[] | null => {
  const parsed: {
    block: (typeof blocks)[number];
    start: bigint;
    end: bigint;
  }[] = [];
  let space: string | null | undefined;
  for (const block of blocks) {
    const start = parseAddress(block.start);
    const end = parseAddress(block.end);
    if (
      start === null ||
      end === null ||
      start.space !== end.space ||
      (space !== undefined && start.space !== space) ||
      end.offset <= start.offset
    )
      return null;
    space = start.space;
    parsed.push({ block, start: start.offset, end: end.offset });
  }
  const ordered = parsed.sort((left, right) =>
    left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
  );
  if (new Set(ordered.map(({ start }) => start)).size !== ordered.length)
    return null;
  const indices = new Map(ordered.map(({ start }, index) => [start, index]));
  const graph = [];
  for (const { block, start, end } of ordered) {
    const successors: number[] = [];
    for (const address of block.successors) {
      const parsedAddress = parseAddress(address);
      if (parsedAddress === null || parsedAddress.space !== space) return null;
      const index = indices.get(parsedAddress.offset);
      if (index === undefined) return null;
      successors.push(index);
    }
    graph.push({
      size: String(end - start),
      successors: successors.sort((left, right) => left - right),
    });
  }
  return graph;
};

export const commentProjection = (
  snapshot: FunctionSnapshot,
): readonly unknown[] | null => {
  const values = snapshot.dossier.comments.map(({ address, kind, text }) => ({
    offset: relativeAddress(address, snapshot.dossier.procedure.address),
    kind,
    text,
  }));
  return values.some(({ offset }) => offset === null) ? null : sorted(values);
};

export const referencedStringProjection = (snapshot: FunctionSnapshot) => {
  const values = snapshot.dossier.referenced_strings.map(
    ({ source_address: sourceAddress, value, decoding, string }) => ({
      source_offset: relativeAddress(
        sourceAddress,
        snapshot.dossier.procedure.address,
      ),
      content: decoding === undefined ? value : null,
      decoding_reason: decoding?.reason ?? null,
      metadata:
        string === undefined
          ? null
          : {
              encoding: string.encoding,
              termination: string.termination,
              byte_length: string.byte_length,
            },
    }),
  );
  return sorted(values);
};

export const nameAndSwiftProjection = (
  snapshot: FunctionSnapshot,
  includeSwiftLiterals = true,
): readonly unknown[] | null => {
  const values = [
    ...snapshot.dossier.referenced_names.map(
      ({ source_address: sourceAddress, value }) => ({
        kind: "name",
        source_offset: relativeAddress(
          sourceAddress,
          snapshot.dossier.procedure.address,
        ),
        value,
      }),
    ),
    ...(includeSwiftLiterals
      ? (snapshot.dossier.swift_string_literals ?? [])
      : []
    ).map(
      ({
        source_address: sourceAddress,
        value,
        representation,
        registers,
      }) => ({
        kind: "swift_string",
        source_offset: relativeAddress(
          sourceAddress,
          snapshot.dossier.procedure.address,
        ),
        value,
        representation,
        registers,
      }),
    ),
  ];
  return values.some(({ source_offset: offset }) => offset === null)
    ? null
    : sorted(values);
};

/**
 * A retained literal proves presence, not that every path through its site was examined.
 * A differing retained fact proves a change only when the opposite dossier is complete
 * and therefore establishes its absence.
 */
export const swiftLiteralSitesConflict = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
): boolean => {
  const leftSites = swiftLiteralSites(left);
  const rightSites = swiftLiteralSites(right);
  for (const site of new Set([
    ...leftSites.values.keys(),
    ...rightSites.values.keys(),
  ])) {
    const leftValues =
      leftSites.values.get(site) ?? (leftSites.complete ? [] : undefined);
    const rightValues =
      rightSites.values.get(site) ?? (rightSites.complete ? [] : undefined);
    if (leftValues === undefined || rightValues === undefined) continue;
    const leftFacts = new Set(leftValues);
    const rightFacts = new Set(rightValues);
    if (
      (rightSites.complete &&
        leftValues.some((value) => !rightFacts.has(value))) ||
      (leftSites.complete && rightValues.some((value) => !leftFacts.has(value)))
    )
      return true;
  }
  return false;
};

/** Omitted literal inventory differs from an observed empty inventory. */
export const swiftLiteralCoverage = (
  snapshot: FunctionSnapshot,
): "absent" | "complete" | "partial" =>
  (snapshot.dossier.swift_string_literal_omissions ?? []).length > 0
    ? "partial"
    : snapshot.dossier.swift_string_literals === undefined
      ? "absent"
      : "complete";

const swiftLiteralSites = (snapshot: FunctionSnapshot) => {
  const base = snapshot.dossier.procedure.address;
  const site = (sourceAddress: string, registers: readonly string[]) => {
    const offset = relativeAddress(sourceAddress, base);
    return offset === null ? null : canonicalJson([offset, registers]);
  };
  // Keep the same literal facts the full strings_names projection compares.
  const values = new Map<string, string[]>();
  for (const literal of snapshot.dossier.swift_string_literals ?? []) {
    const key = site(literal.source_address, literal.registers);
    if (key === null) continue;
    values.set(
      key,
      [
        ...(values.get(key) ?? []),
        canonicalJson([literal.value, literal.representation]),
      ].sort(compareUnicodeCodePoints),
    );
  }
  const complete = swiftLiteralCoverage(snapshot) === "complete";
  return { values, complete };
};

export const sorted = <T>(values: readonly T[]): readonly T[] =>
  values
    .map((value) => ({
      value,
      json: canonicalJson(value, "Function normalization"),
    }))
    .sort((left, right) => compareUnicodeCodePoints(left.json, right.json))
    .map(({ value }) => value);

const parseAddress = (value: string) => {
  const parsed = nativeAddressCoordinateInputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const relativeAddress = (value: string, base: string): string | null => {
  const parsed = parseAddress(value);
  const parsedBase = parseAddress(base);
  return parsed === null ||
    parsedBase === null ||
    parsed.space !== parsedBase.space ||
    parsed.offset < parsedBase.offset
    ? null
    : String(parsed.offset - parsedBase.offset);
};
