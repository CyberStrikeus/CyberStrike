import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { createServer } from "../../../src/server/createServer.js";
import { silentLogger } from "../../../src/logger.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { runDirectAnalysis } from "../../../src/application/DirectAnalysis.js";
import { composedWorkflowFixture } from "../../fixtures/composedWorkflowEvidence.js";

it("returns the same consumed atomic provenance through CLI application and MCP boundaries", async () => {
  const cli = await composedWorkflowFixture();
  const direct = parseEvidence(
    await runDirectAnalysis(
      cli.dependencies,
      cli.path,
      "binary_overview",
      {},
    ).then(projectCliAnalysisResult),
  );
  const fixture = await composedWorkflowFixture();
  const server = createServer(
    { kind: "session", session: fixture.session },
    { logger: silentLogger },
  );
  const client = new Client({
    name: "workflow-evidence-links",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: fixture.path },
    });
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
    const response = await client.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const mcp = parseEvidence(response.structuredContent);
    const atomic = fixture.session
      .exportEvidenceBundle()
      .records.filter(
        (record) => record.operation === "read_binary_inventory_summary",
      );
    expect(atomic).toHaveLength(1);
    expect(mcp.evidence_links).toEqual(
      atomic.map((record) => record.evidence_id),
    );
    expect(mcp.evidence_links).toEqual(direct.evidence_links);
    expect(mcp.normalized_result).toEqual(direct.normalized_result);
    const again = await client.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(again.isError).not.toBe(true);
    expect(parseEvidence(again.structuredContent).evidence_links).toEqual(
      mcp.evidence_links,
    );
    expect(
      fixture.calls.filter(
        (operation) => operation === "read_binary_inventory_summary",
      ),
    ).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
  }
});
