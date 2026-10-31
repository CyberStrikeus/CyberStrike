import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

it("reports a candidate endpoint through the worker boundary in the public CLI", async () => {
  const root = await createTestTempDirectory("rea-endpoint-candidate-cli-");
  // Retain ambiguous requests while excluding type-erased collection/config reads.
  await writeFile(
    join(root, "main.ts"),
    `
    import * as vscode from "vscode";
    client.post("session");
    (client.get as any)("/api/items");
    const records = new Map([["/accounts", { name: "Alice" }]]);
    console.log(records.get("/accounts"));
    function inspect() {
      const records = new Map();
      const alias = records;
      return alias.get("/local-accounts");
    }
    fetch("/network");
    (new Headers().get as any)("content-type");
    (new URLSearchParams() as any).delete("q");
    ((vscode.workspace.getConfiguration("editor") as any).get as any)("tabSize");
    (context.globalState.get as any)("lastSession");
    const browser = window as Window;
    (browser.open as any)(method, "browser-context");
    const database = indexedDB as IDBFactory;
    (database.open as any)("fixture-db", "2");
    const cache = caches as CacheStorage;
    (cache.open as any)("fixture-cache");
  `,
  );
  for (const [name, source] of Object.entries({
    "escaped.mjs": `const box = {};
    box.prototype = Map.prototype;
    function patch(b) { b.prototype.get = fetch; }
    patch(box); new Map().get("/escaped");`,
    "returned.mjs":
      'patch((() => Map.prototype)()); new Map().get("/returned");',
    "opaque.mjs":
      'eval("Map.prototype.get = fetch"); new Map().get("/opaque");',
    "private.mjs":
      'const box = {}; box.prototype = Map.prototype; new Map().get("/private");',
    "returned-write.mjs":
      'const prototype = (() => Map.prototype)(); prototype.get = fetch; new Map().get("/returned-write");',
    "prototype.mjs":
      'Object.getPrototypeOf(new Map()).get = fetch; new Map().get("/prototype");',
    "indirect.mjs":
      'globalThis.eval("Map.prototype.get = fetch"); new Map().get("/indirect");',
    "late-link.mjs":
      'function store() { box.child.prototype = Map.prototype; } const box = {}; const inner = {}; box.child = inner; store(); patch(inner); new Map().get("/late-link");',
    "constructor.mjs":
      'new Map().constructor.prototype.get = fetch; new Map().get("/constructor");',
    "getter.mjs":
      'const holder = { get prototype() { return Map.prototype; } }; holder.prototype.get = fetch; new Map().get("/getter");',
    "assignment.mjs":
      'let run; (run = eval)("Map.prototype.get = fetch"); new Map().get("/assignment");',
  }))
    await writeFile(join(root, name), source);
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const result = javascriptApplicationAnalysisResultSchema.parse(
    parseEvidence(JSON.parse(stdout)).normalized_result,
  );
  expect
    .soft(
      result.graph.nodes
        .filter(({ kind }) => kind === "endpoint")
        .flatMap(({ observations }) =>
          observations.map(({ properties }) => properties.value),
        )
        .sort(),
    )
    .toEqual([
      "/api/items",
      "/assignment",
      "/constructor",
      "/escaped",
      "/getter",
      "/indirect",
      "/late-link",
      "/network",
      "/opaque",
      "/prototype",
      "/returned",
      "/returned-write",
      "session",
    ]);
  for (const value of [
    "/api/items",
    "/assignment",
    "/constructor",
    "/escaped",
    "/getter",
    "/indirect",
    "/late-link",
    "/opaque",
    "/prototype",
    "/returned",
    "/returned-write",
  ]) {
    const escaped = result.graph.nodes.find(
      ({ kind, observations }) =>
        kind === "endpoint" &&
        observations.some(({ properties }) => properties.value === value),
    );
    expect(escaped?.observations[0]).toMatchObject({
      properties: { interpretation: "candidate" },
      evidence: { state: "inferred", confidence: "low" },
    });
  }
  const request = result.graph.nodes.find(
    ({ kind, observations }) =>
      kind === "endpoint" &&
      observations.some(({ properties }) => properties.value === "/network"),
  );
  expect(request?.observations[0]?.evidence).toMatchObject({
    state: "observed",
    confidence: "exact",
  });
  expect(
    result.graph.nodes
      .filter(({ kind }) => kind === "storage")
      .flatMap(({ observations }) =>
        observations.map(
          ({ properties }) =>
            `${String(properties.storage_kind)}:${String(properties.name)}`,
        ),
      )
      .sort(),
  ).toEqual(["cache-storage:fixture-cache", "indexed-db:fixture-db"]);
  const endpoint = result.graph.nodes.find(
    ({ kind, observations }) =>
      kind === "endpoint" &&
      observations.some(({ properties }) => properties.value === "session"),
  );
  expect(endpoint?.observations[0]).toMatchObject({
    properties: {
      endpoint_kind: "network",
      value: "session",
      mechanism: "call:client.post",
      interpretation: "candidate",
    },
    evidence: { state: "inferred", confidence: "low" },
  });
  const edge = result.graph.edges.find(
    ({ target_node_id }) => target_node_id === endpoint?.node_id,
  );
  expect(edge?.properties).toMatchObject({ interpretation: "candidate" });
}, 20_000);

it("preserves SQLite constructor certainty through the public worker and graph", async () => {
  const root = await createTestTempDirectory("rea-storage-candidate-cli-");
  await writeFile(
    join(root, "main.mjs"),
    `
    import Known from "better-sqlite3";
    class Database { constructor(name) { this.name = name; } }
    new Database("local");
    function uncertain(Database) { return new Database("shared"); }
    { const Database = Known; new Database("shared"); }
  `,
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const result = javascriptApplicationAnalysisResultSchema.parse(
    parseEvidence(JSON.parse(stdout)).normalized_result,
  );
  const storage = result.graph.nodes.filter((node) => node.kind === "storage");
  expect(storage).toHaveLength(2);
  const candidate = storage.find(
    (node) => node.observations[0]?.properties.interpretation === "candidate",
  );
  const observed = storage.find(
    (node) => node.observations[0]?.properties.interpretation === undefined,
  );
  expect(candidate?.node_id).not.toBe(observed?.node_id);
  expect(candidate?.observations[0]).toMatchObject({
    properties: { storage_kind: "sqlite", name: "shared" },
    evidence: {
      state: "inferred",
      confidence: "low",
      limitations: expect.arrayContaining([
        expect.stringContaining("only a candidate"),
      ]),
    },
  });
  expect(observed?.observations[0]).toMatchObject({
    properties: { storage_kind: "sqlite", name: "shared" },
    evidence: { state: "observed", confidence: "exact" },
  });
  expect(
    result.graph.edges.find(
      (edge) => edge.target_node_id === candidate?.node_id,
    ),
  ).toMatchObject({
    properties: { interpretation: "candidate" },
    evidence: {
      confidence: "low",
      limitations: expect.arrayContaining([
        expect.stringContaining("only a candidate"),
      ]),
    },
  });
}, 20_000);
