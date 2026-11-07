import { createEvidence } from "../../domain/evidence.js";
import { createWebTextArtifact } from "../../domain/webContentArtifact.js";
import { analyzeJavaScriptSemantics } from "../../domain/javascript/javascriptSemanticAnalysis.js";
import { projectJavaScriptExportReturnShapes } from "../../domain/javascript/javascriptExportReturnShapeProjection.js";
import {
  completeApplicationCoverage,
  partialApplicationCoverage,
} from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../../domain/javascript/javascriptApplicationGraph.js";
import {
  createJavaScriptSemanticGraph,
  createJavaScriptSemanticGraphNode,
  JavaScriptSemanticEvidenceContextRegistry,
} from "../../domain/javascript/javascriptSemanticGraph.js";
import { JAVASCRIPT_SEMANTIC_RELATION_FAMILIES } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import { javascriptApplicationAnalysisResultSchema } from "../../domain/javascript/javascriptApplicationAnalysis.js";

// Inventory identities/counters captured from real analysis of these two sources.
// The inline example retains only source-derived export facts, with explicit gaps.
const captures = {
  count: {
    input_path: "/examples/javascript-export-presence/left",
    root_artifact_sha256:
      "5005ebc2f35719a2fc014f19a81c669f3a1ab471b7245ef6985a111b6845a747",
    inventory_manifest_id:
      "agm_f30ded9a83d43a3980417bbe63dfad569e83386f243c4d6a01af0166372cb9e6",
    inventory_graph_sha256:
      "4b8aceaf67e43fd8317ec1f5fd1df5235f8fa402335accf011683e008c6bc62c",
    integrity_contradictions: [],
  },
  total: {
    input_path: "/examples/javascript-export-presence/right",
    root_artifact_sha256:
      "269ae72a601ad5ac02f1c2dda6ff9accffa2d2e4f4a9e406facee0d5a78a5377",
    inventory_manifest_id:
      "agm_d3ceaa1af38fb3474070ca25c0d4644282e5fb7d5824cee3e3a81391481e9fc1",
    inventory_graph_sha256:
      "3e9bc926951480c35385efe5650d9d781631bd74c37a523d543b5fbe06b01ce6",
    integrity_contradictions: [],
  },
};
const summary = {
  browser_windows: 0,
  explicit_web_preferences: 0,
  preload_entrypoints: 0,
  context_bridge_apis: 0,
  exposed_api_members: 0,
  ipc: {
    operations: 0,
    literal_channels: 0,
    dynamic_channel_operations: 0,
    renderer_transmissions: 0,
    renderer_listeners: 0,
    main_handlers: 0,
    paired_renderer_transmissions: 0,
    ambiguous_renderer_transmissions: 0,
    unpaired_literal_renderer_transmissions: 0,
  },
  sender_validation_observations: 0,
  utility_processes: 0,
  resolved_utility_entrypoints: 0,
  native_addon_bindings: 0,
  resolved_native_addon_bindings: 0,
  protocol_registrations: 0,
};
const statistics = {
  relevant_files: 1,
  nested_asar_containers: 0,
  text_bytes_read: 60,
  invalid_utf8_files: 0,
  parsed_javascript_files: 1,
  skipped_javascript_files: 0,
  visited_ast_nodes: 12,
  findings: 1,
  modules: 0,
  parse_failures: 0,
};
const modulePath = "parser.mjs";
const limitations = [
  "This example retains export and return-shape facts only; other application and semantic relationships are omitted.",
];

const exampleEvidence = (property: "count" | "total") => {
  const metadata = captures[property];
  const source = `export default () => ({ kind: "results", ${property}: query() });\n`;
  const artifact = createWebTextArtifact(source, "text/javascript");
  const ir = analyzeJavaScriptSemantics(source);
  const link = ir.moduleLinks.find(
    ({ exportedName }) => exportedName === "default",
  );
  if (link === undefined)
    throw new Error("Example source must define a default export");
  const coverage =
    ir.coverage.status === "complete"
      ? completeApplicationCoverage()
      : partialApplicationCoverage([], ir.coverage.omittedCount);
  const projection = projectJavaScriptExportReturnShapes({
    ir,
    link,
    modulePath,
    baseCoverage: coverage,
  });
  if (projection === null)
    throw new Error("Example export must retain return shapes");
  const evidence = {
    artifact: {
      available: true,
      artifact_id: `art_${artifact.sha256}`,
      sha256: artifact.sha256,
    },
    location: {
      available: true,
      value: { kind: "source-range", source: modulePath, ...link.location },
    },
    extractor: {
      name: "rea-javascript-artifact-reconstruction",
      version: "1",
      operation: "recover-module-export",
      executable_sha256: null,
    },
    coverage,
    limitations: ir.limitations,
    evidence_ids: [],
  };
  const exported = createJavaScriptApplicationNode({
    kind: "javascript-module",
    identity: {
      strategy: "artifact-local-key",
      stability: "artifact-version",
      artifact_sha256: artifact.sha256,
      namespace: "module-export",
      key: `${metadata.root_artifact_sha256}:${modulePath}:default`,
    },
    observations: [
      {
        label: `${modulePath}:default`,
        properties: {
          semantic_role: "export-binding",
          module_path: modulePath,
          relationship_kind: link.kind,
          exported_name: link.exportedName,
          local_name: link.localName,
          imported_name: link.importedName,
          declared_specifier: link.specifier,
        },
        evidence: {
          ...evidence,
          authority: "ast-static-analysis",
          state: "observed",
          confidence: "exact",
        },
      },
      {
        label: `${modulePath}:default:return-shapes`,
        properties: projection.properties,
        evidence: {
          ...evidence,
          authority: "static-relationship-inference",
          state: "inferred",
          confidence: "high",
          location: {
            available: true,
            value: {
              kind: "source-range",
              source: modulePath,
              ...projection.range,
            },
          },
          extractor: {
            ...evidence.extractor,
            operation: "recover-export-return-shapes",
          },
          coverage: projection.coverage,
          limitations: projection.limitations,
        },
      },
    ],
  });
  const graph = createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [exported.node_id],
    nodes: [exported],
    edges: [],
    coverage: partialApplicationCoverage([], null),
    limitations,
  });
  const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
  const module = createJavaScriptSemanticGraphNode(
    {
      kind: "module",
      identity: {
        artifact_sha256: artifact.sha256,
        module_path: modulePath,
        source_range: null,
        role_key: "example-module",
      },
      function_node_id: null,
      application_node_ids: [exported.node_id],
      label: modulePath,
      properties: {},
      evidence: {
        ...evidence,
        authority: "ast-static-analysis",
        state: "observed",
        confidence: "exact",
      },
    },
    evidenceContexts,
  );
  const semanticGraph = createJavaScriptSemanticGraph({
    schema: "JavaScriptSemanticRelationGraph",
    root_artifact_sha256: metadata.root_artifact_sha256,
    application_graph_id: graph.graph_id,
    root_node_ids: [module.node_id],
    evidence_contexts: evidenceContexts.contexts,
    nodes: [module],
    relations: [],
    fingerprints: [],
    unknowns: [],
    coverage: {
      status: "unknown",
      truncated: false,
      omitted_nodes: null,
      omitted_relations: null,
      limits: [],
      families: JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.map((family) => ({
        family,
        status: "unknown",
        retained_relations: 0,
        omitted_relations: null,
        unknown_ids: [],
      })),
    },
    limitations,
  });
  const result = javascriptApplicationAnalysisResultSchema.parse({
    ...metadata,
    format: "directory",
    graph,
    semantic_graph: semanticGraph,
    summary,
    statistics,
    limitations,
  });
  return createEvidence(
    {
      path: result.input_path,
      sha256: result.root_artifact_sha256,
      format: "directory",
    },
    {
      id: "rea-javascript-application",
      name: "REA JavaScript application analyzer",
      version: "1",
    },
    {
      predicateType: "rea.javascript-application-analysis",
      operation: "analyze_javascript_application",
      parameters: {},
      result,
      confidence: "derived",
      authority: "shipped-artifact",
      limitations,
    },
  );
};

/** Source-derived tagged exports with known presence and unresolved values. */
export const JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE = {
  left: exampleEvidence("count"),
  right: exampleEvidence("total"),
  left_module_path: modulePath,
  left_export_name: "default",
  right_module_path: modulePath,
  right_export_name: "default",
};
