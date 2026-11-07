import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  freezeOwnedJsonTreeSnapshot,
  isImmutableJsonSnapshot,
} from "../immutableJson.js";
import type { AnalysisViewParent } from "./analysisView.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";

const parent = (normalizedResult: unknown): AnalysisViewParent => ({
  evidenceId: `ev_${"a".repeat(64)}`,
  operation: "inspect_python_pyc",
  normalizedResult,
  sealedResult: true,
  limitations: [],
});

it("does not trust a caller's sealed flag or shallow freeze for mutable facts", () => {
  const item = { value: "valid" };
  const source = Object.freeze({ items: [item] });
  const read = createAnalysisViewResultReader(
    z.strictObject({
      items: z.array(z.strictObject({ value: z.literal("valid") })),
    }),
  );
  expect(read(parent(source)).ok).toBe(true);
  item.value = "changed";
  expect(read(parent(source)).ok).toBe(false);
});

it("keeps schema-specific normalized facts separate without mutating sealed source", () => {
  const source = freezeOwnedJsonTreeSnapshot({});
  const first = createAnalysisViewResultReader(
    z.strictObject({
      value: z.string().default("first"),
    }),
  );
  const second = createAnalysisViewResultReader(
    z.strictObject({
      value: z.string().default("second"),
    }),
  );
  const a = first(parent(source));
  const b = second(parent(source));
  expect(a).toEqual({ ok: true, value: { value: "first" } });
  expect(b).toEqual({ ok: true, value: { value: "second" } });
  expect(source).toEqual({});
  if (a.ok && b.ok) {
    expect(isImmutableJsonSnapshot(a.value)).toBe(true);
    expect(isImmutableJsonSnapshot(b.value)).toBe(true);
  }
});

it("borrows omitted optional fields from a sealed JSON source and reuses their parsed facts", () => {
  const source = freezeOwnedJsonTreeSnapshot({});
  const schema = z.strictObject({ optional: z.string().optional() });
  const parse = vi.spyOn(schema, "safeParse");
  const read = createAnalysisViewResultReader(schema);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = read(parent(source));
      if (!result.ok) throw result.error;
      expect(result.value).toBe(source);
      expect(result.value.optional).toBeUndefined();
      expect(Object.hasOwn(result.value, "optional")).toBe(false);
    }
    expect(parse).toHaveBeenCalledTimes(1);
  } finally {
    parse.mockRestore();
  }
});

it("preserves explicit undefined normalization without freezing or caching non-JSON facts", () => {
  const source = freezeOwnedJsonTreeSnapshot({});
  const produced: { optional: undefined }[] = [];
  const schema = z.strictObject({}).transform(() => {
    const facts = { optional: undefined };
    produced.push(facts);
    return facts;
  });
  const read = createAnalysisViewResultReader(schema);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = read(parent(source));
    if (!result.ok) throw result.error;
    expect(result.value).toBe(produced[attempt]);
    expect(Object.hasOwn(result.value, "optional")).toBe(true);
    expect(result.value.optional).toBeUndefined();
    expect(Object.isFrozen(result.value)).toBe(false);
    expect(isImmutableJsonSnapshot(result.value)).toBe(false);
  }
  expect(produced).toHaveLength(2);
  expect(produced[0]).not.toBe(produced[1]);
  expect(source).toEqual({});
  expect(Object.hasOwn(source, "optional")).toBe(false);
});
