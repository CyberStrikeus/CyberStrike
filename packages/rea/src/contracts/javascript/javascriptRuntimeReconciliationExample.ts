import { createEvidence } from "../../domain/evidence.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../../domain/javascript/javascriptApplicationGraph.js";
import { createWebTextArtifact } from "../../domain/webContentArtifact.js";
import {
  createJavaScriptSemanticGraph,
  createJavaScriptSemanticGraphNode,
  JavaScriptSemanticEvidenceContextRegistry,
} from "../../domain/javascript/javascriptSemanticGraph.js";
import { JAVASCRIPT_SEMANTIC_RELATION_FAMILIES } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";

const applicationSha256 = "1".repeat(64);
const script = createWebTextArtifact(
  "export const example = true;\n",
  "text/javascript",
);
const inputPath = "/Applications/Example.app/Contents/Resources/app";
const scriptPath = `${inputPath}/renderer.js`;

const completeCoverage = {
  status: "complete" as const,
  truncated: false,
  omitted_count: 0,
  limits: [],
};
const graphEvidence = {
  authority: "artifact-bytes" as const,
  state: "observed" as const,
  confidence: "exact" as const,
  artifact: {
    available: true as const,
    artifact_id: `art_${script.sha256}`,
    sha256: script.sha256,
  },
  location: {
    available: true as const,
    value: { kind: "artifact-path" as const, path: "renderer.js" },
  },
  extractor: {
    name: "rea-javascript-application",
    version: "1",
    operation: "inventory-relevant-file",
    executable_sha256: null,
  },
  coverage: completeCoverage,
  limitations: [],
  evidence_ids: [],
};
const asset = createJavaScriptApplicationNode({
  kind: "javascript-asset",
  identity: {
    strategy: "content-digest",
    stability: "global-exact",
    sha256: script.sha256,
  },
  observations: [
    {
      label: "renderer.js",
      properties: { path: "renderer.js", bytes: script.bytes },
      evidence: graphEvidence,
    },
  ],
});
const graph = createJavaScriptApplicationGraph({
  schema: "JavaScriptApplicationGraph",
  root_node_ids: [asset.node_id],
  nodes: [asset],
  edges: [],
  coverage: completeCoverage,
  limitations: [],
});
const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
const semanticNode = createJavaScriptSemanticGraphNode(
  {
    kind: "module",
    identity: {
      artifact_sha256: applicationSha256,
      module_path: "renderer.js",
      source_range: null,
      role_key: "example-module",
    },
    function_node_id: null,
    application_node_ids: [asset.node_id],
    label: "renderer.js",
    properties: {},
    evidence: graphEvidence,
  },
  evidenceContexts,
);
const semanticGraph = createJavaScriptSemanticGraph({
  schema: "JavaScriptSemanticRelationGraph",
  root_artifact_sha256: applicationSha256,
  application_graph_id: graph.graph_id,
  root_node_ids: [semanticNode.node_id],
  evidence_contexts: evidenceContexts.contexts,
  nodes: [semanticNode],
  relations: [],
  fingerprints: [],
  unknowns: [],
  coverage: {
    status: "unknown",
    truncated: false,
    omitted_nodes: 0,
    omitted_relations: 0,
    limits: [],
    families: JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.map((family) => ({
      family,
      status: "unknown" as const,
      retained_relations: 0,
      omitted_relations: 0,
      unknown_ids: [],
    })),
  },
  limitations: ["Semantic relations are unavailable in this minimal example."],
});

/** Minimal valid static application Evidence for graph workflow examples. */
export const JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE = createEvidence(
  { path: inputPath, sha256: applicationSha256, format: "directory" },
  {
    id: "rea-javascript-application",
    name: "REA JavaScript application analyzer",
    version: "1",
  },
  {
    predicateType: "rea.javascript-application-analysis",
    operation: "analyze_javascript_application",
    parameters: {},
    result: {
      input_path: inputPath,
      format: "directory",
      root_artifact_sha256: applicationSha256,
      inventory_manifest_id: `agm_${"2".repeat(64)}`,
      inventory_graph_sha256: "3".repeat(64),
      integrity_contradictions: [],
      graph,
      semantic_graph: semanticGraph,
      summary: {
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
      },
      statistics: {
        relevant_files: 1,
        nested_asar_containers: 0,
        text_bytes_read: script.bytes,
        invalid_utf8_files: 0,
        parsed_javascript_files: 1,
        skipped_javascript_files: 0,
        visited_ast_nodes: 7,
        findings: 1,
        modules: 0,
        parse_failures: 0,
      },
      limitations: [],
    },
    confidence: "derived",
    authority: "shipped-artifact",
  },
);

const runtimeEvidence = createEvidence(
  undefined,
  {
    id: "rea-cdp-electron",
    name: "REA Electron file-page CDP observation provider",
    version: "1",
  },
  {
    predicateType: "rea.electron-page-inspection",
    operation: "inspect_electron_page",
    parameters: {
      cdp_endpoint: "http://127.0.0.1:9223",
      target_id: "example-target",
      include_script_sources: true,
    },
    result: {
      browser: {
        product: "Electron/example",
        protocol_version: "1.3",
        revision: "example",
        user_agent: "Electron example",
        js_version: "1",
      },
      target: {
        target_id: "example-target",
        type: "page",
        title: "Example",
        file_path: `${inputPath}/index.html`,
        attached: false,
      },
      capture_window: {
        started_at: "2026-07-15T00:00:00.000Z",
        ended_at: "2026-07-15T00:00:00.100Z",
        observation_ms: 100,
      },
      completeness: browserCompleteness(),
      frames: [],
      dom: { total_nodes: 0, nodes: [] },
      scripts: {
        total: 1,
        items: [
          {
            script_key: `electron_script_${"4".repeat(64)}`,
            frame_id: null,
            file_path: scriptPath,
            cdp_hash: "example",
            length: script.bytes,
            is_module: true,
            language: "JavaScript",
            source: { included: true, artifact: script },
          },
        ],
      },
      resources: [],
      workers: [],
      limitations: ["Example passive capture."],
    },
    confidence: "observed",
    authority: "external-service",
  },
);

/** Compact valid Evidence pair used by the public reconciliation contract. */
export const JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE = {
  static_layers: [{ analysis: JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE }],
  runtime_observations: [runtimeEvidence],
};

function browserCompleteness() {
  return {
    status: "complete_within_window" as const,
    conditions: ["complete_within_window" as const],
    policy_filtered_sections: [],
    attach_limited_sections: [],
    truncated_sections: [],
    unavailable_sections: [],
    excluded: [],
    dropped_events: {
      scripts: 0,
      network_requests: 0,
      console_events: 0,
      websocket_connections: 0,
      websocket_frames: 0,
      webmcp_tools: 0,
      timeline_events: 0,
      total: 0,
    },
  };
}
