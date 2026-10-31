import { describe, expect, it } from "vitest";

import { addressCoordinate, addressDistance } from "./addressCoordinate.js";
import { parseDocuments } from "./nativeDocument.js";
import { parseRelatedAddresses } from "./nativeObservation.js";
import { parseSegments } from "./nativeSegments.js";

describe("native provider boundary values", () => {
  it.each([
    "ram space:0x1",
    "ram:extra:0x1",
    "ram%zz:0x1",
    ":0x1",
    "ram%2f:0x1",
    "0X1",
    "0xA",
  ])("leaves malformed or non-observed coordinate %s unknown", (address) => {
    expect(addressCoordinate(address)).toBeNull();
    expect(addressDistance(address, address)).toBeNull();
  });

  it("preserves encoded space identity and padded observed offsets", () => {
    expect(addressCoordinate("ram%2Fbank:0x000a")).toEqual({
      space: "ram%2Fbank",
      offset: 10n,
    });
    expect(addressDistance("ram%2Fbank:0x000a", "ram%2Fbank:0xb")).toBe(1);
    expect(addressDistance("ram%2Fbank:0xa", "ram%252Fbank:0xb")).toBeNull();
  });

  it("distinguishes measured zero, malformed, incomparable, reversed, and oversized extents", () => {
    expect(addressDistance("not-an-address", "0x2000")).toBeNull();
    expect(addressDistance("ram:0x1000", "rom:0x2000")).toBeNull();
    expect(addressDistance("0x2000", "0x1000")).toBeNull();
    expect(addressDistance("0x1000", "0x1000")).toBe(0);
    expect(addressDistance("0x1000", "0x2000")).toBe(4096);
    expect(addressDistance("0x0", "0x20000000000000")).toBeNull();
  });

  it("rejects segments when required coordinates or unknown permissions are omitted", () => {
    expect(
      parseSegments([
        {
          name: "__TEXT",
          start: "0x1",
          end: "0x2",
          readable: null,
          writable: null,
        },
      ]).ok,
    ).toBe(false);
    expect(
      parseSegments([{ name: "__TEXT", start: "0x1", end: "0x2" }]).ok,
    ).toBe(false);
  });
  it("parses provider arrays", () => {
    expect(parseRelatedAddresses(["0x3"], "callers")).toEqual({
      ok: true,
      value: ["0x3"],
    });
    expect(
      parseSegments([
        {
          name: "__TEXT",
          start: "0x1",
          end: "0x2",
          readable: true,
          writable: false,
          executable: null,
        },
      ]),
    ).toEqual({
      ok: true,
      value: [
        {
          name: "__TEXT",
          start: "0x1",
          end: "0x2",
          readable: true,
          writable: false,
          executable: null,
        },
      ],
    });
    expect(parseDocuments(["fixture"])).toEqual({
      ok: true,
      value: ["fixture"],
    });
  });

  it.each([
    ["relations", () => parseRelatedAddresses([1], "callees")],
    [
      "wrapped relations",
      () => parseRelatedAddresses({ callees: ["0x3"] }, "callees"),
    ],
    ["wrapped documents", () => parseDocuments({ documents: ["fixture"] })],
    ["wrapped segments", () => parseSegments({ segments: [] })],
    ["segments", () => parseSegments([{ name: 1 }])],
    ["documents", () => parseDocuments([1])],
  ])(
    "rejects malformed %s instead of manufacturing empty output",
    (_label, parse) => {
      const result = parse();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
    },
  );

  it("uses provider-neutral wording for malformed shared values", () => {
    const result = parseSegments([{ name: 1 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisOutputError");
      expect(result.error.operation).toBe("list_segments");
      expect(result.error.reason).toBe(
        "Provider returned an invalid segment list",
      );
    }
  });
});
