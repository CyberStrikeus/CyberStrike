import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { machoWithPropertyAttributes } from "../../fixtures/objcPropertyMacho.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe.skipIf(process.platform !== "darwin")(
  "native dispatch property attributes",
  () => {
    cliTest(
      "preserves a leading U+FEFF in a binary property name",
      async ({ cli }) => {
        const directory = await createTestTempDirectory("rea-objc-property-");
        const path = join(directory, "fixture.bin");
        await writeFile(
          path,
          machoWithPropertyAttributes("Tq,N", { firstName: "\ufefffirst" }),
        );
        const output = await cli.run({
          arguments: ["inspect-native-dispatch-metadata", path, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(0);
        expect(output.json).toMatchObject({
          normalized_result: {
            result: {
              objc_classes: [
                {
                  name: "Fixture",
                  properties: [{ name: "\ufefffirst" }, { name: "second" }],
                },
              ],
            },
          },
        });
      },
    );

    cliTest.for([
      ["complete nonatomic", "Tq,N", "nonatomic", false, "complete"],
      ["complete default", 'T@"NSString",C', "atomic", false, "complete"],
      ["unfinished quote", 'T@"NSString', null, null, "partial"],
      ["unfinished quote after R", 'R,T@"NSString', null, true, "partial"],
    ] as const)(
      "reports established property flags only for $0 attributes",
      async ([, attributes, atomicity, readonly, facet], { cli }) => {
        const directory = await createTestTempDirectory("rea-objc-property-");
        const path = join(directory, "fixture.bin");
        await writeFile(path, machoWithPropertyAttributes(attributes));
        const output = await cli.run({
          arguments: ["inspect-native-dispatch-metadata", path, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(0);
        const property = {
          atomicity,
          is_readonly: readonly,
          attributes: expect.arrayContaining([
            { name: "T", value: expect.any(String) },
          ]),
        };
        expect(output.json).toMatchObject({
          normalized_result: {
            result: {
              objc_classes: [
                {
                  name: "Fixture",
                  properties: [
                    { name: "first", ...property },
                    { name: "second", ...property },
                  ],
                },
              ],
              coverage: expect.arrayContaining([
                expect.objectContaining({
                  facet: "objc_properties_categories",
                  status: facet,
                  reason:
                    facet === "partial"
                      ? expect.stringContaining(
                          "property_attributes_incomplete",
                        )
                      : null,
                }),
              ]),
            },
          },
        });
      },
    );
  },
);

describe.skipIf(process.platform !== "darwin")(
  "native dispatch property record isolation",
  () => {
    cliTest.for([
      [
        "an unmapped name pointer",
        { secondNameOffset: 0x2000 },
        "first",
        "0x100000518",
      ],
      ["an empty name", { firstName: "" }, "second", "0x100000508"],
    ] as const)(
      "retains the valid sibling of a property with $0",
      async ([, layout, kept, location], { cli }) => {
        const directory = await createTestTempDirectory("rea-objc-property-");
        const path = join(directory, "fixture.bin");
        await writeFile(path, machoWithPropertyAttributes("Tq,N", layout));
        const output = await cli.run({
          arguments: ["inspect-native-dispatch-metadata", path, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(0);
        expect(output.json).toMatchObject({
          normalized_result: {
            result: {
              objc_classes: [
                {
                  name: "Fixture",
                  properties: [{ name: kept, atomicity: "nonatomic" }],
                },
              ],
              coverage: expect.arrayContaining([
                expect.objectContaining({
                  facet: "objc_properties_categories",
                  status: "partial",
                  reason: expect.stringContaining(
                    `property_decode_failed at ${location}: Fixture: property`,
                  ),
                }),
              ]),
            },
          },
        });
      },
    );
  },
);

describe.skipIf(process.platform !== "darwin")(
  "native dispatch provider choice",
  () => {
    cliTest.for([
      [[], "missing", 1, "unknown_provider"],
      [["--provider", "missing"], "auto", 1, "unknown_provider"],
      [["--provider", "auto"], "missing", 0, null],
    ] as const)(
      "preserves explicit selection %j",
      async ([options, configured, exitCode, reason], { cli }) => {
        const directory = await createTestTempDirectory(
          "rea-dispatch-provider-choice-",
        );
        const path = join(directory, "fixture.bin");
        await writeFile(path, machoWithPropertyAttributes("Tq,N"));
        const output = await cli.run({
          arguments: [
            "inspect-native-dispatch-metadata",
            path,
            ...options,
            "--json",
          ],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: configured,
          },
        });
        expect(output.exitCode, `${output.stdout}\n${output.stderr}`).toBe(
          exitCode,
        );
        if (reason !== null)
          expect(output.json).toMatchObject({
            code: "capability_unavailable",
            details: {
              selection_reason: reason,
              requested_provider_id: "missing",
            },
          });
        else
          expect(output.json).toMatchObject({
            normalized_result: {
              provider: { id: "native-macos" },
              result: { objc_classes: [{ name: "Fixture" }] },
            },
          });
      },
    );
  },
);
