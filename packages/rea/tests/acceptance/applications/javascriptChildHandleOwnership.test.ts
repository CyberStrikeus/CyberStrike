import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";

const analyzeThroughCliAndMcp = async (source: string) => {
  const root = await createTestTempDirectory("rea-child-ownership-");
  const app = join(root, "app");
  const home = join(root, "home");
  await mkdir(app);
  await mkdir(home);
  await writeFile(join(app, "main.mjs"), source);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "scripts/rea.mjs",
      "analyze-javascript-application",
      app,
      "--format",
      "json",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  const { client, call } = await connectLocalToolsMcp({ HOME: home });
  const response = await call("analyze_javascript_application", {
    input_path: app,
    format: "auto",
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(response.structuredContent).toEqual(evidence);
  await client.ping();
  return evidence;
};

it("preserves child ownership uncertainty after replacement through CLI and MCP", async () => {
  const evidence = await analyzeThroughCliAndMcp(
    `import { spawn } from 'node:child_process';
let child = spawn('program');
child = { kill() {}, on() {} };
child.kill();
child.on('exit', () => {});
const stable = spawn('program');
stable.kill();
`,
  );
  const { semantic_graph: graph } =
    javascriptApplicationAnalysisResultSchema.parse(evidence.normalized_result);
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const ownership = graph.relations.filter(({ relation }) =>
    ["forwards-signal", "listens-exit"].includes(relation),
  );
  expect(
    ownership.map((relation) => ({
      relation: relation.relation,
      resolution: relation.resolution,
      sourceLine: nodes.get(relation.source_node_id)?.identity.source_range
        ?.start.line,
      targetLine: nodes.get(relation.target_node_id)?.identity.source_range
        ?.start.line,
    })),
  ).toEqual(
    expect.arrayContaining([
      {
        relation: "forwards-signal",
        resolution: "candidate",
        sourceLine: 4,
        targetLine: 2,
      },
      {
        relation: "listens-exit",
        resolution: "candidate",
        sourceLine: 2,
        targetLine: 5,
      },
      {
        relation: "forwards-signal",
        resolution: "resolved",
        sourceLine: 7,
        targetLine: 6,
      },
    ]),
  );
  expect(ownership).toHaveLength(3);
  expect(
    graph.unknowns.filter(
      ({ family, reason }) =>
        family === "child-process" && reason === "ambiguous-target",
    ),
  ).toHaveLength(2);
}, 60000);

it("keeps deferred instance field child ownership uncertain through CLI and MCP", async () => {
  const evidence = await analyzeThroughCliAndMcp(
    `import { spawn } from 'node:child_process';
let child = spawn('old');
class Stop { field = child.kill(); }
child = spawn('new');
new Stop();
const stable = spawn('stable');
stable.kill();
`,
  );
  const { semantic_graph: graph } =
    javascriptApplicationAnalysisResultSchema.parse(evidence.normalized_result);
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const ownership = graph.relations.filter(
    ({ relation }) => relation === "forwards-signal",
  );
  expect(ownership).toHaveLength(3);
  expect(
    ownership.map((relation) => ({
      resolution: relation.resolution,
      sourceLine: nodes.get(relation.source_node_id)?.identity.source_range
        ?.start.line,
      targetLine: nodes.get(relation.target_node_id)?.identity.source_range
        ?.start.line,
    })),
  ).toEqual(
    expect.arrayContaining([
      { resolution: "candidate", sourceLine: 3, targetLine: 2 },
      { resolution: "candidate", sourceLine: 3, targetLine: 4 },
      { resolution: "resolved", sourceLine: 7, targetLine: 6 },
    ]),
  );
  expect(
    graph.unknowns.filter(
      ({ family, reason }) =>
        family === "child-process" && reason === "ambiguous-target",
    ),
  ).toHaveLength(1);
}, 60000);
