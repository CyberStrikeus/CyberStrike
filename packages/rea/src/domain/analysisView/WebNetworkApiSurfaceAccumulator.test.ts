import { expect, it, vi } from "vitest";
import { analysisViewCaptureFixture } from "../../../tests/fixtures/analysisView.js";
import type { WebNetworkCaptureRecord } from "../webNetworkCapture.js";
import { WebNetworkApiSurfaceAccumulator } from "./WebNetworkApiSurfaceAccumulator.js";

const record = (
  ordinal: number,
  path: string,
  method = "GET",
  mimeType = "application/json",
): WebNetworkCaptureRecord => ({
  ...analysisViewCaptureFixture().records[0]!,
  ordinal,
  limitations: [],
  reported: {
    request: { method, url: `https://api.test${path}` },
    response: { status: 200, content: { mimeType } },
  },
});

const add = (
  accumulator: WebNetworkApiSurfaceAccumulator,
  sample: WebNetworkCaptureRecord,
) => {
  const result = accumulator.add(sample);
  if (!result.ok) throw result.error;
};

it("bounds query parser expansion before publishing or merging observed names", () => {
  const accumulator = new WebNetworkApiSurfaceAccumulator(64 * 1024, true);
  add(accumulator, record(0, "/products?kept=1"));
  const before = accumulator.page(0, 1);
  expect(
    accumulator.add(record(1, `/products?${"x=1&".repeat(200)}`)),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
  expect(accumulator.page(0, 1)).toEqual(before);
  add(accumulator, record(2, "/products?after=2"));
  expect(accumulator.page(0, 1).groups[0]?.query_parameter_names).toEqual([
    { name: "after", record_ordinals: [2] },
    { name: "kept", record_ordinals: [0] },
  ]);
});

it("charges each retained name once and each name's ordinal once per request", () => {
  const accumulator = new WebNetworkApiSurfaceAccumulator(1024 * 1024, true);
  for (let ordinal = 0; ordinal < 1000; ordinal += 1)
    add(accumulator, record(ordinal, "/products?category=one&category=two"));
  expect(accumulator.page(0, 1).groups[0]?.query_parameter_names).toEqual([
    {
      name: "category",
      record_ordinals: Array.from({ length: 1000 }, (_, index) => index),
    },
  ]);
});

it("admits the capture schema clone and grouping against the same budget", () => {
  const sample = record(0, `/${"a".repeat(1200)}`);
  const isolated = new WebNetworkApiSurfaceAccumulator(64 * 1024);
  add(isolated, sample);
  const accumulator = new WebNetworkApiSurfaceAccumulator(64 * 1024);
  expect(
    accumulator.admitCaptureClone({
      headers: Array.from({ length: 40 }, () => ({ name: "x", value: "y" })),
    }).ok,
  ).toBe(true);
  expect(accumulator.add(sample)).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
  expect(accumulator.page(0, 1).groups).toEqual([]);
});

it.each(["admitCaptureClone", "admitInlineEvidence"] as const)(
  "%s refuses dense array expansion without enumerating its keys",
  (method) => {
    const array = Array.from({ length: 100_000 }, () => null);
    let enumerated = false;
    let inspected = 0;
    const ownNames = Object.getOwnPropertyNames;
    const ownDescriptor = Object.getOwnPropertyDescriptor;
    const keys = vi
      .spyOn(Object, "getOwnPropertyNames")
      .mockImplementation((value) => {
        if (value === array) enumerated = true;
        return ownNames(value);
      });
    const descriptors = vi
      .spyOn(Object, "getOwnPropertyDescriptor")
      .mockImplementation((value, key) => {
        if (value === array) inspected += 1;
        return ownDescriptor(value, key);
      });
    try {
      expect(
        new WebNetworkApiSurfaceAccumulator(4096)[method](array),
      ).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
      });
      expect(enumerated).toBe(false);
      expect(inspected).toBeGreaterThan(0);
      expect(inspected).toBeLessThan(16);
    } finally {
      keys.mockRestore();
      descriptors.mockRestore();
    }
  },
);

it("charges non-enumerable fields that the capture schema would clone", () => {
  const value = Object.defineProperty({}, "records", {
    value: Array.from({ length: 100 }, () => ({ reported: {} })),
  });
  expect(
    new WebNetworkApiSurfaceAccumulator(64 * 1024).admitCaptureClone(value),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
});

it("bounds many short literal groups, including groups with unavailable MIME types", () => {
  const accumulator = new WebNetworkApiSurfaceAccumulator(64 * 1024);
  let accepted = 0;
  for (; accepted < 1000; accepted += 1) {
    const before = accumulator.page(0, 1000);
    const result = accumulator.add(
      record(accepted, `/route${accepted}`, "GET", ""),
    );
    if (result.ok) continue;
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
    });
    expect(accumulator.page(0, 1000)).toEqual(before);
    break;
  }
  expect(accepted).toBeGreaterThan(0);
  expect(accepted).toBeLessThan(1000);
  expect(accumulator.page(0, 1000).coverage.total).toBe(accepted);
});

it.each([
  {
    name: "templated segments",
    path: "/1".repeat(350),
    method: "GET",
    mime: "application/json",
  },
  {
    name: "literal path",
    path: `/${"a".repeat(30_000)}`,
    method: "GET",
    mime: "application/json",
  },
  {
    name: "request identity",
    path: "/a",
    method: "M".repeat(60_000),
    mime: "application/json",
  },
  {
    name: "response text",
    path: "/a",
    method: "GET",
    mime: `text/${"a".repeat(30_000)}`,
  },
])(
  "admits $name together with previously retained state before publishing a new group",
  ({ path, method, mime }) => {
    const maximum = 1024 * 1024;
    const isolated = new WebNetworkApiSurfaceAccumulator(maximum);
    add(isolated, record(0, path, method, mime));

    const accumulator = new WebNetworkApiSurfaceAccumulator(maximum);
    for (let ordinal = 0; ordinal < 150; ordinal += 1)
      add(accumulator, record(ordinal, `/route${ordinal}`));
    const before = accumulator.page(0, 1000);
    expect(accumulator.add(record(150, path, method, mime))).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError" },
    });
    expect(accumulator.page(0, 1000)).toEqual(before);
  },
);

it("retains repeated segment, status and MIME values once across many samples", () => {
  const accumulator = new WebNetworkApiSurfaceAccumulator(1024 * 1024);
  for (let ordinal = 0; ordinal < 1000; ordinal += 1)
    add(accumulator, record(ordinal, "/1".repeat(250)));
  const page = accumulator.page(0, 1);
  expect(page.groups).toHaveLength(1);
  expect(page.groups[0]?.record_ordinals).toHaveLength(1000);
  expect(page.groups[0]?.statuses).toEqual([200]);
  expect(page.groups[0]?.content_types).toEqual(["application/json"]);
  expect(page.groups[0]?.templated_segments).toHaveLength(250);
  expect(
    page.groups[0]?.templated_segments.every(
      (segment) => segment.observed_values.join() === "1",
    ),
  ).toBe(true);
});

it("refuses an entire merge before retaining any novel observed values or its ordinal", () => {
  const accumulator = new WebNetworkApiSurfaceAccumulator(1024 * 1024);
  for (let ordinal = 0; ordinal < 100; ordinal += 1)
    add(accumulator, record(ordinal, `/route${ordinal}`));
  add(accumulator, record(100, "/1".repeat(200)));
  const before = accumulator.page(0, 1000);
  const result = accumulator.add(
    record(101, `/${"2".repeat(80)}`.repeat(200), "GET", "text/plain"),
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
  expect(accumulator.page(0, 1000)).toEqual(before);
});

it("bounds excluded-record storage and distinct limitations as well as endpoint groups", () => {
  const accumulator = new WebNetworkApiSurfaceAccumulator(64 * 1024);
  let accepted = 0;
  for (; accepted < 1000; accepted += 1) {
    const sample = record(accepted, "/a");
    sample.reported = null;
    sample.limitations = [`producer caveat ${accepted}`];
    const result = accumulator.add(sample);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
      });
      break;
    }
  }
  expect(accepted).toBeGreaterThan(0);
  expect(accepted).toBeLessThan(1000);
  expect(accumulator.page(0, 1).excluded_records).toHaveLength(accepted);
});
