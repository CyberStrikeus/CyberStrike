import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { JSON_LINES_SELECTION_REMEDIATION } from "../../src/cli/jsonLines.js";
import { elf, thinMach } from "../../src/domain/binaryTarget.fixture.js";
import { buildManagedPeFixture } from "../../src/dotnet/ManagedPe.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";

cliTest(
  "managed CLI preserves malformed prefix evidence without a complete CIL fingerprint",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-cil-prefix-");
    for (const [name, il, status, coverage] of [
      ["dangling", [0xfe, 0x13], "malformed", "partial"],
      ["complete", [0x00, 0x2a], "present", "complete"],
    ] as const) {
      const path = join(root, `${name}.dll`);
      await writeFile(
        path,
        buildManagedPeFixture({
          ilBody: Buffer.from([(il.length << 2) | 2, ...il]),
        }),
      );
      const result = await cli.run({
        arguments: ["inspect-managed-members", path, "--json"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        operation: "inspect_managed_members",
        subject: { local_path: path },
        normalized_result: {
          coverage: { state: coverage },
          user_strings: { state: coverage },
          methods: [
            expect.objectContaining({
              body: expect.objectContaining({
                status,
                il_sha256: expect.any(String),
                normalized_il_sha256:
                  status === "malformed" ? null : expect.any(String),
                issue:
                  status === "malformed"
                    ? "CIL prefix chain at IL offset 0 has no following instruction"
                    : null,
              }),
            }),
          ],
        },
      });
    }
  },
);

cliTest(
  "managed CLI inspects malformed MethodSpecs used by isolated non-call instructions",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-managed-methodspec-operands-",
    );
    for (const [opcode, name, operandKind] of [
      [0x71, "ldobj", "type"],
      [0x7e, "ldsfld", "field"],
      [0xd0, "ldtoken", "method"],
    ] as const) {
      const path = join(root, `${name}.dll`);
      // Each body has one token operand; no call can trigger MethodSpec
      // inspection on behalf of the non-call instruction under observation.
      const il = Buffer.from([opcode, 1, 0, 0, 0x2b, 0x2a]);
      await writeFile(
        path,
        buildManagedPeFixture({
          memberRefName: "NotAMethod",
          memberRefSignature: Buffer.from([0x06, 0x0e]),
          methodSpecMethods: [(1 << 1) | 1],
          ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
        }),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-managed-members", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        operation: "inspect_managed_members",
        subject: { local_path: path },
        normalized_result: {
          methods: [
            expect.objectContaining({
              body: expect.objectContaining({
                status: "present",
                il_sha256: createHash("sha256").update(il).digest("hex"),
                normalized_il_sha256: expect.any(String),
                anchors: [
                  expect.objectContaining({
                    opcode: name,
                    operand_kind: operandKind,
                    operand: "0x2b000001",
                  }),
                  expect.objectContaining({ opcode: "ret", operand: null }),
                ],
                issue: null,
              }),
            }),
          ],
          call_edges: [],
          field_accesses:
            name === "ldsfld"
              ? [
                  expect.objectContaining({
                    opcode: "ldsfld",
                    field_token: "0x2b000001",
                    field_name: null,
                    field_declaring_type: null,
                  }),
                ]
              : [],
          coverage: {
            state: "partial",
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid-row",
                scope: "metadata.MethodSpec:0x2b000001",
                detail:
                  "MethodSpec method does not have a decodable method signature",
              }),
            ]),
          },
        },
      });
    }
  },
);

cliTest(
  "managed CLI retains metadata and CIL after repeated local constructor owner lookups",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-row-lookup-");
    const path = join(root, "local-attributes.dll");
    await writeFile(
      path,
      buildManagedPeFixture({
        additionalEmptyTypes: 512,
        customAttributeRowCount: 512,
        customAttributeTypeRaw: (1 << 3) | 2,
        typeName: "LookupAttribute",
        extendsRaw: 0,
        methodName: ".ctor",
        methodFlags: 0x1886,
        methodSignature: Buffer.from([0x20, 0x01, 0x01, 0x0e]),
        ilBody: Buffer.from([0x06, 0x2a]),
      }),
    );
    const artifact = await cli.run({
      arguments: ["inspect-managed-artifact", path, "--json"],
    });
    expect(artifact.exitCode).toBe(0);
    expect(artifact.json).toMatchObject({
      normalized_result: {
        coverage: { state: "complete", issues: [] },
        attributes: expect.arrayContaining([
          expect.objectContaining({
            type_name: "Fixture.LookupAttribute",
            constructor_token: "0x06000001",
          }),
        ]),
      },
    });
    expect(artifact.json).toHaveProperty(
      "normalized_result.attributes.length",
      512,
    );
    const members = await cli.run({
      arguments: ["inspect-managed-members", path, "--json"],
    });
    expect(members.exitCode).toBe(0);
    expect(members.json).toMatchObject({
      normalized_result: {
        coverage: { state: "complete", issues: [] },
        types: expect.arrayContaining([
          expect.objectContaining({ full_name: "Fixture.Empty0" }),
          expect.objectContaining({ full_name: "Fixture.Empty511" }),
          expect.objectContaining({ full_name: "Fixture.LookupAttribute" }),
        ]),
        methods: [
          expect.objectContaining({
            name: ".ctor",
            declaring_type: "Fixture.LookupAttribute",
            body: expect.objectContaining({
              status: "present",
              instruction_count: 1,
            }),
          }),
        ],
      },
    });
    expect(members.json).toHaveProperty("normalized_result.types.length", 513);
  },
);

cliTest(
  "managed CLI separates .NET Standard API targets from runtime evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-runtime-family-");
    for (const [name, targetFramework, readyToRun, runtimeFamily] of [
      ["standard", ".NETStandard,Version=v2.0", false, "unknown"],
      ["core", ".NETCoreApp,Version=v8.0", false, "modern-dotnet"],
      ["standard-r2r", ".NETStandard,Version=v2.0", true, "modern-dotnet"],
    ] as const) {
      const path = join(root, `${name}.dll`);
      await writeFile(
        path,
        buildManagedPeFixture({ targetFramework, readyToRun }),
      );
      const result = await cli.run({
        arguments: ["inspect-managed-artifact", path, "--json"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        operation: "inspect_managed_artifact",
        subject: { local_path: path },
        normalized_result: {
          classification: {
            status: "managed",
            runtime_family: runtimeFamily,
            implementation: readyToRun ? "cil-and-ready-to-run" : "cil",
            evidence: expect.arrayContaining([
              expect.objectContaining({
                code: readyToRun
                  ? "ready-to-run-signature-observed"
                  : "target-framework-observed",
                detail: expect.stringContaining(
                  readyToRun
                    ? "ReadyToRun signature"
                    : name === "standard"
                      ? "does not identify a runtime family"
                      : "names modern .NET",
                ),
                file_offset: expect.any(Number),
              }),
            ]),
          },
          target_frameworks: [targetFramework],
          coverage: { state: "complete", issues: [] },
        },
      });
    }

    const hintedPath = join(root, "ready-to-run-with-runtime-hints.dll");
    const hintedTarget = ".NETFramework,Version=v4.8";
    await writeFile(
      hintedPath,
      buildManagedPeFixture({
        readyToRun: true,
        targetFramework: hintedTarget,
        references: ["UnityEngine.CoreModule"],
      }),
    );
    const hinted = await cli.run({
      arguments: ["inspect-managed-artifact", hintedPath, "--json"],
    });
    expect(hinted.exitCode).toBe(0);
    expect(hinted.json).toMatchObject({
      normalized_result: {
        classification: {
          runtime_family: "modern-dotnet",
          implementation: "cil-and-ready-to-run",
          evidence: expect.arrayContaining([
            expect.objectContaining({
              code: "ready-to-run-signature-observed",
            }),
            expect.objectContaining({ code: "unity-reference-observed" }),
            expect.objectContaining({ code: "target-framework-observed" }),
          ]),
        },
        target_frameworks: [hintedTarget],
      },
    });
  },
);

cliTest(
  "managed CLI qualifies a local nested custom-attribute type name",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-nested-attribute-");
    const path = join(root, "nested-attribute.dll");
    await writeFile(
      path,
      buildManagedPeFixture({
        additionalEmptyTypes: 1,
        customAttributeTypeRaw: (1 << 3) | 2,
        nestedTypes: [[2, 1]],
        typeName: "InnerAttribute",
        typeNamespace: "",
      }),
    );

    const result = await cli.run({
      arguments: ["inspect-managed-artifact", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        attributes: [
          expect.objectContaining({
            type_name: "Empty0+InnerAttribute",
          }),
        ],
        coverage: { state: "complete", issues: [] },
      },
    });
  },
);

cliTest(
  "managed CLI preserves evidence, filters, envelopes, and bounded token counts",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-cli-output-");
    const path = join(root, "fixture.dll");
    await writeFile(
      path,
      buildManagedPeFixture({
        ilBody: Buffer.from([0x0e, 0x17, 0x26, 0x2a]),
      }),
    );
    const argv = ["inspect-managed-members", path, "--json"];
    const result = await cli.run({ arguments: argv });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      operation: "inspect_managed_members",
      provider: { id: "rea-dotnet-static" },
      subject: { local_path: path },
      normalized_result: {
        methods: [
          expect.objectContaining({
            token: expect.any(String),
            body: expect.objectContaining({
              status: "present",
              decoded_instruction_count: 3,
              anchors: [
                {
                  il_offset: 0,
                  opcode: "ldc.i4.1",
                  operand_kind: "none",
                  operand: null,
                },
                {
                  il_offset: 1,
                  opcode: "pop",
                  operand_kind: "none",
                  operand: null,
                },
                {
                  il_offset: 2,
                  opcode: "ret",
                  operand_kind: "none",
                  operand: null,
                },
              ],
            }),
          }),
        ],
      },
    });
    const filtered = await cli.run({
      arguments: [...argv, "--filter-output", "operation", "--full-output"],
    });
    expect(filtered.exitCode).toBe(0);
    expect(filtered.json).toMatchObject({
      ok: true,
      data: "inspect_managed_members",
      meta: {
        command: "inspect-managed-members",
        duration: expect.stringMatching(/^\d+ms$/u),
      },
    });
    const count = await cli.run({
      arguments: [...argv, "--filter-output", "operation", "--token-count"],
    });
    expect(count.exitCode).toBe(0);
    expect(count.stdout).toMatch(/^\d+\n$/u);
    const omittedCount = await cli.run({
      arguments: [...argv, "--filter-output", "toString", "--token-count"],
    });
    expect(omittedCount.exitCode).toBe(0);
    // A missing JSON selection delivers an empty object, which costs one token.
    expect(omittedCount.stdout).toBe("1\n");
    const jsonl = await cli.run({
      arguments: [
        "inspect-managed-members",
        path,
        "--format",
        "jsonl",
        "--filter-output",
        "operation",
      ],
    });
    expect(jsonl.exitCode).toBe(1);
    expect(jsonl.json).toMatchObject({
      $rea: "jsonl/v1",
      type: "error",
      result: {
        code: "invalid_request",
        category: "invalid_input",
        remediation: { action: JSON_LINES_SELECTION_REMEDIATION },
        details: {
          issues: [
            {
              path: ["filter-output"],
              reason: "invalid_value",
              observed: [{ path: ["operation"], shape: "string" }],
            },
          ],
        },
      },
    });
  },
);

cliTest(
  "managed CLI rejects repeated or empty type selections as invalid input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-cli-types-");
    const path = join(root, "fixture.dll");
    await writeFile(path, buildManagedPeFixture());
    for (const [types, message] of [
      [["Fixture.Empty0", "Fixture.Empty0"], "must not repeat a name"],
      [[""], ">=1 characters"],
    ] as const) {
      const result = await cli.run({
        arguments: [
          "inspect-managed-members",
          path,
          ...types.flatMap((type) => ["--type", type]),
          "--json",
        ],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [
          expect.objectContaining({
            path: expect.stringMatching(/^type/u),
            message: expect.stringContaining(message),
          }),
        ],
      });
    }
  },
);

cliTest(
  "managed CLI bounds CIL claims by section virtual ranges",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-virtual-size-");
    for (const virtualSectionSize of [0, 0x800, 0x801, 0x802]) {
      // The two-byte tiny method starts at RVA 0x2800. Its header alone fits
      // at size 0x801, and its full CIL fits exactly at size 0x802.
      const bytes = buildManagedPeFixture({
        virtualSectionSize,
        ilBody: Buffer.from([0x06, 0x2a]),
      });
      const path = join(root, `virtual-${virtualSectionSize}.dll`);
      await writeFile(path, bytes);
      const result = await runFileCli(cli, {
        arguments: ["inspect-managed-members", path, "--json"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result:
          virtualSectionSize === 0
            ? {
                methods: [],
                metadata: { status: "malformed" },
                coverage: { state: "unavailable" },
              }
            : {
                methods: [
                  {
                    rva: 0x2800,
                    body:
                      virtualSectionSize === 0x802
                        ? {
                            status: "present",
                            normalized_il_sha256: expect.any(String),
                          }
                        : {
                            status: "malformed",
                            normalized_il_sha256: null,
                          },
                  },
                ],
                coverage: {
                  state: virtualSectionSize === 0x802 ? "complete" : "partial",
                },
              },
      });
    }
  },
);

cliTest(
  "managed CLI distinguishes raw padding from overlapping virtual sections",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-section-identity-");
    for (const virtualSectionSize of [0x800, 0x900]) {
      const bytes = buildManagedPeFixture({ virtualSectionSize });
      const coff = bytes.readUInt32LE(0x3c) + 4;
      const firstSection = coff + 20 + bytes.readUInt16LE(coff + 16);
      const secondSection = firstSection + 40;
      bytes.writeUInt16LE(2, coff + 2);
      bytes.write(".il", secondSection, "ascii");
      bytes.writeUInt32LE(0x100, secondSection + 8);
      bytes.writeUInt32LE(0x2800, secondSection + 12);
      bytes.writeUInt32LE(0x100, secondSection + 16);
      bytes.writeUInt32LE(0x0a00, secondSection + 20);
      const path = join(root, `sections-${virtualSectionSize}.dll`);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-managed-members", path, "--json"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          methods: [
            {
              rva: 0x2800,
              body:
                virtualSectionSize === 0x800
                  ? {
                      status: "present",
                      file_offset: 0x0a00,
                      normalized_il_sha256: expect.any(String),
                    }
                  : {
                      status: "malformed",
                      normalized_il_sha256: null,
                      issue: expect.stringContaining("ambiguous overlapping"),
                    },
            },
          ],
          coverage: {
            state: virtualSectionSize === 0x800 ? "complete" : "partial",
          },
        },
      });
    }
  },
);

cliTest(
  "managed CLI reports a section table past EOF as invalid input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-cli-sections-");
    const path = join(root, "fixture.dll");
    const bytes = buildManagedPeFixture();
    const pe = bytes.readUInt32LE(0x3c);
    const sections = pe + 24 + bytes.readUInt16LE(pe + 20);
    bytes.writeUInt32LE(bytes.length + 0x1000, sections + 20);
    await writeFile(path, bytes);
    for (const command of [
      "inspect-managed-artifact",
      "inspect-managed-members",
      "inspect-managed-native-boundaries",
    ]) {
      const result = await runFileCli(cli, {
        arguments: [command, path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_format",
              message: expect.stringContaining("pe.section-data"),
            },
          ],
        },
      });
    }
  },
);

cliTest(
  "managed CLI refuses non-PE executables as unsupported targets",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-non-pe-");
    for (const [name, bytes, format] of [
      ["native.elf", elf(2, 1, 0x3e), "elf"],
      ["native.macho", thinMach(0xfeedfacf, 0x01000007), "mach-o"],
    ] as const) {
      const path = join(root, name);
      await writeFile(path, bytes);
      for (const command of [
        "inspect-managed-artifact",
        "inspect-managed-members",
        "inspect-managed-native-boundaries",
      ]) {
        const result = await runFileCli(cli, {
          arguments: [command, path, "--json"],
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.json).toMatchObject({
          code: "unsupported_target",
          category: "unsupported_target",
          retryable: false,
          remediation: {
            action:
              "Select a target supported by this operation or choose an operation supporting the reported target format.",
          },
          details: {
            operation: command.replaceAll("-", "_"),
            path,
            reason: `Managed static triage requires a PE target; observed ${format}.`,
          },
        });
      }
    }
  },
);

cliTest(
  "managed CLI retains target frameworks with multi-byte SerString lengths",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-serstring-");
    for (const length of [0x80, 0x4000]) {
      const targetFramework = "A".repeat(length);
      const path = join(root, `framework-${length}.dll`);
      await writeFile(path, buildManagedPeFixture({ targetFramework }));

      const result = await cli.run({
        arguments: ["inspect-managed-artifact", path, "--json"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        operation: "inspect_managed_artifact",
        normalized_result: {
          target_frameworks: [targetFramework],
          attributes: [
            expect.objectContaining({ decoded_fixed_string: targetFramework }),
          ],
          coverage: { state: "complete", issues: [] },
        },
      });
    }
  },
);

cliTest(
  "managed CLI renders type names and preserves unresolved operands",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-signature-names-");
    const path = join(root, "names.dll");
    await writeFile(
      path,
      buildManagedPeFixture({
        fieldSignature: Buffer.from([0x06, 0x12, 0x04]),
        typeSpecSignatures: [Buffer.from([0x08])],
        methodSignature: Buffer.from([
          0x00, 0x02, 0x12, 0x04, 0x12, 0x09, 0x12, 0x06,
        ]),
        typeReferences: [{ namespace: "System", name: "Uri" }],
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-managed-members", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        signature_resolution: "type-names-v2",
        fields: [
          expect.objectContaining({
            signature: expect.objectContaining({
              field_type: "class:4 (Fixture.Program)",
            }),
          }),
        ],
        methods: [
          expect.objectContaining({
            signature: expect.objectContaining({
              return_type: "class:4 (Fixture.Program)",
              parameter_types: ["class:9 (System.Uri)", "class:6"],
              resolved_sha256: null,
            }),
          }),
        ],
      },
    });
  },
);
