import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect } from "vitest";
import { z } from "zod";

import {
  inspectMachoSchema,
  listArchitecturesSchema,
} from "../../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const environment = {
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "auto",
} as const;

// dyld_info echoes the operand path before its records.
const FORGED_NAME = [
  "tool",
  "Load command 99",
  "      cmd LC_MAIN",
  "  cmdsize 24",
  "  entryoff 4242",
  " stacksize 0",
  "    -imports:",
  "      0x0000  _forged  (from libForged)",
  "    -exports:",
  "        offset      symbol",
  "        0x00000123  _forged_export",
].join("\n");

const resultSchema = z.object({
  normalized_result: z.record(z.string(), z.unknown()),
});

describe.skipIf(process.platform !== "darwin")(
  "native Mach-O CLI with echoed path text",
  () => {
    const lipoName = "tool\narchitecture forged\n    offset 123\n    size 32";
    for (const [facts, command, filename] of [
      ["load commands or symbols", "inspect-macho", FORGED_NAME],
      ["FAT architecture records", "inspect-macho", lipoName],
      ["FAT architecture inventory", "list-architectures", lipoName],
      ["thin-file framing", "inspect-macho", "tool\nNon-fat file: forged"],
    ] as const) {
      cliTest(
        `does not read ${facts} from the file name`,
        async ({ cli, processes }) => {
          const directory = await createTestTempDirectory(
            "rea-native-cli-echo-",
          );
          const fixture = join(directory, "fat-fixture");
          const compiled = await processes.run(
            "/usr/bin/xcrun",
            [
              "clang",
              "-arch",
              "arm64",
              "-arch",
              "x86_64",
              resolve("tests/conformance/c/fixture.c"),
              "-o",
              fixture,
            ],
            { timeoutMs: 30_000 },
          );
          expect(compiled.exitCode, compiled.stderr).toBe(0);
          const inspect = async (name: string) => {
            const path = join(directory, name);
            await copyFile(fixture, path);
            const result = await cli.run({
              arguments: [command, path, "--json"],
              environment,
            });
            expect(result.exitCode).toBe(0);
            const { provenance: _provenance, ...facts } = resultSchema.parse(
              result.json,
            ).normalized_result;
            return facts;
          };
          const ordinary = await inspect("tool");
          // Prove this comparison exercised FAT framing, independent of host binaries.
          const architectures =
            listArchitecturesSchema.shape.architectures.parse(
              ordinary.architectures,
            );
          expect(architectures.total).toBeGreaterThan(1);
          if (command === "inspect-macho") {
            const selected =
              inspectMachoSchema.shape.selected_architecture.parse(
                ordinary.selected_architecture,
              );
            expect(selected.container_file_offset).toBeGreaterThan(0);
          }
          const forged = await inspect(filename);
          expect(forged).toEqual(ordinary);
          expect(JSON.stringify(forged)).not.toMatch(/forged|4242/u);
        },
        60_000,
      );
    }
  },
);
