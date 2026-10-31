import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { z } from "zod";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerDevicetreeTool } from "../../../src/server/registerDevicetreeTool.js";
import { registerAnalysisViewTool } from "../../../src/server/registerAnalysisViewTool.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { DevicetreeProvider } from "../../../src/firmware/devicetree/DevicetreeProvider.js";
import { DevicetreeService } from "../../../src/application/binaryDiagnostics/DevicetreeService.js";
import { silentLogger } from "../../../src/logger.js";
import type { Evidence } from "../../../src/domain/evidence.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  cells,
  devicetreeFixture,
  dtString,
} from "../../../src/firmware/devicetree/Devicetree.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

const createDtbServer = (
  session: ReturnType<typeof createTestBinarySession>,
) => {
  const service = new DevicetreeService(new DevicetreeProvider());
  onTestFinished(() => service.close());
  const record = (evidence: Evidence) => session.recordEvidence(evidence);
  const lookup = (id: string) => session.evidenceById(id);
  const server = new EvidenceMcpServer(
    { name: "dtb-boundary", version: "1" },
    {},
    record,
    createToolResultDelivery(undefined),
  );
  registerDevicetreeTool(server, service, silentLogger, record, lookup);
  registerAnalysisViewTool(server, silentLogger, lookup, record);
  return server;
};

mcpTest(
  "inspects DTB and pages retained properties without reopening the file",
  async ({ mcp }) => {
    const session = createTestBinarySession(() => {
      throw new Error("DTB inspection must not start an engine");
    });
    const client = await mcp.connect(createDtbServer(session));
    try {
      const schemas = await advertisedMcpToolSchemas(
        client,
        "inspect_devicetree",
      );
      const root = await createTestTempDirectory("rea-dtb-mcp-");
      const path = join(root, "board.dtb");
      await writeFile(path, devicetreeFixture());
      const response = await client.callTool({
        name: "inspect_devicetree",
        arguments: { path, detail: "summary" },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expect(
        schemas.ajv.validate(schemas.outputSchema, response.structuredContent),
        JSON.stringify(schemas.ajv.errors),
      ).toBe(true);
      const result = toolContract("inspect_devicetree").outputSchema.parse(
        response.structuredContent,
      ).normalized_result;
      if (!("parent_evidence_id" in result))
        throw new Error("Expected summary view");
      expect(result.summary.unresolved_reference_count).toBe(1);
      await unlink(path);
      const page = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: result.parent_evidence_id,
          },
          view: {
            kind: "devicetree",
            collection: "properties",
            path: "/serial@1000",
            offset: 0,
            limit: 1,
          },
        },
      });
      expect(page.isError, JSON.stringify(page)).not.toBe(true);
      expect(page.structuredContent).toMatchObject({
        normalized_result: {
          kind: "devicetree",
          items: [
            {
              name: "reg",
              source_index: 0,
              derived: {
                confidence: "derived",
                reg: [{ address: "0x1000", size: "0x100" }],
              },
            },
          ],
        },
      });
    } finally {
      await session.close();
    }
  },
  // Includes SDK schema conversion, dialect validation and two public calls.
  60_000,
);
mcpTest(
  "pages nodes without repeating a large bootargs summary",
  async ({ mcp }) => {
    const session = createTestBinarySession(() => {
      throw new Error("DTB inspection must not start an engine");
    });
    const client = await mcp.connect(createDtbServer(session));
    try {
      const root = await createTestTempDirectory("rea-dtb-mcp-bootargs-");
      const path = join(root, "board.dtb");
      // Quotes double under JSON escaping; the value must not ride on every page.
      const bootargs = '"'.repeat(3 * 1024 * 1024);
      await writeFile(
        path,
        devicetreeFixture({
          name: "",
          children: [
            { name: "chosen", properties: { bootargs: dtString(bootargs) } },
          ],
        }),
      );
      const response = await client.callTool({
        name: "inspect_devicetree",
        arguments: { path, detail: "summary", max_file_bytes: 16777216 },
      });
      // The complete summary exceeds the response budget; its retained parent
      // must still page, so pages cannot repeat the summary strings.
      const { error } = parseMcpToolError(response);
      expect(error.code).toBe("resource_constraint");
      const receipt = session.evidenceById(
        z
          .object({ evidence_id: z.string() })
          .parse(error.details?.reported_limits).evidence_id,
      );
      const evidenceId = z
        .object({ parent_evidence_id: z.string() })
        .parse(receipt?.normalized_result).parent_evidence_id;
      const page = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: evidenceId,
          },
          view: { kind: "devicetree", collection: "nodes", limit: 2 },
        },
      });
      expect(page.isError, JSON.stringify(page).slice(0, 4000)).not.toBe(true);
      expect(JSON.stringify(page).length).toBeLessThan(65536);
      expect(page.structuredContent).toMatchObject({
        normalized_result: {
          kind: "devicetree",
          devicetree: { alias_count: 0, reference_count: 0 },
          items: [{ path: "/" }, { path: "/chosen", property_count: 1 }],
        },
      });
    } finally {
      await session.close();
    }
  },
  60_000,
);
mcpTest(
  "keeps a malformed canonical phandle unresolved in retained reference pages",
  async ({ mcp }) => {
    const session = createTestBinarySession(() => {
      throw new Error("DTB inspection must not start an engine");
    });
    const client = await mcp.connect(createDtbServer(session));
    try {
      const root = await createTestTempDirectory("rea-dtb-mcp-phandle-");
      const path = join(root, "board.dtb");
      await writeFile(
        path,
        devicetreeFixture({
          name: "",
          children: [
            {
              name: "target",
              properties: { phandle: cells(1, 2), "linux,phandle": cells(3) },
            },
            { name: "consumer", properties: { "interrupt-parent": cells(3) } },
          ],
        }),
      );
      const response = await client.callTool({
        name: "inspect_devicetree",
        arguments: { path, detail: "summary" },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const result = toolContract("inspect_devicetree").outputSchema.parse(
        response.structuredContent,
      ).normalized_result;
      if (!("parent_evidence_id" in result))
        throw new Error("Expected summary view");
      expect(result.summary.unresolved_reference_count).toBe(1);
      await unlink(path);
      const page = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: result.parent_evidence_id,
          },
          view: { kind: "devicetree", collection: "references" },
        },
      });
      expect(page.isError, JSON.stringify(page)).not.toBe(true);
      expect(page.structuredContent).toMatchObject({
        normalized_result: {
          devicetree: { unresolved_reference_count: 1 },
          items: [
            {
              source: "/consumer",
              property: "interrupt-parent",
              phandle: 3,
              target: null,
            },
          ],
        },
      });
    } finally {
      await session.close();
    }
  },
  60_000,
);
mcpTest("rejects relative paths and unsupported versions", async ({ mcp }) => {
  const session = createTestBinarySession(() => {
    throw new Error("No engine");
  });
  const client = await mcp.connect(createDtbServer(session));
  try {
    const response = await client.callTool({
      name: "inspect_devicetree",
      arguments: { path: "board.dtb" },
    });
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "invalid_request",
    });
    const root = await createTestTempDirectory("rea-dtb-mcp-version-");
    const path = join(root, "board.dtb");
    await writeFile(path, devicetreeFixture(undefined, 18));
    const unsupported = await client.callTool({
      name: "inspect_devicetree",
      arguments: { path },
    });
    expect(parseMcpToolError(unsupported).error).toMatchObject({
      code: "unsupported_target",
    });
  } finally {
    await session.close();
  }
});
