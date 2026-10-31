import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import {
  PE_LOAD_CONFIG_FIXTURE,
  peLoadConfigImage,
} from "../../../src/native/pe/PeLoadConfig.fixture.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

mcpTest(
  "advertises and reads PE TLS/load config without executing or changing the image",
  async ({ mcp }) => {
    const session = createTestBinarySession(() => {
      throw new Error("Must not start a deep provider");
    });
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
    );
    try {
      const definition = (await client.listTools()).tools.find(
        (tool) => tool.name === "inspect_pe_load_config",
      );
      if (definition === undefined)
        throw new Error("Missing advertised contract");
      expect(definition.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      const root = await createTestTempDirectory("rea-pe-config-mcp-");
      const path = join(root, "app.exe");
      const bytes = peLoadConfigImage();
      await writeFile(path, bytes);
      const response = await client.callTool(
        {
          name: "inspect_pe_load_config",
          arguments: { path },
        },
        { toolDefinition: definition },
      );
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = toolContract(
        "inspect_pe_load_config",
      ).outputSchema.parse(response.structuredContent);
      expect(evidence.normalized_result.tls?.callbacks[0]?.file_offset).toBe(
        0x1600,
      );
      expect(
        evidence.normalized_result.load_config?.guard_flags?.flags,
      ).toContain("IMAGE_GUARD_CF_INSTRUMENTED");
      expect(evidence.normalized_result.load_config).toMatchObject({
        dynamic_value_reloc_table_offset:
          PE_LOAD_CONFIG_FIXTURE.dynamicRelocOffset,
        dynamic_value_reloc_table_section:
          PE_LOAD_CONFIG_FIXTURE.dynamicRelocSection,
      });
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
      const bad = await client.callTool(
        {
          name: "inspect_pe_load_config",
          arguments: { path: "relative.exe" },
        },
        { toolDefinition: definition },
      );
      expect(bad.isError).toBe(true);
    } finally {
      await session.close();
    }
  },
  60_000,
);
