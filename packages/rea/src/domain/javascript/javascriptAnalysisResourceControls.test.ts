import { expect, it } from "vitest";
import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import { projectAnalysisError } from "../analysisErrorProjection.js";
import {
  JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS,
  JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION,
  JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION,
  JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
  JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM,
  JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM,
  javaScriptAnalysisResourceControlsSchema,
  javaScriptWorkerHeapExhaustionRecovery,
  javaScriptSemanticCeilingCoverage,
  javaScriptWorkerHeapRemediation,
} from "./javascriptAnalysisResourceControls.js";

it("keeps omitted operational choices absent and validates explicit semantic budgets", () => {
  expect(javaScriptAnalysisResourceControlsSchema.parse({})).toEqual({});
  expect(
    javaScriptAnalysisResourceControlsSchema.parse({
      max_semantic_nodes: 750_000,
      max_semantic_nodes_per_file: 700_000,
      max_semantic_unknowns: 500_000,
      max_semantic_unknowns_per_file: 400_000,
    }),
  ).toEqual({
    max_semantic_nodes: 750_000,
    max_semantic_nodes_per_file: 700_000,
    max_semantic_unknowns: 500_000,
    max_semantic_unknowns_per_file: 400_000,
  });
  for (const value of [0, -1, 1.5, 1_000_001, Infinity, NaN]) {
    for (const key of [
      "max_semantic_nodes",
      "max_semantic_nodes_per_file",
      "max_semantic_unknowns",
      "max_semantic_unknowns_per_file",
    ])
      expect(
        javaScriptAnalysisResourceControlsSchema.safeParse({ [key]: value })
          .success,
      ).toBe(false);
  }
});

it("names max_heap_mb, its range, and the budgets it does not raise", () => {
  const heapMb = JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.heapMb;
  const error = new AnalysisResourceConstraintError(
    "analyze_javascript_application",
    "memory",
    `Owned JavaScript worker exhausted its ${String(heapMb)} MiB V8 old-space heap (max_heap_mb) while analyzing app.js during static`,
    { worker_old_space_mb: heapMb },
    { remediationAction: javaScriptWorkerHeapRemediation(heapMb) },
  );
  const projected = projectAnalysisError(error);
  expect(projected.message).toContain(`max_heap_mb`);
  expect(projected.message).toContain(`${String(heapMb)} MiB`);
  expect(projected.remediation.action).toContain("max_heap_mb");
  expect(projected.remediation.action).toContain(
    String(JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM),
  );
  expect(projected.remediation.action).toContain(
    String(JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM),
  );
  expect(projected.remediation.action).toContain("--max-heap-mb");
  expect(projected.remediation.action).toContain("next analysis");
  expect(projected.remediation.action).toContain("new worker");
  expect(projected.remediation.action).toContain("parent result budget");
  expect(projected.remediation.action).toContain("transfer");
  expect(projected.remediation.action).not.toMatch(/available host memory/u);
  const maximum = projectAnalysisError(
    new AnalysisResourceConstraintError(
      "analyze_javascript_application",
      "memory",
      "heap",
      null,
      {
        remediationAction: javaScriptWorkerHeapRemediation(
          JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM,
        ),
      },
    ),
  );
  expect(maximum.remediation.action).toContain("Do not increase it further");
});

it("names the parent heap control for the parent result budget", () => {
  expect(JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION).toContain(
    "parent result budget",
  );
  expect(JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION).toContain("NODE_OPTIONS");
  expect(JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION).toContain(
    "--max-old-space-size=<MiB>",
  );
  expect(JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION).toContain("max_heap_mb");
  expect(JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION).not.toContain(
    "no runtime override",
  );
});

it("names the parent heap control for checkpoint decode", () => {
  expect(JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION).toContain(
    "parent process heap",
  );
  expect(JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION).toContain(
    "NODE_OPTIONS",
  );
  expect(JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION).toContain(
    "--max-old-space-size=<MiB>",
  );
  expect(JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION).toContain(
    "admit this checkpoint",
  );
  expect(JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION).toContain(
    "Increasing max_heap_mb does not raise it",
  );
});

it("attributes V8 heap exhaustion to max_heap_mb only when that flag is enforced", () => {
  const node = javaScriptWorkerHeapExhaustionRecovery({
    heapFlagsEnforced: true,
    heapMb: 1024,
    path: "app.js",
    phase: "static",
  });
  expect(node.reason).toContain(
    "exhausted its 1024 MiB V8 old-space heap (max_heap_mb)",
  );
  expect(node.remediationAction).toContain("max_heap_mb");
  expect(node.remediationAction).toContain("--max-heap-mb");
  const bun = javaScriptWorkerHeapExhaustionRecovery({
    heapFlagsEnforced: false,
    heapMb: 1024,
    path: "app.js",
    phase: "static",
  });
  expect(bun.reason).toContain("Bun ignores the V8 old-space flag");
  expect(bun.reason).not.toContain(
    "exhausted its 1024 MiB V8 old-space heap (max_heap_mb)",
  );
  expect(bun.remediationAction).toContain("Bun ignores V8 heap flags");
  expect(bun.remediationAction).not.toContain("Increase max_heap_mb");
});

it("names the four semantic arguments on ceiling coverage", () => {
  const both = { total: true, perFile: true };
  const nodes = javaScriptSemanticCeilingCoverage("nodes", 50, 30, both);
  const unknowns = javaScriptSemanticCeilingCoverage("unknowns", 3, 2, both);
  const perFileOnly = javaScriptSemanticCeilingCoverage("nodes", 50, 30, {
    total: false,
    perFile: true,
  });
  const totalOnly = javaScriptSemanticCeilingCoverage("unknowns", 3, 2, {
    total: true,
    perFile: false,
  });
  expect(nodes.limits).toEqual(perFileOnly.limits);
  expect(nodes.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_node_ceiling", value: 50, unit: "items" },
      { name: "semantic_graph_file_node_ceiling", value: 30, unit: "items" },
      { name: "max_semantic_nodes", value: 50, unit: "items" },
      { name: "max_semantic_nodes_per_file", value: 30, unit: "items" },
    ]),
  );
  expect(unknowns.limits).toEqual(totalOnly.limits);
  expect(unknowns.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_unknown_ceiling", value: 3, unit: "items" },
      { name: "semantic_graph_file_unknown_ceiling", value: 2, unit: "items" },
      { name: "max_semantic_unknowns", value: 3, unit: "items" },
      { name: "max_semantic_unknowns_per_file", value: 2, unit: "items" },
    ]),
  );
  expect(nodes.limitation).toContain("1 to");
  expect(nodes.limitation).toContain(String(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM));
  expect(nodes.limitation).toContain(
    "CLI: --max-semantic-nodes and --max-semantic-nodes-per-file",
  );
  expect(nodes.limitation).toContain(
    "Set max_semantic_nodes and max_semantic_nodes_per_file",
  );
  expect(nodes.limitation).toContain("Raising them does not raise");
  expect(nodes.limitation).toContain("next analysis");
  expect(unknowns.limitation).toContain(
    "CLI: --max-semantic-unknowns and --max-semantic-unknowns-per-file",
  );
  expect(unknowns.limitation).toContain("max_semantic_nodes");
  expect(perFileOnly.limitation).toContain("max_semantic_nodes_per_file is 30");
  expect(perFileOnly.limitation).toContain(
    "Set max_semantic_nodes_per_file on the next",
  );
  expect(perFileOnly.limitation).toContain(
    "CLI: --max-semantic-nodes-per-file",
  );
  expect(perFileOnly.limitation).toContain("Raising it does not raise");
  expect(perFileOnly.limitation).not.toContain("max_semantic_nodes is 50");
  expect(perFileOnly.limitation).not.toContain("--max-semantic-nodes and");
  expect(totalOnly.limitation).toContain("max_semantic_unknowns is 3");
  expect(totalOnly.limitation).toContain(
    "Set max_semantic_unknowns on the next",
  );
  expect(totalOnly.limitation).toContain("CLI: --max-semantic-unknowns)");
  expect(totalOnly.limitation).not.toContain(
    "max_semantic_unknowns_per_file is 2",
  );
  expect(totalOnly.limitation).not.toContain(
    "--max-semantic-unknowns-per-file",
  );
  const capped = javaScriptSemanticCeilingCoverage(
    "nodes",
    JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
    30,
    { total: true, perFile: false },
  );
  expect(capped.limitation).toContain("Do not increase it further");
  expect(capped.limitation).not.toContain("max_semantic_nodes_per_file is 30");
  expect(() =>
    javaScriptSemanticCeilingCoverage("nodes", 50, 30, {
      total: false,
      perFile: false,
    }),
  ).toThrow("ceiling that stopped retention");
});
