import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  inspectKernelModuleInputSchema,
  kernelModuleSchema,
  MODULE_SIGNATURE_MAGIC,
} from "../../domain/native/kernelModule.js";
import { BinaryFormatFailure } from "../metadata/BinaryContainer.js";
import {
  compressedKernelModuleContainer,
  kernelModuleFixture,
  modversionEntry,
  moduleSignatureTrailer,
} from "./KernelModule.fixture.js";
import { parseKernelModule } from "./KernelModuleParser.js";

const artifactPath = "/artifacts/demo.ko";

const parse = (bytes: Buffer, extra: { readonly max_entries?: number } = {}) =>
  kernelModuleSchema.parse(
    parseKernelModule(
      bytes,
      {
        path: artifactPath,
        sha256: "ab".repeat(32),
        bytes: bytes.length,
      },
      inspectKernelModuleInputSchema.parse({
        path: artifactPath,
        ...extra,
      }),
    ),
  );

const pkcs7 = Buffer.from("fake-pkcs7-bytes", "latin1");
const pkcs7Sha256 = createHash("sha256").update(pkcs7).digest("hex");

it("preserves parameter duplicates, embedded equals, and original entry bytes", () => {
  const records = [
    "parm=level:verbosity=a",
    "parmtype=level:int",
    "parm=level:again",
  ];
  const report = parse(
    kernelModuleFixture({ modinfo: Buffer.from(`${records.join("\0")}\0`) }),
  );
  expect(
    report.modinfo?.entries.map(({ key, value, raw_hex }) => ({
      key,
      value,
      raw_hex,
    })),
  ).toEqual(
    records.map((record) => ({
      key: record.slice(0, record.indexOf("=")),
      value: record.slice(record.indexOf("=") + 1),
      raw_hex: Buffer.from(`${record}\0`).toString("hex"),
    })),
  );
});

it("distinguishes absent metadata from unavailable section names", () => {
  const absent = parse(kernelModuleFixture({ modinfo: null, versions: null }));
  expect(absent.modinfo?.status).toBe("absent");
  expect(absent.versions?.status).toBe("absent");
  const bytes = kernelModuleFixture();
  bytes.writeUInt16LE(0, 62);
  const unknown = parse(bytes);
  expect(unknown.modinfo?.status).toBe("unknown");
  expect(unknown.versions?.status).toBe("unknown");
});

it.each([
  [64, true],
  [64, false],
  [32, true],
  [32, false],
] as const)("reports an ET_REL ELF%s %s module", (bits, little) => {
  const report = parse(kernelModuleFixture({ bits, little }));
  const width = bits === 64 ? 16 : 8;
  expect(report).toMatchObject({
    format: bits === 64 ? "elf64" : "elf32",
    byte_order: little ? "little" : "big",
    machine: bits === 64 ? 62 : 20,
    type: 1,
    type_name: "relocatable",
    applicability: "applicable",
    compression: null,
    next_probe: null,
    coverage: { status: "complete", examined_entries: 9 },
  });
  expect(
    report.modinfo?.entries.map((entry) => [entry.key, entry.value]),
  ).toEqual([
    ["license", "GPL"],
    ["vermagic", "5.15.0 SMP mod_unload"],
    ["alias", "pci:v1"],
    ["alias", "pci:v2"],
    ["name", "demo"],
    ["depends", ""],
  ]);
  expect(
    report.modinfo?.entries.every((entry) => entry.status === "observed"),
  ).toBe(true);
  expect(report.versions?.layout).toBe(
    bits === 64 ? "elf64_unsigned_long_name56" : "elf32_unsigned_long_name60",
  );
  expect(
    report.versions?.entries.map((entry) => [entry.crc_hex, entry.name]),
  ).toEqual([
    ["12345678".padStart(width, "0"), "printk"],
    ["90abcdef".padStart(width, "0"), "module_layout"],
  ]);
  expect(report.this_module).toMatchObject({
    status: "present",
    layout: "unknown",
    location: { bytes: 8 },
  });
  expect(report.ksymtab?.sections.map((section) => section.name)).toEqual([
    "__ksymtab",
  ]);
  expect(report.init_text).toMatchObject({ status: "present", bytes: 4 });
  expect(report.exit_text).toMatchObject({ status: "present", bytes: 1 });
  expect(report.signature).toMatchObject({
    status: "present",
    reason: null,
    pkcs7: {
      location: { bytes: pkcs7.length },
      sha256: pkcs7Sha256,
    },
    info: { algo: 0, hash: 0, id_type: 2, sig_len: pkcs7.length },
  });
});

it("keeps earlier .modinfo entries when the last span is unterminated", () => {
  const report = parse(
    kernelModuleFixture({
      modinfo: Buffer.from("license=GPL\0alias=pci:v3", "latin1"),
    }),
  );
  expect(report.modinfo?.status).toBe("present");
  expect(report.modinfo?.entries.map((entry) => entry.reason)).toEqual([
    null,
    "unterminated_modinfo_entry",
  ]);
  expect(report.modinfo?.entries[1]).toMatchObject({
    status: "malformed",
    key: "alias",
    value: "pci:v3",
  });
});

it("reports a missing separator, an empty key, and an over-long field per entry", () => {
  const report = parse(
    kernelModuleFixture({
      modinfo: Buffer.concat([
        Buffer.from("license\0=GPL\0", "latin1"),
        Buffer.from(`${"k".repeat(257)}=x\0`, "latin1"),
        Buffer.from(`name=${"v".repeat(4097)}\0`, "latin1"),
      ]),
    }),
  );
  expect(report.modinfo?.entries.map((entry) => entry.reason)).toEqual([
    "modinfo_missing_separator",
    "modinfo_empty_key",
    "modinfo_field_exceeds_limit",
    "modinfo_field_exceeds_limit",
  ]);
  expect(report.modinfo?.entries[1]).toMatchObject({
    key: null,
    value: "GPL",
  });
  expect(report.modinfo?.entries[2]).toMatchObject({ key: null, value: "x" });
  expect(report.modinfo?.entries[3]).toMatchObject({
    key: "name",
    value: null,
  });
});

it("closes __versions when the section size is not a multiple of 64", () => {
  const report = parse(kernelModuleFixture({ versions: Buffer.alloc(63) }));
  expect(report.versions).toMatchObject({
    status: "malformed",
    entries: [],
    reason: "versions_size_not_multiple",
    layout: "elf64_unsigned_long_name56",
    entry_bytes: 64,
  });
  expect(report.coverage.examined_entries).toBe(
    (report.modinfo?.entries.length ?? 0) +
      (report.ksymtab?.sections.length ?? 0),
  );
});

it("observes a version name with nonzero padding and rejects a missing NUL", () => {
  const padded = modversionEntry(0x12345678, "printk", 64, true);
  padded[8 + "printk".length + 1] = 0x7f;
  const unterminated = Buffer.alloc(64, 0x41);
  unterminated.writeBigUInt64LE(0x11n, 0);
  const report = parse(
    kernelModuleFixture({
      versions: Buffer.concat([padded, unterminated]),
    }),
  );
  expect(report.versions?.entries[0]).toMatchObject({
    status: "observed",
    name: "printk",
    reason: null,
    crc_hex: "0000000012345678",
  });
  expect(report.versions?.entries[1]).toMatchObject({
    status: "malformed",
    name: null,
    reason: "version_name_unterminated",
    crc_hex: "0000000000000011",
  });
});

it("reports an inconsistent signature length without a PKCS#7 range", () => {
  const report = parse(
    kernelModuleFixture({
      signature: moduleSignatureTrailer(Buffer.from("abcd"), 50_000),
    }),
  );
  expect(report.signature).toMatchObject({
    status: "malformed",
    reason: "signature_length_inconsistent",
    pkcs7: null,
    info: { sig_len: 50_000, id_type: 2 },
  });
  expect(report.modinfo?.entries[0]?.key).toBe("license");
});

it("withholds PKCS#7 bytes for nonzero signature parameters and a non-PKCS7 id", () => {
  const nonzero = Buffer.alloc(12);
  nonzero[0] = 1;
  nonzero[2] = 2;
  nonzero.writeUInt32BE(4, 8);
  const otherId = Buffer.alloc(12);
  otherId[0] = 1;
  otherId[3] = 2;
  otherId[2] = 1;
  otherId.writeUInt32BE(4, 8);
  const magic = Buffer.from(MODULE_SIGNATURE_MAGIC, "latin1");
  const payload = Buffer.from("abcd");
  expect(
    parse(
      kernelModuleFixture({
        signature: Buffer.concat([payload, nonzero, magic]),
      }),
    ).signature,
  ).toMatchObject({
    status: "malformed",
    reason: "signature_parameters_nonzero",
    pkcs7: null,
  });
  expect(
    parse(
      kernelModuleFixture({
        signature: Buffer.concat([payload, otherId, magic]),
      }),
    ).signature,
  ).toMatchObject({
    status: "unsupported",
    reason: "signature_id_type_not_pkcs7",
    pkcs7: null,
    info: { id_type: 1 },
  });
});

it("does not examine kernel metadata on a non-relocatable ELF", () => {
  const report = parse(kernelModuleFixture({ type: 2 }));
  expect(report).toMatchObject({
    applicability: "not_applicable",
    type: 2,
    type_name: "executable",
    modinfo: null,
    versions: null,
    signature: null,
    coverage: { status: "not_applicable", examined_entries: 0 },
  });
});

it.each(["gzip", "xz", "zstd"] as const)(
  "recommends external decompression for a %s container",
  (codec) => {
    const report = parse(compressedKernelModuleContainer(codec));
    expect(report).toMatchObject({
      applicability: "unsupported",
      format: null,
      compression: { codec, status: "unsupported" },
      next_probe: { operation: "external_decompression" },
      modinfo: null,
      coverage: { status: "unsupported", examined_entries: 0 },
    });
    expect(report.next_probe?.rationale).toContain(codec);
    expect(report.next_probe?.rationale).toContain("external");
    expect(report.next_probe?.rationale).toContain(
      "call inspect_kernel_module on the decompressed file",
    );
    expect(
      kernelModuleSchema.safeParse({
        ...report,
        next_probe: { ...report.next_probe, operation: "extract_artifact" },
      }).success,
    ).toBe(false);
  },
);

it("fails closed when the combined entry budget is exhausted", () => {
  expect(() => parse(kernelModuleFixture(), { max_entries: 7 })).toThrow(
    ArtifactReaderFailure,
  );
  try {
    parse(kernelModuleFixture(), { max_entries: 7 });
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactReaderFailure);
    expect(error).toMatchObject({ reason: "limit", boundary: "capacity" });
  }
});

it("examines the first of two .modinfo sections and records the duplicate", () => {
  const report = parse(kernelModuleFixture({ repeatModinfo: true }));
  expect(report.modinfo?.entries).toHaveLength(6);
  expect(report.limitations.join("\n")).toContain(
    "Multiple .modinfo sections are declared; the first is examined.",
  );
});

it("does not decode compressed, nobits, or out-of-file metadata sections", () => {
  const compressed = kernelModuleFixture();
  compressed.writeBigUInt64LE(0x800n, 64 + 64 + 8);
  expect(parse(compressed).modinfo).toMatchObject({
    status: "unsupported",
    entries: [],
    reason: "modinfo_section_compressed",
  });
  const nobits = kernelModuleFixture();
  nobits.writeUInt32LE(8, 64 + 64 + 4);
  expect(parse(nobits).modinfo).toMatchObject({
    status: "malformed",
    location: null,
    entries: [],
    reason: "modinfo_section_not_file_backed",
  });
  const outside = kernelModuleFixture();
  outside.writeBigUInt64LE(1_000_000n, 64 + 64 + 24);
  expect(parse(outside).modinfo).toMatchObject({
    status: "malformed",
    reason: "modinfo_section_not_file_backed",
  });
  const versionsOutside = kernelModuleFixture();
  versionsOutside.writeBigUInt64LE(1_000_000n, 64 + 64 * 2 + 24);
  expect(parse(versionsOutside).versions).toMatchObject({
    status: "malformed",
    entries: [],
    reason: "versions_section_not_file_backed",
  });
  const versionsCompressed = kernelModuleFixture();
  versionsCompressed.writeBigUInt64LE(0x800n, 64 + 64 * 2 + 8);
  expect(parse(versionsCompressed).versions).toMatchObject({
    status: "unsupported",
    entries: [],
    reason: "versions_section_compressed",
  });
  const versionsNobits = kernelModuleFixture();
  versionsNobits.writeUInt32LE(8, 64 + 64 * 2 + 4);
  expect(parse(versionsNobits).versions).toMatchObject({
    status: "malformed",
    location: null,
    entries: [],
    reason: "versions_section_not_file_backed",
  });
  const moduleSection = kernelModuleFixture();
  moduleSection.writeUInt32LE(8, 64 + 64 * 3 + 4);
  expect(parse(moduleSection).this_module).toMatchObject({
    status: "present",
    location: null,
    layout: "unknown",
  });
});

it("rejects a non-ELF file that is not a recognized container", () => {
  expect(() => parse(Buffer.from("not an elf"))).toThrow(BinaryFormatFailure);
});

it("rejects ELF bytes preceding a bare signature magic as an inconsistent trailer", () => {
  const report = parse(
    kernelModuleFixture({
      signature: Buffer.from(MODULE_SIGNATURE_MAGIC, "latin1"),
    }),
  );
  expect(report.signature).toMatchObject({
    status: "malformed",
    reason: "signature_length_inconsistent",
    pkcs7: null,
  });
  expect(report.modinfo?.entries[0]?.key).toBe("license");
});

it("records a missing trailer as observed absence", () => {
  const report = parse(kernelModuleFixture({ signature: null }));
  expect(report.signature).toMatchObject({
    status: "absent",
    magic: null,
    info: null,
    pkcs7: null,
    reason: null,
  });
  expect(report.limitations.join("\n")).toContain(
    "not proof the module is unsigned",
  );
});

it("names a non-file-backed __ksymtab section without dropping the module", () => {
  const bytes = kernelModuleFixture();
  bytes.writeUInt32LE(8, 64 + 64 * 4 + 4);
  const report = parse(bytes);
  expect(report.ksymtab?.sections).toEqual([]);
  expect(report.limitations.join("\n")).toContain(
    "1 __ksymtab* section(s) are declared but not file-backed",
  );
  expect(report.modinfo?.entries[0]?.key).toBe("license");
});

it("charges many sections sharing one huge __ksymtab name to the entry budget", () => {
  const name = `__ksymtab_${"x".repeat(65_490)}`;
  const bytes = kernelModuleFixture({
    sharedNameSections: { name, count: 8192 },
  });
  const started = performance.now();
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);
  const report = parse(bytes, { max_entries: 65_536 });
  expect(performance.now() - started).toBeLessThan(5_000);
  const huge = report.ksymtab?.sections.slice(1) ?? [];
  expect(huge).toHaveLength(8192);
  expect(
    huge.every(
      (section) =>
        section.name === null &&
        section.reason === "ksymtab_name_exceeds_limit",
    ),
  ).toBe(true);
  expect(report.ksymtab?.sections[0]).toMatchObject({
    name: "__ksymtab",
    reason: null,
  });
  expect(report.coverage.examined_entries).toBe(6 + 2 + 1 + 8192);
  expect(JSON.stringify(report).length).toBeLessThan(2 * 1024 * 1024);
});
