import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  peImportImage,
  peImportDirectoryAtRva,
  peImportDirectoryMappingStops,
} from "../../fixtures/binaryDiagnostics/peImports.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest, type TestMcp } from "../../support/mcp/mcpFixture.js";

const connect = async (mcp: TestMcp) => {
  const session = createTestBinarySession(() => {
    throw new Error("PE import inspection must not start a deep provider");
  });
  const client = await mcp.connect(createServer({ kind: "session", session }));
  return { client, session };
};

mcpTest(
  "advertises inspect_pe_imports and reads named imports",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const {
        toolDefinition: advertised,
        ajv,
        outputSchema,
      } = await advertisedMcpToolSchemas(client, "inspect_pe_imports");
      expect(advertised?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      const root = await createTestTempDirectory("rea-pe-imports-mcp-");
      const path = join(root, "app.exe");
      await writeFile(path, peImportImage({ bits: 64 }));
      const response = await client.callTool({
        name: "inspect_pe_imports",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(
        ajv.validate(outputSchema, response.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      const evidence = toolContract("inspect_pe_imports").outputSchema.parse(
        response.structuredContent,
      );
      expect(evidence.normalized_result.format).toBe("pe32-plus");
      expect(evidence.normalized_result.imports[0]?.name).toBe("KERNEL32.dll");
      expect(
        evidence.normalized_result.imports[0]?.functions.map((row) => row.name),
      ).toEqual(["GetProcAddress", "ExitProcess"]);
      for (const [label, bytes, rva] of [
        ["rva", peImportDirectoryAtRva("standard", 0xfffffff0), 0xfffffff0],
        ["mapping", peImportDirectoryMappingStops("standard", 0), 0x40000000],
      ] as const) {
        const partialPath = join(root, `invalid-first-descriptor-${label}.exe`);
        await writeFile(partialPath, bytes);
        const partial = await client.callTool({
          name: "inspect_pe_imports",
          arguments: { path: partialPath },
        });
        expect(partial.isError, JSON.stringify(partial.content)).not.toBe(true);
        expect(
          ajv.validate(outputSchema, partial.structuredContent),
          JSON.stringify(ajv.errors),
        ).toBe(true);
        const partialReport = toolContract(
          "inspect_pe_imports",
        ).outputSchema.parse(partial.structuredContent).normalized_result;
        expect(partialReport.import_directory).toMatchObject({
          rva,
          locations: [],
        });
        expect(partialReport.coverage.status).toBe("partial");
        expect(partialReport.imphash.md5).toBeNull();
      }
    } finally {
      await session.close();
    }
  },
);

mcpTest("requires an absolute path for inspect_pe_imports", async ({ mcp }) => {
  const { client, session } = await connect(mcp);
  try {
    const response = await client.callTool({
      name: "inspect_pe_imports",
      arguments: { path: "app.exe" },
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_pe_imports" },
    });
  } finally {
    await session.close();
  }
});
