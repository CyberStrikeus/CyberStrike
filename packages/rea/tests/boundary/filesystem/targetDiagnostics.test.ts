import { chmod, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { systemDoctorHost } from "../../../src/application/Doctor.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { pe } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("executable format refusal diagnostics", () => {
  it.each([
    [0x01a6, "0x01a6"],
    [0x0000, "0x0000"],
    [0xffff, "0xffff"],
  ] as const)(
    "retains unsupported PE machine %i in the refusal",
    async (machine, expectedMachine) => {
      const directory = await createTestTempDirectory("rea-target-pe-machine-");
      const path = join(directory, "unsupported.exe");
      const bytes = pe(0x014c);
      bytes.writeUInt16LE(machine, 0x44);
      await writeFile(path, bytes);

      const result = await parseBinaryTarget(path);
      if (result.ok) throw new Error("unsupported PE target was admitted");
      const reason = `unsupported PE architecture (COFF machine ${expectedMachine})`;
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        message: `Cannot open artifact: ${reason}.`,
        details: { reason, constraint: "file_format_rejected" },
      });
    },
  );

  it.each(["NE", "LE", "LX"] as const)(
    "reports unsupported %s executables without path advice",
    async (signature) => {
      const directory = await createTestTempDirectory(
        `rea-target-${signature.toLowerCase()}-`,
      );
      const path = join(directory, "unsupported.exe");
      const bytes = Buffer.alloc(0x80 + 24);
      bytes.write("MZ", 0, "ascii");
      bytes.writeUInt32LE(0x80, 0x3c);
      bytes.write(signature, 0x80, "ascii");
      await writeFile(path, bytes);

      const result = await parseBinaryTarget(path);
      if (result.ok)
        throw new Error(`unsupported ${signature} target was admitted`);
      const reason = `unsupported ${signature} executable in MZ image`;
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        retryable: false,
        message: `Cannot open artifact: ${reason}.`,
        details: {
          reason,
          constraint: "file_format_rejected",
        },
        remediation: {
          action:
            "Review the reported file-format reason and select a supported, well-formed target.",
        },
      });
      expect(projected.message).not.toContain("Check that the path");

      expect(await systemDoctorHost().inspectTarget?.(path)).toMatchObject({
        classification: "unsupported_target",
        details: { constraint: "file_format_rejected" },
        remediation:
          "Review the reported file-format reason and select a supported, well-formed target.",
      });
    },
  );
});

describe("target route diagnostics", () => {
  it.each(["module.wasm", "module.bin", "misleading.js", "misleading.hop"])(
    "identifies a WASM v1 header in %s without suggesting native provider installation",
    async (name) => {
      const directory = await createTestTempDirectory("rea-wasm-target-");
      const path = join(directory, name);
      const bytes = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
      await writeFile(path, bytes);
      const result = await parseBinaryTarget(path);
      if (result.ok) throw new Error("WASM was admitted to native opening");
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        retryable: false,
        details: {
          path: await realpath(path),
          constraint: "wasm_requires_static_inspection",
        },
      });
      expect(projected.message).toContain("WebAssembly");
      expect(projected.remediation.action).toContain("inspect_wasm_artifact");
      expect(projected.remediation.action).toContain("REA_WABT_BIN_DIRECTORY");
      expect(projected.remediation.action).toContain("WABT 1.0.42");
      expect(projected.remediation.action).toContain("does not execute");
      expect(await systemDoctorHost().inspectTarget?.(path)).toMatchObject({
        ok: false,
        classification: "unsupported_target",
        details: { constraint: "wasm_requires_static_inspection" },
        remediation: projected.remediation.action,
      });
    },
  );

  it.each([
    [0, 0x61, 0x73, 0x6d],
    [0, 0x61, 0x73, 0x6d, 2, 0, 0, 0],
    [1, 2, 3, 4, 5, 6, 7, 8],
  ])(
    "does not infer supported WASM encoding from a suffix or incomplete header",
    async (...bytes) => {
      const directory = await createTestTempDirectory("rea-wasm-unknown-");
      const path = join(directory, "module.wasm");
      await writeFile(path, Buffer.from(bytes));
      const result = await parseBinaryTarget(path);
      if (result.ok) throw new Error("unknown header was admitted");
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        category: "unsupported_target",
        retryable: false,
        details: { constraint: "file_format_rejected" },
      });
      expect(projected.remediation.action).not.toContain(
        "inspect_wasm_artifact",
      );
    },
  );

  it("preserves an explicit raw-binary selection even when the bytes have a WASM header", async () => {
    const directory = await createTestTempDirectory("rea-wasm-explicit-raw-");
    const path = join(directory, "module.wasm");
    await writeFile(path, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    expect(
      await parseBinaryTarget(path, {
        formatHint: "raw-binary",
        architecture: "x86",
        entryPoint: "0x001000",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        path: await realpath(path),
        format: "raw-binary",
        architecture: "x86",
        entryPoint: "0x1000",
        entryPointSource: "0x001000",
      },
    });
  });
  it("identifies the directory opening constraint and gives the direct analysis route", async () => {
    const directory = await createTestTempDirectory("rea-js-target-");
    await writeFile(join(directory, "index.js"), "export const answer = 42;\n");
    const result = await parseBinaryTarget(directory);
    if (result.ok) throw new Error("directory was admitted as a file");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "target_unavailable",
      details: {
        path: await realpath(directory),
        constraint: "directory_requires_file",
      },
    });
    expect(projected.message).toContain("analyze_javascript_application");
    expect(projected.remediation.action).toContain("input_path");
    const doctor = systemDoctorHost();
    expect(await doctor.inspectTarget?.(directory)).toMatchObject({
      name: "target",
      ok: false,
      classification: "unsupported_target",
      details: { constraint: "directory_requires_file" },
      remediation: projected.remediation.action,
    });
    const missing = await parseBinaryTarget(join(directory, "missing"));
    if (missing.ok) throw new Error("missing target was admitted");
    const missingProjection = projectAnalysisError(missing.error);
    expect(missingProjection).toMatchObject({
      details: { reason: expect.stringContaining("does not exist") },
      message: expect.stringContaining("does not exist"),
    });
    expect(missingProjection.message).toContain(
      "Check that the path exists, is readable, and points to a supported file.",
    );
    expect(
      await doctor.inspectTarget?.(join(directory, "missing")),
    ).toMatchObject({
      ok: false,
      classification: "config_drift",
      details: { reason: expect.stringContaining("does not exist") },
    });
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "preserves a real filesystem permission denial",
    async () => {
      const directory = await createTestTempDirectory("rea-target-denied-");
      const path = join(directory, "index.js");
      await writeFile(path, "export const answer = 42;");
      await chmod(path, 0o000);
      try {
        const result = await parseBinaryTarget(path);
        if (result.ok) throw new Error("unreadable target was admitted");
        const projected = projectAnalysisError(result.error);
        expect(projected).toMatchObject({
          details: { reason: expect.stringContaining("permission denied") },
          message: expect.stringContaining("permission denied"),
        });
        expect(projected.message).toContain(
          "Check that the path exists, is readable, and points to a supported file.",
        );
        expect(await systemDoctorHost().inspectTarget?.(path)).toMatchObject({
          ok: false,
          classification: "config_drift",
          details: { reason: expect.stringContaining("permission denied") },
        });
      } finally {
        await chmod(path, 0o600);
      }
    },
  );
});

describe("raw-binary load rejection diagnostics", () => {
  const rawBinaryRejection = async (
    options: Parameters<typeof parseBinaryTarget>[1],
    bytes = Buffer.alloc(64),
  ) => {
    const directory = await createTestTempDirectory("rea-raw-load-");
    const path = join(directory, "image.bin");
    await writeFile(path, bytes);
    const result = await parseBinaryTarget(path, options);
    if (result.ok) throw new Error("invalid raw-binary load was admitted");
    return projectAnalysisError(result.error);
  };

  it("projects a misaligned arm entry as caller input without path advice", async () => {
    const projected = await rawBinaryRejection({
      formatHint: "raw-binary",
      architecture: "arm",
      entryPoint: "0x1",
    });
    expect(projected).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      message:
        "Cannot open artifact: raw-binary arm entry_point 0x1 must be 4-byte aligned.",
      details: {
        reason: "raw-binary arm entry_point 0x1 must be 4-byte aligned",
        constraint: "load_selection_rejected",
      },
      remediation: {
        action:
          "Correct the reported load argument (--target-format, --architecture, or --entry-point on the CLI; format, architecture, or entry_point through MCP) and retry.",
      },
    });
    expect(projected.message).not.toContain("Check that the path");
  });

  it("projects an x86 entry beyond the address width as caller input", async () => {
    const projected = await rawBinaryRejection({
      formatHint: "raw-binary",
      architecture: "x86",
      entryPoint: "0xffffffffff",
    });
    expect(projected).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: { constraint: "load_selection_rejected" },
    });
    expect(projected.message).toContain("x86 address width");
    expect(projected.message).not.toContain("Check that the path");
  });

  it("projects architecture and entry without raw-binary format as caller input", async () => {
    const projected = await rawBinaryRejection({
      architecture: "arm",
      entryPoint: "0x0",
    });
    expect(projected).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message:
        "Cannot open artifact: architecture and entry_point apply only with format=raw-binary.",
      details: { constraint: "load_selection_rejected" },
    });
    expect(projected.message).not.toContain("Check that the path");
  });

  it("keeps an empty raw-binary file a target refusal", async () => {
    const projected = await rawBinaryRejection(
      {
        formatHint: "raw-binary",
        architecture: "arm",
        entryPoint: "0x8000000",
      },
      Buffer.alloc(0),
    );
    expect(projected).toMatchObject({
      code: "target_unavailable",
      category: "unsupported_target",
      details: {
        reason: "raw-binary requires at least one file byte",
        constraint: "file_format_rejected",
      },
    });
  });

  it("projects the raw-binary target-kind pairing as caller input", async () => {
    const projected = await rawBinaryRejection({
      formatHint: "raw-binary",
      targetKind: "database",
      architecture: "x86",
      entryPoint: "0x1000",
    });
    expect(projected).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        reason: "raw-binary format requires an executable target kind",
        constraint: "load_selection_rejected",
      },
    });
  });

  it("projects the DOS COM target-kind pairing as caller input too", async () => {
    const projected = await rawBinaryRejection({
      formatHint: "dos-com",
      targetKind: "database",
    });
    expect(projected).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        reason: "DOS COM format requires an executable target kind",
        constraint: "load_selection_rejected",
      },
    });
  });
});

describe("caller-selected and inferred target interpretation", () => {
  it.each(["archive.hop", "archive.HOP"])(
    "preserves inferred database routing for ZIP content named %s",
    async (name) => {
      const directory = await createTestTempDirectory("rea-zip-database-");
      const bytes = Buffer.alloc(22);
      bytes.writeUInt32LE(0x06054b50, 0);
      const zipPath = join(directory, "archive.zip");
      const databasePath = join(directory, name);
      await writeFile(zipPath, bytes);
      await writeFile(databasePath, bytes);
      expect(await parseBinaryTarget(zipPath)).toMatchObject({
        ok: true,
        value: { kind: "archive", format: "zip" },
      });
      expect(await parseBinaryTarget(databasePath)).toMatchObject({
        ok: true,
        value: { kind: "database", format: "analysis-database" },
      });
      expect(Buffer.compare(await readFile(databasePath), bytes)).toBe(0);
    },
  );

  it("preserves explicit DOS COM interpretation for bytes with a WASM header", async () => {
    const directory = await createTestTempDirectory("rea-wasm-explicit-com-");
    const path = join(directory, "module.hop");
    await writeFile(path, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    expect(
      await parseBinaryTarget(path, { formatHint: "dos-com" }),
    ).toMatchObject({
      ok: true,
      value: { kind: "executable", format: "dos-com", architecture: "x86" },
    });
  });
  it.each(["module.wasm", "misleading.hop"])(
    "preserves explicitly selected database routing for %s",
    async (name) => {
      const directory = await createTestTempDirectory(
        "rea-wasm-explicit-database-",
      );
      const path = join(directory, name);
      await writeFile(path, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
      expect(
        await parseBinaryTarget(path, { targetKind: "database" }),
      ).toMatchObject({
        ok: true,
        value: { kind: "database", format: "analysis-database" },
      });
    },
  );

  it.each(["ordinary.hop", "ordinary.HOP"])(
    "retains automatic database routing for non-WASM %s",
    async (name) => {
      const directory = await createTestTempDirectory("rea-ordinary-database-");
      const path = join(directory, name);
      await writeFile(path, "existing database content");
      expect(await parseBinaryTarget(path)).toMatchObject({
        ok: true,
        value: { kind: "database", format: "analysis-database" },
      });
    },
  );
});
