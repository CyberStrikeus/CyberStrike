import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  assertRecoveryCleanup,
  recoveryFixture,
} from "../../fixtures/javascript-recovery/provider.js";

it
  .skipIf(process.platform !== "linux" || process.arch !== "x64")
  .each([false, true])(
  "advertises and executes recovery through the named SDK contract (multiple inputs: %s)",
  async (multiple) => {
    const fixture = await recoveryFixture();
    const session = createTestBinarySession(() => {
      throw new Error("no binary provider should start");
    });
    const server = createServer(
      { kind: "session", session },
      {
        javascriptRecovery: fixture.provider,
      },
    );
    const client = new Client({ name: "recovery-contract", version: "1" });
    onTestFinished(async () => {
      await client.close();
      await server.close();
      await session.close();
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    const advertised = tools.tools.find(
      (tool) => tool.name === "recover_javascript_sources",
    );
    if (advertised === undefined || advertised.outputSchema === undefined)
      throw new Error("recovery tool must advertise both schemas");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const inputSchema: Record<string, unknown> = advertised.inputSchema;
    const outputSchema: Record<string, unknown> = advertised.outputSchema;
    expect(ajv.validateSchema(inputSchema)).toBe(true);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    const additional = join(fixture.root, "chunk.js");
    if (multiple) await writeFile(additional, "export const chunk = 1;");
    const args = {
      path: fixture.path,
      output_directory: fixture.output,
      ...(multiple ? { additional_paths: [additional] } : {}),
    };
    expect(ajv.validate(inputSchema, args)).toBe(true);
    const response = await client.callTool({
      name: "recover_javascript_sources",
      arguments: args,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(
      ajv.validate(outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const parsed = toolContract(
      "recover_javascript_sources",
    ).outputSchema.parse(response.structuredContent);
    const evidence = parseEvidence(parsed);
    expect(evidence).toMatchObject({
      operation: "recover_javascript_sources",
      confidence: "derived",
      authority: "shipped-artifact",
      parameters: {
        ...args,
        extraction_mode: "structural",
        rewrite_level: "standard",
      },
    });
    expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
    await assertRecoveryCleanup(fixture.launches);
  },
);

it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "reports denied selected-input access before launching recovery",
  async (context) => {
    const fixture = await recoveryFixture();
    onTestFinished(() => chmod(fixture.path, 0o600));
    await chmod(fixture.path, 0);
    const denial = await readFile(fixture.path).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    if (denial === undefined) context.skip();
    expect(denial).toMatchObject({ code: "EACCES" });
    const session = createTestBinarySession(() => {
      throw new Error("no binary provider should start");
    });
    const server = createServer(
      { kind: "session", session },
      {
        javascriptRecovery: fixture.provider,
      },
    );
    const client = new Client({ name: "recovery-denied", version: "1" });
    onTestFinished(async () => {
      await client.close();
      await server.close();
      await session.close();
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "recover_javascript_sources",
      arguments: { path: fixture.path, output_directory: fixture.output },
    });
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "access_denied",
        category: "unavailable",
        details: {
          operation: "recover_javascript_sources",
          path: fixture.path,
          system_code: "EACCES",
          boundary: "filesystem-read",
        },
      },
    });
    expect(fixture.launches).toEqual([]);
  },
);
