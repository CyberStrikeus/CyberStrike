import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";
import { z } from "zod";

import { createBrowserEvidence } from "../../../src/application/BrowserEvidence.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { analyzeFixture } from "../../fixtures/javascriptRuntimeReconciliation.js";
import { passiveNetworkCapture } from "../../fixtures/passiveNetworkCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

const reconciledSchema = z.object({
  normalized_result: z.object({
    reconciliations: z.array(
      z.object({
        entity_kind: z.string(),
        runtime_node_id: z.string(),
        static_node_id: z.string().nullable(),
        status: z.string(),
        basis: z.string(),
        confidence: z.string(),
        reason: z.string(),
      }),
    ),
    static_load_states: z.array(
      z.object({
        static_node_id: z.string(),
        kind: z.string(),
        status: z.string(),
        reason: z.string(),
      }),
    ),
    graph: z.object({
      nodes: z.array(
        z.object({
          node_id: z.string(),
          observations: z.array(
            z.object({
              properties: z.record(z.string(), z.unknown()),
            }),
          ),
        }),
      ),
      edges: z.array(
        z.object({
          relation: z.string(),
          source_node_id: z.string(),
          target_node_id: z.string(),
        }),
      ),
    }),
  }),
});

/** Reconcile one source-free browser capture under `${origin}/assets/`. */
const reconcileThroughCli = async (
  root: string,
  analysis: Awaited<ReturnType<typeof analyzeFixture>>,
  suffixes: readonly string[],
) => {
  const inspection = passiveNetworkCapture([]);
  const origin = inspection.target.origin;
  inspection.frames = [
    { frame_id: "frame-main", parent_frame_id: null, url: origin, origin },
  ];
  inspection.scripts = {
    total: suffixes.length,
    items: suffixes.map((suffix, index) => ({
      script_key: `scr_${String(index).padStart(64, "0")}`,
      frame_id: "frame-main",
      url: `${origin}/assets/${suffix}`,
      origin,
      cdp_hash: null,
      length: null,
      is_module: true,
      language: "JavaScript",
      source_map_url: null,
      resource_reconciliation: {
        status: "unmatched",
        reason: "no_exact_sanitized_url",
      },
      source: { included: false, reason: "not-requested" },
    })),
  };
  const runtime = createBrowserEvidence(
    "inspect_web_page",
    inspectWebPageInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "page",
      allowed_origins: [origin],
      observation_ms: 0,
      include_script_sources: false,
    }),
    inspection,
    {
      id: "rea-cdp-browser",
      name: "REA Chrome DevTools Protocol observation provider",
      version: "2",
    },
  );
  const inputPath = join(root, "reconciliation.json");
  await writeFile(
    inputPath,
    JSON.stringify({
      static_layers: [
        {
          role: "application",
          analysis,
          runtime_mappings: [
            {
              kind: "url-prefix",
              prefix: `${origin}/assets/`,
              artifact_prefix: "",
            },
          ],
        },
      ],
      runtime_observations: [runtime],
    }),
  );
  const { stdout, stderr } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "reconcile-javascript-runtime", inputPath, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1_024 * 1_024 },
  );
  expect(stderr).toBe("");
  const result = reconciledSchema.parse(JSON.parse(stdout)).normalized_result;
  const nodes = new Map(result.graph.nodes.map((node) => [node.node_id, node]));
  const property = (nodeId: string | null, key: string) =>
    nodeId === null
      ? null
      : (nodes
          .get(nodeId)
          ?.observations.map(({ properties }) => properties[key])
          .find((value) => typeof value === "string") ?? null);
  const pathOf = (nodeId: string | null) => property(nodeId, "path");
  const scripts = new Map(
    result.reconciliations
      .filter(({ entity_kind }) => entity_kind === "script")
      .map((item) => [
        String(property(item.runtime_node_id, "location")).slice(
          `${origin}/assets/`.length,
        ),
        {
          status: item.status,
          basis: item.basis,
          reason: item.reason,
          path: pathOf(item.static_node_id),
          observed_as: result.graph.edges.filter(
            ({ relation, source_node_id, target_node_id }) =>
              relation === "observed_as" &&
              [source_node_id, target_node_id].includes(item.runtime_node_id),
          ).length,
        },
      ]),
  );
  const loadStates = new Map(
    result.static_load_states
      .filter(({ kind }) => kind === "javascript-asset")
      .map((state) => [
        pathOf(state.static_node_id),
        { status: state.status, reason: state.reason },
      ]),
  );
  return { scripts, loadStates };
};

const unmappedLocation = {
  status: "unknown",
  basis: "none",
  reason: "no-authorized-location-mapping",
  path: null,
  observed_as: 0,
};

const mappedLocation = (path: string) => ({
  status: "matched",
  basis: "operator-url-mapping",
  reason: "unique-location-match",
  path,
  observed_as: 1,
});

it(
  "matches a source-free webpack script to its containing asset",
  async () => {
    const root = await createTestTempDirectory("rea-url-bundler-asset-");
    temporary.push(root);
    await mkdir(join(root, "chunks"));
    await writeFile(
      join(root, "chunks", "runtime.js"),
      '(globalThis["webpackChunkfixture"] = globalThis["webpackChunkfixture"] || []).push([["main"],{1:(module)=>{module.exports=1;}},(__webpack_require__)=>{__webpack_require__(1);}]);\n',
    );
    const analysis = await analyzeFixture(root);
    const result = await reconcileThroughCli(root, analysis, [
      "chunks/runtime.js",
    ]);
    expect(result.scripts.get("chunks/runtime.js")).toEqual(
      mappedLocation("chunks/runtime.js"),
    );
    expect(result.loadStates.get("chunks/runtime.js")).toEqual({
      status: "loaded",
      reason: "runtime-script-correspondence",
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "keeps an encoded slash inside one URL segment rather than naming a nested artifact",
  async () => {
    const root = await createTestTempDirectory("rea-url-prefix-segments-");
    temporary.push(root);
    await mkdir(join(root, "child"));
    await Promise.all([
      writeFile(join(root, "child", "part.js"), "export const nested = 1;\n"),
      writeFile(join(root, "child%2Fpart.js"), "export const literal = 2;\n"),
      writeFile(join(root, "sp ace.js"), "export const space = 3;\n"),
      writeFile(join(root, "é.js"), "export const accent = 4;\n"),
    ]);
    const analysis = await analyzeFixture(root);

    const { scripts } = await reconcileThroughCli(root, analysis, [
      "child/part.js",
      "child/part.js?v=%2F#f%2F",
      "child%2Fpart.js",
      "child%2fpart.js",
      "child%252Fpart.js",
      "sp%20ace.js",
      "%C3%A9.js",
      "child/%E0.js",
    ]);

    expect(Object.fromEntries(scripts)).toEqual({
      "child/part.js": mappedLocation("child/part.js"),
      "child/part.js?v=%2F#f%2F": mappedLocation("child/part.js"),
      "child%2Fpart.js": unmappedLocation,
      "child%2fpart.js": unmappedLocation,
      "child%252Fpart.js": mappedLocation("child%2Fpart.js"),
      "sp%20ace.js": mappedLocation("sp ace.js"),
      "%C3%A9.js": mappedLocation("é.js"),
      "child/%E0.js": unmappedLocation,
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "keeps static load state unknown beneath a prefix whose runtime script had no artifact path",
  async () => {
    const root = await createTestTempDirectory("rea-url-prefix-load-state-");
    temporary.push(root);
    await mkdir(join(root, "child"));
    await Promise.all([
      writeFile(join(root, "child", "part.js"), "export const nested = 1;\n"),
      writeFile(join(root, "other.js"), "export const other = 2;\n"),
    ]);
    const analysis = await analyzeFixture(root);

    const control = await reconcileThroughCli(root, analysis, ["other.js"]);
    expect(Object.fromEntries(control.loadStates)).toEqual({
      "child/part.js": {
        status: "not-observed-in-capture",
        reason: "not-observed-in-bounded-capture",
      },
      "other.js": {
        status: "loaded",
        reason: "runtime-script-correspondence",
      },
    });

    const encoded = await reconcileThroughCli(root, analysis, [
      "other.js",
      "child%2Fpart.js",
    ]);
    expect(encoded.scripts.get("child%2Fpart.js")).toEqual(unmappedLocation);
    expect(Object.fromEntries(encoded.loadStates)).toEqual({
      "child/part.js": {
        status: "unknown",
        reason: "static-or-runtime-coverage-incomplete",
      },
      "other.js": {
        status: "loaded",
        reason: "runtime-script-correspondence",
      },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
