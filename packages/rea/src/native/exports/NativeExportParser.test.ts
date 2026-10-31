import { describe, expect, it, vi } from "vitest";

import {
  elfExportImage,
  elfAliasedVersionImage,
  peExportImage,
} from "../../../tests/fixtures/binaryDiagnostics/nativeExports.js";
import * as nativeExportContracts from "../../domain/native/nativeExports.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../metadata/BinaryContainer.js";
import {
  parseNativeExports,
  parseNativeExportsSteps,
} from "./NativeExportParser.js";

const artifact = { path: "/fixture/lib", sha256: "a".repeat(64), bytes: 1 };
const parse = (bytes: Buffer) =>
  nativeExportContracts.nativeExportsSchema.parse(
    parseNativeExports(bytes, artifact),
  );

it.each(["requirements", "definitions"] as const)(
  "bounds aliased GNU version %s work and keeps exports with unknown versions",
  (kind) => {
    const bytes = elfAliasedVersionImage(kind, 65_535);
    const decoded = vi.spyOn(nativeExportContracts, "decodeElfExportName");
    try {
      const steps = parseNativeExportsSteps(bytes, artifact);
      let checkpoint = steps.next(),
        yields = 0;
      while (!checkpoint.done) {
        yields++;
        checkpoint = steps.next();
      }
      const result = nativeExportContracts.nativeExportsSchema.parse(
        checkpoint.value,
      );
      expect(yields).toBeGreaterThan(2);
      expect(result.coverage.status).toBe("partial");
      expect(result.exports).toMatchObject([
        { name: "versioned_export", version: { index: 2, name: null } },
      ]);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "version_unresolved",
            message: expect.stringContaining("traversal work allowance"),
          }),
        ]),
      );
      // The cost oracle observes the shared decoding boundary: a long aliased
      // name must not be decoded for every visit despite tiny retained output.
      expect(
        decoded.mock.calls.filter(([name]) => name.length === 65_535),
      ).toHaveLength(1);
    } finally {
      decoded.mockRestore();
    }
  },
);

const peExportNameAcrossSections = (overlapAtRva?: number): Buffer => {
  const bytes = Buffer.concat([
    peExportImage({
      functions: [{ rva: 0x2000 }],
      names: [{ name: "BoundaryName", index: 0 }],
    }),
    Buffer.alloc(overlapAtRva === undefined ? 0x400 : 0x800),
  ]);
  const pe = 128;
  const optional = pe + 24;
  const section = optional + bytes.readUInt16LE(pe + 20);
  const second = section + 40;
  bytes.writeUInt16LE(2, pe + 6);
  bytes.write(".data", second, "ascii");
  bytes.writeUInt32LE(0x400, second + 8);
  bytes.writeUInt32LE(0x1400, second + 12);
  bytes.writeUInt32LE(0x400, second + 16);
  bytes.writeUInt32LE(0x800, second + 20);
  bytes.writeUInt32LE(0x40000040, second + 36);
  bytes.writeUInt32LE(0x13fc, 0x480);
  bytes.write("BoundaryName\0", 0x7fc, "latin1");
  if (overlapAtRva !== undefined) {
    const third = second + 40;
    bytes.writeUInt16LE(3, pe + 6);
    bytes.write(".alias", third, "ascii");
    bytes.writeUInt32LE(0x100, third + 8);
    bytes.writeUInt32LE(overlapAtRva, third + 12);
    bytes.writeUInt32LE(0x100, third + 16);
    bytes.writeUInt32LE(0xc00, third + 20);
    bytes.writeUInt32LE(0x40000040, third + 36);
    bytes.fill(0x41, 0xc00, 0xd00);
  }
  return bytes;
};

describe("PE export name coverage", () => {
  it("reads a bounded export name across adjacent section mappings", () => {
    const result = parse(peExportNameAcrossSections());
    expect(result).toMatchObject({
      exports: [
        {
          name: "BoundaryName",
          ordinal: 1,
          address: "0x180002000",
          forwarder: null,
        },
      ],
      coverage: { status: "complete", examined_entries: 1, exports: 1 },
      issues: [],
    });
  });

  it("ignores conflicting mappings after the export name terminator", () => {
    const result = parse(peExportNameAcrossSections(0x1409));

    expect(result.exports).toMatchObject([{ name: "BoundaryName" }]);
    expect(result.issues).toEqual([]);
    expect(result.coverage.status).toBe("complete");
  });

  it("rejects conflicting mappings that overlap the export name", () => {
    const result = parse(peExportNameAcrossSections(0x1404));

    expect(result.exports).toEqual([]);
    expect(result.issues).toMatchObject([{ code: "name_unreadable" }]);
    expect(result.coverage.status).toBe("partial");
  });

  it("validates unreadable names on unused slots without retaining exports", () => {
    const result = parse(
      peExportImage({
        functions: [null, { rva: 0x3000 }],
        names: [
          { name: "Unreadable", index: 0 },
          { name: "Unused", index: 0 },
          { name: "Kept", index: 1 },
        ],
        nameRvaOverride: { position: 0, rva: 0x9000 },
      }),
    );

    expect(result.exports.map(({ name }) => name)).toEqual(["Kept"]);
    expect(result.issues).toMatchObject([
      { code: "name_unreadable", location: "0x9000" },
    ]);
    expect(result.coverage).toMatchObject({
      status: "partial",
      examined_entries: 2,
      exports: 1,
    });
  });
});

describe("PE forwarder directory bounds", () => {
  it.each([32, 64] as const)(
    "requires the complete PE%d forwarder string to remain inside the export directory",
    (bits) => {
      const bytes = peExportImage({
        bits,
        functions: [{ rva: 0x11fc }, { rva: 0x2000 }],
        names: [{ name: "Kept", index: 1 }],
      });
      // The string starts in .edata's declared export range but its NUL is
      // outside it. The adjacent section bytes remain mapped and readable.
      bytes.write("DLL.Target\0", 0x5fc, "latin1");
      const result = parse(bytes);

      expect(result.exports).toMatchObject([{ name: "Kept", ordinal: 2 }]);
      expect(result.issues).toMatchObject([
        { code: "malformed_entry", location: "0x11fc" },
      ]);
      expect(result.coverage).toMatchObject({
        status: "partial",
        examined_entries: 2,
        exports: 1,
      });
    },
  );

  it.each([32, 64] as const)(
    "accepts a PE%d forwarder whose NUL is the final export-directory byte",
    (bits) => {
      const bytes = peExportImage({ bits, functions: [{ rva: 0x11f5 }] });
      bytes.write("DLL.Target\0", 0x5f5, "latin1");

      expect(parse(bytes)).toMatchObject({
        exports: [{ name: null, ordinal: 1, forwarder: "DLL.Target" }],
        coverage: { status: "complete", exports: 1 },
        issues: [],
      });
    },
  );
});

describe("PE export directories", () => {
  it.each([32, 64] as const)(
    "reports named, aliased, ordinal-only and forwarded PE%d exports",
    (bits) => {
      const result = parse(
        peExportImage({
          bits,
          ordinalBase: 5,
          functions: [
            { rva: 0x2000 },
            { rva: 0x2010 },
            null,
            { forwarder: "OTHER.Target" },
          ],
          names: [
            { name: "Alias", index: 0 },
            { name: "Forwarded", index: 3 },
            { name: "Primary", index: 0 },
          ],
        }),
      );
      const base = bits === 64 ? 0x180000000 : 0x10000000;

      expect(result).toMatchObject({
        format: "pe",
        bits,
        export_directory: {
          rva: 0x1000,
          size: 0x200,
          dll_name: "fixture.dll",
          ordinal_base: 5,
        },
        coverage: {
          status: "complete",
          examined_entries: 4,
          exports: 4,
        },
        issues: [],
      });
      expect(result.exports).toEqual([
        {
          name: "Alias",
          ordinal: 5,
          address: `0x${(base + 0x2000).toString(16)}`,
          forwarder: null,
        },
        {
          name: "Primary",
          ordinal: 5,
          address: `0x${(base + 0x2000).toString(16)}`,
          forwarder: null,
        },
        {
          name: null,
          ordinal: 6,
          address: `0x${(base + 0x2010).toString(16)}`,
          forwarder: null,
        },
        {
          name: "Forwarded",
          ordinal: 8,
          address: null,
          forwarder: "OTHER.Target",
        },
      ]);
    },
  );

  it("counts unreadable and out-of-range names without inventing exports", () => {
    const result = parse(
      peExportImage({
        functions: [{ rva: 0x2000 }, { rva: 0x2010 }],
        names: [
          { name: "Unmapped", index: 0 },
          { name: "Stray", index: 9 },
          { name: "Kept", index: 1 },
        ],
        nameRvaOverride: { position: 0, rva: 0x9000 },
      }),
    );

    expect(result.exports.map(({ name }) => name)).toEqual(["Kept"]);
    expect(result.coverage).toMatchObject({ status: "partial", exports: 1 });
    expect(result.issues.map(({ code }) => code)).toEqual([
      "name_unreadable",
      "malformed_entry",
    ]);
  });

  it("reports an image without an export directory as exporting nothing", () => {
    const result = parse(peExportImage({ exportDirectory: false }));

    expect(result).toMatchObject({
      export_directory: null,
      exports: [],
      coverage: { status: "complete", examined_entries: 0 },
    });
    expect(result.limitations[0]).toContain("declares no export directory");
  });

  it("preserves biased ordinals beyond WORD and DWORD", () => {
    const cases = [
      { ordinalBase: 0x10000, index: 0, ordinal: 0x10000 },
      { ordinalBase: 0xffffffff, index: 0, ordinal: 0xffffffff },
      {
        ordinalBase: 0xffffffff,
        index: 1,
        ordinal: 0x1_0000_0000,
      },
    ];

    for (const { ordinalBase, index, ordinal } of cases) {
      const result = parse(
        peExportImage({
          ordinalBase,
          functions: Array.from({ length: index + 1 }, (_, row) =>
            row === index ? { rva: 0x2000 } : null,
          ),
          names: [{ name: "Named", index }],
        }),
      );
      expect(result.exports).toMatchObject([{ name: "Named", ordinal }]);
    }
  });

  it("ignores a trailing unused slot after the last 16-bit ordinal", () => {
    const result = parse(
      peExportImage({
        ordinalBase: 0xffff,
        functions: [{ rva: 0x2000 }, null],
        names: [{ name: "Kept", index: 0 }],
      }),
    );

    expect(result).toMatchObject({
      coverage: { status: "complete", examined_entries: 2, exports: 1 },
      issues: [],
      exports: [{ name: "Kept", ordinal: 0xffff }],
    });
  });

  it("refuses an export table above the inventory allowance", () => {
    expect(() =>
      parseNativeExports(
        peExportImage({ functions: [], declaredFunctions: 0x40001 }),
        artifact,
      ),
    ).toThrow(BinaryResourceFailure);
  });
});

describe("ELF dynamic symbol exports", () => {
  const symbols = [
    { name: "plain_fn" },
    { name: "versioned_fn", version: 2 },
    { name: "old_fn", version: 0x8003 },
    { name: "weak_obj", binding: 2, type: 1 },
    { name: "ifunc_sym", type: 10 },
    { name: "protected_fn", visibility: 3 },
    { name: "hidden_fn", visibility: 2 },
    { name: "undefined_fn", section: 0 },
    { name: "local_fn", binding: 0 },
    { name: "local_version_fn", version: 0 },
  ];

  it("lists defined default and protected globals with their versions", () => {
    const result = parse(
      elfExportImage({
        symbols,
        versionDefinitions: ["libfixture.so", "VER_1", "VER_0"],
      }),
    );

    expect(result).toMatchObject({
      format: "elf",
      bits: 64,
      byte_order: "little",
      architecture: "amd64",
      coverage: { status: "complete", examined_entries: 10, exports: 6 },
      issues: [],
    });
    expect(
      result.format === "elf" &&
        result.exports.map(({ name, type, binding, version }) => ({
          name,
          type,
          binding,
          version,
        })),
    ).toEqual([
      { name: "plain_fn", type: "function", binding: "global", version: null },
      {
        name: "versioned_fn",
        type: "function",
        binding: "global",
        version: {
          index: 2,
          name: "VER_1",
          name_bytes_base64: null,
          name_utf8_decodable: true,
          hidden: false,
        },
      },
      {
        name: "old_fn",
        type: "function",
        binding: "global",
        version: {
          index: 3,
          name: "VER_0",
          name_bytes_base64: null,
          name_utf8_decodable: true,
          hidden: true,
        },
      },
      { name: "weak_obj", type: "object", binding: "weak", version: null },
      { name: "ifunc_sym", type: "ifunc", binding: "global", version: null },
      {
        name: "protected_fn",
        type: "function",
        binding: "global",
        version: null,
      },
    ]);
  });

  it("reads a big-endian ELF32 table", () => {
    const result = parse(
      elfExportImage({
        bits: 32,
        little: false,
        machine: 20,
        symbols: [{ name: "be_fn", value: 0x10000n, size: 8n }],
      }),
    );

    expect(result).toMatchObject({
      bits: 32,
      byte_order: "big",
      architecture: "ppc",
      exports: [{ name: "be_fn", value: "0x10000", size: "8" }],
    });
  });
});

describe("ELF export version and name coverage", () => {
  it("marks versions unknown when the version table does not fit", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "a" }, { name: "b", version: 2 }],
        versionDefinitions: ["lib.so", "V1"],
        truncatedVersions: true,
      }),
    );

    expect(
      result.format === "elf" && result.exports.map(({ version }) => version),
    ).toEqual(["unknown", "unknown"]);
    expect(result.exports.map(({ name }) => name)).toEqual(["a", "b"]);
    expect(result.coverage).toMatchObject({
      status: "partial",
      examined_entries: 2,
      exports: 2,
      reason:
        "1 export table issue(s) affect reported rows or metadata; see issues",
    });
    expect(result.issues).toMatchObject([{ code: "version_unresolved" }]);
  });

  it("reports one issue per undefined version index", () => {
    const result = parse(
      elfExportImage({
        symbols: [
          { name: "a", version: 7 },
          { name: "b", version: 7 },
        ],
        versionDefinitions: ["lib.so"],
      }),
    );

    expect(
      result.format === "elf" && result.exports.map(({ version }) => version),
    ).toEqual([
      {
        index: 7,
        name: null,
        name_bytes_base64: null,
        name_utf8_decodable: null,
        hidden: false,
      },
      {
        index: 7,
        name: null,
        name_bytes_base64: null,
        name_utf8_decodable: null,
        hidden: false,
      },
    ]);
    expect(result.issues).toHaveLength(1);
  });

  it("counts a symbol whose name is outside the string table", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "kept" }, { name: "lost", nameOffset: 0x7000 }],
      }),
    );

    expect(result.exports.map(({ name }) => name)).toEqual(["kept"]);
    expect(result.issues).toMatchObject([{ code: "name_unreadable" }]);
    expect(result.coverage.status).toBe("partial");
  });

  it("separates an examined empty symbol table from unavailable symbol declarations", () => {
    expect(parse(elfExportImage({ symbols: [] }))).toMatchObject({
      exports: [],
      coverage: { status: "complete" },
    });
    expect(
      parse(elfExportImage({ symbols: [], dynamicSymbols: false })),
    ).toMatchObject({ exports: [], coverage: { status: "complete" } });
    for (const bytes of [
      elfExportImage({ symbols: [], sectionHeaders: false }),
      elfExportImage({
        symbols: [],
        dynamicSymbols: false,
        dynamicSegment: true,
      }),
    ])
      expect(parse(bytes)).toMatchObject({
        exports: [],
        coverage: {
          status: "unsupported",
          reason: expect.stringContaining("dynamic segment"),
          examined_entries: 0,
        },
      });
  });
});

describe("ELF version requirements", () => {
  it("resolves defined copy-relocated symbols through version requirements", () => {
    const result = parse(
      elfExportImage({
        symbols: [
          { name: "stdout", type: 1, value: 0x28268n, version: 3 },
          { name: "stderr", type: 1, value: 0x282a0n, version: 0x8003 },
        ],
        versionRequirements: [{ index: 3, name: "GLIBC_2.2.5" }],
      }),
    );

    expect(result).toMatchObject({
      coverage: { status: "complete", exports: 2 },
      issues: [],
      exports: [
        {
          name: "stdout",
          value: "0x28268",
          version: { index: 3, name: "GLIBC_2.2.5", hidden: false },
        },
        {
          name: "stderr",
          value: "0x282a0",
          version: { index: 3, name: "GLIBC_2.2.5", hidden: true },
        },
      ],
    });
  });

  it("keeps version definitions and requirements in the same symbol lookup", () => {
    const result = parse(
      elfExportImage({
        symbols: [
          { name: "defined_version", version: 2 },
          { name: "required_version", version: 4 },
        ],
        versionDefinitions: ["libfixture.so", "FIXTURE_1"],
        versionRequirements: [
          { index: 3, name: "GLIBC_2.2.5" },
          { index: 4, name: "GLIBC_2.3" },
        ],
      }),
    );

    expect(result).toMatchObject({
      coverage: { status: "complete", exports: 2 },
      issues: [],
      exports: [
        { name: "defined_version", version: { index: 2, name: "FIXTURE_1" } },
        {
          name: "required_version",
          version: { index: 4, name: "GLIBC_2.3" },
        },
      ],
    });
  });

  it("uses a definition name when a requirement shares its index", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "ambiguous", version: 2 }],
        versionDefinitions: ["libfixture.so", "DEFINITION"],
        versionRequirements: [{ index: 2, name: "REQUIREMENT" }],
      }),
    );

    expect(result.exports).toMatchObject([
      {
        name: "ambiguous",
        version: { index: 2, name: "DEFINITION", hidden: false },
      },
    ]);
    expect(result.coverage.status).toBe("complete");
    expect(result.issues).toEqual([]);
  });

  it("retains exports and reports a truncated version-requirement chain", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "stdout", type: 1, version: 3 }],
        versionRequirements: [{ index: 3, name: "GLIBC_2.2.5" }],
        truncatedVersionRequirements: true,
      }),
    );

    expect(result.exports).toMatchObject([
      { name: "stdout", version: { index: 3, name: null, hidden: false } },
    ]);
    expect(result.coverage.status).toBe("partial");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "version_unresolved",
          message: expect.stringContaining(
            "auxiliary chain leaves its section",
          ),
        }),
      ]),
    );
  });

  it("marks a definition chain that ends before its declared count", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "defined_version", version: 2 }],
        versionDefinitions: ["libfixture.so", "FIXTURE_1"],
        truncatedVersionDefinitions: true,
      }),
    );

    expect(result.exports).toMatchObject([
      {
        name: "defined_version",
        version: {
          index: 2,
          name: null,
          name_bytes_base64: null,
          name_utf8_decodable: null,
          hidden: false,
        },
      },
    ]);
    expect(result.coverage.status).toBe("partial");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "version_unresolved",
          message: expect.stringContaining(
            "chain ends before its declared count",
          ),
        }),
      ]),
    );
  });
});

describe("export inventory review regressions", () => {
  it("reads an export directory stored in the PE headers", () => {
    const result = parse(
      peExportImage({
        inHeaders: true,
        functions: [{ rva: 0x2000 }, { forwarder: "OTHER.Target" }],
        names: [
          { name: "HeaderExport", index: 0 },
          { name: "HeaderForward", index: 1 },
        ],
      }),
    );

    expect(result).toMatchObject({
      export_directory: { rva: 0x200, dll_name: "fixture.dll" },
      coverage: { status: "complete", exports: 2 },
    });
    expect(result.exports.map(({ name }) => name)).toEqual([
      "HeaderExport",
      "HeaderForward",
    ]);
  });

  it("bounds retained name text before storing rows", () => {
    // 300 rows naming one 60000-byte string retain about 18 MB of text.
    const long = "n".repeat(60000);
    const bytes = elfExportImage({
      symbols: Array.from({ length: 300 }, () => ({ name: long })),
    });

    expect(bytes.length).toBeLessThan(100_000);
    expect(() => parseNativeExports(bytes, artifact)).toThrow(
      BinaryResourceFailure,
    );
  });

  it("keeps exports when the version table lies outside the file", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "a" }, { name: "b", version: 2 }],
        versionDefinitions: ["lib.so", "V1"],
        versionsOutsideFile: true,
      }),
    );

    expect(
      result.format === "elf" && result.exports.map(({ version }) => version),
    ).toEqual(["unknown", "unknown"]);
    expect(result.coverage.status).toBe("partial");
  });

  it("reports an empty version name as unresolved", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "a", version: 2 }],
        versionDefinitions: ["lib.so", ""],
      }),
    );

    expect(
      result.format === "elf" && result.exports.map(({ version }) => version),
    ).toEqual([
      {
        index: 2,
        name: null,
        name_bytes_base64: null,
        name_utf8_decodable: null,
        hidden: false,
      },
    ]);
    expect(result.issues).toMatchObject([{ code: "version_unresolved" }]);
    expect(result.exports.map(({ name }) => name)).toEqual(["a"]);
    expect(result.coverage).toMatchObject({
      status: "partial",
      examined_entries: 1,
      exports: 1,
      reason:
        "1 export table issue(s) affect reported rows or metadata; see issues",
    });
  });

  it("rejects a dynamic symbol table without its null entry", () => {
    expect(() =>
      parseNativeExports(
        elfExportImage({ symbols: [], emptyDynamicSymbols: true }),
        artifact,
      ),
    ).toThrow(BinaryFormatFailure);
  });
});

describe("ELF symbol-name text", () => {
  it.each([65535, 65536])(
    "keeps the ELF export name scan bounded when its NUL follows %i bytes",
    (length) => {
      const name = "n".repeat(length);
      const result = parse(elfExportImage({ symbols: [{ name }] }));
      if (result.format !== "elf") throw new TypeError("expected ELF result");
      expect(result.exports.map((entry) => entry.name)).toEqual(
        length === 65535 ? [name] : [],
      );
      if (length === 65536)
        expect(result.issues).toContainEqual(
          expect.objectContaining({
            message: expect.stringContaining(
              "unterminated or exceeds the string budget",
            ),
          }),
        );
    },
  );

  it("decodes UTF-8 names and retains exact bytes", () => {
    const result = parse(elfExportImage({ symbols: [{ name: "cafÃ©" }] }));
    expect(result.format).toBe("elf");
    if (result.format !== "elf") throw new TypeError("expected ELF result");
    expect(result.exports[0]).toMatchObject({
      name: "café",
      name_bytes_base64: "Y2Fmw6k=",
      name_utf8_decodable: true,
    });
  });

  it("retains invalid UTF-8 bytes without replacement", () => {
    const result = parse(elfExportImage({ symbols: [{ name: "\u00ff" }] }));
    expect(result.format).toBe("elf");
    if (result.format !== "elf") throw new TypeError("expected ELF result");
    expect(result.exports[0]).toMatchObject({
      name: "ÿ",
      name_bytes_base64: "/w==",
      name_utf8_decodable: false,
    });
  });

  it.each([
    {
      source: "definition",
      result: () =>
        parse(
          elfExportImage({
            symbols: [{ name: "defined", version: 2 }],
            versionDefinitions: ["libfixture.so", "libcafÃ©.so"],
          }),
        ),
      versionIndex: 2,
    },
    {
      source: "requirement",
      result: () =>
        parse(
          elfExportImage({
            symbols: [{ name: "required", version: 3 }],
            versionRequirements: [{ index: 3, name: "libcafÃ©.so" }],
          }),
        ),
      versionIndex: 3,
    },
  ])(
    "decodes UTF-8 version names from the $source table",
    ({ result, versionIndex }) => {
      const parsed = result();
      expect(parsed.format).toBe("elf");
      if (parsed.format !== "elf") throw new TypeError("expected ELF result");
      expect(parsed.exports[0]?.version).toEqual({
        index: versionIndex,
        name: "libcafé.so",
        name_bytes_base64: "bGliY2Fmw6kuc28=",
        name_utf8_decodable: true,
        hidden: false,
      });
      expect(parsed.issues).toEqual([]);
      expect(parsed.coverage.status).toBe("complete");
    },
  );

  it("retains invalid UTF-8 version-name bytes with a byte-preserving display", () => {
    const result = parse(
      elfExportImage({
        symbols: [{ name: "defined", version: 2 }],
        versionDefinitions: ["libfixture.so", "\u00ff"],
      }),
    );
    expect(result.format).toBe("elf");
    if (result.format !== "elf") throw new TypeError("expected ELF result");
    expect(result.exports[0]?.version).toEqual({
      index: 2,
      name: "ÿ",
      name_bytes_base64: "/w==",
      name_utf8_decodable: false,
      hidden: false,
    });
  });
});

it("refuses formats other than PE and ELF", () => {
  const macho = Buffer.alloc(64);
  macho.writeUInt32LE(0xfeedfacf, 0);
  expect(() => parseNativeExports(macho, artifact)).toThrow(
    BinaryFormatFailure,
  );
});
