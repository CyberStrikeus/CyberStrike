import { expect, it } from "vitest";

import { decodePaddedBase64, paddedBase64ByteLength } from "./paddedBase64.js";

it("preserves padded syntax, including empty bodies and nonzero pad bits", () => {
  for (const [encoded, decoded] of [
    ["", ""],
    ["AA==", "00"],
    ["AB==", "00"],
    ["AAA=", "0000"],
    ["AAB=", "0000"],
    ["////", "ffffff"],
  ] as const) {
    expect(decodePaddedBase64(encoded)?.toString("hex")).toBe(decoded);
    expect(paddedBase64ByteLength(encoded)).toBe(decoded.length / 2);
  }
  for (const malformed of [
    "A",
    "AA",
    "AAA",
    "=AAA",
    "A===",
    "====",
    "AA==A",
    "AA-_",
    "AA==\n",
    "AA==\r",
    "AA== ",
    "A A=",
    "ＡＡ==",
  ]) {
    expect(paddedBase64ByteLength(malformed), malformed).toBeUndefined();
    expect(decodePaddedBase64(malformed), malformed).toBeUndefined();
  }
});

it("validates large bodies and malformed suffixes without a regexp stack overflow", () => {
  const body = Buffer.alloc(24 * 1024 * 1024 - 3, 0x81);
  const encoded = body.toString("base64");
  expect(paddedBase64ByteLength(encoded)).toBe(body.length);
  expect(decodePaddedBase64(encoded)?.equals(body)).toBe(true);
  const malformed = `${encoded.slice(0, -1)}!`;
  expect(paddedBase64ByteLength(malformed)).toBeUndefined();
});
