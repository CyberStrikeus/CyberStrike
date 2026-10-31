import { describe, expect, it } from "vitest";

import {
  MAX_TYPE_NESTING_DEPTH,
  nestedTypeNames,
} from "./ManagedSignatureTypeNames.js";

/** Rows 1..length, each nested in the row before it. */
const chain = (length: number) => {
  const calls: number[] = [];
  const link = (row: number) => {
    calls.push(row);
    return row >= 1 && row <= length
      ? {
          namespace: "",
          name: `T${String(row)}`,
          enclosingRow: row > 1 ? row - 1 : null,
        }
      : null;
  };
  return { calls, digest: nestedTypeNames(link, () => undefined) };
};

describe("nested signature type digests", () => {
  it("reads each row of a chain within the nesting cap once", () => {
    const { calls, digest } = chain(MAX_TYPE_NESTING_DEPTH);
    for (let row = MAX_TYPE_NESTING_DEPTH; row >= 1; row -= 1)
      expect(digest(row)?.digest).toBeInstanceOf(Buffer);

    expect(calls).toHaveLength(MAX_TYPE_NESTING_DEPTH);
  });

  it("does not name a type nested deeper than the cap, and stops at the cap", () => {
    const { calls, digest } = chain(4_000);

    expect(digest(4_000)).toBeNull();
    expect(calls.length).toBeLessThanOrEqual(MAX_TYPE_NESTING_DEPTH + 1);
    expect(digest(MAX_TYPE_NESTING_DEPTH)?.digest).toBeInstanceOf(Buffer);
    expect(digest(MAX_TYPE_NESTING_DEPTH + 1)).toBeNull();
  });

  it("reads shared parents once when many types are nested past the cap", () => {
    // Rows 1..64 form a chain; rows 1001..2000 are each nested in row 64, one
    // level past the cap. Naming the deepest types first must not reread the
    // chain for each of them.
    const calls: number[] = [];
    const children = 1_000;
    const link = (row: number) => {
      calls.push(row);
      if (row >= 1 && row <= MAX_TYPE_NESTING_DEPTH)
        return {
          namespace: "",
          name: `T${String(row)}`,
          enclosingRow: row > 1 ? row - 1 : null,
        };
      return row > 1_000 && row <= 1_000 + children
        ? {
            namespace: "",
            name: `C${String(row)}`,
            enclosingRow: MAX_TYPE_NESTING_DEPTH,
          }
        : null;
    };
    const digest = nestedTypeNames(link, () => undefined);
    for (let row = 1_001; row <= 1_000 + children; row += 1)
      expect(digest(row)).toBeNull();

    // No row is read twice; the walk can stop at the cap before the outermost.
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls.length).toBeLessThanOrEqual(MAX_TYPE_NESTING_DEPTH + children);
  });

  it("names every type of a long chain in linear time", () => {
    const { calls, digest } = chain(4_000);
    for (let row = 1; row <= 4_000; row += 1) digest(row);

    // Rows past the cap may each walk at most the cap; none rewalks below it.
    expect(calls.length).toBeLessThanOrEqual(
      4_000 * (MAX_TYPE_NESTING_DEPTH + 1),
    );
    expect(calls.filter((row) => row === 1)).toHaveLength(1);
  });

  it("does not name a type whose nesting is cyclic", () => {
    const digest = nestedTypeNames(
      (row) => ({
        namespace: "",
        name: `T${String(row)}`,
        enclosingRow: row === 1 ? 2 : 1,
      }),
      () => undefined,
    );

    expect(digest(1)).toBeNull();
    expect(digest(2)).toBeNull();
  });

  it("tells a nested type from a top-level type with its joined name", () => {
    const nested = nestedTypeNames(
      (row) =>
        row === 1
          ? { namespace: "", name: "Outer", enclosingRow: null }
          : { namespace: "", name: "Inner", enclosingRow: 1 },
      () => undefined,
    );
    const flat = nestedTypeNames(
      () => ({ namespace: "", name: "Outer/Inner", enclosingRow: null }),
      () => undefined,
    );

    const nestedName = nested(2);
    const flatName = flat(1);
    if (nestedName === null || flatName === null)
      throw new Error("Expected both type names to resolve");
    expect(nestedName.name).toBe("Outer/Inner");
    expect(flatName.name).toBe(nestedName.name);
    expect(nestedName.digest.equals(flatName.digest)).toBe(false);
  });
});
