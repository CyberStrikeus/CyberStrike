import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";

const execute = promisify(execFile);

it("preserves earlier and sibling effects without inventing replaced cached-module or process effects", async () => {
  const root = await createTestTempDirectory("rea-builtin-identity-");
  await writeFile(
    join(root, "app.cjs"),
    `
    throw new Error('parse only');
    const a = require('node:fs'); const b = require('fs');
    b.readFileSync('before.json'); const stream = b.createReadStream('before.json'); stream.destroy();
    patch(a); b.readFileSync('wrong-after.json');
    const proc = require('node:process'); proc.env = {}; proc.argv = []; const mode = proc.env.MODE; const arg = proc.argv[2];
  `,
  );
  await writeFile(
    join(root, "sibling.mjs"),
    `import fs from 'node:fs'; fs.writeFileSync = custom; fs.readFileSync('sibling.json'); fs.readFileSync = custom;`,
  );
  await writeFile(
    join(root, "captures.cjs"),
    `const fs = require('node:fs');
     const saved = require('fs').readFileSync;
     const { readFileSync: savedDestructured } = fs;
     fs.readFileSync('before-write.json'); fs.readFileSync = custom;
     const { readFileSync: late } = require('fs');
     const lateMember = require('fs').readFileSync;
     saved('saved.json'); savedDestructured('saved-destructured.json');
     late('wrong-late.json'); lateMember('wrong-member.json');`,
  );
  await writeFile(
    join(root, "direct.cjs"),
    `require('node:fs').readFileSync('direct.json');
     const fs = require('fs'); fs.readFileSync('later.json');
     require('fs/promises').open('before');
     fs.promises.open = custom; require('node:fs/promises').open('wrong');`,
  );
  await writeFile(
    join(root, "loader.cjs"),
    `require = () => ({ readFileSync() {} });
     const fs = require('node:fs'); fs.readFileSync('wrong-loader.json');
     require('node:fs').readFileSync('wrong-direct-loader.json');`,
  );
  await writeFile(
    join(root, "imports.cts"),
    `import fs = require('node:fs'); const other = require('fs');
     const read = other.readFileSync; observe(read); read('escaped.json');
     fs.readFileSync = custom; other.readFileSync('wrong-import-equals.json');`,
  );
  await writeFile(
    join(root, "late-loader.cjs"),
    `const fs=require('fs'); fs.readFileSync('loader-before.json');
     require=replacement; fs.readFileSync('loader-after.json');
     require('fs').readFileSync('wrong-late-loader.json');`,
  );
  await writeFile(
    join(root, "replacement.cts"),
    `import fs = require('fs'); const other=require('fs'); fs={}; fs.readFileSync=custom; other.readFileSync('replacement-kept.json');`,
  );
  await writeFile(
    join(root, "dynamic.cjs"),
    `const fs=require('fs'); fs.hook=custom; fs[key](); fs.readFileSync('wrong-dynamic.json');`,
  );
  await writeFile(
    join(root, "wrapped.cjs"),
    `const fs=require('fs'); let assigned; const saved=(0, fs.readFileSync); fs.readFileSync=custom; const late=(assigned=fs.readFileSync); saved('wrapped-kept.json'); late('wrong-wrapped.json');`,
  );
  await writeFile(
    join(root, "global-process.cjs"),
    `process.env={MODE:'local'}; const proc=require('process'); const mode=proc.env.MODE;`,
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  const result = javascriptApplicationAnalysisResultSchema.parse(
    evidence.normalized_result,
  );
  expect(
    result.semantic_graph.nodes
      .filter(({ kind }) => kind === "config-source")
      .map(({ properties }) => properties.key)
      .sort(),
  ).toEqual([
    "before-write.json",
    "before.json",
    "direct.json",
    "escaped.json",
    "later.json",
    "loader-after.json",
    "loader-before.json",
    "replacement-kept.json",
    "saved-destructured.json",
    "saved.json",
    "sibling.json",
    "wrapped-kept.json",
  ]);
  expect(
    result.semantic_graph.nodes.filter(({ kind }) => kind === "resource"),
  ).toHaveLength(2);
  expect(
    result.semantic_graph.relations.filter(
      ({ relation }) => relation === "releases",
    ),
  ).toHaveLength(1);
  const { client, call } = await connectLocalToolsMcp();
  const response = await call("analyze_javascript_application", {
    input_path: root,
    format: "auto",
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(response.structuredContent).toEqual(evidence);
  await client.ping();
}, 60000);

it("excludes monkey-patched CommonJS effects from CLI and MCP evidence", async () => {
  const root = await createTestTempDirectory("rea-builtin-mutated-");
  await writeFile(
    join(root, "app.cjs"),
    `
    throw new Error("parse only");
    const fs = require("node:fs"); fs.readFileSync = custom; fs.createReadStream = custom;
    const cp = require("node:child_process"); cp.spawn = custom;
    const timers = require("node:timers"); patch(timers);
    const http = require("node:http"); delete http.get;
    fs.readFileSync("config.json"); const stream = fs.createReadStream("config.json"); stream.destroy();
    const child = cp.spawn("tool", []); child.kill();
    const timer = timers.setTimeout(callback, 1); clearTimeout(timer);
    http.get("http://example.test");
  `,
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  const result = javascriptApplicationAnalysisResultSchema.parse(
    evidence.normalized_result,
  );
  expect(
    result.semantic_graph.nodes.filter(({ kind }) =>
      [
        "config-source",
        "resource",
        "child-process",
        "timer",
        "request",
      ].includes(kind),
    ),
  ).toEqual([]);
  expect(
    result.semantic_graph.relations.filter(({ relation }) =>
      ["releases", "forwards-signal", "cancels-timer"].includes(relation),
    ),
  ).toEqual([]);
  const { client, call } = await connectLocalToolsMcp();
  const response = await call("analyze_javascript_application", {
    input_path: root,
    format: "auto",
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(response.structuredContent).toEqual(evidence);
  await client.ping();
}, 60000);

it("retains CommonJS builtin effects and handle links through CLI and MCP", async () => {
  const root = await createTestTempDirectory("rea-builtin-commonjs-");
  await writeFile(
    join(root, "app.cjs"),
    `
    throw new Error("This source must only be parsed, never executed");
    const fs = require("node:fs");
    const {spawn: launch} = require("node:child_process");
    const timers = require("timers");
    const {get} = require("http");
    const proc = require("node:process");
    const text = fs.readFileSync("config.json", "utf8");
    const stream = fs.createReadStream("config.json"); stream.destroy();
    const child = launch("tool", []); child.kill("SIGTERM");
    const timer = timers.setTimeout(callback, 10); timers.clearTimeout(timer);
    get("http://example.test");
    const mode = proc.env.MODE;
    const absent = require("node:fs").default; absent.readFileSync("wrong-default");
    const external = require("./fs.js"); external.readFileSync("wrong-external");
    function shadowed(require) { const fs = require("node:fs"); fs.readFileSync("wrong"); }
  `,
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  const result = javascriptApplicationAnalysisResultSchema.parse(
    evidence.normalized_result,
  );
  const nodes = result.semantic_graph.nodes;
  expect(
    nodes.filter(({ kind }) =>
      [
        "config-source",
        "resource",
        "child-process",
        "timer",
        "request",
      ].includes(kind),
    ),
  ).toHaveLength(6);
  expect(nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "config-source",
        properties: expect.objectContaining({ key: "config.json" }),
      }),
      expect.objectContaining({
        kind: "config-source",
        properties: expect.objectContaining({ key: "MODE" }),
      }),
      ...["createReadStream", "spawn", "setTimeout", "get"].map((method) =>
        expect.objectContaining({
          properties: expect.objectContaining({ method }),
        }),
      ),
    ]),
  );
  const relations = result.semantic_graph.relations;
  for (const relation of ["releases", "forwards-signal", "cancels-timer"])
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation, resolution: "resolved" }),
      ]),
    );
  const { client, call } = await connectLocalToolsMcp();
  const response = await call("analyze_javascript_application", {
    input_path: root,
    format: "auto",
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(response.structuredContent).toEqual(evidence);
  await client.ping();
}, 60000);

it.each([
  "import fs from 'node:fs';",
  "import {default as fs} from 'node:fs';",
])(
  "retains filesystem effects in the public CLI with %s",
  async (declaration) => {
    const root = await createTestTempDirectory("rea-builtin-default-cli-");
    await writeFile(
      join(root, "app.js"),
      `${declaration} const text=fs.readFileSync('config.json','utf8'); const stream=fs.createReadStream('config.json'); stream.destroy();`,
    );
    const { stdout } = await execute(
      process.execPath,
      ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
      { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
    );
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(JSON.parse(stdout)).normalized_result,
    );
    expect(result.semantic_graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "config-source",
          properties: expect.objectContaining({ key: "config.json" }),
        }),
        expect.objectContaining({
          kind: "resource",
          properties: expect.objectContaining({ method: "createReadStream" }),
        }),
      ]),
    );
    expect(result.semantic_graph.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "releases",
          resolution: "resolved",
        }),
      ]),
    );
  },
  20_000,
);

it("keeps only direct logical defaults and actual argv elements in the public CLI graph", async () => {
  const root = await createTestTempDirectory("rea-builtin-default-cli-");
  const manyDefaults = Array.from(
    { length: 400 },
    (_, index) =>
      `const value${index} = process.env.KEY_${index} ?? "fallback-${index}";`,
  ).join("\n");
  await writeFile(
    join(root, "app.js"),
    [
      `const chained = process.env.CHAINED ?? "fallback" ?? "unreachable";
const wrapped = ((process.env.WRAPPED)) ?? "wrapped";
const argument = process.argv[2];
const argumentLength = process.argv.length;
const namedArgument = process.argv["02"];
const negativeArgument = process.argv["-1"];
const method = process.argv.map;
const lastArrayIndex = process.argv[4294967294];
const outOfRangeArgument = process.argv[4294967295];
const dynamicArgument = process.argv[process.env.ARGV_INDEX];
function shadowed(process) { return process.argv[3]; }`,
      manyDefaults,
    ].join("\n"),
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const result = javascriptApplicationAnalysisResultSchema.parse(
    parseEvidence(JSON.parse(stdout)).normalized_result,
  );
  const configSources = result.semantic_graph.nodes.filter(
    ({ kind }) => kind === "config-source",
  );
  const defaults = configSources.filter(
    ({ properties }) => properties.source_kind === "default",
  );
  expect(defaults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          key: "CHAINED",
          value: "fallback",
        }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          key: "WRAPPED",
          value: "wrapped",
        }),
      }),
    ]),
  );
  expect(
    defaults.filter(({ properties }) => properties.key === "CHAINED"),
  ).toHaveLength(1);
  expect(defaults).toHaveLength(402);
  const defaultsByKey = new Map(
    defaults.map(({ properties }) => [properties.key, properties.value]),
  );
  for (let index = 0; index < 400; index += 1)
    expect(defaultsByKey.get(`KEY_${index}`)).toBe(`fallback-${index}`);
  const argvSources = configSources.filter(
    ({ properties }) => properties.source_kind === "argv",
  );
  expect(argvSources).toHaveLength(3);
  expect(argvSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({ key: "2" }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ key: "4294967294" }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ key: null }),
      }),
    ]),
  );
  expect(
    result.semantic_graph.relations
      .filter(({ relation }) => relation === "reads-argv")
      .map(({ resolution }) => resolution),
  ).toEqual(expect.arrayContaining(["resolved", "candidate"]));
  expect(
    result.semantic_graph.relations.filter(
      ({ relation, source_node_id, target_node_id }) => {
        if (relation !== "overrides") return false;
        const source = result.semantic_graph.nodes.find(
          ({ node_id }) => node_id === source_node_id,
        );
        const target = result.semantic_graph.nodes.find(
          ({ node_id }) => node_id === target_node_id,
        );
        return (
          source?.properties.key === "CHAINED" &&
          target?.properties.key === "CHAINED"
        );
      },
    ),
  ).toHaveLength(1);
}, 20_000);
