import { describe, expect, it } from "vitest";

import {
  referenceFactsCompatible,
  type ReferenceCompatibilityRow,
} from "./functionReferenceCompatibility.js";

const row = (
  source: string | null,
  target: string | null,
  kind: string | null = "call",
  direction: "in" | "out" = "out",
): ReferenceCompatibilityRow => ({ direction, source, target, kind });

const oracle = (
  left: readonly ReferenceCompatibilityRow[],
  right: readonly ReferenceCompatibilityRow[],
): boolean => {
  if (left.length !== right.length) return false;
  const assigned = new Set<number>();
  const visit = (index: number): boolean => {
    if (index === left.length) return true;
    const candidate = left[index];
    if (candidate === undefined) return false;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      if (assigned.has(rightIndex)) continue;
      const other = right[rightIndex];
      if (other === undefined || candidate.direction !== other.direction)
        continue;
      if (
        (candidate.source !== null &&
          other.source !== null &&
          candidate.source !== other.source) ||
        (candidate.target !== null &&
          other.target !== null &&
          candidate.target !== other.target) ||
        (candidate.kind !== null &&
          other.kind !== null &&
          candidate.kind !== other.kind)
      )
        continue;
      assigned.add(rightIndex);
      if (visit(index + 1)) return true;
      assigned.delete(rightIndex);
    }
    return false;
  };
  return visit(0);
};

const multisetsThroughTwo = (): ReferenceCompatibilityRow[][] => {
  const values: (string | null)[] = [null, "a", "b"];
  const rows = values.flatMap((source) =>
    values.map((target) => row(source, target)),
  );
  const multisets: ReferenceCompatibilityRow[][] = [[]];
  for (let first = 0; first < rows.length; first++) {
    const firstRow = rows[first];
    if (firstRow === undefined) continue;
    multisets.push([firstRow]);
    for (let second = first; second < rows.length; second++) {
      const secondRow = rows[second];
      if (secondRow !== undefined) multisets.push([firstRow, secondRow]);
    }
  }
  return multisets;
};

describe("referenceFactsCompatible", () => {
  it("agrees with an independent permutation oracle for exhaustive two-field multisets", () => {
    const multisets = multisetsThroughTwo();
    for (const left of multisets) {
      for (const right of multisets) {
        expect(
          referenceFactsCompatible(left, right),
          JSON.stringify({ left, right }),
        ).toBe(oracle(left, right));
      }
    }
  });

  it("agrees with the oracle for seeded three-field sets with duplicates and directions", () => {
    const values: (string | null)[] = [null, "a", "b"];
    const directions = ["in", "out"] as const;
    let state = 0x4210;
    const next = (limit: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state >>> 8) % limit;
    };
    for (let sample = 0; sample < 700; sample++) {
      const length = next(7);
      const makeRows = (): ReferenceCompatibilityRow[] =>
        Array.from({ length }, () =>
          row(
            values[next(values.length)] ?? null,
            values[next(values.length)] ?? null,
            values[next(values.length)] ?? null,
            directions[next(directions.length)] ?? "out",
          ),
        );
      const left = makeRows();
      const right = makeRows();
      expect(
        referenceFactsCompatible(left, right),
        JSON.stringify({ left, right }),
      ).toBe(oracle(left, right));
    }
  });

  it("does not greedily cancel identical partial rows before a compatible cross-pairing", () => {
    const left = [row(null, null, null), row("left", "left-target", "call")];
    const right = [row(null, null, null), row("right", "right-target", "data")];

    expect(referenceFactsCompatible(left, right)).toBe(true);
    expect(oracle(left, right)).toBe(true);
  });

  it("requires direction equality even when all other fields are unknown", () => {
    expect(
      referenceFactsCompatible(
        [row(null, null, null, "in")],
        [row(null, null, null, "out")],
      ),
    ).toBe(false);
  });

  it("finds a perfect match through one wildcard hub among ten thousand rows", () => {
    const count = 10_000;
    const left = Array.from({ length: count }, (_, index) =>
      row(`s${index}`, `t${index}`, `k${index}`),
    );
    const right = left.slice(0, -1);
    right.push(row(null, null, null));

    expect(referenceFactsCompatible(left, right)).toBe(true);
  });

  it("handles ten thousand rows in one dense compatible bucket", () => {
    const count = 10_000;
    const left = Array.from({ length: count }, (_, index) =>
      row(null, `t${index}`, "call"),
    );
    const right = Array.from({ length: count }, (_, index) =>
      row(`s${index}`, null, "call"),
    );

    expect(referenceFactsCompatible(left, right)).toBe(true);
  });
});
