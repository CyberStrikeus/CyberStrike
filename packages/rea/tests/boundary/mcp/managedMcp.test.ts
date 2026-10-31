import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import type { BinarySession } from "../../../src/application/binary/BinarySession.js";
import { MANAGED_NATIVE_VERIFICATION_EXAMPLE } from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { ManagedStaticProvider } from "../../../src/dotnet/ManagedStaticProvider.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { elf } from "../../../src/domain/binaryTarget.fixture.js";
import { managedMemberInspectionSchema } from "../../../src/domain/managed/managedArtifact.js";
import { managedMemberComparisonResultSchema } from "../../../src/domain/managed/managedMemberComparison.js";

type ManagedOutputAssertion = Awaited<ReturnType<typeof createOutputAssertion>>;

const fieldTokenFixture = (): Buffer => {
  const il = Buffer.from([0xd0, 1, 0, 0, 0x0a, 0x26, 0x2a]);
  return buildManagedPeFixture({
    targetFramework: null,
    memberRefName: "Counter",
    memberRefParentRaw: 8,
    memberRefSignature: Buffer.from([0x06, 0x08]),
    ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
  });
};

const assertFieldMemberRefToken = async (
  client: Client,
  path: string,
): Promise<void> => {
  const fieldToken = structured(
    await client.callTool({
      name: "inspect_managed_members",
      arguments: { path },
    }),
  );
  const inspection = managedMemberInspectionSchema.parse(
    fieldToken.normalized_result,
  );
  expect(inspection.member_refs[0]?.signature).toMatchObject({
    kind: "field",
    parse_status: "decoded",
  });
  expect(inspection.methods[0]?.body.anchors[0]).toMatchObject({
    opcode: "ldtoken",
    operand_kind: "field",
    operand: "0x0a000001",
  });
};

it("runs every managed static inspection independently of an active native target", async () => {
  const directory = await createTestTempDirectory(
    "rea-managed-independent-mcp-",
  );
  const path = join(directory, "fixture.dll");
  const otherPath = join(directory, "other-fixture.dll");
  const partialPath = join(directory, "partial-method.dll");
  const fieldTokenPath = join(directory, "field-token.dll");
  await writeFile(path, buildManagedPeFixture());
  await writeFile(otherPath, buildManagedPeFixture({ methodName: "Other" }));
  await writeFile(
    partialPath,
    buildManagedPeFixture({
      virtualSectionSize: 0x801,
      ilBody: Buffer.from([0x06, 0x2a]),
    }),
  );
  await writeFile(fieldTokenPath, fieldTokenFixture());
  const session = composeBinarySession(new AnalysisProviderRegistry([]), [
    new ManagedStaticProvider(),
  ]);
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "managed-independent-mcp", version: "1.0.0" },
    serverOptions: {
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
        browserObservationEnabled: false,
        electronObservationEnabled: false,
      }),
    },
  });
  const managedMembersTool = (await client.listTools()).tools.find(
    ({ name }) => name === "inspect_managed_members",
  );
  expect(managedMembersTool?.inputSchema).toMatchObject({
    additionalProperties: false,
  });
  const artifact = structured(
    await client.callTool({
      name: "inspect_managed_artifact",
      arguments: { path },
    }),
  );
  expect(artifact).toMatchObject({
    operation: "inspect_managed_artifact",
    provider: { id: "rea-dotnet-static" },
    subject: { local_path: path, format: "pe" },
  });
  const misspelledPath = await client.callTool({
    name: "inspect_managed_members",
    arguments: { pth: otherPath },
  });
  expect(misspelledPath.isError).toBe(true);
  const invalidSelection = await client.callTool({
    name: "inspect_managed_artifact",
    arguments: { path: join(directory, "missing.dll") },
  });
  expect(invalidSelection.isError).toBe(true);
  const nativePath = join(directory, "native.elf");
  await writeFile(nativePath, elf(2, 1, 0x3e));
  expect(
    parseMcpToolError(
      await client.callTool({
        name: "inspect_managed_artifact",
        arguments: { path: nativePath },
      }),
    ).error,
  ).toMatchObject({
    code: "unsupported_target",
    category: "unsupported_target",
    details: { operation: "inspect_managed_artifact", path: nativePath },
  });
  const members = structured(
    await client.callTool({ name: "inspect_managed_members", arguments: {} }),
  );
  expect(members).toMatchObject({
    operation: "inspect_managed_members",
    provider: { id: "rea-dotnet-static" },
    subject: { local_path: path, format: "pe" },
  });
  const otherArtifact = structured(
    await client.callTool({
      name: "inspect_managed_artifact",
      arguments: { path: otherPath },
    }),
  );
  expect(otherArtifact).toMatchObject({
    subject: { local_path: otherPath, format: "pe" },
  });
  const reusedOtherTarget = structured(
    await client.callTool({ name: "inspect_managed_members", arguments: {} }),
  );
  expect(reusedOtherTarget).toMatchObject({
    operation: "inspect_managed_members",
    subject: { local_path: otherPath, format: "pe" },
  });
  await verifyManagedTypeSelection(client, path, otherPath);
  const boundaries = structured(
    await client.callTool({
      name: "inspect_managed_native_boundaries",
      arguments: { path },
    }),
  );
  expect(boundaries).toMatchObject({
    operation: "inspect_managed_native_boundaries",
    provider: { id: "rea-dotnet-static" },
    subject: { local_path: path, format: "pe" },
  });
  const partial = structured(
    await client.callTool({
      name: "inspect_managed_members",
      arguments: { path: partialPath },
    }),
  );
  expect(partial).toMatchObject({
    subject: { local_path: partialPath, format: "pe" },
    normalized_result: {
      methods: [
        {
          body: {
            status: "malformed",
            normalized_il_sha256: null,
            issue: "Method body leaves file-backed PE section data",
          },
        },
      ],
      coverage: { state: "partial" },
    },
  });
  await assertFieldMemberRefToken(client, fieldTokenPath);
}, 30_000);

it("compares observed call-target names through the managed MCP contract", async () => {
  const directory = await createTestTempDirectory("rea-managed-call-target-");
  const leftPath = join(directory, "left.dll");
  const rightPath = join(directory, "right.dll");
  const samePath = join(directory, "same.dll");
  const il = Buffer.from([0x28, 1, 0, 0, 0x0a, 0x2a]);
  const fixture = (memberRefName: string) =>
    buildManagedPeFixture({
      targetFramework: null,
      memberRefName,
      ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
    });
  await Promise.all([
    writeFile(leftPath, fixture("Clear")),
    writeFile(rightPath, fixture("WriteLine")),
    writeFile(samePath, fixture("Clear")),
  ]);
  const session = composeBinarySession(new AnalysisProviderRegistry([]), [
    new ManagedStaticProvider(),
  ]);
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "managed-call-target-test", version: "1" },
  });
  const outputAssertion = await createOutputAssertion(client);
  const inspect = async (path: string) =>
    inlineEvidence(
      structured(
        await client.callTool({
          name: "inspect_managed_members",
          arguments: { path },
        }),
      ),
    );
  const left = await inspect(leftPath);
  const right = await inspect(rightPath);
  const same = await inspect(samePath);
  for (const [evidence, name] of [
    [left, "Clear"],
    [right, "WriteLine"],
  ] as const) {
    const inspection = managedMemberInspectionSchema.parse(
      evidence.normalized_result,
    );
    expect(inspection.methods[0]?.body.anchors).toMatchObject([
      { opcode: "call", operand_kind: "method" },
      { opcode: "ret", operand_kind: "none" },
    ]);
    expect(inspection.call_edges[0]).toMatchObject({
      target_name: name,
      target_declaring_type:
        "System.Runtime.Versioning.TargetFrameworkAttribute",
    });
  }
  const compare = async (rightEvidence: Record<string, unknown>) =>
    structured(
      await client.callTool({
        name: "compare_managed_members",
        arguments: { left, right: rightEvidence },
      }),
    );
  const changed = inlineEvidence(await compare(right));
  outputAssertion.assert("compare_managed_members", changed);
  const changedReport = managedMemberComparisonResultSchema.parse(
    changed.normalized_result,
  );
  expect(changedReport.methods).toContainEqual(
    expect.objectContaining({
      status: "changed",
      dimensions: expect.arrayContaining(["call-target"]),
    }),
  );
  const unchanged = inlineEvidence(await compare(same));
  expect(
    managedMemberComparisonResultSchema.parse(unchanged.normalized_result)
      .methods,
  ).toContainEqual(expect.objectContaining({ status: "unchanged" }));
});

it("opens a managed PE and executes the managed static provider through MCP", async () => {
  const directory = await createTestTempDirectory("rea-managed-mcp-");
  const path = join(directory, "fixture.exe");
  const rightPath = join(directory, "fixture-renamed.exe");
  await writeFile(path, buildManagedPeFixture());
  await writeFile(rightPath, buildManagedPeFixture({ methodName: "Renamed" }));
  const session = composeBinarySession(new AnalysisProviderRegistry([]), [
    new ManagedStaticProvider(),
  ]);
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "managed-mcp-test", version: "1.0.0" },
    serverOptions: {
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
        browserObservationEnabled: false,
        electronObservationEnabled: false,
      }),
    },
  });
  const assertOutput = await createOutputAssertion(client);
  await verifyManagedCatalogAndNativeWorkflow(client, session, assertOutput);
  const members = await inspectManagedStaticWorkflow(
    client,
    path,
    assertOutput,
  );
  await verifyManagedComparisonAndReconstruction(
    client,
    members,
    rightPath,
    assertOutput,
  );
}, 30_000);

const verifyManagedCatalogAndNativeWorkflow = async (
  client: Client,
  session: BinarySession,
  outputAssertion: ManagedOutputAssertion,
): Promise<void> => {
  expect(outputAssertion.names).toEqual(
    expect.arrayContaining([
      "inspect_managed_artifact",
      "inspect_managed_members",
      "inspect_managed_native_boundaries",
      "compare_managed_members",
      "import_managed_reconstruction",
      "verify_managed_native_boundaries",
    ]),
  );
  for (const evidence of [
    MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
    ...MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations,
  ])
    expect(session.recordEvidence(evidence)).toMatchObject({ ok: true });
  const verified = structured(
    await client.callTool({
      name: "verify_managed_native_boundaries",
      arguments: {
        managed_boundaries:
          MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
        native_observations:
          MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations,
      },
    }),
  );
  await outputAssertion.assert("verify_managed_native_boundaries", verified);
  expect(verified).toMatchObject({
    evidence_id: expect.stringMatching(/^ev_[a-f0-9]{64}$/u),
    normalized_result: {
      summary: { verified: 1 },
      algorithm: { token_to_address_mapping: "not-inferred" },
    },
  });
  const native = MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations[0];
  if (native === undefined) throw new Error("missing native Evidence");
  const wrong = await client.callTool({
    name: "verify_managed_native_boundaries",
    arguments: {
      managed_boundaries: native,
      native_observations: [
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
      ],
    },
  });
  expect(parseMcpToolError(wrong)).toMatchObject({
    error: {
      code: "invalid_request",
      details: {
        issues: [expect.objectContaining({ path: ["managed_boundaries"] })],
      },
    },
  });
};

const inspectManagedStaticWorkflow = async (
  client: Client,
  path: string,
  outputAssertion: ManagedOutputAssertion,
): Promise<Record<string, unknown>> => {
  const inspected = structured(
    await client.callTool({
      name: "inspect_managed_artifact",
      arguments: { path },
    }),
  );
  await outputAssertion.assert("inspect_managed_artifact", inspected);
  expect(inspected).toMatchObject({
    normalized_result: {
      classification: { status: "managed", runtime_family: "modern-dotnet" },
      references: [expect.objectContaining({ name: "System.Runtime" })],
    },
  });
  expect(inlineEvidence(inspected)).toMatchObject({
    operation: "inspect_managed_artifact",
    provider: { id: "rea-dotnet-static" },
    subject: { local_path: path, format: "pe" },
  });
  const members = inlineEvidence(
    structured(
      await client.callTool({
        name: "inspect_managed_members",
        arguments: { path },
      }),
    ),
  );
  await outputAssertion.assert("inspect_managed_members", members);
  expect(members).toMatchObject({
    operation: "inspect_managed_members",
    provider: { id: "rea-dotnet-static" },
    subject: { local_path: path, format: "pe" },
    normalized_result: {
      identity_scope: { token_identity: "build-local" },
      methods: [expect.objectContaining({ token: expect.any(String) })],
      call_edges: [
        expect.objectContaining({ target_token: expect.any(String) }),
      ],
      field_accesses: [
        expect.objectContaining({ field_token: expect.any(String) }),
      ],
    },
  });
  const boundaries = structured(
    await client.callTool({
      name: "inspect_managed_native_boundaries",
      arguments: { path },
    }),
  );
  await outputAssertion.assert("inspect_managed_native_boundaries", boundaries);
  expect(boundaries).toMatchObject({
    normalized_result: {
      identity_scope: { token_identity: "build-local" },
      pinvoke_imports: [],
      native_implementations: [],
    },
  });
  return members;
};

const methodFrom = (members: Record<string, unknown>) =>
  z
    .array(
      z.object({
        token: z.string(),
        signature: z.object({ raw_sha256: z.string() }),
        body: z.object({ normalized_il_sha256: z.string().nullable() }),
      }),
    )
    .parse(
      z.record(z.string(), z.unknown()).parse(members.normalized_result)
        .methods,
    )[0];

const verifyManagedComparisonAndReconstruction = async (
  client: Client,
  members: Record<string, unknown>,
  rightPath: string,
  outputAssertion: ManagedOutputAssertion,
): Promise<void> => {
  await client.callTool({
    name: "open_binary",
    arguments: { path: rightPath },
  });
  const right = inlineEvidence(
    structured(
      await client.callTool({
        name: "inspect_managed_members",
        arguments: {},
      }),
    ),
  );
  const compared = inlineEvidence(
    structured(
      await client.callTool({
        name: "compare_managed_members",
        arguments: {
          left: members,
          right,
        },
      }),
    ),
  );
  await outputAssertion.assert("compare_managed_members", compared);
  expect(compared).toMatchObject({
    operation: "compare_managed_members",
    provider: { id: "rea-dotnet-workflows" },
    confidence: "inferred",
    normalized_result: {
      algorithm: { name_matching: "exact-signature-fallback" },
      matching: { exact_il_signature: 1, exact_signature: 0 },
    },
  });
  const method = methodFrom(members);
  expect(method).toBeDefined();
  if (method === undefined) return;
  await verifyImport(client, members, method);
};

type ManagedMethod = NonNullable<ReturnType<typeof methodFrom>>;

const verifyImport = async (
  client: Client,
  members: Record<string, unknown>,
  method: ManagedMethod,
): Promise<void> => {
  const imported = inlineEvidence(
    structured(
      await client.callTool({
        name: "import_managed_reconstruction",
        arguments: {
          static_members: members,
          decompiler: {
            name: "ilspycmd",
            version: "9.1.0.7988",
            family: "ilspy",
            executable_sha256: null,
            options: ["--type", "Example.Program"],
          },
          methods: [
            {
              token: method.token,
              signature_sha256: method.signature.raw_sha256,
              normalized_il_sha256: method.body.normalized_il_sha256,
              reconstruction: {
                kind: "decompiled-csharp",
                language: "csharp",
                text: "internal static void Main() { }",
              },
            },
          ],
          notes: ["synthetic MCP import"],
        },
      }),
    ),
  );
  expect(imported).toMatchObject({
    operation: "import_managed_reconstruction",
    provider: { id: "rea-dotnet-workflows" },
    confidence: "inferred",
    authority: "analyst-inference",
    normalized_result: {
      phase: "reconstruction-import",
      executed: false,
      decompiler: { name: "ilspycmd", version: "9.1.0.7988", family: "ilspy" },
      summary: { imported_methods: 1, decompiled_csharp_methods: 1 },
      methods: [
        {
          token: method.token,
          signature_sha256: method.signature.raw_sha256,
          normalized_il_sha256: method.body.normalized_il_sha256,
          reconstruction: {
            kind: "decompiled-csharp",
            language: "csharp",
            text_sha256: createHash("sha256")
              .update("internal static void Main() { }")
              .digest("hex"),
          },
          validation: {
            matched_static_member: true,
            exact_build_required: true,
            canonical_observation: false,
            confidence_floor: "inference",
          },
        },
      ],
    },
  });
};

/** Selected type names reach the provider and unmatched names stay visible. */
const verifyManagedTypeSelection = async (
  client: Client,
  path: string,
  otherPath: string,
): Promise<void> => {
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_managed_members",
  );
  if (advertised === undefined) throw new Error("missing managed member tool");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(advertised.inputSchema)).toBe(true);
  const validate = ajv.compile(advertised.inputSchema);
  expect(
    validate({ path, type_names: ["Fixture.Program", "Missing.Type"] }),
  ).toBe(true);
  const selected = structured(
    await client.callTool({
      name: "inspect_managed_members",
      arguments: { path, type_names: ["Fixture.Program", "Missing.Type"] },
    }),
  );
  expect(selected).toMatchObject({
    parameters: { path, type_names: ["Fixture.Program", "Missing.Type"] },
    normalized_result: {
      types: [expect.objectContaining({ full_name: "Fixture.Program" })],
      methods: [expect.objectContaining({ declaring_type: "Fixture.Program" })],
      selection: {
        type_names: ["Fixture.Program", "Missing.Type"],
        unmatched_type_names: ["Missing.Type"],
      },
    },
  });
  const repeatedSelection = await client.callTool({
    name: "inspect_managed_members",
    arguments: { path, type_names: ["Fixture.Program", "Fixture.Program"] },
  });
  expect(parseMcpToolError(repeatedSelection).error.code).toBe(
    "invalid_request",
  );
  const reselectedOtherTarget = structured(
    await client.callTool({
      name: "inspect_managed_artifact",
      arguments: { path: otherPath },
    }),
  );
  expect(reselectedOtherTarget).toMatchObject({
    subject: { local_path: otherPath, format: "pe" },
  });
};

const structured = (result: CallToolResult): Record<string, unknown> => {
  if (result.isError === true) return parseMcpToolError(result);
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null
  )
    throw new Error("missing structured result");
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
};

const createOutputAssertion = async (client: Client) => {
  const tools = (await client.listTools()).tools;
  const ajv = new Ajv2020({
    strict: false,
    validateFormats: false,
  });
  return {
    names: tools.map(({ name }) => name),
    assert: (
      name: Parameters<typeof toolContract>[0],
      output: Record<string, unknown>,
    ): void => {
      const contract = toolContract(name);
      const wire = tools.find((tool) => tool.name === name);
      if (wire?.outputSchema === undefined)
        throw new Error(`Missing advertised output schema for ${name}`);
      const valid = ajv.compile(
        z.record(z.string(), z.unknown()).parse(wire.outputSchema),
      );
      expect(valid(output), `${name} advertised output`).toBe(true);
      expect(contract.outputSchema.safeParse(output).success).toBe(true);
    },
  };
};

const inlineEvidence = (
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  return parseEvidence(value);
};
