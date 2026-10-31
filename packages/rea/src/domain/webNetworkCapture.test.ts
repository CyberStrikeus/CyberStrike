import { expect, it } from "vitest";
import {
  freezeJsonSnapshot,
  immutableJsonSnapshotMember,
} from "./immutableJson.js";
import {
  safeParseOwnedWebNetworkCapture,
  webNetworkCaptureSchema,
} from "./webNetworkCapture.js";

const capture = (format = "har") => ({
  format,
  artifact: { path: "/capture", sha256: "a".repeat(64), bytes: 10 },
  decoder: { id: "fixture", name: "Fixture", version: "1" },
  container: {
    reported: {},
    numeric_literals: [],
    redactions: [],
    records_pointer: "/log/entries",
  },
  total_records: 3,
  records: [
    {
      ordinal: 2,
      location: { kind: "json-pointer", pointer: "/log/entries/2" },
      reported: { method: "GET", timestamp: null },
      binary_fields: [],
      numeric_literals: [
        {
          pointer: "/time",
          producer_type: "json-number",
          literal: "9007199254740993",
        },
      ],
      redactions: [],
      limitations: [],
    },
  ],
  runtime_attribution: "unknown",
  limitations: [],
});

it.each(["har", "saz", "mitmproxy"])(
  "borrows a fully validated immutable %s capture, retaining exact source facts",
  (format) => {
    const source = freezeJsonSnapshot(capture(format));
    const expected = webNetworkCaptureSchema.parse(source);
    for (let page = 0; page < 2; page += 1) {
      const parsed = safeParseOwnedWebNetworkCapture(source);
      if (!parsed.success) throw parsed.error;
      expect(parsed.data).toBe(source);
      expect(parsed.data).toEqual(expected);
    }
  },
);

it.each(["mutable", "shallow-frozen"])(
  "revalidates a %s capture after a nested ordinal changes",
  (kind) => {
    const source = capture();
    if (kind === "shallow-frozen") Object.freeze(source);
    expect(safeParseOwnedWebNetworkCapture(source).success).toBe(true);
    source.records[0]!.ordinal = 3;
    expect(safeParseOwnedWebNetworkCapture(source)).toEqual(
      webNetworkCaptureSchema.safeParse(source),
    );
    expect(safeParseOwnedWebNetworkCapture(source).success).toBe(false);
    source.records[0]!.ordinal = 0;
    expect(safeParseOwnedWebNetworkCapture(source).success).toBe(true);
  },
);

it("validates a child of a sealed portable envelope and rejects malformed sealed siblings", () => {
  const malformed = capture();
  malformed.records.push({ ...malformed.records[0]! });
  const envelope = freezeJsonSnapshot({ valid: capture(), malformed });
  const valid = immutableJsonSnapshotMember(envelope, "valid");
  const parsed = safeParseOwnedWebNetworkCapture(valid);
  expect(parsed.success && parsed.data).toBe(valid);
  const invalid = immutableJsonSnapshotMember(envelope, "malformed");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = safeParseOwnedWebNetworkCapture(invalid);
    expect(result.success).toBe(false);
    expect(result).toEqual(webNetworkCaptureSchema.safeParse(invalid));
  }
});

it("does not treat external deep freezing as the owner's validation proof", () => {
  const source = capture();
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(source);
  for (let page = 0; page < 2; page += 1) {
    const parsed = safeParseOwnedWebNetworkCapture(source);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data).not.toBe(source);
    expect(parsed.data).toEqual(webNetworkCaptureSchema.parse(source));
  }
});

it("retains schema normalization when an owned source contains a hidden reported field", () => {
  const source = capture();
  Object.defineProperty(source.container, "reported", {
    value: Object.defineProperty({}, "hidden", { value: 7 }),
    enumerable: true,
  });
  const sealed = freezeJsonSnapshot(source);
  const parsed = safeParseOwnedWebNetworkCapture(sealed);
  if (!parsed.success) throw parsed.error;
  expect(parsed.data).not.toBe(sealed);
  expect(parsed.data).toEqual(webNetworkCaptureSchema.parse(sealed));
  expect(
    Object.hasOwn(parsed.data.container.reported as object, "hidden"),
  ).toBe(false);
});
