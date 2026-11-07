import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, onTestFinished } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  peCertificateFixture,
  pkcs7SignedDataFixture,
} from "../../../src/native/pe/PeCertificates.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest, type TestMcp } from "../../support/mcp/mcpFixture.js";
import { repeatedCertificateSignedData } from "../../fixtures/peCertificateAllowance.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const connect = async (mcp: TestMcp) => {
  const session = createTestBinarySession(() => {
    throw new Error("PE certificate inspection must not start a deep provider");
  });
  onTestFinished(async () => {
    const result = await session.close();
    if (!result.ok) throw result.error;
  });
  const client = await mcp.connect(
    createServer({ kind: "session", session }),
    undefined,
    schemaValidation,
  );
  return client;
};

mcpTest(
  "advertised output schema accepts partial unsigned-attribute evidence",
  async ({ mcp }) => {
    const client = await connect(mcp);
    const advertised = (await client.listTools()).tools.find(
      (tool) => tool.name === "inspect_pe_certificates",
    );
    if (advertised?.outputSchema === undefined)
      throw new Error("PE certificates output schema is missing");
    const schema: Record<string, unknown> = advertised.outputSchema;
    const ajv = schemaValidation.assertions;
    expect(ajv.validateSchema(schema)).toBe(true);
    const root = await createTestTempDirectory("rea-pe-cert-schema-");
    const path = join(root, "timestamped.exe");
    await writeFile(
      path,
      peCertificateFixture(
        false,
        pkcs7SignedDataFixture(undefined, undefined, undefined, [
          [1, 3, 6, 1, 4, 1, 311, 3, 3, 1],
        ]),
      ),
    );
    const result = await client.callTool({
      name: "inspect_pe_certificates",
      arguments: { path },
    });
    expect(result.isError).not.toBe(true);
    expect(
      ajv.validate(schema, result.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
  },
);

mcpTest(
  "advertises inspect_pe_certificates and reads PKCS#7 signer identity",
  async ({ mcp }) => {
    const client = await connect(mcp);
    const advertised = (await client.listTools()).tools.find(
      (tool) => tool.name === "inspect_pe_certificates",
    );
    expect(advertised?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
    });
    const root = await createTestTempDirectory("rea-pe-cert-mcp-");
    const path = join(root, "signed.exe");
    await writeFile(path, peCertificateFixture(true));
    const response = await client.callTool({
      name: "inspect_pe_certificates",
      arguments: { path },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const evidence = toolContract("inspect_pe_certificates").outputSchema.parse(
      response.structuredContent,
    );
    expect(evidence.normalized_result.format).toBe("pe32-plus");
    expect(
      evidence.normalized_result.entries[0]?.pkcs7?.certificates[0]?.serial_hex,
    ).toBe("11223344");
  },
);

mcpTest(
  "requires an absolute path for inspect_pe_certificates",
  async ({ mcp }) => {
    const client = await connect(mcp);
    const response = await client.callTool({
      name: "inspect_pe_certificates",
      arguments: { path: "signed.exe" },
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_pe_certificates" },
    });
  },
);

mcpTest.for([
  { count: 350, reported_limits: { max_decoded_text_bytes: 65_536 } },
  { count: 600, reported_limits: { max_asn1_values: 16_384 } },
])(
  "reports decoder capacity as a nonretryable resource failure for $count certificates",
  async ({ count, reported_limits }, { mcp }) => {
    const client = await connect(mcp);
    const root = await createTestTempDirectory("rea-pe-cert-mcp-budget-");
    const path = join(root, "large.exe");
    await writeFile(
      path,
      peCertificateFixture(false, repeatedCertificateSignedData(count)),
    );
    const response = await client.callTool({
      name: "inspect_pe_certificates",
      arguments: { path },
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: { operation: "inspect_pe_certificates", reported_limits },
    });
  },
);
