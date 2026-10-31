import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

it.each([
  [
    "callback",
    `const task = function execute(execute) {
    return execute();
  }; task(() => 'CALLBACK');`,
    2,
    null,
  ],
  [
    "body-local",
    `const task = function execute() {
    var execute = () => 'LOCAL';
    return execute();
  }; task();`,
    3,
    2,
  ],
])(
  "keeps named expression %s calls distinct in the public CLI",
  async (name, source, callLine, targetLine) => {
    const root = await createTestTempDirectory("rea-function-name-cli-");
    await writeFile(join(root, "app.js"), source);
    const { stdout } = await execute(
      process.execPath,
      ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
      { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
    );
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(JSON.parse(stdout)).normalized_result,
    );
    const graph = result.semantic_graph;
    const calls = graph.nodes.filter(
      ({ kind, identity }) =>
        kind === "call-site" && identity.source_range?.start.line === callLine,
    );
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const targets = graph.relations
      .filter(
        ({ relation, source_node_id }) =>
          relation === "calls" && source_node_id === call.node_id,
      )
      .map(
        ({ target_node_id }) =>
          graph.nodes.find(({ node_id }) => node_id === target_node_id)
            ?.identity.source_range?.start.line,
      );
    expect(targets).toEqual(targetLine === null ? [] : [targetLine]);
  },
  20_000,
);
