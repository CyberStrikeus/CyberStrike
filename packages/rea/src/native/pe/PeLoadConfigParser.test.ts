import { describe, expect, it } from "vitest";
import {
  inspectPeLoadConfigInputSchema,
  peLoadConfigSchema,
  type PeLoadConfigField,
} from "../../domain/native/peLoadConfig.js";
import {
  parsePeLoadConfig,
  PeLoadConfigLimitFailure,
} from "./PeLoadConfigParser.js";
import {
  peLoadConfigImage,
  peManySectionsImage,
  type PeLoadConfigFixtureOptions,
} from "./PeLoadConfig.fixture.js";

const parse = (
  options: PeLoadConfigFixtureOptions = {},
  max_callbacks = 64,
) => {
  const bytes = peLoadConfigImage(options);
  return parsePeLoadConfig(
    bytes,
    { path: "/sample.exe", sha256: "a".repeat(64), bytes: bytes.length },
    inspectPeLoadConfigInputSchema.parse({
      path: "/sample.exe",
      max_callbacks,
    }),
  );
};
describe.each([32, 64] as const)("PE%s load configuration", (bits) => {
  it("locates callbacks and separates flag claims", async () => {
    const report = await parse({ bits });
    expect(peLoadConfigSchema.safeParse(report).success).toBe(true);
    expect(report.tls?.callbacks).toHaveLength(3);
    expect(report.tls?.callbacks[0]).toMatchObject({
      rva: 0x2000,
      file_offset: 0x1600,
      section: ".text",
    });
    expect(report.tls?.callbacks[2]).toMatchObject({
      rva: 0x9000,
      file_offset: null,
      section: null,
    });
    expect(report.load_config?.guard_flags?.raw).toBe(0x500);
    expect(report.load_config?.inferences[0]?.evidence_kind).toBe("inferred");
    expect(report.load_config?.se_handler_count).toBe(bits === 32 ? 2 : null);
  });
  it("honors Size even when directory bytes contain newer fields", async () => {
    const report = await parse({
      bits,
      loadConfigSize: 64,
      loadConfigDirectorySize: 320,
    });
    expect(report.load_config?.guard_flags).toBeNull();
    expect(report.load_config?.security_cookie === null).toBe(bits === 64);
  });
  it.each(["empty", "absent"] as const)(
    "accepts %s callbacks",
    async (callbacks) => {
      expect((await parse({ bits, callbacks })).tls?.callbacks).toEqual([]);
    },
  );
  it("accepts exactly the callback budget and rejects overflow", async () => {
    expect(
      (await parse({ bits, callbackCount: 1 }, 1)).examined_callbacks,
    ).toBe(1);
    await expect(parse({ bits }, 1)).rejects.toBeInstanceOf(
      PeLoadConfigLimitFailure,
    );
  });
  it("reports absent directories", async () => {
    expect(await parse({ bits, tls: false, loadConfig: false })).toMatchObject({
      tls: null,
      load_config: null,
    });
  });
  it.each([
    "tls-unmapped",
    "tls-truncated",
    "tls-half",
    "load-config-oversize",
    "load-config-truncated",
    "load-config-half",
    "raw-data-inverted",
    "callback-unterminated",
    "ambiguous-section",
  ] as const)("rejects %s", async (malformed) => {
    await expect(parse({ bits, malformed })).rejects.toThrow();
  });
});

it("reads Size bytes past a legacy 64-byte PE32 directory", async () => {
  const report = await parse({ bits: 32, loadConfigDirectorySize: 64 });
  expect(report.load_config?.directory.size).toBe(64);
  expect(report.load_config?.size).toBeGreaterThan(64);
  expect(report.load_config?.structure_location).toEqual({
    offset: report.load_config?.directory.file_offset,
    bytes: report.load_config?.size,
  });
  expect(report.load_config?.se_handler_count).toBe(2);
  expect(report.load_config?.guard_flags?.raw).toBe(0x500);
});

it("preserves pointer precision and unknown flag bits", async () => {
  const bytes = peLoadConfigImage();
  // PE64 load config at 0x640; XFG slot at +280, GuardFlags at +144.
  bytes.writeBigUInt64LE(0xfedcba9876543210n, 0x640 + 280);
  bytes.writeUInt32LE(0xf0200100, 0x640 + 144);
  const report = await parsePeLoadConfig(
    bytes,
    { path: "/sample.exe", sha256: "a".repeat(64), bytes: bytes.length },
    inspectPeLoadConfigInputSchema.parse({ path: "/sample.exe" }),
  );
  expect(report.load_config?.guard_xfg_check_function_pointer).toEqual({
    va: "0xfedcba9876543210",
    rva: null,
    file_offset: null,
    section: null,
  });
  expect(report.load_config?.guard_flags).toMatchObject({
    unrecognized: 0x200000,
    cf_function_table_stride: 19,
  });
});

it("honors cancellation before parsing", async () => {
  const bytes = peLoadConfigImage();
  await expect(
    parsePeLoadConfig(
      bytes,
      { path: "/sample.exe", sha256: "a".repeat(64), bytes: bytes.length },
      inspectPeLoadConfigInputSchema.parse({ path: "/sample.exe" }),
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
});

it("retains a callback in virtual-only section storage with unknown file offset", async () => {
  expect(
    (await parse({ zeroFillCallback: true })).tls?.callbacks[0],
  ).toMatchObject({ rva: 0x2200, file_offset: null, section: ".text" });
});

it("resolves callback sections in bounded time for the largest section table", async () => {
  const bytes = peManySectionsImage(65535, 4096);
  const started = performance.now();
  const report = await parsePeLoadConfig(
    bytes,
    { path: "/sample.exe", sha256: "a".repeat(64), bytes: bytes.length },
    inspectPeLoadConfigInputSchema.parse({
      path: "/sample.exe",
      max_callbacks: 4096,
    }),
  );
  // A per-callback scan of every section takes several seconds here.
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(report.tls?.callbacks).toHaveLength(4096);
  expect(report.tls?.callbacks.every(({ section }) => section === ".v")).toBe(
    true,
  );
});

/**
 * IMAGE_LOAD_CONFIG_DIRECTORY32/64 member offsets transcribed from the PE/COFF
 * specification and llvm/Object/COFF.h (coff_load_configuration32/64), kept
 * independent of the parser's layout table.
 */
const SPEC_FIELDS: Record<
  32 | 64,
  readonly (readonly [PeLoadConfigField, number, 2 | 4 | 8])[]
> = {
  32: [
    ["security_cookie", 60, 4],
    ["se_handler_table", 64, 4],
    ["se_handler_count", 68, 4],
    ["guard_cf_check_function_pointer", 72, 4],
    ["guard_cf_dispatch_function_pointer", 76, 4],
    ["guard_cf_function_table", 80, 4],
    ["guard_cf_function_count", 84, 4],
    ["guard_flags", 88, 4],
    ["guard_address_taken_iat_entry_table", 104, 4],
    ["guard_address_taken_iat_entry_count", 108, 4],
    ["guard_long_jump_target_table", 112, 4],
    ["guard_long_jump_target_count", 116, 4],
    ["dynamic_value_reloc_table", 120, 4],
    ["chpe_metadata_pointer", 124, 4],
    ["dynamic_value_reloc_table_offset", 136, 4],
    ["dynamic_value_reloc_table_section", 140, 2],
    ["guard_eh_continuation_table", 164, 4],
    ["guard_eh_continuation_count", 168, 4],
    ["guard_xfg_check_function_pointer", 172, 4],
  ],
  64: [
    ["security_cookie", 88, 8],
    ["se_handler_table", 96, 8],
    ["se_handler_count", 104, 8],
    ["guard_cf_check_function_pointer", 112, 8],
    ["guard_cf_dispatch_function_pointer", 120, 8],
    ["guard_cf_function_table", 128, 8],
    ["guard_cf_function_count", 136, 8],
    ["guard_flags", 144, 4],
    ["guard_address_taken_iat_entry_table", 160, 8],
    ["guard_address_taken_iat_entry_count", 168, 8],
    ["guard_long_jump_target_table", 176, 8],
    ["guard_long_jump_target_count", 184, 8],
    ["dynamic_value_reloc_table", 192, 8],
    ["chpe_metadata_pointer", 200, 8],
    ["dynamic_value_reloc_table_offset", 224, 4],
    ["dynamic_value_reloc_table_section", 228, 2],
    ["guard_eh_continuation_table", 264, 8],
    ["guard_eh_continuation_count", 272, 8],
    ["guard_xfg_check_function_pointer", 280, 8],
  ],
};

/** Load-config file offset in the synthetic image: `.data` 0x600 + RVA 0x40. */
const LOAD_CONFIG_AT = 0x640;

/** A distinct sentinel per field that fills its whole width. */
const sentinel = (index: number, width: 2 | 4 | 8): bigint =>
  width === 8
    ? 0x0000_0102_0304_0500n + BigInt(index)
    : BigInt((width === 4 ? 0x01020300 : 0x1200) + index);

/** Rewrite the struct from spec offsets alone, then declare `size`. */
const specImage = (bits: 32 | 64, size: number): Buffer => {
  const known = bits === 32 ? 192 : 320;
  const bytes = peLoadConfigImage({
    bits,
    loadConfigSize: known,
    loadConfigDirectorySize: known,
  });
  bytes.fill(0, LOAD_CONFIG_AT, LOAD_CONFIG_AT + known);
  bytes.writeUInt32LE(size, LOAD_CONFIG_AT);
  SPEC_FIELDS[bits].forEach(([, offset, width], index) => {
    const value = sentinel(index, width);
    if (width === 8) bytes.writeBigUInt64LE(value, LOAD_CONFIG_AT + offset);
    else if (width === 4)
      bytes.writeUInt32LE(Number(value), LOAD_CONFIG_AT + offset);
    else bytes.writeUInt16LE(Number(value), LOAD_CONFIG_AT + offset);
  });
  return bytes;
};

/** The report value a field takes when Size covers it. */
const expectedField = (name: PeLoadConfigField, value: bigint): unknown => {
  if (name === "guard_flags")
    return expect.objectContaining({ raw: Number(value) });
  if (name.endsWith("_count")) return Number(value);
  if (name === "dynamic_value_reloc_table" || name === "chpe_metadata_pointer")
    return `0x${value.toString(16)}`;
  if (
    name === "dynamic_value_reloc_table_offset" ||
    name === "dynamic_value_reloc_table_section"
  )
    return Number(value);
  return expect.objectContaining({ va: `0x${value.toString(16)}`, rva: null });
};

describe.each([32, 64] as const)(
  "PE%s load-config fields at specification offsets",
  (bits) => {
    it.each(
      SPEC_FIELDS[bits].map(([name, offset, width], index) => ({
        name,
        index,
        end: offset + width,
      })),
    )("exposes $name exactly when Size reaches $end", async ({ name, end }) => {
      for (const size of [end - 1, end]) {
        const bytes = specImage(bits, size);
        const report = await parsePeLoadConfig(
          bytes,
          { path: "/sample.exe", sha256: "a".repeat(64), bytes: bytes.length },
          inspectPeLoadConfigInputSchema.parse({ path: "/sample.exe" }),
        );
        const config = report.load_config;
        if (config === null) throw new Error("Expected a load configuration");
        expect(config.size).toBe(size);
        SPEC_FIELDS[bits].forEach(([field, offset, width], fieldIndex) => {
          // PE32+ SafeSEH-named slots are never a handler table.
          const covered =
            offset + width <= size &&
            !(bits === 64 && field.startsWith("se_handler"));
          expect(config[field], `${field} at Size ${String(size)}`).toEqual(
            covered ? expectedField(field, sentinel(fieldIndex, width)) : null,
          );
        });
        expect(config[name] === null).toBe(
          size < end || (bits === 64 && name.startsWith("se_handler")),
        );
      }
    });
  },
);

it.each([32, 64] as const)(
  "PE%s retains dynamic relocation offset and section with a zero pointer",
  async (bits) => {
    const pointerOffset = bits === 32 ? 120 : 192;
    const offsetOffset = bits === 32 ? 136 : 224;
    const sectionOffset = bits === 32 ? 140 : 228;
    for (const [offset, section] of [
      [0, 0],
      [0x40, 1],
      [0xffffffff, 0xffff],
    ] as const) {
      const bytes = specImage(bits, bits === 32 ? 192 : 320);
      bytes.fill(
        0,
        LOAD_CONFIG_AT + pointerOffset,
        LOAD_CONFIG_AT + pointerOffset + (bits === 32 ? 4 : 8),
      );
      bytes.writeUInt32LE(offset, LOAD_CONFIG_AT + offsetOffset);
      bytes.writeUInt16LE(section, LOAD_CONFIG_AT + sectionOffset);
      const report = await parsePeLoadConfig(
        bytes,
        { path: "/sample.exe", sha256: "a".repeat(64), bytes: bytes.length },
        inspectPeLoadConfigInputSchema.parse({ path: "/sample.exe" }),
      );
      expect(peLoadConfigSchema.safeParse(report).success).toBe(true);
      expect(report.load_config).toMatchObject({
        dynamic_value_reloc_table: "0x0",
        dynamic_value_reloc_table_offset: offset,
        dynamic_value_reloc_table_section: section,
      });
    }
  },
);
