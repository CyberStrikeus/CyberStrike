import { expect, it } from "vitest";

import { decodeAsn1Oid } from "./asn1Oid.js";

const limits = { bytes: 64, arcBytes: 32 };

it("decodes combined initial arcs and later arcs beyond JavaScript integer precision", () => {
  expect(decodeAsn1Oid(Uint8Array.of(0x88, 0x37, 0x03), limits)).toEqual({
    ok: true,
    value: "2.999.3",
  });
  expect(
    decodeAsn1Oid(
      Uint8Array.of(0x2a, 0xa0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00),
      limits,
    ),
  ).toEqual({ ok: true, value: "1.2.18014398509481984" });
});

it("distinguishes malformed arcs from each caller-selected capacity bound", () => {
  expect(decodeAsn1Oid(new Uint8Array(), limits)).toEqual({
    ok: false,
    error: { kind: "empty" },
  });
  expect(decodeAsn1Oid(Uint8Array.of(0x2a, 0x81), limits)).toEqual({
    ok: false,
    error: { kind: "truncated" },
  });
  const content = Uint8Array.of(0x2a, 0x81, 0x00);
  expect(decodeAsn1Oid(content, { bytes: 3, arcBytes: 2 })).toEqual({
    ok: true,
    value: "1.2.128",
  });
  expect(decodeAsn1Oid(content, { bytes: 2, arcBytes: 2 })).toEqual({
    ok: false,
    error: { kind: "byte-limit", limit: 2 },
  });
  expect(decodeAsn1Oid(content, { bytes: 3, arcBytes: 1 })).toEqual({
    ok: false,
    error: { kind: "arc-limit", limit: 1 },
  });
});

it.each([
  [0x80, 0x2a],
  [0x2a, 0x80, 0x03],
  [0x2a, 0x80, 0x80, 0x00],
])("rejects a non-minimal subidentifier: %j", (...bytes) => {
  expect(decodeAsn1Oid(Uint8Array.from(bytes), limits)).toEqual({
    ok: false,
    error: { kind: "non-minimal" },
  });
});

it("preserves zero subidentifiers and internal zero base-128 groups", () => {
  expect(decodeAsn1Oid(Uint8Array.of(0, 0, 0x81, 0x80, 0), limits)).toEqual({
    ok: true,
    value: "0.0.0.16384",
  });
});
