import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";
import { z } from "zod";

import { listArchitecturesSchema } from "../../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const environment = {
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "auto",
} as const;

const resultSchema = z.object({
  subject: z.object({ format: z.string(), architecture: z.string() }),
  normalized_result: z.record(z.string(), z.unknown()),
});

describe.skipIf(process.platform !== "darwin")(
  "native Mach-O CLI with a thin arm64_32 object",
  () => {
    cliTest(
      "admits the thin object for static Mach-O inspection",
      async ({ cli, processes }) => {
        const directory = await createTestTempDirectory(
          "rea-native-cli-arm64-32-",
        );
        // A header-free source keeps the object independent of SDK slices.
        const source = join(directory, "watch.c");
        await writeFile(source, "int rea_watch_value(void) { return 42; }\n");
        const object = join(directory, "watch.o");
        const compiled = await processes.run(
          "/usr/bin/xcrun",
          ["clang", "-arch", "arm64_32", "-c", source, "-o", object],
          { timeoutMs: 30_000 },
        );
        expect(compiled.exitCode, compiled.stderr).toBe(0);
        for (const command of [
          "list-architectures",
          "inspect-macho",
          "inspect-signature",
        ]) {
          const result = await cli.run({
            arguments: [command, object, "--json"],
            environment,
          });
          expect(result.exitCode, `${command}: ${result.stdout}`).toBe(0);
          const parsed = resultSchema.parse(result.json);
          expect(parsed.subject).toMatchObject({
            format: "mach-o",
            architecture: "arm64_32",
          });
          if (command === "list-architectures")
            expect(
              listArchitecturesSchema.shape.architectures
                .parse(parsed.normalized_result.architectures)
                .items.map(({ name }) => name),
            ).toEqual(["arm64_32"]);
        }
        // 32-bit dispatch metadata is unsupported, and no deep-analysis
        // provider admits arm64_32, so the fallback is a typed refusal.
        const dispatch = await cli.run({
          arguments: ["inspect-native-dispatch-metadata", object, "--json"],
          environment,
        });
        expect(dispatch.json).toMatchObject({
          code: "capability_unavailable",
          retryable: false,
          details: { selection_reason: "target_unsupported" },
        });
      },
      60_000,
    );
  },
);
