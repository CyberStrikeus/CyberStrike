import { webBundleAnalysisSchema } from "../../../src/domain/webBundleAnalysis.js";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const capturedSource = `
const dynamic = globalThis.options;
document.modelContext.registerTool({
  name: "spread",
  inputSchema: { properties: { ...{ query: {} }, direct: {} } }
});
document.modelContext.registerTool({
  name: "partial",
  inputSchema: { properties: { known: {}, ...dynamic } }
});
document.modelContext.registerTool({
  name: "empty-status", description: "same",
  inputSchema: { properties: dynamic }
});
document.modelContext.registerTool({
  name: "empty-status", description: "same",
  inputSchema: { properties: {} }
});
document.modelContext.registerTool({
  name: "own-after-prototype-setter",
  inputSchema: {
    properties: { own: {} },
    __proto__: { properties: { inherited: {} } }
  }
});
`;

const inspectDeclarations = (document: unknown) => {
  const parsed =
    toolContract("analyze_web_bundle").outputSchema.parse(document);
  const parsedEvidence = parseEvidence(parsed);
  return {
    evidence: parsedEvidence,
    declarations: webBundleAnalysisSchema.parse(parsed.normalized_result)
      .observations.webmcp_declarations,
  };
};

const expectCoverageCases = (
  declarations: ReturnType<typeof inspectDeclarations>["declarations"],
) => {
  expect(declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "spread",
        schema_property_names: ["direct", "query"],
        schema_property_names_coverage: "complete",
      }),
      expect.objectContaining({
        name: "partial",
        schema_property_names: ["known"],
        schema_property_names_coverage: "partial",
      }),
      expect.objectContaining({
        name: "empty-status",
        description: "same",
        schema_property_names: [],
        schema_property_names_coverage: "unknown",
      }),
      expect.objectContaining({
        name: "empty-status",
        description: "same",
        schema_property_names: [],
        schema_property_names_coverage: "complete",
      }),
      expect.objectContaining({
        name: "own-after-prototype-setter",
        schema_property_names: ["own"],
        schema_property_names_coverage: "complete",
      }),
    ]),
  );
  expect(
    declarations.filter(({ name }) => name === "empty-status"),
  ).toHaveLength(2);
};

cliTest(
  "preserves WebMCP schema-name coverage through compiled CLI and stdio MCP",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Debugger.getScriptSource"
          ? { scriptSource: capturedSource }
          : undefined,
    });
    try {
      const contract = toolContract("analyze_web_bundle");
      const cliReply = await cli.run({
        arguments: [
          "analyze-web-bundle",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--json",
        ],
      });
      expect(cliReply.exitCode, cliReply.stdout + cliReply.stderr).toBe(0);
      const cliAnalysis = inspectDeclarations(cliReply.json);
      expectCoverageCases(cliAnalysis.declarations);

      const { call } = await connectLocalToolsMcp();
      const input = {
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        include_script_sources: true,
        fetch_source_maps: false,
      };
      const response = await call(contract.name, input);
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const mcpAnalysis = inspectDeclarations(response.structuredContent);
      expectCoverageCases(mcpAnalysis.declarations);
      expect(mcpAnalysis.evidence.operation).toBe("analyze_web_bundle");
      expect(mcpAnalysis.evidence.authority).toBe("external-service");
      expect(mcpAnalysis.declarations).toEqual(cliAnalysis.declarations);
    } finally {
      await browser.close();
    }
  },
  120_000,
);
