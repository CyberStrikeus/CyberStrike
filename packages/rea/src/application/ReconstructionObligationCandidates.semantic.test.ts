import { describe, expect, it } from "vitest";

import { JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE } from "../contracts/javascript/javascriptRuntimeReconciliationExample.js";
import { createEvidence } from "../domain/evidence.js";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";
import { javascriptApplicationAnalysisResultSchema } from "../domain/javascript/javascriptApplicationAnalysis.js";
import { artifactEvidence } from "../domain/javascript/javascriptApplicationGraph.fixture.js";
import {
  createJavaScriptSemanticGraph,
  createJavaScriptSemanticGraphNode,
  createJavaScriptSemanticGraphUnknown,
  JavaScriptSemanticEvidenceContextRegistry,
} from "../domain/javascript/javascriptSemanticGraph.js";
import {
  build,
  deriveCandidates,
  request,
} from "./ReconstructionObligationLedger.fixture.js";

const semanticApplication = (
  frontiers: readonly {
    detail: string;
    binding: "event" | "module" | "candidate" | "family";
  }[] = [],
  incomplete = false,
) => {
  const example = JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE;
  const base = javascriptApplicationAnalysisResultSchema.parse(
    example.normalized_result,
  );
  const contexts = new JavaScriptSemanticEvidenceContextRegistry();
  for (const context of base.semantic_graph.evidence_contexts)
    contexts.adopt(context);
  const module = base.semantic_graph.nodes[0]!;
  const evidence = artifactEvidence(base.root_artifact_sha256, "renderer.js");
  const event = createJavaScriptSemanticGraphNode(
    {
      kind: "event",
      identity: { ...module.identity, role_key: "event" },
      function_node_id: null,
      application_node_ids: [],
      label: "Event boundary",
      properties: {},
      evidence,
    },
    contexts,
  );
  const unknowns = frontiers.map(({ detail, binding }) =>
    createJavaScriptSemanticGraphUnknown(
      {
        node_id:
          binding === "event"
            ? event.node_id
            : binding === "module"
              ? module.node_id
              : null,
        family: "event",
        relation_kinds: ["registers-listener"],
        reason: "ambiguous-target",
        detail,
        candidate_node_ids: binding === "candidate" ? [event.node_id] : [],
        evidence: {
          ...evidence,
          authority: "unknown",
          state: "unknown",
          confidence: "unknown",
          limitations: [detail],
        },
      },
      contexts,
    ),
  );
  const { graph_id: _graphId, ...semantic } = base.semantic_graph;
  const graph = createJavaScriptSemanticGraph({
    ...semantic,
    nodes: [module, event],
    evidence_contexts: contexts.contexts,
    unknowns,
    coverage: {
      ...semantic.coverage,
      status: unknowns.length > 0 || incomplete ? "unknown" : "complete",
      families: semantic.coverage.families.map((family) => ({
        ...family,
        status:
          family.family === "event" && (unknowns.length > 0 || incomplete)
            ? "unknown"
            : "complete",
        unknown_ids:
          family.family === "event"
            ? unknowns.map(({ unknown_id }) => unknown_id).sort()
            : [],
      })),
    },
    limitations:
      incomplete || unknowns.length > 0
        ? ["Event source was not fully examined."]
        : [],
  });
  const application = createEvidence(
    {
      path: base.input_path,
      sha256: base.root_artifact_sha256,
      format: base.format,
    },
    example.provider,
    {
      predicateType: example.predicate_type,
      operation: example.operation,
      parameters: example.parameters,
      result: { ...base, semantic_graph: graph },
      confidence: "derived",
      authority: "shipped-artifact",
    },
  );
  return { application, graph, event, unknowns };
};

describe("semantic uncertainty at the obligation candidate boundary", () => {
  it("binds only definite node unknowns and retains every other frontier as a limitation", () => {
    const source = semanticApplication([
      { detail: "Dynamic event name.", binding: "event" },
      { detail: "Module has no obligation policy.", binding: "module" },
      { detail: "Possible event target only.", binding: "candidate" },
      { detail: "Unknown event family frontier.", binding: "family" },
    ]);
    const ledger = build(request([source.application]));
    expect(ledger.obligations).toHaveLength(1);
    const boundId = source.unknowns[0]!.unknown_id;
    expect(ledger.obligations[0]).toMatchObject({
      family: "event",
      residual_unknown_ids: [boundId],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "residual-unknown" }),
      ]),
    });
    expect(ledger.reports.residual_unknown_ids).toEqual([boundId]);
    expect(ledger.coverage.status).toBe("partial");
    for (const unknown of source.unknowns)
      expect(ledger.limitations).toContain(
        `Semantic graph ${source.graph.graph_id} contains unresolved ${unknown.family} unknown ${unknown.unknown_id}: ${unknown.detail}`,
      );
  });

  it("unions repeated generated observations without losing or duplicating residual unknowns", () => {
    const first = semanticApplication([
      { detail: "First frontier.", binding: "event" },
      { detail: "Shared frontier.", binding: "event" },
    ]);
    const second = semanticApplication([
      { detail: "Second frontier.", binding: "event" },
      { detail: "Shared frontier.", binding: "event" },
    ]);
    const complete = semanticApplication();
    const records = [
      first.application,
      second.application,
      complete.application,
    ];
    const expected = [
      ...new Set(
        [...first.unknowns, ...second.unknowns].map(
          ({ unknown_id }) => unknown_id,
        ),
      ),
    ].sort();
    for (const order of [records, [...records].reverse()]) {
      const generated = deriveCandidates(createEvidenceBundle(order), []);
      expect(generated.candidates).toHaveLength(1);
      expect(generated.candidates[0]).toMatchObject({
        definitionCount: 1,
        residual_unknown_ids: expected,
      });
      expect(generated.candidates[0]!.authority_references).toHaveLength(3);
      const ledger = build(request(order));
      expect(ledger.reports.residual_unknown_ids).toEqual(expected);
      expect(
        ledger.obligations[0]!.diagnostics.map(({ code }) => code),
      ).not.toContain("duplicate-definition");
    }
  });

  it("retains incomplete coverage and source limitations even without explicit unknown records", () => {
    const source = semanticApplication([], true);
    const ledger = build(request([source.application]));
    expect(ledger.obligations).toHaveLength(1);
    expect(ledger.reports.residual_unknown_ids).toEqual([]);
    expect(ledger.coverage.status).toBe("partial");
    expect(ledger.limitations).toEqual([
      `Semantic graph ${source.graph.graph_id} coverage is unknown; omitted candidates remain unknown.`,
      `Semantic graph ${source.graph.graph_id}: Event source was not fully examined.`,
    ]);
  });

  it("keeps a complete semantic source complete without fabricating uncertainty", () => {
    const { application } = semanticApplication();
    const ledger = build(request([application]));
    expect(ledger.obligations).toHaveLength(1);
    expect(ledger.obligations[0]!.residual_unknown_ids).toEqual([]);
    expect(ledger.reports.residual_unknown_ids).toEqual([]);
    expect(ledger.limitations).toEqual([]);
    expect(ledger.coverage.status).toBe("complete");
    expect(ledger.status).toBe("open");
  });
});
