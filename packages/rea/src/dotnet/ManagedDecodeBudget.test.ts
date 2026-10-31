import { describe, expect, it } from "vitest";

import {
  admitManagedProjection,
  ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";

describe("managed projection admission", () => {
  it("charges decoded strings by their JSON bytes", () => {
    const name = "a".repeat(12 * 1024 * 1024);

    expect(admitManagedProjection({ name })).toEqual({ name });
  });

  it("charges escaped and multibyte characters at their encoded size", () => {
    expect(() =>
      admitManagedProjection({ name: "\u0001".repeat(12 * 1024 * 1024) }),
    ).toThrow(ManagedReaderFailure);
    expect(() =>
      admitManagedProjection({ name: "€".repeat(23 * 1024 * 1024) }),
    ).toThrow(ManagedReaderFailure);
  });

  it("counts escaped JSON bytes exactly at the budget boundary", () => {
    // Control escapes, quotes, three-byte text, surrogate pairs and lone
    // surrogates each have a distinct JSON size; fill the rest with ASCII.
    const mixed = "\u0001".repeat(4096) + '"\\' + "€😀\ud800\udc00\ud800";
    const used = Buffer.byteLength(JSON.stringify(mixed));
    const filled = (extra: number) =>
      mixed + "a".repeat(64 * 1024 * 1024 - used + extra);

    expect(() => admitManagedProjection(filled(0))).not.toThrow();
    expect(() => admitManagedProjection(filled(1))).toThrow(
      ManagedReaderFailure,
    );
  });

  it("charges an admitted record once inside its containing projection", () => {
    const budget = new ManagedDecodeBudget();
    const record = admitManagedProjection(
      { name: "a".repeat(40 * 1024 * 1024) },
      budget,
    );

    expect(() =>
      admitManagedProjection({ records: [record] }, budget),
    ).not.toThrow();
    // The containing projection spent the credit, so later reuse pays again.
    expect(() =>
      admitManagedProjection({ records: [record, record] }, budget),
    ).toThrow(ManagedReaderFailure);
  });

  it("charges a repeated occurrence of an admitted record again", () => {
    const budget = new ManagedDecodeBudget();
    const record = admitManagedProjection(
      { name: "a".repeat(40 * 1024 * 1024) },
      budget,
    );

    // The first occurrence spends the credit; the second serializes again.
    expect(() =>
      admitManagedProjection({ records: [record, record] }, budget),
    ).toThrow(ManagedReaderFailure);
  });
});

describe("managed decoding bounds", () => {
  it("bounds new row identities without charging lookup replay or merging tables", () => {
    const budget = new ManagedDecodeBudget();
    budget.reserve(64 * 1024 * 1024 - 512, null);
    budget.reserveRow(2, 1, 100);
    budget.reserveRow(12, 1, 200);

    expect(() => budget.reserveRow(2, 1, 100)).not.toThrow();
    expect(() => budget.reserveRow(2, 2, 300)).toThrow(ManagedReaderFailure);
    // A rejected row has no retained reservation; replay cannot bypass capacity.
    expect(() => budget.reserveRow(2, 2, 300)).toThrow(ManagedReaderFailure);
  });

  it("keeps concurrent decoding bounds within one budget until released", () => {
    const budget = new ManagedDecodeBudget();
    const bound = 40 * 1024 * 1024;

    budget.admitTransient(bound, null);
    expect(() => budget.admitTransient(bound, null)).toThrow(
      ManagedReaderFailure,
    );
    expect(() => budget.reserve(bound, null)).toThrow(ManagedReaderFailure);
    budget.releaseTransient();
    expect(() => budget.admitTransient(bound, null)).not.toThrow();
  });
});
