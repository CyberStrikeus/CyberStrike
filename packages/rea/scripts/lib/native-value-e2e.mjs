import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseEvidence } from "../../dist/domain/evidence.js";
import { analysisProfileSchema } from "../../dist/domain/analysisProfile.js";
import { nativeValueTraceSchema } from "../../dist/domain/native/nativeValueTrace.js";
import {
  requireMcpEvidenceBundle,
  requireMcpLifecycleResult,
  requireMcpOutput,
} from "./mcp-verifier-results.mjs";
import { verifyGhidraBoundaries } from "./real-ghidra-boundaries.mjs";

const defaultEntrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url));
const environment = () => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  ...(process.env.NODE_OPTIONS === undefined
    ? {}
    : { NODE_OPTIONS: process.env.NODE_OPTIONS }),
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "ghidra",
  HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
  ...(process.env.GHIDRA_INSTALL_DIR === undefined
    ? {}
    : { GHIDRA_INSTALL_DIR: process.env.GHIDRA_INSTALL_DIR }),
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { JAVA_HOME: process.env.JAVA_HOME }),
  ...(process.env.GHIDRA_HEADLESS_MAXMEM === undefined
    ? {}
    : { GHIDRA_HEADLESS_MAXMEM: process.env.GHIDRA_HEADLESS_MAXMEM }),
  ...(process.env.GHIDRA_MAXMEM === undefined
    ? {}
    : { GHIDRA_MAXMEM: process.env.GHIDRA_MAXMEM }),
  ...(process.env._JAVA_OPTIONS === undefined
    ? {}
    : { _JAVA_OPTIONS: process.env._JAVA_OPTIONS }),
});

const verifyGraph = (input, target, procedure, globalAddress) => {
  const graph = nativeValueTraceSchema.parse(input);
  assert.equal(graph.target_sha256, target.sha256);
  assert.equal(graph.seed, procedure);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const kind of ["argument-binding", "parameter-use", "return-binding"]) {
    const edges = graph.edges.filter((edge) => edge.kind === kind);
    assert.ok(edges.length > 0, `Real native dependency graph lacks ${kind}`);
    for (const edge of edges) {
      const source = nodes.get(edge.source);
      const destination = nodes.get(edge.target);
      assert.ok(source, `Missing source node ${edge.source}`);
      assert.ok(destination, `Missing target node ${edge.target}`);
      assert.equal(edge.status, "derived");
      if (kind === "argument-binding") {
        assert.match(source.operation?.opcode ?? "", /^CALL(?:IND)?$/u);
        assert.equal(destination.kind, "parameter");
        assert.equal(edge.input_index, destination.parameter.ordinal + 1);
      } else if (kind === "parameter-use") {
        assert.equal(source.kind, "parameter");
        assert.ok(destination.operation.inputs[edge.input_index]);
      } else {
        assert.equal(source.operation?.opcode, "RETURN");
        assert.match(destination.operation?.opcode ?? "", /^CALL(?:IND)?$/u);
        assert.equal(edge.input_index, 1);
      }
    }
  }
  assert.ok(
    graph.nodes.some((node) =>
      node.operation?.inputs.some((value) => value.location === globalAddress),
    ),
    "Source-owned global operand is absent from the real dependency graph",
  );
  for (const node of graph.nodes)
    assert.match(node.evidence_id, /^ev_[a-f0-9]{64}$/u);
  for (const procedure of graph.procedures) {
    assert.equal(procedure.provider, "ghidra");
    assert.match(procedure.analysis_profile_digest, /^[a-f0-9]{64}$/u);
  }
  return graph;
};

/** Verify real Ghidra dependency composition through production CLI and stdio MCP. */
export async function verifyNativeValueE2e(
  target,
  procedure,
  globalAddress,
  { entrypoint = defaultEntrypoint } = {},
) {
  const workspace = await mkdtemp(join(tmpdir(), "rea-native-values-e2e-"));
  const runtime = join(
    workspace,
    `runtime${process.platform === "win32" ? "" : " with spaces"}-${"x".repeat(100)}`,
  );
  await mkdir(runtime);
  const env = { ...environment(), TMPDIR: runtime };
  try {
    return await verifyNativeValueAdapters(
      target,
      procedure,
      globalAddress,
      entrypoint,
      env,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verifyNativeValueAdapters(
  target,
  procedure,
  globalAddress,
  entrypoint,
  env,
) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      entrypoint,
      "trace-native-values",
      target.path,
      procedure,
      "--provider",
      "ghidra",
      "--max-depth",
      "2",
      "--max-functions",
      "8",
      "--limit",
      "5000",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 72 * 1024 * 1024 },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  assert.equal(evidence.operation, "trace_native_values");
  assert.equal(evidence.provider.id, "rea-workflow");
  const workflowProfile = analysisProfileSchema.parse(
    evidence.analysis_profile,
  );
  assert.equal(workflowProfile.provider.id, "rea-workflow");
  const upstreamProfile = analysisProfileSchema.parse(
    workflowProfile.parameters.upstream_analysis_profile,
  );
  assert.equal(upstreamProfile.provider.id, "ghidra");
  const cliGraph = verifyGraph(
    evidence.normalized_result,
    target,
    procedure,
    globalAddress,
  );
  for (const procedure of cliGraph.procedures)
    assert.equal(procedure.analysis_profile_digest, upstreamProfile.digest);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "native-values-real-e2e", version: "1" });
  let boundaries;
  try {
    await client.connect(transport);
    const opened = await client.callTool(
      {
        name: "open_binary",
        arguments: { path: target.path, provider_id: "ghidra" },
      },
      { timeout: 180000 },
    );
    assert.notEqual(opened.isError, true, JSON.stringify(opened));
    const inventoryReply = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    const inventory = requireMcpLifecycleResult(
      inventoryReply,
      "binary_session",
    );
    assert.ok(
      inventory.tool_availability.some(
        (tool) => tool.name === "trace_native_values" && tool.available,
      ),
      "Native value tracing is unavailable in real provider discovery",
    );
    const result = await client.callTool(
      {
        name: "trace_native_values",
        arguments: { procedure, max_depth: 2, max_functions: 8, limit: 5000 },
      },
      { timeout: 180000 },
    );
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.notEqual(result.structuredContent, undefined);
    const mcpEvidence = parseEvidence(
      requireMcpOutput(result, "trace_native_values"),
    );
    assert.equal(mcpEvidence.operation, "trace_native_values");
    assert.equal(mcpEvidence.provider.id, "rea-workflow");
    assert.deepEqual(mcpEvidence.analysis_profile, workflowProfile);
    const mcpGraph = verifyGraph(
      mcpEvidence.normalized_result,
      target,
      procedure,
      globalAddress,
    );
    assert.deepEqual(mcpEvidence.normalized_result, mcpGraph);
    assert.deepEqual(mcpGraph, cliGraph);
    const analyzed = await client.callTool(
      {
        name: "analyze_function",
        arguments: { procedure, detail: "complete" },
      },
      { timeout: 180000 },
    );
    assert.notEqual(analyzed.isError, true, JSON.stringify(analyzed));
    assert.notEqual(analyzed.structuredContent, undefined);
    const functionEvidence = parseEvidence(
      requireMcpOutput(analyzed, "analyze_function"),
    );
    assert.equal(functionEvidence.operation, "analyze_function");
    assert.equal(functionEvidence.provider.id, "ghidra");
    assert.deepEqual(
      functionEvidence.normalized_result.facet_availability,
      Object.fromEntries(
        [
          "pseudocode",
          "assembly",
          "comments",
          "callers",
          "callees",
          "references",
          "strings_names",
          "cfg",
        ].map((facet) => [facet, { available: true }]),
      ),
    );
    assert.equal(functionEvidence.relationship_coverage?.status, "complete");
    assert.ok(
      functionEvidence.relationship_coverage.diagnostics.some((diagnostic) =>
        diagnostic.includes("indirect calls remain unknown"),
      ),
    );
    const functionProfile = analysisProfileSchema.parse(
      functionEvidence.analysis_profile,
    );
    assert.deepEqual(functionProfile, upstreamProfile);
    const comparison = await client.callTool(
      {
        name: "compare_functions",
        arguments: {
          left: analyzed.structuredContent,
          right: analyzed.structuredContent,
        },
      },
      { timeout: 180000 },
    );
    assert.notEqual(comparison.isError, true, JSON.stringify(comparison));
    assert.notEqual(comparison.structuredContent, undefined);
    const comparisonEvidence = parseEvidence(
      requireMcpOutput(comparison, "compare_functions"),
    );
    assert.equal(
      comparisonEvidence.normalized_result.status,
      "unchanged",
      JSON.stringify(comparisonEvidence.normalized_result.dimensions),
    );
    assert.ok(
      comparisonEvidence.evidence_links.includes(functionEvidence.evidence_id),
    );
    await verifyUnresolvedCallEvidence(client);
    const bundleReply = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    assert.ok(
      bundleReply.structuredContent,
      "MCP omitted structured Evidence bundle",
    );
    const bundle = requireMcpEvidenceBundle(bundleReply);
    for (const evidence of [
      mcpEvidence,
      functionEvidence,
      comparisonEvidence,
    ]) {
      assert.deepEqual(
        bundle.records.find(
          (record) => record.evidence_id === evidence.evidence_id,
        ),
        evidence,
      );
    }
    boundaries = await verifyGhidraBoundaries(client, {
      target,
      procedure,
      entrypoint,
      env,
    });
    const closed = await client.callTool({
      name: "close_binary",
      arguments: {},
    });
    assert.notEqual(closed.isError, true, JSON.stringify(closed));
    const statusReply = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    assert.equal(
      requireMcpLifecycleResult(statusReply, "binary_session").open,
      false,
    );
    assert.deepEqual(
      (await readdir(env.TMPDIR)).filter((name) =>
        name.startsWith("rea-ghidra-"),
      ),
      [],
      "Ghidra left runtime files after close",
    );
  } finally {
    await client.close();
    await transport.close();
  }
  return {
    mocked: false,
    cli: true,
    stdio_mcp: true,
    inline_evidence: true,
    direct_function_comparison: true,
    boundaries,
    nodes: cliGraph.total_nodes,
    edges: cliGraph.total_edges,
    decompilations: cliGraph.decompilations,
    unknowns: cliGraph.unknowns.length,
  };
}

async function verifyUnresolvedCallEvidence(client) {
  const inventory = await client.callTool({
    name: "list_procedures",
    arguments: {},
  });
  assert.notEqual(inventory.isError, true, JSON.stringify(inventory));
  assert.notEqual(inventory.structuredContent, undefined);
  const procedures = parseEvidence(
    requireMcpOutput(inventory, "list_procedures"),
  ).normalized_result;
  const indirect = procedures.find((item) =>
    item.value.endsWith("rea_ghidra_inventory_indirect"),
  );
  const leaf = procedures.find((item) =>
    item.value.endsWith("rea_ghidra_inventory_leaf"),
  );
  assert.ok(
    indirect && leaf,
    "Source fixture lacks the unresolved callback and its possible target",
  );
  const analyzed = await client.callTool(
    {
      name: "analyze_function",
      arguments: { procedure: indirect.address, detail: "complete" },
    },
    { timeout: 180000 },
  );
  assert.notEqual(analyzed.isError, true, JSON.stringify(analyzed));
  assert.notEqual(analyzed.structuredContent, undefined);
  const evidence = parseEvidence(
    requireMcpOutput(analyzed, "analyze_function"),
  );
  assert.equal(evidence.relationship_coverage?.status, "partial");
  assert.ok(evidence.normalized_result.unresolved_calls.length > 0);
  const traced = await client.callTool(
    {
      name: "trace_call_path",
      arguments: {
        start: indirect.address,
        goal: leaf.address,
        direction: "forward",
      },
    },
    { timeout: 180000 },
  );
  assert.notEqual(traced.isError, true, JSON.stringify(traced));
  assert.notEqual(traced.structuredContent, undefined);
  const trace = parseEvidence(
    requireMcpOutput(traced, "trace_call_path"),
  ).normalized_result;
  assert.equal(trace.goal_status, "unknown");
  assert.equal(trace.truncated, true);
  assert.ok(trace.residual_unknowns.length > 0);
  const compared = await client.callTool(
    {
      name: "compare_functions",
      arguments: {
        left: analyzed.structuredContent,
        right: analyzed.structuredContent,
      },
    },
    { timeout: 180000 },
  );
  assert.notEqual(compared.isError, true, JSON.stringify(compared));
  assert.notEqual(compared.structuredContent, undefined);
  assert.equal(
    parseEvidence(requireMcpOutput(compared, "compare_functions"))
      .normalized_result.status,
    "unknown",
  );
}
