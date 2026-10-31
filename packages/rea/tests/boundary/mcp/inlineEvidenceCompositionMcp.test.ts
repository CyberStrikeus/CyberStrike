import { describe, expect, it } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { connectGhidraMcp } from "./ghidraMcpHarness.js";

describe("inline MCP Evidence composition", () => {
  it("feeds returned function Evidence directly to comparison and matches the bundle", async () => {
    const harness = await connectGhidraMcp("inline-function-evidence");
    const { mcp, session } = harness;
    try {
      const response = await mcp.callTool({
        name: "analyze_function",
        arguments: { procedure: "fixture_main", detail: "complete" },
      });
      expect(response.isError).not.toBe(true);
      const analyzed = toolContract("analyze_function").outputSchema.parse(
        response.structuredContent,
      );
      const comparison = await mcp.callTool({
        name: "compare_functions",
        arguments: { left: analyzed, right: analyzed },
      });
      expect(comparison.isError).not.toBe(true);
      const inline = parseEvidence(analyzed);
      expect(inline.normalized_result).toEqual(analyzed.normalized_result);
      expect(session.evidenceById(inline.evidence_id)).toEqual(inline);
      const compared = toolContract("compare_functions").outputSchema.parse(
        comparison.structuredContent,
      );
      const comparisonEvidence = parseEvidence(compared);
      expect(comparisonEvidence.evidence_links).toContain(inline.evidence_id);
      expect(comparisonEvidence.normalized_result).toEqual(
        compared.normalized_result,
      );
      const bundle = await mcp.callTool({
        name: "get_evidence_bundle",
        arguments: {},
      });
      const exported = toolContract("get_evidence_bundle").outputSchema.parse(
        bundle.structuredContent,
      );
      const retained = parseEvidenceBundle(exported.result);
      expect(retained.records).toContainEqual(inline);
      expect(retained.records).toContainEqual(comparisonEvidence);
    } finally {
      await harness.close();
    }
  });
});
