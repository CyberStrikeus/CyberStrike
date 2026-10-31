import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { describe, expect } from "vitest";
import { z } from "zod";

import { inspectMachoSchema } from "../../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const evidenceSchema = z.object({ normalized_result: inspectMachoSchema });

describe.skipIf(process.platform !== "darwin")(
  "native Mach-O CLI object segment",
  () => {
    cliTest(
      "reports an object file's unnamed segment by its observed empty name",
      async ({ cli, processes }) => {
        const directory = await createTestTempDirectory("rea-object-segment-");
        const source = join(directory, "qa.c");
        const object = join(directory, "qa.o");
        await writeFile(source, "int qa(void) { return 7; }\n");
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
        const inspected = evidenceSchema.parse(result.json).normalized_result;
        const segment = inspected.load_commands.items.find(
          ({ kind }) => kind === "LC_SEGMENT_64" || kind === "LC_SEGMENT",
        );
        expect(segment?.fields["segname #1"]).toBe("");
        expect(inspected.segments).toMatchObject({
          items: [
            {
              name: "",
              sections: {
                items: expect.arrayContaining([
                  expect.objectContaining({
                    segment: "__TEXT",
                    name: "__text",
                  }),
                ]),
              },
            },
          ],
          exhaustive: true,
        });
      },
    );
  },
);
