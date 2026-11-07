import { expect, it } from "vitest";

import { inferJsonShape } from "./jsonShape.js";
import { WEB_RUNTIME_LIMITS } from "./webRuntime.js";

it("refuses a small deeply nested source whose expanded shape exceeds the real retained allowance", () => {
  const depth = 760;
  const source = '{"a":'.repeat(depth) + "0" + "}".repeat(depth);
  expect(Buffer.byteLength(source)).toBe(4_561);
  const result = inferJsonShape(source, WEB_RUNTIME_LIMITS.retainedEventBytes);
  if (result.ok) throw new Error("Expected expanded shape capacity refusal");
  expect(result.error).toMatchObject({
    kind: "capacity",
    maximumBytes: WEB_RUNTIME_LIMITS.retainedEventBytes,
  });
  if (result.error.kind === "capacity")
    expect(result.error.requiredBytesAtLeast).toBeGreaterThan(
      WEB_RUNTIME_LIMITS.retainedEventBytes,
    );
});

it("admits exact escaped and Unicode output bytes, independently of input whitespace", () => {
  const source = JSON.stringify({
    'quote"\\\n': [
      { "é/~": 1, "\ud800": true },
      { "é/~": "other", "\ud800": null },
    ],
    "\u{10000}": "value",
  });
  const reference = inferJsonShape(
    source,
    WEB_RUNTIME_LIMITS.retainedEventBytes,
  );
  if (!reference.ok) throw reference.error;
  const exact = Buffer.byteLength(JSON.stringify(reference.value.shape));
  expect(reference.value.serializedBytes).toBe(exact);
  const accepted = inferJsonShape(` ${source}\n`, exact);
  if (!accepted.ok) throw accepted.error;
  expect(accepted.value).toEqual(reference.value);
  const refused = inferJsonShape(source, exact - 1);
  if (refused.ok) throw new Error("Expected one-byte-over-budget refusal");
  expect(refused.error.kind).toBe("capacity");
});

it("shares repeated array paths while preserving all observation and node counts", () => {
  const source = JSON.stringify(
    Array.from({ length: 10_000 }, () => ({ retained: true })),
  );
  const reference = inferJsonShape(
    source,
    WEB_RUNTIME_LIMITS.retainedEventBytes,
  );
  if (!reference.ok) throw reference.error;
  const result = inferJsonShape(source, reference.value.serializedBytes);
  if (!result.ok) throw result.error;
  expect(result.value.shape).toMatchObject({
    node_count: 20_001,
    max_depth_observed: 2,
    properties: [
      { path: [{ kind: "array-element" }], observations: 10_000 },
      {
        path: [
          { kind: "array-element" },
          { kind: "property", name: "retained" },
        ],
        observations: 10_000,
      },
    ],
  });
  expect(result.value.serializedBytes).toBe(
    Buffer.byteLength(JSON.stringify(result.value.shape)),
  );
});

it("refuses wide expanded paths before admitting all source keys", () => {
  const source = JSON.stringify(
    Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => [
        `field_${index}_é\\"`,
        index,
      ]),
    ),
  );
  const refused = inferJsonShape(source, 4_096);
  if (refused.ok) throw new Error("Expected wide shape capacity refusal");
  expect(refused.error.kind).toBe("capacity");
  const admitted = inferJsonShape(
    source,
    WEB_RUNTIME_LIMITS.retainedEventBytes,
  );
  if (!admitted.ok) throw admitted.error;
  expect(admitted.value.shape.properties).toHaveLength(2_000);
  expect(admitted.value.serializedBytes).toBe(
    Buffer.byteLength(JSON.stringify(admitted.value.shape)),
  );
});

it.each(["not-json", Uint8Array.from([0xff])])(
  "distinguishes invalid source from valid JSON capacity refusal",
  (source) => {
    const result = inferJsonShape(source, 0);
    if (result.ok) throw new Error("Expected invalid JSON refusal");
    expect(result.error.kind).toBe("invalid-json");
    const valid = inferJsonShape("null", 0);
    if (valid.ok) throw new Error("Expected capacity refusal for valid JSON");
    expect(valid.error.kind).toBe("capacity");
  },
);
