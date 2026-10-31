import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { verifyJavaScriptReturnShapes } from "../../fixtures/javascriptReturnShapes.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const createCallbackFixture = async () => {
  const root = await createTestTempDirectory("rea-callback-targets-");
  const file = join(root, "app.mjs");
  await writeFile(
    file,
    `
function fallback() { return "local"; }
function original() { return "original"; }
export function choose(cb, flag) { if (flag) cb=fallback; return cb(); }
export function logical(cb, flag) { flag && (cb=fallback); return cb(); }
export function definite(cb) { cb=fallback; return cb(); }
export function beforeAfter(cb) { const before=cb(); cb=fallback; return [before,cb()]; }
export function captured(cb) { const saved=cb; cb=fallback; return saved(); }
export function delayed(cb) { function replace() { cb=fallback; } return cb(); }
export function caught(cb,flag) { try { throw cb; } catch (cb) { if(flag)cb=fallback; return cb(); } }
export function defaulted(cb=original,flag) { if(flag)cb=fallback; return cb(); }
export function local(flag) { let cb=original; if(flag)cb=fallback; return cb(); }
export function replaced() { let cb=original; cb=fallback; return cb(); }
export function guarded(cb,flag) { if(flag){cb=fallback;return cb();}return "skipped"; }
export function guardedVar(flag) { if(flag){var cb=fallback;return cb();}return "skipped"; }
export function logicalAssign(cb) { cb ||= fallback;return cb(); }
export function restored() { let cb=fallback;const saved=cb;cb=saved;return cb(); }
export function emptyOr() { let cb;cb ||= fallback;return cb(); }
export function emptyNullish() { let cb;cb ??= fallback;return cb(); }
export function knownLocal(flag) { let cb=fallback;if(flag)cb=fallback;return cb(); }
export function finallyDefinite(cb,flag) { if(flag)cb=fallback;cb=fallback;return cb(); }
`,
  );
  const oracle = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `
import {pathToFileURL} from "node:url";
const m=await import(pathToFileURL(process.argv[1]));
const cb=()=>"incoming";
console.log(JSON.stringify([
m.choose(cb,false),m.choose(cb,true),m.logical(cb,false),m.definite(cb),
m.beforeAfter(cb),m.captured(cb),m.delayed(cb),m.caught(cb,false),
m.defaulted(cb,false),m.defaulted(undefined,false),m.local(false),m.local(true),m.replaced(),
m.guarded(cb,false),m.guarded(cb,true),m.guardedVar(false),m.guardedVar(true),m.logicalAssign(cb),m.restored(),m.emptyOr(),m.emptyNullish(),m.knownLocal(false),m.knownLocal(true),m.finallyDefinite(cb,false)
]));`,
    file,
  ]);
  expect(JSON.parse(oracle.stdout)).toEqual([
    "incoming",
    "local",
    "incoming",
    "local",
    ["incoming", "local"],
    "incoming",
    "incoming",
    "incoming",
    "incoming",
    "original",
    "original",
    "local",
    "local",
    "skipped",
    "local",
    "skipped",
    "local",
    "incoming",
    "local",
    "local",
    "local",
    "local",
    "local",
    "local",
  ]);
  return root;
};

const verifyCallbackGraph = (
  graph: ReturnType<
    typeof javascriptApplicationAnalysisResultSchema.parse
  >["semantic_graph"],
) => {
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const calls = (name: string) =>
    graph.nodes
      .filter(
        (node) =>
          node.kind === "call-site" &&
          node.function_node_id !== null &&
          nodes.get(node.function_node_id)?.properties.name === name,
      )
      .sort(
        (a, b) =>
          (a.identity.source_range?.start.column ?? 0) -
          (b.identity.source_range?.start.column ?? 0),
      );
  const targets = (nodeId: string) =>
    graph.relations
      .filter(
        (relation) =>
          relation.relation === "calls" && relation.source_node_id === nodeId,
      )
      .map((relation) => ({
        target: nodes.get(relation.target_node_id)?.label,
        resolution: relation.resolution,
      }))
      .sort((a, b) => String(a.target).localeCompare(String(b.target)));
  for (const name of ["choose", "logical", "delayed", "caught", "defaulted"]) {
    const call = calls(name)[0];
    if (call === undefined) throw new Error(`Missing ${name} call`);
    expect(targets(call.node_id), name).toContainEqual({
      target: "fallback",
      resolution: "candidate",
    });
    expect(
      targets(call.node_id).every((target) => target.resolution !== "resolved"),
      name,
    ).toBe(true);
  }
  for (const name of [
    "definite",
    "replaced",
    "guarded",
    "guardedVar",
    "restored",
    "emptyOr",
    "emptyNullish",
    "knownLocal",
    "finallyDefinite",
  ]) {
    const call = calls(name)[0];
    if (call === undefined) throw new Error(`Missing ${name} call`);
    expect(targets(call.node_id), name).toEqual([
      { target: "fallback", resolution: "resolved" },
    ]);
  }
  expect(targets(calls("logicalAssign")[0]!.node_id)).toEqual([]);
  expect(calls("beforeAfter")).toHaveLength(2);
  expect(targets(calls("beforeAfter")[0]!.node_id)).toEqual([]);
  expect(targets(calls("beforeAfter")[1]!.node_id)).toEqual([
    { target: "fallback", resolution: "resolved" },
  ]);
  expect(targets(calls("captured")[0]!.node_id)).toEqual([]);
  expect(targets(calls("local")[0]!.node_id)).toEqual([
    { target: "fallback", resolution: "candidate" },
    { target: "original", resolution: "candidate" },
  ]);

  return calls;
};

cliTest(
  "preserves incoming callback uncertainty through CLI and retained MCP traces",
  async ({ cli }) => {
    const root = await createCallbackFixture();
    const analyzed = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--artifact-format",
        "directory",
        "--json",
      ],
    });
    expect(analyzed.exitCode, analyzed.stderr).toBe(0);
    const contract = toolContract("analyze_javascript_application");
    const evidence = contract.outputSchema.parse(analyzed.json);
    const graph = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    ).semantic_graph;
    const calls = verifyCallbackGraph(graph);

    const { client, call } = await connectLocalToolsMcp();
    const retainedResponse = await call("analyze_javascript_application", {
      input_path: root,
      format: "directory",
      detail: "summary",
    });
    expect(retainedResponse.isError).not.toBe(true);
    expect(retainedResponse.structuredContent).toMatchObject({
      normalized_result: { parent_evidence_id: evidence.evidence_id },
    });
    // Summary replies keep the complete Evidence available for subsequent queries.
    const retainedId = evidence.evidence_id;
    const selected = calls("choose")[0]!;
    const query = {
      seed: { kind: "semantic-node" as const, node_id: selected.node_id },
      direction: "forward-influence" as const,
      allowed_relations: ["calls" as const],
    };
    const traced = await call("trace_javascript_semantics", {
      application: { kind: "retained-evidence", evidence_id: retainedId },
      query,
    });
    expect(traced.isError).not.toBe(true);
    const traceEvidence = toolContract(
      "trace_javascript_semantics",
    ).outputSchema.parse(traced.structuredContent);
    const trace = javaScriptSemanticTraceResultSchema.parse(
      traceEvidence.normalized_result,
    );
    expect(trace.status).toBe("ambiguous");
    expect(trace.relations).toEqual([]);
    expect(trace.coverage.status).toBe("partial");
    expect(graph.unknowns.length).toBeGreaterThan(0);
    expect(trace.source_graph_id).toBe(graph.graph_id);
    expect(trace.evidence_contexts.length).toBeGreaterThan(0);
    const request = join(root, "trace.json");
    await writeFile(request, JSON.stringify({ application: evidence, query }));
    const cliTrace = await cli.run({
      arguments: ["trace-javascript-semantics", request, "--json"],
    });
    expect(cliTrace.exitCode, cliTrace.stderr).toBe(0);
    expect(
      toolContract("trace_javascript_semantics").outputSchema.parse(
        cliTrace.json,
      ).evidence_id,
    ).toBe(traceEvidence.evidence_id);
    const candidates = await call("trace_javascript_semantics", {
      application: { kind: "retained-evidence", evidence_id: retainedId },
      query: { ...query, include_ambiguous_dynamic_edges: true },
    });
    expect(candidates.isError).not.toBe(true);
    const candidateTrace = javaScriptSemanticTraceResultSchema.parse(
      toolContract("trace_javascript_semantics").outputSchema.parse(
        candidates.structuredContent,
      ).normalized_result,
    );
    expect(candidateTrace.status).toBe("ambiguous");
    expect(candidateTrace.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "calls", resolution: "candidate" }),
      ]),
    );
    await client.ping();
  },
);

cliTest(
  "applies returned-reference effects to the callback selected at the call",
  async ({ cli }) => {
    const source = `
const original={value:1},replacement={value:2};
function first(){return original;}
function second(){return replacement;}
export function inspect(){let cb=first;const result=cb();cb=second;result.value=3;return {original:original.value,replacement:replacement.value};}
const restoredObject={value:1};
function create(){return restoredObject;}
export function restored(){let cb=create;const saved=cb;cb=saved;cb().value=3;return {value:restoredObject.value};}
`;
    const oracle = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      source + "console.log(JSON.stringify([inspect(),restored()]));",
    ]);
    expect(JSON.parse(oracle.stdout)).toEqual([
      { original: 3, replacement: 2 },
      { value: 3 },
    ]);
    await verifyJavaScriptReturnShapes(
      cli,
      source,
      (fields) => {
        expect(fields("restored")).toContainEqual(
          expect.objectContaining({ path: "/value", state: "unknown" }),
        );
        expect(fields("inspect")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "/replacement",
              state: "literal",
              value: 2,
            }),
            expect.objectContaining({
              path: "/original",
              state: "unknown",
            }),
          ]),
        );
      },
      "app.mjs",
    );
  },
);
