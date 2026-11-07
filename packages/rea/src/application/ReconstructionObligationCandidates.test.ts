import { javascriptApplicationAnalysisResultSchema } from "../domain/javascript/javascriptApplicationAnalysis.js";
import { JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE } from "../contracts/javascript/javascriptRuntimeReconciliationExample.js";
import {
  createJavaScriptSemanticGraph,
  createJavaScriptSemanticGraphNode,
  JavaScriptSemanticEvidenceContextRegistry,
} from "../domain/javascript/javascriptSemanticGraph.js";
import {
  deriveCandidates,
  proofEvidence,
} from "./ReconstructionObligationLedger.fixture.js";
import { describe, expect, it } from "vitest";

import { createEvidence } from "../domain/evidence.js";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";
import {
  emptyUnverifiedProcessCapture,
  FINALIZED_PROCESS_CAPTURE_EXAMPLE,
} from "../domain/process/processCapture.fixture.js";
import { PROCESS_PROVIDER } from "../domain/process/processEvidenceProvider.js";
import { parseProcessCapture } from "../domain/process/processCaptureParsing.js";
import {
  digestProcessCommitment,
  processScenarioSchema,
  processComparisonContract,
  processScenarioCommitment,
} from "../domain/process/processScenario.js";
import {
  APPLICATION_GRAPH_DIGESTS,
  artifactEvidence,
  buildSyntheticJavaScriptApplicationGraph,
  completeCoverage,
} from "../domain/javascript/javascriptApplicationGraph.fixture.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../domain/javascript/javascriptApplicationGraph.js";
import { MANAGED_WORKFLOW_PROVIDER } from "../domain/investigationProviders.js";
import { createProcessCaptureEvidence } from "./process/ProcessEvidence.js";

const applicationWithUnknowns = (
  keys: readonly string[],
  {
    kind = "unknown",
    label = "Unclassified application boundary",
  }: { kind?: "unknown" | "package"; label?: string } = {},
) => {
  const source = createEvidence(
    undefined,
    { id: "fixture-source", name: "Fixture source", version: "1" },
    {
      operation: "inspect_fixture_source",
      parameters: {},
      result: {},
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
  const base = buildSyntheticJavaScriptApplicationGraph();
  const unknownNodes = keys.map((key) =>
    createJavaScriptApplicationNode({
      kind,
      identity: {
        strategy: "artifact-local-key",
        stability: "artifact-version",
        artifact_sha256: APPLICATION_GRAPH_DIGESTS.asar,
        namespace: "fixture",
        key,
      },
      observations: [
        {
          label,
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "unclassified.js",
          ),
        },
      ],
    }),
  );
  const graph = createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: base.root_node_ids,
    nodes: [...base.nodes, ...unknownNodes],
    edges: base.edges,
    coverage: completeCoverage,
    limitations: base.limitations,
  });
  const application = createEvidence(undefined, MANAGED_WORKFLOW_PROVIDER, {
    predicateType: "rea.managed-application-graph",
    operation: "project_managed_application_graph",
    parameters: {},
    result: {
      projection_id: `magp_${"a".repeat(64)}`,
      root_artifact_sha256: APPLICATION_GRAPH_DIGESTS.asar,
      source_evidence: {
        managed_artifact_evidence_id: source.evidence_id,
        managed_members_evidence_id: null,
        managed_native_boundaries_evidence_id: null,
      },
      summary: {
        graph_nodes: graph.nodes.length,
        graph_edges: graph.edges.length,
        assemblies: 0,
        modules: 0,
        types: 0,
        methods: 0,
        fields: 0,
        pinvoke_imports: 0,
        native_implementations: 0,
      },
      graph,
      coverage: { status: "complete-within-inputs" },
      evidence_links: [source.evidence_id],
      limitations: [],
    },
    confidence: "inferred",
    authority: "analyst-inference",
    evidenceLinks: [source.evidence_id],
  });
  return {
    graph,
    unknownNodes,
    generated: deriveCandidates(
      createEvidenceBundle([source, application]),
      [],
    ),
  };
};

const unknownLimitation = (graphId: string, nodeId: string): string =>
  `Application graph ${graphId} contains unresolved node ${nodeId}; reconstruction obligations remain unknown.`;

describe("reconstruction obligation candidates", () => {
  it("preserves unresolved application nodes as deterministic limitations", () => {
    const { graph, unknownNodes, generated } = applicationWithUnknowns([
      "unclassified-first",
      "unclassified-second",
    ]);

    expect(generated.candidates.length).toBeGreaterThan(0);
    expect([...generated.limitations].sort()).toEqual(
      unknownNodes
        .map((node) => unknownLimitation(graph.graph_id, node.node_id))
        .sort(),
    );
    for (const node of unknownNodes)
      expect(
        generated.candidates.some(
          ({ target }) => target.application_node_id === node.node_id,
        ),
      ).toBe(false);
  });

  it("falls back to a kind-based title when an application node label is blank", () => {
    const {
      unknownNodes: [node],
      generated,
    } = applicationWithUnknowns(["blank-label"], {
      kind: "package",
      label: " ",
    });

    expect(
      generated.candidates.find(
        ({ target }) => target.application_node_id === node?.node_id,
      )?.title,
    ).toBe("package boundary");
  });

  it("does not bind an unknown process image to a packaged artifact obligation", () => {
    const scenario = processScenarioSchema.parse({
      executable: "/path/whose-launch-identity-is-unknown",
    });
    const base = emptyUnverifiedProcessCapture();
    const scenarioProjection = processScenarioCommitment(scenario);
    const comparisonContract = processComparisonContract(scenario);
    const capture = parseProcessCapture({
      ...base,
      normalization: scenario.normalization,
      manifest: {
        ...base.manifest,
        scenario: scenarioProjection,
        comparison_contract: comparisonContract,
        full_scenario_sha256: digestProcessCommitment(scenarioProjection),
        comparison_contract_sha256: digestProcessCommitment(comparisonContract),
        selected_executable_sha256: null,
        executable_sha256: null,
        executable_identity: {
          state: "unknown",
          reason: "Selected executable could not be inspected.",
        },
        normalization_sha256: digestProcessCommitment(scenario.normalization),
      },
    });
    const evidence = createProcessCaptureEvidence(scenario, capture);
    const generated = deriveCandidates(createEvidenceBundle([evidence]), []);

    expect(generated.candidates).toEqual([]);
    expect(generated.limitations).toContain(
      `Process capture ${evidence.evidence_id} has no validated executable artifact identity; packaged-process lifecycle obligation was not bound to an artifact.`,
    );
  });

  it("names the first rejected capture field and the remaining issue count", () => {
    const {
      manifest: { completed_at: _completedAt, ...manifest },
      exit,
      ...rest
    } = FINALIZED_PROCESS_CAPTURE_EXAMPLE;
    const evidence = createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: {
        ...rest,
        manifest,
        exit: {
          ...exit,
          finalization: {
            ...exit.finalization,
            signals: [
              { ...exit.finalization.signals[0], reason: "not allowed here" },
            ],
          },
        },
      },
    });
    const generated = deriveCandidates(createEvidenceBundle([evidence]), []);

    expect(generated.limitations).toEqual([
      `Process Evidence ${evidence.evidence_id} could not generate candidates: at manifest.completed_at: Invalid input: expected string, received undefined (1 more issues)`,
    ]);
  });
});

it("keeps each semantic candidate bound to its own file and authority context", () => {
  const contexts = new JavaScriptSemanticEvidenceContextRegistry();
  const base = javascriptApplicationAnalysisResultSchema.parse(
    JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.normalized_result,
  );
  const sourceRecords = [
    proofEvidence("first-file"),
    proofEvidence("second-file"),
  ];
  const module = createJavaScriptSemanticGraphNode(
    {
      kind: "module",
      identity: {
        artifact_sha256: base.root_artifact_sha256,
        module_path: "app.js",
        source_range: null,
        role_key: "module",
      },
      function_node_id: null,
      application_node_ids: [],
      label: "app.js",
      properties: {},
      evidence: artifactEvidence(base.root_artifact_sha256, "app.js"),
    },
    contexts,
  );
  const requests = sourceRecords.flatMap((source, fileIndex) =>
    [1, 2].map((line) => {
      const sha256 = String(fileIndex + 4).repeat(64);
      const path = `file-${String(fileIndex)}.js`;
      return createJavaScriptSemanticGraphNode(
        {
          kind: "request",
          identity: {
            artifact_sha256: sha256,
            module_path: path,
            source_range: {
              start: { line, column: 0 },
              end: { line, column: 8 },
            },
            role_key: `request-${String(line)}`,
          },
          function_node_id: null,
          application_node_ids: [],
          label: `${path}:${String(line)}`,
          properties: {},
          evidence: {
            ...artifactEvidence(sha256, path, "ast-static-analysis"),
            evidence_ids: [source.evidence_id],
          },
        },
        contexts,
      );
    }),
  );
  const { graph_id: _graphId, ...semantic } = base.semantic_graph;
  const semanticGraph = createJavaScriptSemanticGraph({
    ...semantic,
    root_node_ids: [module.node_id],
    nodes: [module, ...requests],
    evidence_contexts: contexts.contexts,
  });
  const example = JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE;
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
      result: { ...base, semantic_graph: semanticGraph },
      confidence: "derived",
      authority: "shipped-artifact",
      evidenceLinks: sourceRecords.map(({ evidence_id }) => evidence_id),
    },
  );
  const generated = deriveCandidates(
    createEvidenceBundle([...sourceRecords, application]),
    [],
  );
  expect(generated.limitations).toEqual([
    `Semantic graph ${semanticGraph.graph_id} coverage is unknown; omitted candidates remain unknown.`,
    `Semantic graph ${semanticGraph.graph_id}: Semantic relations are unavailable in this minimal example.`,
  ]);
  expect(generated.candidates).toHaveLength(requests.length);
  for (const [index, node] of requests.entries()) {
    const source = sourceRecords[Math.floor(index / 2)];
    expect(
      generated.candidates.find(
        ({ target }) => target.semantic_node_id === node.node_id,
      ),
    ).toMatchObject({
      title: node.label,
      family: "request",
      source_state: "candidate",
      target: {
        artifact_sha256: node.identity.artifact_sha256,
        semantic_node_id: node.node_id,
      },
      authority_references: [
        {
          evidence_id: source?.evidence_id,
          authority: "controlled-replay",
          state: "candidate",
          location: `${semanticGraph.graph_id}/node/${node.node_id}`,
        },
      ],
    });
  }
});

it("falls back to a kind-based title when a semantic node label is blank", () => {
  const contexts = new JavaScriptSemanticEvidenceContextRegistry();
  const base = javascriptApplicationAnalysisResultSchema.parse(
    JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.normalized_result,
  );
  const source = proofEvidence("blank-label-file");
  const module = createJavaScriptSemanticGraphNode(
    {
      kind: "module",
      identity: {
        artifact_sha256: base.root_artifact_sha256,
        module_path: "app.js",
        source_range: null,
        role_key: "module",
      },
      function_node_id: null,
      application_node_ids: [],
      label: "app.js",
      properties: {},
      evidence: artifactEvidence(base.root_artifact_sha256, "app.js"),
    },
    contexts,
  );
  const sha256 = "4".repeat(64);
  const request = createJavaScriptSemanticGraphNode(
    {
      kind: "request",
      identity: {
        artifact_sha256: sha256,
        module_path: "file.js",
        source_range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 8 },
        },
        role_key: "request-1",
      },
      function_node_id: null,
      application_node_ids: [],
      label: " ",
      properties: {},
      evidence: {
        ...artifactEvidence(sha256, "file.js", "ast-static-analysis"),
        evidence_ids: [source.evidence_id],
      },
    },
    contexts,
  );
  const { graph_id: _graphId, ...semantic } = base.semantic_graph;
  const semanticGraph = createJavaScriptSemanticGraph({
    ...semantic,
    root_node_ids: [module.node_id],
    nodes: [module, request],
    evidence_contexts: contexts.contexts,
  });
  const example = JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE;
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
      result: { ...base, semantic_graph: semanticGraph },
      confidence: "derived",
      authority: "shipped-artifact",
      evidenceLinks: [source.evidence_id],
    },
  );
  const generated = deriveCandidates(
    createEvidenceBundle([source, application]),
    [],
  );

  expect(
    generated.candidates.find(
      ({ target }) => target.semantic_node_id === request.node_id,
    )?.title,
  ).toBe("request semantic boundary");
});
