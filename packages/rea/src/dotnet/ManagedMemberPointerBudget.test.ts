import { describe, expect, it, vi } from "vitest";

import {
  attachManagedDecodeBudget,
  ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import { memberListRowLookup } from "./ManagedMemberPointers.js";
import { readManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { buildManagedMemberPointerFixture } from "./ManagedPe.fixture.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";

const representationCapacity = 64 * 1024 * 1024;

const pointerFixture = () => {
  const bytes = buildManagedMemberPointerFixture();
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Fixture has no CLI metadata");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "cli.metadata"),
    pe.cli.metadata.size,
  );
  // A fresh owner lets the test set exact remaining capacity independently of
  // the metadata version/string admission already exercised by the parser.
  const budget = new ManagedDecodeBudget();
  attachManagedDecodeBudget(layout, budget);
  const indexBytes =
    ((layout.table(6)?.rowCount ?? 0) + 1) * Uint32Array.BYTES_PER_ELEMENT +
    256;
  return { bytes, layout, budget, indexBytes };
};

describe("managed member pointer index capacity", () => {
  it("rejects insufficient capacity before allocating the inverse index", () => {
    const { bytes, layout, budget, indexBytes } = pointerFixture();
    budget.reserve(representationCapacity - indexBytes + 1, null);
    let allocations = 0;
    let failure: unknown;
    // Proxy forwards static BYTES_PER_ELEMENT too: losing it would produce a
    // NaN admission failure and falsely pass a before-allocation assertion.
    vi.stubGlobal(
      "Uint32Array",
      new Proxy(Uint32Array, {
        construct(target, arguments_, newTarget) {
          allocations += 1;
          return Reflect.construct(target, arguments_, newTarget);
        },
      }),
    );
    try {
      memberListRowLookup(bytes, layout, 6);
    } catch (cause: unknown) {
      failure = cause;
    } finally {
      vi.unstubAllGlobals();
    }

    expect(failure).toBeInstanceOf(ManagedReaderFailure);
    expect(failure).toMatchObject({
      issue: {
        code: "resource-limit",
        scope: "metadata.representation",
        offset: layout.table(5)?.offset,
      },
    });
    expect(allocations).toBe(0);
  });

  it("reuses one layout's index without allocating or charging it again", () => {
    const { bytes, layout, budget, indexBytes } = pointerFixture();
    budget.reserve(representationCapacity - indexBytes, null);
    let allocations = 0;
    let observed: number[];
    vi.stubGlobal(
      "Uint32Array",
      new Proxy(Uint32Array, {
        construct(target, arguments_, newTarget) {
          allocations += 1;
          return Reflect.construct(target, arguments_, newTarget);
        },
      }),
    );
    try {
      const first = memberListRowLookup(bytes, layout, 6);
      const repeated = memberListRowLookup(bytes, layout, 6);
      observed = [first(1), first(2), repeated(1), repeated(2)];
    } finally {
      vi.unstubAllGlobals();
    }

    expect(observed).toEqual([2, 1, 2, 1]);
    expect(allocations).toBe(1);
    expect(() => budget.reserve(1, null)).toThrow(ManagedReaderFailure);
  });
});
