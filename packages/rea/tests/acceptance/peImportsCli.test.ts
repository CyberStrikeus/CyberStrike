import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  peImportImage,
  peImportFixtureOffset,
  peImportLeadingSectionImage,
  peImportManySectionsImage,
  peImportDirectoryAtRva,
  peImportDirectoryMappingStops,
  peWithoutImportTableFixture,
} from "../fixtures/binaryDiagnostics/peImports.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";

for (const bits of [32, 64] as const) {
  cliTest(
    `rejects non-MZ PE${String(bits)} imports across CLI and MCP`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-pe-imports-signature-");
      const call = await cli.sharedMcpCall!();
      for (const [name, prefix] of [
        ["zz", Buffer.from("ZZ")],
        ["high-bit", Buffer.from([0xcd, 0xda])],
      ] as const) {
        const bytes = peImportImage({ bits });
        prefix.copy(bytes);
        const path = join(root, `${name}.exe`);
        await writeFile(path, bytes);
        const result = await cli.run({
          arguments: ["inspect-pe-imports", path, "--json"],
        });
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject({
          code: "invalid_request",
          details: {
            operation: "inspect_pe_imports",
            issues: expect.arrayContaining([
              expect.objectContaining({
                path: ["path"],
                reason: "invalid_format",
              }),
            ]),
          },
        });
        const response = await call("inspect_pe_imports", { path });
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response)).toEqual({ error: result.json });
        expect((await readFile(path)).equals(bytes)).toBe(true);
      }
      const path = join(root, "valid.exe");
      const bytes = peImportImage({ bits });
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-pe-imports", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const response = await call("inspect_pe_imports", { path });
      expect(response.isError).not.toBe(true);
      for (const value of [result.json, response.structuredContent]) {
        const report =
          toolContract("inspect_pe_imports").outputSchema.parse(
            value,
          ).normalized_result;
        expect(report.bits).toBe(bits);
        expect(report.imports[0]?.functions.map((row) => row.name)).toEqual([
          "GetProcAddress",
          "ExitProcess",
        ]);
        expect(report.coverage.status).toBe("complete");
      }
      expect((await readFile(path)).equals(bytes)).toBe(true);
    },
  );
}

cliTest(
  "distinguishes pefile's bounded name read from an invalid import name",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-import-name-");
    const call = await cli.sharedMcpCall!();
    for (const [label, name, reason] of [
      ["long", "A".repeat(513), /512-byte read limit/u],
      [
        "invalid",
        "Has Space",
        /characters pefile treats as invalid and omits/u,
      ],
    ] as const) {
      const path = join(root, `${label}.exe`);
      await writeFile(
        path,
        peImportImage({
          sectionBytes: 0x1000,
          dlls: [{ name: "k.dll", functions: [{ name }] }],
        }),
      );
      const cliResult = await cli.run({
        arguments: ["inspect-pe-imports", path, "--json"],
      });
      expect(cliResult.exitCode, cliResult.stderr).toBe(0);
      const mcpResult = await call("inspect_pe_imports", { path });
      expect(mcpResult.isError).not.toBe(true);
      for (const value of [cliResult.json, mcpResult.structuredContent]) {
        const report =
          toolContract("inspect_pe_imports").outputSchema.parse(
            value,
          ).normalized_result;
        expect(report.coverage.status).toBe("complete");
        expect(report.imports[0]?.functions[0]?.name).toBe(name);
        expect(report.imphash).toMatchObject({
          md5: null,
          reason: expect.stringMatching(reason),
        });
      }
    }
  },
);

cliTest(
  "reports native and managed Linux AMD64 PE imports through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-imports-cli-");
    const call = await cli.sharedMcpCall!();
    for (const managed of [false, true]) {
      const bytes = peImportImage({ bits: 64 });
      const machine = managed ? 0x8664 ^ 0x7b79 : 0x8664;
      bytes.writeUInt16LE(machine, 132);
      if (managed) {
        // Declare a file-backed CLR header beyond the fixture's import data.
        // This synthetic image tests import inspection, not .NET execution.
        const cliRva = 0x1700;
        const cliHeader = peImportFixtureOffset(cliRva);
        const cliDirectory = 152 + 112 + 14 * 8;
        bytes.writeUInt32LE(cliRva, cliDirectory);
        bytes.writeUInt32LE(72, cliDirectory + 4);
        bytes.writeUInt32LE(72, cliHeader);
        bytes.writeUInt16LE(2, cliHeader + 4);
        bytes.writeUInt16LE(5, cliHeader + 6);
      }
      const path = join(root, managed ? "managed-linux.dll" : "native.exe");
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-pe-imports", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const response = await call("inspect_pe_imports", { path });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      for (const value of [result.json, response.structuredContent]) {
        const report =
          toolContract("inspect_pe_imports").outputSchema.parse(
            value,
          ).normalized_result;
        expect(report).toMatchObject({
          machine,
          format: "pe32-plus",
          architecture: "amd64",
          bits: 64,
          coverage: { status: "complete" },
        });
        expect(report.imports).toHaveLength(1);
        expect(report.imports[0]?.name).toBe("KERNEL32.dll");
        expect(report.imports[0]?.functions.map((row) => row.name)).toEqual([
          "GetProcAddress",
          "ExitProcess",
        ]);
        expect(report.imphash.md5).toBe("92cef6cc91a85825f3c8a0516517c66f");
      }
    }
  },
);

cliTest(
  "resolves a relative PE path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-imports-cli-rel-");
    const path = join(root, "unsigned.exe");
    const bytes = peWithoutImportTableFixture();
    await writeFile(path, bytes);
    const result = await cli.run({
      arguments: ["inspect-pe-imports", "unsigned.exe", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_imports").outputSchema.parse(
      result.json,
    );
    expect(evidence).toMatchObject({
      confidence: "observed",
      subject: {
        local_path: path,
        format: "pe",
        architecture: "x86_64",
        digest: { sha256: createHash("sha256").update(bytes).digest("hex") },
      },
      normalized_result: {
        artifact: { path, bytes: bytes.length },
        format: "pe32-plus",
        machine: 0x8664,
        bits: 64,
        architecture: "amd64",
        import_directory: null,
        delay_import_directory: null,
        imports: [],
        delay_imports: [],
        imphash: { algorithm: "pefile", md5: null },
        coverage: {
          status: "complete",
          examined_dlls: 0,
          imports: 0,
          delay_imports: 0,
        },
      },
    });
  },
);

cliTest("reports a truncated PE as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-pe-imports-cli-bad-");
  const path = join(root, "broken.exe");
  await writeFile(path, Buffer.from("MZ"));
  const result = await cli.run({
    arguments: ["inspect-pe-imports", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: {
      operation: "inspect_pe_imports",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["path"], reason: "invalid_format" }),
      ]),
    },
  });
});

cliTest(
  "preserves directory declarations and partial rows at RVA and mapping boundaries",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-pe-imports-cli-directory-rva-",
    );
    for (const [kind, rva, retained, mappingGap] of [
      ["standard", 0xffffffec, 1, false],
      ["standard", 0xfffffff0, 0, false],
      ["delay", 0xffffffe0, 1, false],
      ["delay", 0xfffffff0, 0, false],
      ["standard", 0x40000000, 0, true],
      ["standard", 0x40000000, 1, true],
      ["delay", 0x40000000, 0, true],
      ["delay", 0x40000000, 1, true],
    ] as const) {
      const path = join(root, `${kind}-${String(rva)}-${String(retained)}.exe`);
      await writeFile(
        path,
        mappingGap
          ? peImportDirectoryMappingStops(kind, retained)
          : peImportDirectoryAtRva(kind, rva),
      );
      const invocation = {
        arguments: ["inspect-pe-imports", path, "--json"],
      };
      const result = await (rva === 0xffffffec
        ? cli.run(invocation)
        : runFileCli(cli, invocation));
      expect(result.exitCode, result.stderr).toBe(0);
      const report = toolContract("inspect_pe_imports").outputSchema.parse(
        result.json,
      ).normalized_result;
      const directory =
        kind === "standard"
          ? report.import_directory
          : report.delay_import_directory;
      const rows = kind === "standard" ? report.imports : report.delay_imports;
      expect(directory).toMatchObject({ rva });
      expect(directory?.locations).toHaveLength(retained);
      expect(rows).toHaveLength(retained);
      expect(report.coverage.status).toBe("partial");
      expect(report.imphash.md5).toBe(
        kind === "delay" ? "92cef6cc91a85825f3c8a0516517c66f" : null,
      );
    }
  },
);

cliTest(
  "retains a partial inventory when an IAT RVA overflows",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-imports-cli-overflow-");
    for (const bits of [32, 64] as const) {
      const bytes = peImportImage({ bits });
      bytes.writeUInt32LE(
        0x100000000 - bits / 8,
        peImportFixtureOffset(0x1000) + 16,
      );
      const path = join(root, `app-${String(bits)}.exe`);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-pe-imports", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const report = toolContract("inspect_pe_imports").outputSchema.parse(
        result.json,
      ).normalized_result;
      expect(report.imports[0]?.functions.map((row) => row.name)).toEqual([
        "GetProcAddress",
      ]);
      expect(report.coverage.status).toBe("partial");
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "malformed_entry",
            location: "0x100000000",
          }),
        ]),
      );
      expect(report.imphash.md5).toBeNull();
    }
  },
);

cliTest(
  "keeps complete facts when pefile cannot see the same import table",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-pe-imports-cli-compatibility-",
    );
    const functions = Array.from({ length: 140 }, (_, i) => ({
      name: `Function${String(i).padStart(3, "0")}`,
    }));
    const cases = [
      [
        "cross-section",
        peImportImage({
          sectionBytes: 0x4000,
          splitAt: 0x1000,
          dlls: [{ name: "KERNEL32.dll", functions }],
        }),
        140,
      ],
      ["section-cap", peImportManySectionsImage(2049, 2), 2],
      ["null-section", peImportLeadingSectionImage(false), 2],
    ] as const;
    for (const [name, bytes, count] of cases) {
      const path = join(root, `${name}.exe`);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-pe-imports", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const report = toolContract("inspect_pe_imports").outputSchema.parse(
        result.json,
      ).normalized_result;
      expect(report.imports[0]?.name).toBe("KERNEL32.dll");
      expect(report.imports[0]?.functions).toHaveLength(count);
      expect(report.coverage.status).toBe("complete");
      expect(report.imphash).toMatchObject({
        md5: null,
        reason: expect.stringMatching(/mapping|compatibility/u),
      });
      if (name === "cross-section")
        expect(report.imports[0]?.functions[128]?.name).toBe("Function128");
    }
  },
);
