import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { describe, expect } from "vitest";
import { z } from "zod";

import { inspectMachoSchema } from "../../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const evidenceSchema = z.object({ normalized_result: inspectMachoSchema });

describe.skipIf(process.platform !== "darwin")(
  "native Mach-O CLI linker options",
  () => {
    cliTest(
      "retains every compiler-recorded linker option string in order",
      async ({ cli, processes }) => {
        const directory = await createTestTempDirectory("rea-linker-option-");
        const source = join(directory, "options.c");
        const object = join(directory, "options.o");
        await writeFile(
          source,
          [
            '__asm__(".linker_option \\"-framework\\", \\"Foundation\\"");',
            '__asm__(".linker_option \\"-lz\\"");',
            "int sample(void) { return 7; }",
            "",
          ].join("\n"),
        );
        const compiled = await processes.run(
          "/usr/bin/xcrun",
          ["clang", "-c", source, "-o", object],
          { timeoutMs: 30_000 },
        );
        expect(compiled.exitCode, compiled.stderr).toBe(0);
        const result = await cli.run({
          arguments: ["inspect-macho", object, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const { load_commands: loadCommands } = evidenceSchema.parse(
          result.json,
        ).normalized_result;
        expect(loadCommands.exhaustive).toBe(true);
        expect(
          loadCommands.items
            .filter((command) => command.kind === "LC_LINKER_OPTION")
            .map(({ fields }) => fields),
        ).toMatchObject([
          {
            cmd: "LC_LINKER_OPTION",
            cmdsize: 40,
            count: 2,
            "string #1": "-framework",
            "string #2": "Foundation",
          },
          {
            cmd: "LC_LINKER_OPTION",
            cmdsize: 16,
            count: 1,
            "string #1": "-lz",
          },
        ]);
      },
    );
  },
);
