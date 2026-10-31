import { expect, it } from "vitest";

import { readMarshalSubset } from "./MarshalSubset.js";

const bytes = (hex: string): Buffer => Buffer.from(hex, "hex");

it("reads a Python 3.9 reference-flagged PYZ table", () => {
  const parsed = readMarshalSubset(
    bytes(
      "db04000000a902da0568656c6c6fa903e900000000e90a000000e914000000a902da03706b67a903e901000000e91e000000e928000000a902fa0c6a736f6e2e6465636f646572a9037204000000e964000000e932000000a902da026e73a903e90300000072040000007204000000",
    ),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual([
    ["hello", [0, 10, 20]],
    ["pkg", [1, 30, 40]],
    ["json.decoder", [0, 100, 50]],
    ["ns", [3, 0, 0]],
  ]);
});

it("decodes CPython marshal Unicode with surrogatepass", () => {
  expect(
    readMarshalSubset(
      bytes(
        "5b01000000290275080000006e6f64655fedb3bf29036900000000690c0000006901000000",
      ),
    ),
  ).toEqual({
    ok: true,
    value: [["node_\udcff", [0, 12, 1]]],
  });
});

it("retains a surrogate-bearing Unicode string in its marshal reference slot", () => {
  expect(readMarshalSubset(bytes("2902f50400000061edb3bf7200000000"))).toEqual({
    ok: true,
    value: ["a\udcff", "a\udcff"],
  });
});

it.each([
  ["", ""],
  ["c2a2", "\u00a2"],
  ["e282ac", "\u20ac"],
  ["efbbbf", "\ufeff"],
  ["f0908080", "\ud800\udc00"],
  ["f48fbfbf", "\udbff\udfff"],
  ["eda080", "\ud800"],
  ["edbfbf", "\udfff"],
  ["eda080edbfbf", "\ud800\udfff"],
])("preserves CPython Unicode code points for UTF-8 %s", (hex, value) => {
  const body = bytes(hex);
  const length = Buffer.alloc(4);
  length.writeInt32LE(body.length);
  // Unicode and reference-flagged interned Unicode use the same codec.
  for (const type of [0x75, 0xf4])
    expect(
      readMarshalSubset(Buffer.concat([Buffer.from([type]), length, body])),
    ).toEqual({ ok: true, value });
});

it.each([
  "80",
  "c080",
  "c2",
  "c241",
  "e08080",
  "eda0",
  "eda041",
  "f0808080",
  "f09080",
  "f4908080",
  "f5808080",
])("rejects malformed UTF-8 %s despite surrogatepass", (malformed) => {
  const body = bytes(malformed);
  const length = Buffer.alloc(4);
  length.writeInt32LE(body.length);
  expect(
    readMarshalSubset(Buffer.concat([Buffer.from([0x75]), length, body])),
  ).toMatchObject({
    ok: false,
    error: {
      reason: "format",
      message: "PYZ marshal string is not valid UTF-8",
    },
  });
});

it("resolves a shared string through a reference reserved before the tuple", () => {
  const parsed = readMarshalSubset(
    bytes(
      "db020000002902da06736861726564a903e900000000e901000000e90200000029027201000000a9037204000000e903000000e904000000",
    ),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual([
    ["shared", [0, 1, 2]],
    ["shared", [1, 3, 4]],
  ]);
});

it("does not allocate a new reference slot for a flagged TYPE_REF", () => {
  const parsed = readMarshalSubset(
    bytes("2904fa0161f200000000fa01627201000000"),
  );
  expect(parsed).toEqual({ ok: true, value: ["a", "a", "b", "b"] });
});

it("reads a long integer that fits in a safe integer", () => {
  const parsed = readMarshalSubset(
    bytes(
      "5b01000000a902da03626967a903e900000000ec03000000000000000004e905000000",
    ),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual([["big", [0, 2 ** 40, 5]]]);
});

it.each(["6c0200000003000000", "6cfeffffff03000000"])(
  "rejects marshal long %s with a zero most-significant digit as malformed",
  (hex) => {
    expect(readMarshalSubset(bytes(hex))).toMatchObject({
      ok: false,
      error: {
        reason: "format",
        message: "PYZ marshal long is not normalized",
      },
    });
  },
);

it("reads the zero-digit marshal long encoding as zero", () => {
  expect(readMarshalSubset(bytes("6c00000000"))).toEqual({
    ok: true,
    value: 0,
  });
});

it("keeps positive over-budget marshal long digit counts as resource refusals", () => {
  expect(readMarshalSubset(bytes("6c09000000"))).toMatchObject({
    ok: false,
    error: { reason: "limit" },
  });
});

it("reads a negative 32-bit integer", () => {
  const parsed = readMarshalSubset(
    bytes("5b01000000a902da016ea903e900000000e9ffffffffe901000000"),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual([["n", [0, -1, 1]]]);
});

it("rejects a marshal type outside the subset", () => {
  const parsed = readMarshalSubset(Buffer.from([0x4e]));
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.error.reason).toBe("format");
});

it.each([
  ["string", "73ffffffff"],
  ["list", "5bffffffff"],
  ["tuple", "28ffffffff"],
])("classifies a negative marshal %s size as malformed", (_kind, hex) => {
  const parsed = readMarshalSubset(bytes(hex));
  expect(parsed).toMatchObject({
    ok: false,
    error: { reason: "format" },
  });
});

it.each([
  ["string", "7301000100"],
  ["list", "5ba1860100"],
])("keeps positive marshal %s budget refusals as limits", (_kind, hex) => {
  const parsed = readMarshalSubset(bytes(hex));
  expect(parsed).toMatchObject({
    ok: false,
    error: { reason: "limit" },
  });
});
