import { describe, expect, it } from "vitest";
import {
  NATIVE_AOT_MAX_REPORT_BYTES,
  parseNativeAotPe,
} from "./nativeAotPe.js";
import {
  NATIVE_AOT_HYDRATION_BASE,
  NATIVE_AOT_HYDRATION_CAPACITY,
  type NativeAotHydrationCommand,
  nativeAotPeDigest,
  nativeAotPeHydrationFixture,
} from "../../../tests/fixtures/nativeaotPe.js";

/** The parser's first output allocation; larger streams must grow it. */
const INITIAL_OUTPUT = 64 * 1024;
const TARGET = 0x140001010n;
const fill = (length: number, value = 0xa5): Buffer =>
  Buffer.alloc(length, value);

const hydrate = (commands: readonly NativeAotHydrationCommand[]) => {
  const { bytes, expected } = nativeAotPeHydrationFixture(commands);
  const digest = nativeAotPeDigest(bytes);
  const { summary } = parseNativeAotPe(
    bytes,
    digest,
    NATIVE_AOT_MAX_REPORT_BYTES,
  );
  // The overlay is parser-owned; the captured snapshot must stay unchanged.
  expect(nativeAotPeDigest(bytes)).toBe(digest);
  return { summary, expected };
};

describe("NativeAOT DEHYDRATED_DATA hydration output", () => {
  it.each<[string, NativeAotHydrationCommand[]]>([
    ["COPY ending at the initial capacity", [{ copy: fill(INITIAL_OUTPUT) }]],
    ["COPY that grows the output", [{ copy: fill(INITIAL_OUTPUT + 1) }]],
    [
      "COPY that grows retained output",
      [{ copy: fill(32768) }, { copy: fill(32769, 0xa6) }],
    ],
    [
      "COPYs that grow the output twice",
      [
        { copy: fill(INITIAL_OUTPUT + 1) },
        { copy: fill(INITIAL_OUTPUT + 1, 0xa6) },
      ],
    ],
    [
      "empty COPYs around growth",
      [
        { copy: Buffer.alloc(0) },
        { copy: fill(INITIAL_OUTPUT + 1) },
        { copy: Buffer.alloc(0) },
        { copy: fill(3, 0xa6) },
      ],
    ],
    [
      "zero fill that grows the output",
      [
        { copy: fill(INITIAL_OUTPUT - 1) },
        { zero: 10 },
        { copy: fill(5, 0xa6) },
      ],
    ],
    [
      "relative fixup straddling growth",
      [
        { copy: fill(INITIAL_OUTPUT - 2) },
        { fixupRel: TARGET },
        { copy: fill(3, 0xa6) },
      ],
    ],
    [
      "pointer fixup straddling growth",
      [
        { copy: fill(INITIAL_OUTPUT - 4) },
        { fixupPtr: TARGET },
        { copy: fill(3, 0xa6) },
      ],
    ],
    [
      "inline relative pointers straddling growth",
      [
        { copy: fill(INITIAL_OUTPUT - 6) },
        { inlineRel: [TARGET, TARGET + 8n, TARGET + 16n] },
        { copy: fill(3, 0xa6) },
      ],
    ],
    [
      "inline pointers straddling growth",
      [
        { copy: fill(INITIAL_OUTPUT - 12) },
        { inlinePtr: [TARGET, TARGET + 8n, TARGET + 16n] },
        { copy: fill(3, 0xa6) },
      ],
    ],
    [
      "output growing to exactly the mapped section end",
      [
        { copy: fill(NATIVE_AOT_HYDRATION_CAPACITY - 9) },
        { fixupPtr: TARGET },
        { zero: 1 },
      ],
    ],
  ])("preserves every byte for %s", (_case, commands) => {
    const { summary, expected } = hydrate(commands);
    expect(summary.status).toBe("complete");
    expect(summary.diagnostics).toEqual([]);
    expect(summary.derived_overlay).toEqual({
      address: `0x${NATIVE_AOT_HYDRATION_BASE.toString(16)}`,
      size_bytes: expected.length,
      sha256: nativeAotPeDigest(expected),
    });
  });

  it.each<[string, NativeAotHydrationCommand[], string]>([
    [
      "COPY past the mapped section",
      [{ copy: fill(NATIVE_AOT_HYDRATION_CAPACITY + 1) }],
      "exceeds_mapped_section",
    ],
    [
      "pointer fixup past the mapped section after growth",
      [{ copy: fill(NATIVE_AOT_HYDRATION_CAPACITY - 4) }, { fixupPtr: TARGET }],
      "exceeds_mapped_section",
    ],
    [
      "COPY payload past DEHYDRATED_DATA after growth",
      [
        { copy: fill(INITIAL_OUTPUT + 1) },
        { raw: Buffer.from([4 << 3, 1, 2]) },
      ],
      "copy_leaves_section",
    ],
    [
      "fixup index outside captured sections after growth",
      [
        { copy: fill(INITIAL_OUTPUT + 1) },
        { raw: Buffer.from([(31 << 3) | 3, 0xff, 0xff, 0xff]) },
      ],
      "fixup_leaves_sections",
    ],
  ])("reports %s as partial without an overlay", (_case, commands, detail) => {
    const { summary } = hydrate(commands);
    expect(summary.status).toBe("partial");
    expect(summary.derived_overlay).toBeNull();
    expect(summary.reason).toMatchObject({
      code: "hydration_failed",
      detail,
    });
    expect(summary.diagnostics).toEqual([detail]);
  });
});

describe("NativeAOT hydration pointer domain", () => {
  it.each([
    {
      label: "negative",
      imageBase: 0x10000n,
      delta: -0x80000000,
    },
    {
      label: "above uint64",
      imageBase: (1n << 64n) - 0x62000n,
      delta: 0x7fffffff,
    },
  ])(
    "keeps a partial report when an inline pointer is $label",
    ({ imageBase, delta }) => {
      const { bytes } = nativeAotPeHydrationFixture([
        { inlinePtr: [NATIVE_AOT_HYDRATION_BASE] },
      ]);
      const fixtureBase = 0x140000000n;
      bytes.writeBigUInt64LE(imageBase, 0x98 + 24);
      // Directory rows store absolute VAs. Move them with the image base so
      // the directory stays admitted and hydration still runs.
      for (const offset of [0x618, 0x620, 0x630, 0x638]) {
        const value = bytes.readBigUInt64LE(offset);
        if (value >= fixtureBase)
          bytes.writeBigUInt64LE(value - fixtureBase + imageBase, offset);
      }
      // The first inline pointer is at RVA 0x3005. Image base 0x10000 makes
      // that VA 0x13005, and delta -0x80000000 leaves the unsigned domain.
      bytes.writeInt32LE(delta, 0x1605);
      const summary = parseNativeAotPe(
        bytes,
        nativeAotPeDigest(bytes),
        NATIVE_AOT_MAX_REPORT_BYTES,
      ).summary;
      expect(summary.status).toBe("partial");
      expect(summary.derived_overlay).toBeNull();
      expect(summary.reason).toMatchObject({
        code: "no_system_object_root",
        hydration: { detail: "pointer_outside_address_domain" },
      });
    },
  );
});
