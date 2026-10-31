import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { nativeDispatchMetadataResultSchema } from "../../../src/domain/native/objcSwiftMetadata.js";
import { objcRecordBudgetMacho } from "../../fixtures/objcRecordBudgetMacho.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe.skipIf(process.platform !== "darwin")(
  "native dispatch input budget through the public CLI",
  () => {
    cliTest(
      "forwards --max-input-bytes to the byte reader and records its admission",
      async ({ cli }) => {
        const directory = await createTestTempDirectory("rea-objc-input-");
        const path = join(directory, "fixture.macho");
        await writeFile(path, objcRecordBudgetMacho("class"));
        const size = (await stat(path)).size;
        const run = (...flags: string[]) =>
          cli.run({
            arguments: [
              "inspect-native-dispatch-metadata",
              path,
              ...flags,
              "--json",
            ],
            environment: { REA_LOG_LEVEL: "silent" },
          });
        const admission = (output: Awaited<ReturnType<typeof run>>) => {
          expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(0);
          return nativeDispatchMetadataResultSchema.parse(
            parseEvidence(output.json).normalized_result,
          ).input_admission;
        };

        expect(admission(await run())).toEqual({
          maximum_bytes: 67108864,
          source: "default",
          retained_bytes: size,
        });
        expect(admission(await run("--max-input-bytes", String(size)))).toEqual(
          { maximum_bytes: size, source: "caller", retained_bytes: size },
        );
        const refused = await run("--max-input-bytes", String(size - 1));
        expect(refused.exitCode).not.toBe(0);
        expect(refused.json).toMatchObject({
          code: "resource_constraint",
          details: {
            reported_limits: {
              input_bytes: size - 1,
              input_bytes_source: "caller",
              observed_input_bytes: size,
            },
          },
        });
      },
    );
  },
);
