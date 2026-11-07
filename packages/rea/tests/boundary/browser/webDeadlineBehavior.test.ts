import { expect, it } from "vitest";

import { createBrowserEvidence } from "../../../src/application/BrowserEvidence.js";
import { CDP_BROWSER_PROVIDER_IDENTITY } from "../../../src/browser/providerIdentities.js";
import { listBrowserTargetsInputSchema } from "../../../src/domain/browserObservation.js";
import { browserTargetListSchema } from "../../../src/domain/browserObservationSchemas.js";
import {
  analyzeWebBundleInputSchema,
  webBundleAnalysisSchema,
} from "../../../src/domain/webBundleAnalysis.js";

const targetList = browserTargetListSchema.parse({
  browser: {
    product: "FakeChrome/1.0",
    protocol_version: "1.3",
    revision: "fake-revision",
    user_agent: "FakeChrome",
    js_version: "13.0",
  },
  targets: [],
  excluded: { disallowed_origin: 0, unsupported_url: 0, non_page: 0 },
  limitations: [],
});

const bundle = webBundleAnalysisSchema.parse({
  capture: {
    target_url: "https://example.test/",
    scripts_observed: 0,
    scripts_analyzed: 0,
    source_artifacts: [],
  },
  observations: {
    chunks: { nodes: [], edges: [] },
    routes: [],
    endpoints: [],
    webmcp_declarations: [],
    source_maps: {
      status: "not_requested",
      requested: 0,
      processed: 0,
      items: [],
    },
  },
  inferences: [],
  unknowns: [],
  completeness: {
    status: "complete",
    parsed_scripts: 0,
    parse_failures: 0,
    visited_ast_nodes: 0,
  },
  limitations: [],
});

it("records an explicit command deadline and omits the default", () => {
  const base = {
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "page",
    fetch_source_maps: false,
  };
  const explicit = createBrowserEvidence(
    "analyze_web_bundle",
    analyzeWebBundleInputSchema.parse({
      ...base,
      command_timeout_ms: 1_500,
    }),
    bundle,
    CDP_BROWSER_PROVIDER_IDENTITY,
  );
  expect(explicit.parameters.command_timeout_ms).toBe(1_500);
  const omitted = createBrowserEvidence(
    "analyze_web_bundle",
    analyzeWebBundleInputSchema.parse(base),
    bundle,
    CDP_BROWSER_PROVIDER_IDENTITY,
  );
  expect(omitted.parameters).not.toHaveProperty("command_timeout_ms");
});

it("rejects a command deadline on target listing and leaves it out of Evidence", () => {
  expect(
    listBrowserTargetsInputSchema.safeParse({
      cdp_endpoint: "http://127.0.0.1:9222",
      command_timeout_ms: 1_500,
    }).success,
  ).toBe(false);
  const evidence = createBrowserEvidence(
    "list_browser_targets",
    listBrowserTargetsInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
    }),
    targetList,
    CDP_BROWSER_PROVIDER_IDENTITY,
  );
  expect(evidence.parameters).not.toHaveProperty("command_timeout_ms");
});

it("records an explicit source-map fetch deadline and omits the default", () => {
  const base = {
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "page",
    fetch_source_maps: true,
  };
  const explicit = createBrowserEvidence(
    "analyze_web_bundle",
    analyzeWebBundleInputSchema.parse({
      ...base,
      source_map_fetch_timeout_ms: 1_500,
    }),
    bundle,
    CDP_BROWSER_PROVIDER_IDENTITY,
  );
  expect(explicit.parameters.source_map_fetch_timeout_ms).toBe(1_500);
  const omitted = createBrowserEvidence(
    "analyze_web_bundle",
    analyzeWebBundleInputSchema.parse(base),
    bundle,
    CDP_BROWSER_PROVIDER_IDENTITY,
  );
  expect(omitted.parameters).not.toHaveProperty("source_map_fetch_timeout_ms");
});
