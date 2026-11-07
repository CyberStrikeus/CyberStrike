import { createHash } from "node:crypto";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNativeExportsService } from "../../../src/composition/binaryDiagnostics.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { nativeExportsSchema } from "../../../src/domain/native/nativeExports.js";
import {
  elfExportImage,
  peExportImage,
  peRepeatedExportNamesImage,
} from "../../fixtures/binaryDiagnostics/nativeExports.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("native export stable filesystem boundary", () => {
  it("retains source identity and usable exports when a forwarder leaves its declared directory", async () => {
    const root = await createTestTempDirectory("rea-native-export-forwarder-");
    const path = join(root, "truncated-forwarder.dll");
    const bytes = peExportImage({
      functions: [{ rva: 0x11fc }, { rva: 0x2000 }],
      names: [{ name: "Kept", index: 1 }],
    });
    bytes.write("DLL.Target\0", 0x5fc, "latin1");
    await writeFile(path, bytes);
    const service = createNativeExportsService();
    try {
      const result = await service.inspect({ path });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const evidence = parseEvidence(result.value);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(evidence.subject).toMatchObject({
        local_path: path,
        digest: { sha256 },
      });
      expect(
        nativeExportsSchema.parse(evidence.normalized_result),
      ).toMatchObject({
        artifact: { path, sha256, bytes: bytes.length },
        exports: [{ name: "Kept", ordinal: 2 }],
        issues: [
          {
            code: "malformed_entry",
            location: "0x11fc",
            message: expect.stringContaining("Forwarder of ordinal 1"),
          },
        ],
        coverage: { status: "partial", examined_entries: 2, exports: 1 },
      });
    } finally {
      await service.close();
    }
  });

  it("bounds retained PE aliases before interpreting their target", async () => {
    const root = await createTestTempDirectory("rea-native-export-aliases-");
    const service = createNativeExportsService();
    try {
      // A malformed forwarder suppresses all rows, but its names still occupy
      // the intermediate inventory and must be bounded before EAT traversal.
      for (const target of [0x3000, 0x1080, 0]) {
        const path = join(root, `aliases-${String(target)}.dll`);
        const bytes = peRepeatedExportNamesImage(target);
        expect(bytes.length).toBeLessThan(32_000);
        await writeFile(path, bytes);
        const result = await service.inspect({ path });
        if (target === 0) {
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          expect(result.value.normalized_result).toMatchObject({
            exports: [],
            issues: [],
            coverage: { status: "complete", examined_entries: 1, exports: 0 },
          });
        } else {
          expect(result).toMatchObject({
            ok: false,
            error: { _tag: "AnalysisResourceConstraintError" },
          });
        }
      }
    } finally {
      await service.close();
    }
  });

  it("binds PE and ELF export inventories to the selected file", async () => {
    const root = await createTestTempDirectory("rea-native-exports-");
    const service = createNativeExportsService();
    for (const [name, bytes, format] of [
      [
        "fixture.dll",
        peExportImage({
          functions: [{ rva: 0x2000 }],
          names: [{ name: "Exported", index: 0 }],
        }),
        "pe",
      ],
      [
        "libfixture.so",
        elfExportImage({ symbols: [{ name: "exported" }] }),
        "elf",
      ],
    ] as const) {
      const path = join(root, name);
      await writeFile(path, bytes);
      const result = await service.inspect({ path });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const evidence = parseEvidence(result.value);
      const sha256 = createHash("sha256").update(bytes).digest("hex");

      expect(evidence).toMatchObject({
        operation: "inspect_native_exports",
        provider: { id: "rea-native-exports" },
        confidence: "observed",
        subject: { local_path: path, format, digest: { sha256 } },
      });
      expect(
        nativeExportsSchema.parse(evidence.normalized_result),
      ).toMatchObject({
        artifact: { path, sha256, bytes: bytes.length },
        format,
        coverage: { status: "complete", exports: 1 },
      });
    }
    await service.close();
  });
});

describe("native export text capacity", () => {
  it.each(["symbol", "version"] as const)(
    "bounds UTF-8 bytes of retained ELF %s text and its exact-byte spelling",
    async (kind) => {
      const root = await createTestTempDirectory("rea-native-export-text-");
      const service = createNativeExportsService();
      const text = "€".repeat(20_000);
      const rawName = Buffer.from(text, "utf8").toString("latin1");
      try {
        for (const count of [119, 160]) {
          const path = join(root, `${kind}-${String(count)}.so`);
          const bytes = elfExportImage({
            symbols: Array.from({ length: count }, () =>
              kind === "symbol" ? { name: rawName } : { name: "a", version: 2 },
            ),
            ...(kind === "version"
              ? { versionDefinitions: ["lib.so", rawName] }
              : {}),
          });
          expect(bytes.length).toBeLessThan(70_000);
          await writeFile(path, bytes);
          const result = await service.inspect({ path });
          if (count === 160) {
            expect(result).toMatchObject({
              ok: false,
              error: { _tag: "AnalysisResourceConstraintError" },
            });
            continue;
          }
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          const report = nativeExportsSchema.parse(
            result.value.normalized_result,
          );
          if (report.format !== "elf") throw new Error("Expected ELF report");
          expect(report.coverage).toMatchObject({
            status: "complete",
            exports: count,
          });
          const row = report.exports[0]!;
          const name = kind === "symbol" ? row : row.version;
          expect(name).toMatchObject({
            name: text,
            name_bytes_base64: Buffer.from(text, "utf8").toString("base64"),
            name_utf8_decodable: true,
          });
        }
      } finally {
        await service.close();
      }
    },
  );

  it("bounds intermediate ELF version names even when no symbols use them", async () => {
    const root = await createTestTempDirectory("rea-native-export-versions-");
    const service = createNativeExportsService();
    try {
      for (const count of [279, 280]) {
        const path = join(root, `versions-${String(count)}.so`);
        const bytes = elfExportImage({
          symbols: [],
          versionDefinitions: Array<string>(count).fill("v".repeat(60_000)),
          // Definitions replace requirements at the same indices; released
          // names must not remain charged against the live map's allowance.
          ...(count === 279
            ? {
                versionRequirements: Array.from(
                  { length: count },
                  (_, index) => ({
                    index: index + 1,
                    name: "w".repeat(60_000),
                  }),
                ),
              }
            : {}),
        });
        expect(bytes.length).toBeLessThan(140_000);
        await writeFile(path, bytes);
        const result = await service.inspect({ path });
        if (count === 280)
          expect(result).toMatchObject({
            ok: false,
            error: { _tag: "AnalysisResourceConstraintError" },
          });
        else {
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          expect(result.value.normalized_result).toMatchObject({
            exports: [],
            issues: [],
            coverage: { status: "complete", exports: 0 },
          });
        }
      }
    } finally {
      await service.close();
    }
  });
});

describe("native export encoding and failures", () => {
  it("keeps ELF symbol bytes while exposing valid UTF-8 text", async () => {
    const root = await createTestTempDirectory("rea-native-export-unicode-");
    const path = join(root, "libfixture.so");
    const bytes = elfExportImage({
      symbols: [{ name: "cafÃ©", version: 2 }, { name: "\u00ff" }],
      versionDefinitions: ["libfixture.so", "libcafÃ©.so"],
    });
    await writeFile(path, bytes);
    const service = createNativeExportsService();
    const result = await service.inspect({ path });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.normalized_result).toMatchObject({
      format: "elf",
      exports: [
        {
          name: "café",
          name_bytes_base64: "Y2Fmw6k=",
          name_utf8_decodable: true,
          version: {
            index: 2,
            name: "libcafé.so",
            name_bytes_base64: "bGliY2Fmw6kuc28=",
            name_utf8_decodable: true,
          },
        },
        {
          name: "ÿ",
          name_bytes_base64: "/w==",
          name_utf8_decodable: false,
        },
      ],
    });
    const olderRows = JSON.parse(
      JSON.stringify(result.value.normalized_result),
    ) as { exports: Record<string, unknown>[] };
    for (const row of olderRows.exports) {
      delete row.name_bytes_base64;
      delete row.name_utf8_decodable;
      const version = row.version;
      if (version !== null && typeof version === "object") {
        Reflect.deleteProperty(version, "name_bytes_base64");
        Reflect.deleteProperty(version, "name_utf8_decodable");
      }
    }
    expect(nativeExportsSchema.parse(olderRows)).toMatchObject({
      exports: [
        {
          name: "café",
          name_bytes_base64: null,
          name_utf8_decodable: null,
          version: {
            index: 2,
            name: "libcafé.so",
            name_bytes_base64: null,
            name_utf8_decodable: null,
            hidden: false,
          },
        },
        { name: "ÿ", name_bytes_base64: null, name_utf8_decodable: null },
      ],
    });
    await service.close();
  });

  it("returns typed input, unsupported, budget and cancellation failures", async () => {
    const root = await createTestTempDirectory("rea-native-export-failures-");
    const path = join(root, "fixture.dll");
    const alias = join(root, "alias.dll");
    const macho = join(root, "fixture.dylib");
    const malformed = join(root, "malformed.dll");
    await writeFile(path, peExportImage({ functions: [] }));
    const machoBytes = Buffer.alloc(64);
    machoBytes.writeUInt32LE(0xfeedfacf, 0);
    await writeFile(macho, machoBytes);
    await writeFile(malformed, Buffer.from("MZ not a PE image"));
    await symlink(path, alias);
    const service = createNativeExportsService();
    const failure = async (
      input: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      const result = await service.inspect(
        input,
        signal === undefined ? undefined : { signal },
      );
      if (result.ok) throw new Error("Expected a failure");
      return result.error;
    };

    for (const [candidate, reason] of [
      [alias, "invalid_format"],
      [malformed, "invalid_format"],
      [join(root, "missing.dll"), "invalid_value"],
    ] as const)
      expect(await failure({ path: candidate })).toMatchObject({
        _tag: "AnalysisInputError",
        operation: "inspect_native_exports",
        issues: [{ path: ["path"], reason }],
      });
    expect(await failure({ path: macho })).toMatchObject({
      _tag: "AnalysisUnsupportedTargetError",
      reason: expect.stringContaining("inspect_macho"),
    });
    expect(await failure({ path, max_file_bytes: 64 })).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
    });
    expect(
      await failure({ path }, AbortSignal.abort("caller stop")),
    ).toMatchObject({ _tag: "AnalysisCancelledError" });
    await service.close();
  });
});
