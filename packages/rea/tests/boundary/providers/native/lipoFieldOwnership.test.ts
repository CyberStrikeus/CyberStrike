import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { MachOSliceArtifactReader } from "../../../../src/artifacts/MachOSliceArtifactReader.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  listArchitecturesSchema,
  inspectMachoSchema,
} from "../../../../src/domain/native/nativeInspection.js";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { NATIVE_COMMAND_OUTPUT_BUDGET_BYTES } from "../../../../src/native/CommandRunner.js";
import {
  LipoFieldRetentionError,
  parseLipoCapture,
} from "../../../../src/native/parsers/lipo.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../../../../src/artifacts/ArtifactReader.js";

it.each(["absent", "valid", "uninterpretable"] as const)(
  "preserves %s lipo fields through native observations and structural slice inventory",
  async (mode) => {
    const root = await createTestTempDirectory("rea-lipo-field-owner-");
    const path = join(root, "fat");
    const thin = machoImage({ cpu: CPU.arm64 });
    await writeFile(path, fatImage([{ cpu: CPU.arm64, bytes: thin }]));
    const badLines = [
      " offset 4096",
      "  offset -1  ",
      " size 9007199254740992",
      " align 2^12 (2048)",
    ];
    const lines =
      mode === "absent"
        ? []
        : mode === "uninterpretable"
          ? badLines
          : [" offset 4096", ` size ${thin.length}`, " align 2^12 (4096)"];
    const stdout = [
      "architecture arm64",
      " cputype 16777228",
      " cpusubtype 0",
      ...lines,
      "",
    ].join("\n");
    const runner = new NativeFixtureRunner({ lipo: stdout });
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      await nativeMachoTargetForFile(path),
    );
    const reader = new MachOSliceArtifactReader(path, {}, runner);
    try {
      const listed = await client.execute("list_architectures", {});
      if (!listed.ok) throw listed.error;
      const list = listArchitecturesSchema.parse(listed.value.result);
      expect(list.architectures.items).toMatchObject([
        {
          name: "arm64",
          cpu_type: "16777228",
          cpu_subtype: "0",
          file_offset: mode === "valid" ? 4096 : null,
          size: mode === "valid" ? thin.length : null,
          alignment: mode === "valid" ? 4096 : null,
        },
      ]);
      const inspected = await client.execute("inspect_macho", {});
      if (!inspected.ok) throw inspected.error;
      const macho = inspectMachoSchema.parse(inspected.value.result);
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(entries).toMatchObject([
        { path: "slices/arm64", byteOffset: 4096, declaredSize: thin.length },
      ]);
      if (mode === "uninterpretable") {
        expect(list.limitations).toHaveLength(3);
        expect(list.architectures.limitations).toEqual([]);
        for (const line of badLines) {
          expect(list.limitations.some((note) => note.includes(line))).toBe(
            true,
          );
          expect(macho.architectures.limitations).toEqual([]);
          expect(macho.limitations.some((note) => note.includes(line))).toBe(
            true,
          );
          expect(
            entries[0]?.limitations.some((note) => note.includes(line)),
          ).toBe(true);
        }
        expect(entries[0]?.limitations.join(" ")).not.toContain("lipo omitted");
        expect(entries[0]?.limitations).toContain(
          "Slice range was derived from structural Mach-O facts because lipo's range declarations could not all be interpreted.",
        );
      } else {
        expect(list.limitations).toEqual([]);
        expect(entries[0]?.limitations).toEqual(
          mode === "valid"
            ? []
            : [
                "Slice range was derived from structural Mach-O facts because lipo omitted it.",
              ],
        );
      }
    } finally {
      await reader.close();
      await client.close();
    }
  },
);

it("does not replace a parsed contradictory lipo range with structural fallback", async () => {
  const root = await createTestTempDirectory("rea-lipo-known-mismatch-");
  const path = join(root, "fat");
  const thin = machoImage({ cpu: CPU.arm64 });
  await writeFile(path, fatImage([{ cpu: CPU.arm64, bytes: thin }]));
  const reader = new MachOSliceArtifactReader(
    path,
    {},
    new NativeFixtureRunner({
      lipo: `architecture arm64\n cputype 16777228\n cpusubtype 0\n offset 8192\n size ${thin.length}\n align 2^12 (4096)\n`,
    }),
  );
  try {
    await expect(
      reader.entries()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({
      reason: "integrity",
      message: expect.stringContaining("disagrees with the Mach-O FAT table"),
    });
  } finally {
    await reader.close();
  }
});

it("refuses retained raw-field expansion as capacity rather than a malformed lipo record", async () => {
  const root = await createTestTempDirectory("rea-lipo-field-capacity-");
  const path = join(root, "fat");
  await writeFile(
    path,
    fatImage([{ cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) }]),
  );
  const source = "\u0000".repeat(
    Math.floor(NATIVE_COMMAND_OUTPUT_BUDGET_BYTES / 18) + 1,
  );
  const stdout = `architecture arm64\n offset ${source}\n`;
  expect(Buffer.byteLength(stdout)).toBeLessThan(
    NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
  );
  const runner = new NativeFixtureRunner({ lipo: stdout });
  const captured = await runner.run("lipo", ["-detailed_info", path]);
  if (!captured.ok) throw captured.error;
  const stderr = "retained raw lipo diagnostic\n";
  const refused = parseLipoCapture(
    {
      ...captured.value,
      stderr,
      stderrBytes: Buffer.byteLength(stderr),
      exitCode: 7,
      signal: "SIGTERM",
    },
    "list_architectures",
    path,
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("Expected lipo field retention refusal");
  expect(refused.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    capturedOutput: {
      stdout,
      stderr,
      stdout_bytes: Buffer.byteLength(stdout),
      stderr_bytes: Buffer.byteLength(stderr),
      exit_code: 7,
      signal: "SIGTERM",
      truncated: false,
    },
  });
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    await nativeMachoTargetForFile(path),
  );
  const reader = new MachOSliceArtifactReader(path, {}, runner);
  try {
    const result = await client.execute("list_architectures", {});
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
    });
    const published: ArtifactEntry[] = [];
    const failure: unknown = await (async () => {
      for await (const entry of reader.entries()) published.push(entry);
    })().catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ reason: "limit", boundary: "memory" });
    expect(failure).toBeInstanceOf(ArtifactReaderFailure);
    if (!(failure instanceof ArtifactReaderFailure))
      throw new Error("Expected artifact capacity refusal");
    expect(failure.cause).toBeInstanceOf(LipoFieldRetentionError);
    if (!(failure.cause instanceof LipoFieldRetentionError))
      throw new Error("Expected exact parser capacity cause");
    expect(failure.cause.requiredBytes).toBeGreaterThan(
      NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
    );
    expect(published).toEqual([]);
    expect(reader.provenance()).toEqual([
      {
        tool: "lipo",
        arguments: ["-detailed_info", "$ARTIFACT"],
        tool_version: captured.value.toolVersion,
        executable_sha256: captured.value.executableSha256,
        exit_code: captured.value.exitCode,
        effects: ["read"],
      },
    ]);
  } finally {
    await reader.close();
    await client.close();
  }
});

it("does not publish file locations beyond the selected binary slice", async () => {
  const path = join(
    await createTestTempDirectory("rea-macho-location-"),
    "fixture",
  );
  const segment = Buffer.alloc(72);
  segment.writeUInt32LE(0x19, 0);
  segment.writeUInt32LE(72, 4);
  segment.write("__TEXT", 8);
  segment.writeBigUInt64LE(0x100000000n, 24);
  segment.writeBigUInt64LE(0x4000n, 32);
  segment.writeBigUInt64LE(0x4000n, 48);
  const main = Buffer.alloc(24);
  main.writeUInt32LE(0x80000028, 0);
  main.writeUInt32LE(24, 4);
  main.writeBigUInt64LE(0x1000n, 8);
  await writeFile(
    path,
    machoImage({ cpu: CPU.arm64, commands: [segment, main] }),
  );
  const runner = new NativeFixtureRunner({
    lipo: "input file fixture is not a fat file\nNon-fat file: fixture is architecture: arm64\n",
    "dyld_info:-exports": "offset symbol\n0x20 _outside\n",
    nm: "_outside\n",
  });
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    await nativeMachoTargetForFile(path),
  );
  try {
    const result = await client.execute("inspect_macho", {});
    if (!result.ok) throw result.error;
    const inspected = inspectMachoSchema.parse(result.value.result);
    expect(inspected.exports.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "_outside", address: null }),
      ]),
    );
    expect(inspected.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no file-backed image base"),
      ]),
    );
    expect(inspected.segments.items[0]).toMatchObject({
      file_offset: 0,
      file_size: 0x4000,
    });
    expect(inspected.entrypoints.exhaustive).toBe(false);
    expect(inspected.entrypoints.limitations).toContain(
      "An entrypoint lies outside the selected Mach-O slice.",
    );
    expect(inspected.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("outside the selected slice"),
      ]),
    );
    expect(result.value.locations).not.toContainEqual({
      kind: "file-offset",
      offset: 0x1000,
    });
    expect(result.value.locations).not.toContainEqual({
      kind: "file-offset-range",
      start: 0,
      end: 0x4000,
    });
  } finally {
    await client.close();
  }
});
