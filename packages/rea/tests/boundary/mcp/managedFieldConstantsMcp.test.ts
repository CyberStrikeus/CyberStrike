import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { buildManagedPeFixture } from "../../../scripts/fixtures/managed/pe.mjs";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { ManagedStaticProvider } from "../../../src/dotnet/ManagedStaticProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { managedMemberInspectionSchema } from "../../../src/domain/managed/managedArtifact.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("retains lossless field constants in MCP Evidence and pages them after the source disappears", async () => {
  const root = await createTestTempDirectory("rea-field-default-");
  const path = join(root, "constants.dll");
  await writeFile(
    path,
    buildManagedPeFixture({
      fields: [
        { name: "Limit", flags: 0x8056, signature: Buffer.from([6, 0x0b]) },
      ],
      constants: [
        { typeCode: 0x0b, value: Buffer.from("ffffffffffffffff", "hex") },
      ],
    }),
  );
  const harness = await createApplicationMcpHarness({
    session: composeBinarySession(new AnalysisProviderRegistry([]), [
      new ManagedStaticProvider(),
    ]),
  });
  onTestFinished(harness.close);
  const { client } = harness;
  const tools = (await client.listTools()).tools;
  const definition = tools.find(
    (tool) => tool.name === "inspect_managed_members",
  );
  if (definition?.outputSchema === undefined)
    throw new Error("Member output schema missing");
  const outputSchema: Record<string, unknown> = definition.outputSchema;
  const reply = await client.callTool(
    { name: definition.name, arguments: { path, detail: "complete" } },
    { toolDefinition: definition },
  );
  expect(reply.isError).not.toBe(true);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(
    ajv.validate(outputSchema, reply.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const parent = parseEvidence(reply.structuredContent);
  const { fields } = managedMemberInspectionSchema.parse(
    parent.normalized_result,
  );
  expect(fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        constant: expect.objectContaining({
          state: "decoded",
          element_type: "u8",
          value: "18446744073709551615",
        }),
      }),
    ]),
  );
  await unlink(path);
  const viewTool = tools.find((tool) => tool.name === "inspect_analysis_view");
  if (viewTool?.outputSchema === undefined)
    throw new Error("View output schema missing");
  const viewOutputSchema: Record<string, unknown> = viewTool.outputSchema;
  const request = {
    source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
    view: {
      kind: "managed-members",
      collection: "fields",
      fields: ["constant"],
      offset: 0,
      limit: 1,
    },
  };
  expect(
    ajv.validate(viewTool.inputSchema, request),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const page = await client.callTool(
    { name: viewTool.name, arguments: request },
    { toolDefinition: viewTool },
  );
  expect(page.isError).not.toBe(true);
  expect(
    ajv.validate(viewOutputSchema, page.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const view = parseEvidence(page.structuredContent).normalized_result;
  expect(view).toMatchObject({
    parent_evidence_id: parent.evidence_id,
    page: {
      rows: [
        {
          source_index: 0,
          token: "0x04000001",
          constant: { value: "18446744073709551615" },
        },
      ],
    },
  });
});
