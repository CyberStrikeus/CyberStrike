import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { nativeDispatchMetadataResultSchema } from "../../../src/domain/native/objcSwiftMetadata.js";

import { objcRecordBudgetMacho } from "../../fixtures/objcRecordBudgetMacho.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe.skipIf(process.platform !== "darwin")(
  "native dispatch declaration-local record budget",
  () => {
    cliTest.for([["protocol"], ["class"]] as const)(
      "marks an omitted $0 method list partial in public CLI output",
      async ([owner], { cli }) => {
        const directory = await createTestTempDirectory("rea-objc-budget-");
        const path = join(directory, "fixture.macho");
        await writeFile(path, objcRecordBudgetMacho(owner));
        const output = await cli.run({
          arguments: [
            "inspect-native-dispatch-metadata",
            path,
            "--max-records",
            "1",
            "--json",
          ],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(0);
        const result = nativeDispatchMetadataResultSchema.parse(
          parseEvidence(output.json).normalized_result,
        ).result;
        if (owner === "protocol") {
          expect(result?.objc_protocol_records).toMatchObject([
            {
              name: "FixtureProtocol",
              methods: [],
              decode: { status: "partial", reason: "max_records_reached" },
            },
          ]);
        } else {
          expect(result?.objc_classes).toMatchObject([
            {
              name: "FixtureClass",
              methods: [],
              decode: { status: "partial", reason: "max_records_reached" },
            },
          ]);
        }
        expect(result?.coverage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              facet: "objc_class_method_ivar_metadata",
              status: "partial",
              reason: expect.stringContaining("max_records_reached"),
            }),
          ]),
        );
      },
    );
  },
);
