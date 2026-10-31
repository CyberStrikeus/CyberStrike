import { describe, expect, it } from "vitest";

import { decodeZipName, sameZipName } from "./zipEntryName.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(Buffer.from(text, "hex"));
const units = (text: string): string[] =>
  [...text].map((c) => (c.codePointAt(0) ?? 0).toString(16).padStart(4, "0"));

describe("ZIP entry names as apksig decodes them", () => {
  // Expected code points from OpenJDK 25's new String(bytes, UTF_8).
  it.each([
    ["64ff", ["0064", "fffd"]],
    ["c080", ["fffd", "fffd"]],
    ["e08080", ["fffd", "fffd", "fffd"]],
    // Encoded surrogates: one replacement for Java, three for WHATWG.
    ["eda080", ["fffd"]],
    ["edbfbf", ["fffd"]],
    ["eda0", ["fffd"]],
    ["edb080ed8080", ["fffd", "d000"]],
    ["eda041", ["fffd", "0041"]],
    ["f0808080", ["fffd", "fffd", "fffd", "fffd"]],
    ["f4908080", ["fffd", "fffd", "fffd", "fffd"]],
    ["f888808080", ["fffd", "fffd", "fffd", "fffd", "fffd"]],
    ["e28241", ["fffd", "0041"]],
    ["f09f98", ["fffd"]],
    ["f09f9841", ["fffd", "0041"]],
    ["f09041", ["fffd", "0041"]],
    ["e180c280", ["fffd", "0080"]],
    ["f09080c0", ["fffd", "fffd"]],
    ["f09f9880", ["1f600"]],
    ["636166c3a9", ["0063", "0061", "0066", "00e9"]],
    // Java keeps a leading byte-order mark as U+FEFF.
    ["efbbbf41", ["feff", "0041"]],
    ["efbbbfefbbbf", ["feff", "feff"]],
  ])("decodes %s as Java does", (stored, expected) => {
    expect(units(decodeZipName(hex(stored)))).toEqual(expected);
  });

  it("matches names that decode to the same Java string", () => {
    expect(sameZipName(hex("64ff"), hex("64fe"))).toBe(true);
    expect(sameZipName(hex("64ff"), hex("64efbfbd"))).toBe(true);
    expect(sameZipName(hex("78eda080"), hex("78ff"))).toBe(true);
    expect(sameZipName(hex("78ff"), hex("78ffff"))).toBe(false);
    expect(sameZipName(hex("6162"), hex("6162"))).toBe(true);
    expect(sameZipName(hex("6162"), hex("6163"))).toBe(false);
  });
});
