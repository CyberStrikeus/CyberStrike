import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves uncertainty from a member write through with scope",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-with-member-write-");
    await writeFile(
      join(root, "main.cjs"),
      `
const shared = { mode: "initial", keep: 1 };
const unrelated = {};
const counter = { n: 1 };
const removed = { n: 1 };
const original = { n: 1 };
const alias = original;
const plain = { value: "plain-before" };
const nested = { child: { flag: "nested-before", values: ["array-before"] } };
plain.value = "plain-after";
with (unrelated) { shared.mode = "updated"; counter.n++; delete removed.n; alias.n = 2; nested.child = replacement; }
module.exports.read = function read() { return shared.mode; };
module.exports.keep = function keep() { return shared.keep; };
module.exports.counter = function readCounter() { return counter.n; };
module.exports.removed = function readRemoved() { return removed.n; };
module.exports.aliased = function readAliased() { return original.n; };
module.exports.plain = function readPlain() { return plain.value; };
`,
    );
    const analysis = await cli.run({
      arguments: ["analyze-javascript-application", root, "--format", "json"],
    });
    expect(analysis.exitCode, analysis.stderr).toBe(0);
    const application = parseEvidence(analysis.json);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      application.normalized_result,
    );
    const observations = result.graph.nodes.flatMap(
      ({ observations }) => observations,
    );
    for (const [name, status] of [
      ["read", "unknown"],
      ["keep", "literal"],
      ["counter", "unknown"],
      ["removed", "unknown"],
      ["aliased", "unknown"],
      ["plain", "unknown"],
    ] as const) {
      const projection = observations.find(
        ({ properties }) =>
          properties.semantic_role === "export-return-shapes" &&
          properties.exported_name === name,
      );
      expect(projection, name).toBeDefined();
      expect(projection?.properties.static_return_shapes).toMatchObject([
        {
          value_status: status,
          fields: [{ state: status, ...(name === "keep" ? { value: 1 } : {}) }],
        },
      ]);
    }
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected shared MCP session");
    for (const value of [
      "initial",
      "plain-before",
      "nested-before",
      "array-before",
    ]) {
      const traced = await call("trace_javascript_semantics", {
        application,
        query: {
          seed: { kind: "literal", value },
          direction: "forward-influence",
        },
      });
      expect(traced.isError, JSON.stringify(traced.content)).not.toBe(true);
      const trace = javaScriptSemanticTraceResultSchema.parse(
        parseEvidence(traced.structuredContent).normalized_result,
      );
      expect(trace.summary.total_seed_matches).toBeGreaterThan(0);
      expect(trace.summary.relevant_unknowns).toBeGreaterThan(0);
    }
  },
);
