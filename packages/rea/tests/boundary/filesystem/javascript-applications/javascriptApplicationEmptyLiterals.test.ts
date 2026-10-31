import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { matchJavaScriptApplicationVersions } from "../../../../src/domain/javascript/javascriptApplicationVersionKeys.js";
import { findApplicationFeatureSeeds } from "../../../../src/domain/javascript/javascriptFeatureSeed.js";
import {
  applicationFeatureSeedSchema,
  traceApplicationFeatureInputSchema,
} from "../../../../src/domain/javascript/javascriptFeatureTraceSchemas.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

const analyzeSource = async (
  source: string,
  extraFiles: Readonly<Record<string, string>> = {},
) => {
  const inputPath = await createTestTempDirectory("rea-js-empty-literal-");
  await writeFile(join(inputPath, "app.js"), `${source}\n`);
  for (const [path, text] of Object.entries(extraFiles))
    await writeFile(join(inputPath, path), text);
  const result = await analyzeJavaScriptApplication({
    input_path: inputPath,
    format: "directory",
  });
  if (!result.ok)
    throw new Error(`Expected analysis success: ${result.error.message}`);
  return javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  );
};

it("retains empty literal evidence across the application boundary surfaces", async () => {
  const sources = [
    "fetch('');",
    "new WebSocket('');",
    "navigator.serviceWorker.register('');",
    "new Worker('');",
    "const x = require('');",
    "import y from ''; y();",
    "import('');",
    "localStorage.getItem('');",
    "localStorage.setItem('', 1);",
    "indexedDB.open('');",
    "win.loadFile('');",
    "win.loadURL('');",
    "app.get('', handler);",
    "process.on('', () => 1);",
    "const { EventEmitter } = require('events'); new EventEmitter().on('', () => 1);",
    "const { spawn } = require('child_process'); spawn('/bin/x').on('', () => 1);",
    "const { ipcMain } = require('electron'); ipcMain.handle('', () => 1);",
    "const { ipcRenderer } = require('electron'); ipcRenderer.invoke('');",
    "const { contextBridge } = require('electron'); contextBridge.exposeInMainWorld('', {});",
  ];
  const output = await analyzeSource(sources.join("\n"));
  expect(output.graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "endpoint" }),
      expect.objectContaining({ kind: "worker" }),
      expect.objectContaining({ kind: "ipc-channel" }),
      expect.objectContaining({ kind: "context-bridge-api" }),
    ]),
  );
  expect(output.semantic_graph?.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "request",
        properties: expect.objectContaining({ endpoint: "" }),
      }),
      expect.objectContaining({
        kind: "event",
        properties: expect.objectContaining({ event_name: "" }),
      }),
    ]),
  );
});

/** Endpoint identity keys tag literal values apart from candidates. */
const literalEndpointKey = (value: string): string =>
  JSON.stringify(["literal", value]);

it("keeps bridge entry paths stable through worker validation and API seed matching", async () => {
  const output = await analyzeSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    const literal = () => ipcRenderer.send("literal");
    const nested = () => ipcRenderer.send("nested");
    contextBridge.exposeInMainWorld("desktop", {
      "nested.write": literal,
      nested: { write: nested },
    });
  `);
  const semanticProperties = (output.semantic_graph?.nodes ?? []).map(
    ({ properties }) => properties,
  );
  const applicationProperties = output.graph.nodes.flatMap(({ observations }) =>
    observations.map(({ properties }) => properties),
  );
  const pathIds = (properties: typeof semanticProperties) =>
    new Set(
      properties
        .map(({ path_id }) => path_id)
        .filter((pathId): pathId is string => typeof pathId === "string"),
    );
  expect(pathIds(semanticProperties)).toEqual(pathIds(applicationProperties));
  const semanticPaths = semanticProperties.filter(
    ({ step_kind }) => step_kind === "terminal",
  );
  const applicationPaths = applicationProperties.filter(
    ({ step_kind }) => step_kind === "terminal",
  );
  const expectedPaths = [
    expect.objectContaining({
      path_id: expect.any(String),
      entry_path: ["desktop", "nested.write"],
      channel: "literal",
    }),
    expect.objectContaining({
      path_id: expect.any(String),
      entry_path: ["desktop", "nested", "write"],
      channel: "nested",
    }),
  ];
  expect(semanticPaths).toEqual(expect.arrayContaining(expectedPaths));
  expect(applicationPaths).toEqual(expect.arrayContaining(expectedPaths));
  const pathIdentities = (paths: typeof semanticPaths) =>
    new Set(
      paths.map(({ path_id, entry_path, channel }) =>
        JSON.stringify([path_id, entry_path, channel]),
      ),
    );
  expect(new Set(semanticPaths.map(({ path_id }) => path_id)).size).toBe(2);
  expect(pathIdentities(applicationPaths)).toEqual(
    pathIdentities(semanticPaths),
  );

  const matches = findApplicationFeatureSeeds(
    output.graph.nodes,
    applicationFeatureSeedSchema.parse({
      kind: "api",
      value: "desktop.nested.write",
      entry_path: ["desktop", "nested.write"],
    }),
  );
  expect(matches).toHaveLength(1);
  expect(
    output.graph.nodes
      .find(({ node_id: nodeId }) => nodeId === matches[0]?.node_id)
      ?.observations.some(
        ({ properties }) =>
          Array.isArray(properties.entry_path) &&
          properties.entry_path.join("\0") === "desktop\0nested.write",
      ),
  ).toBe(true);
  expect(
    findApplicationFeatureSeeds(
      output.graph.nodes,
      applicationFeatureSeedSchema.parse({
        kind: "api",
        value: "desktop.nested.write",
      }),
    ),
  ).toHaveLength(2);
});

it("analyzes a plain long-line loader without package metadata", async () => {
  const output = await analyzeSource(
    `var Module = {}; fetch(""); new Worker(""); var payload = "${"x".repeat(65_536)}";`,
    { "game-data.js": "Module.data = { ready: true };" },
  );
  const nodes = output.graph.nodes.filter(
    ({ kind }) => kind === "endpoint" || kind === "worker",
  );
  expect(nodes.map(({ kind }) => kind).sort()).toEqual(["endpoint", "worker"]);
  for (const node of nodes) {
    expect(node.identity).toMatchObject({
      strategy: "artifact-local-key",
      // A Worker string is relative to the unestablished document base, so
      // its identity is the retained expression rather than a specifier.
      key: node.kind === "endpoint" ? literalEndpointKey("") : 'new Worker("")',
    });
    expect(node.observations.map(({ label }) => label)).toEqual([null]);
  }
});

it("keeps exact values for empty literals without synthetic application labels", async () => {
  const output = await analyzeSource(
    "fetch(''); fetch('\"\"'); fetch('/api'); process.on('', () => 1);",
  );
  const endpoints = output.graph.nodes
    .filter(({ kind }) => kind === "endpoint")
    .map(({ identity, observations }) => ({
      key: identity.strategy === "artifact-local-key" ? identity.key : null,
      labels: observations.map(({ label }) => label),
      values: observations.map(({ properties }) => properties.value),
    }));
  // The empty endpoint has no display label, so it cannot be confused with
  // a literal two-quote endpoint; both keep exact identities.
  expect(endpoints).toEqual(
    expect.arrayContaining([
      { key: literalEndpointKey(""), labels: [null], values: [""] },
      { key: literalEndpointKey('""'), labels: ['""'], values: ['""'] },
      { key: literalEndpointKey("/api"), labels: ["/api"], values: ["/api"] },
    ]),
  );
  expect(endpoints).toHaveLength(3);
  expect(
    output.semantic_graph?.nodes
      .filter(({ kind }) => kind === "event")
      .map(({ label, properties }) => ({
        label,
        eventName: properties.event_name,
      })),
  ).toEqual([{ label: '""', eventName: "" }]);
});

it.each([
  { version: 3, sources: [""], names: [], mappings: "AAAA" },
  { version: 3, sourceRoot: null, sources: [""], names: [], mappings: "AAAA" },
  { version: 3, sourceRoot: "", sources: [""], names: [], mappings: "AAAA" },
  {
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: { version: 3, sources: [""], names: [], mappings: "AAAA" },
      },
    ],
  },
])("projects an empty source-map source name: %j", async (map) => {
  const output = await analyzeSource("//# sourceMappingURL=app.js.map", {
    "app.js.map": JSON.stringify(map),
  });
  const originals = output.graph.nodes
    .filter(({ kind }) => kind === "source-module")
    .map(({ identity, observations }) => ({
      originalSource:
        identity.strategy === "source-map-original"
          ? identity.original_source
          : null,
      sources: observations.map(
        ({ source_map_reference }) => source_map_reference?.source_name,
      ),
    }));
  expect(originals).toEqual([{ originalSource: "", sources: [""] }]);
});

it("keeps empty and two-quote source-map names distinct", async () => {
  const output = await analyzeSource("//# sourceMappingURL=app.js.map", {
    "app.js.map": JSON.stringify({
      version: 3,
      sources: ["", '""'],
      names: [],
      mappings: "AAAA,CCAA",
    }),
  });
  expect(
    output.graph.nodes
      .filter(({ kind }) => kind === "source-module")
      .map(({ identity }) =>
        identity.strategy === "source-map-original"
          ? identity.original_source
          : null,
      )
      .sort(),
  ).toEqual(["", '""']);
});

it("does not match an empty endpoint with a literal two-quote seed", async () => {
  const output = await analyzeSource("fetch(''); fetch('\"\"');");
  const endpoints = new Map(
    output.graph.nodes
      .filter(({ kind }) => kind === "endpoint")
      .map((node) => [
        node.node_id,
        node.identity.strategy === "artifact-local-key"
          ? node.identity.key
          : null,
      ]),
  );
  const matches = findApplicationFeatureSeeds(output.graph.nodes, {
    kind: "string",
    value: '""',
    match: "exact",
    case_sensitive: true,
  }).filter(({ node_id: nodeId }) => endpoints.has(nodeId));
  expect(matches.map(({ node_id: nodeId }) => endpoints.get(nodeId))).toEqual([
    literalEndpointKey('""'),
  ]);
});

const IPC_SOURCE =
  "const { ipcMain } = require('electron'); ipcMain.handle('', () => 1); ipcMain.handle('\"\"', () => 2);";

const ipcChannels = (
  nodes: Awaited<ReturnType<typeof analyzeSource>>["graph"]["nodes"],
) =>
  new Map(
    nodes
      .filter(({ kind }) => kind === "ipc-channel")
      .map((node) => [node.node_id, node.observations[0]?.properties.channel]),
  );

it("selects an empty IPC channel with an exact empty seed", async () => {
  const output = await analyzeSource(IPC_SOURCE);
  const channels = ipcChannels(output.graph.nodes);
  const matches = findApplicationFeatureSeeds(output.graph.nodes, {
    kind: "channel",
    value: "",
    match: "exact",
    case_sensitive: true,
  });
  expect(matches.map(({ node_id: nodeId }) => channels.get(nodeId))).toEqual([
    "",
  ]);
});

const seedSchema = traceApplicationFeatureInputSchema.shape.seed;
const validateAdvertisedSeed = new Ajv2020({
  strict: false,
  validateFormats: false,
}).compile(z.toJSONSchema(seedSchema, { io: "input" }));

it.each([
  [{ kind: "channel", value: "", match: "exact" }, true],
  [{ kind: "string", value: "", match: "exact" }, true],
  [{ kind: "channel", value: "/x" }, true],
  [{ kind: "string", value: "" }, false],
  [{ kind: "channel", value: "" }, false],
  [{ kind: "channel", value: "", match: "contains" }, false],
  [{ kind: "node-id", value: "", match: "exact" }, false],
  [{ kind: "api", value: "desktop.nested.write" }, true],
  [
    {
      kind: "api",
      value: "desktop.nested.write",
      entry_path: ["desktop", "nested.write"],
    },
    true,
  ],
  [{ kind: "channel", value: "channel", entry_path: ["channel"] }, false],
] as const)(
  "validates seed %j at runtime and in the advertised schema",
  (seed, accepted) => {
    expect(seedSchema.safeParse(seed).success).toBe(accepted);
    expect(validateAdvertisedSeed(seed)).toBe(accepted);
  },
);

it("pairs the same empty IPC channel across application versions", async () => {
  const left = await analyzeSource(IPC_SOURCE);
  const right = await analyzeSource(`${IPC_SOURCE} // v2`);
  const leftChannels = ipcChannels(left.graph.nodes);
  const rightChannels = ipcChannels(right.graph.nodes);
  const matching = matchJavaScriptApplicationVersions(
    left.graph.nodes,
    right.graph.nodes,
  );
  expect(
    matching.pairs
      .filter(({ left: node }) => node.kind === "ipc-channel")
      .map(({ left: leftNode, right: rightNode }) => [
        leftChannels.get(leftNode.node_id),
        rightChannels.get(rightNode.node_id),
      ]),
  ).toEqual(
    expect.arrayContaining([
      ["", ""],
      ['""', '""'],
    ]),
  );
  expect(matching.unmatchedLeft.map(({ kind }) => kind)).not.toContain(
    "ipc-channel",
  );
});

it("selects an empty context-bridge API with an exact empty seed", async () => {
  const output = await analyzeSource(
    "const { contextBridge } = require('electron'); contextBridge.exposeInMainWorld('', {}); contextBridge.exposeInMainWorld('\"\"', {});",
  );
  const apis = new Map(
    output.graph.nodes
      .filter(({ kind }) => kind === "context-bridge-api")
      .map((node) => [node.node_id, node.observations[0]?.properties.api_key]),
  );
  const matches = findApplicationFeatureSeeds(output.graph.nodes, {
    kind: "api",
    value: "",
    match: "exact",
    case_sensitive: true,
  });
  expect(matches.map(({ node_id: nodeId }) => apis.get(nodeId))).toEqual([""]);
});

it("pairs indexed source-map leaves by raw source name and root", async () => {
  const map = (value: number) =>
    JSON.stringify({
      version: 3,
      sections: ["one", "two"].map((name, line) => ({
        offset: { line, column: 0 },
        map: {
          version: 3,
          sourceRoot: `../${name}`,
          sources: ["same.js"],
          sourcesContent: [`export const value = ${String(value)};`],
          names: [],
          mappings: "AAAA",
        },
      })),
    });
  const left = await analyzeSource("//# sourceMappingURL=app.js.map", {
    "app.js.map": map(1),
  });
  const right = await analyzeSource("//# sourceMappingURL=app.js.map", {
    "app.js.map": map(2),
  });
  const matching = matchJavaScriptApplicationVersions(
    left.graph.nodes,
    right.graph.nodes,
  );
  const originals = matching.pairs.filter(
    ({ left: node }) => node.kind === "source-module",
  );
  expect(originals).toHaveLength(2);
  for (const pair of originals) {
    expect(pair).toMatchObject({
      basis: "source-map-identity",
      confidence: "high",
    });
    expect(pair.left.identity).toMatchObject({
      original_source: "same.js",
      source_root: expect.any(String),
    });
    if (pair.left.identity.strategy !== "source-map-original")
      throw new Error("Expected source identity");
    expect(pair.right.identity).toMatchObject({
      source_root: pair.left.identity.source_root,
    });
  }
});

it("reports malformed source roots without manufacturing an original path", async () => {
  const output = await analyzeSource("//# sourceMappingURL=app.js.map", {
    "app.js.map": JSON.stringify({
      version: 3,
      sourceRoot: 42,
      sources: ["a.js"],
      names: [],
      mappings: "AAAA",
    }),
  });
  expect(
    output.graph.nodes.filter(({ kind }) => kind === "source-module"),
  ).toEqual([]);
  expect(
    output.graph.nodes.flatMap(({ observations }) => observations),
  ).toContainEqual(
    expect.objectContaining({
      properties: expect.objectContaining({
        limitation: "Source map sourceRoot must be a string or null.",
      }),
      evidence: expect.objectContaining({ state: "unavailable" }),
    }),
  );
});
