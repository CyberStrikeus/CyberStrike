import { describe, expect, it } from "vitest";

import { createBrowserEvidence } from "./BrowserEvidence.js";
import {
  analyzeWebBundleInputSchema,
  webBundleAnalysisSchema,
} from "../domain/webBundleAnalysis.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };

const result = webBundleAnalysisSchema.parse({
  capture: {
    target_url: "https://app.example.test/dashboard?token=redacted",
    target_origin: "https://app.example.test",
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

const input = (allowedOrigins: string[]) =>
  analyzeWebBundleInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "page-1",
    observation_ms: 0,
    allowed_origins: allowedOrigins,
  });

describe("web bundle Evidence origin scope", () => {
  it("records the captured target origin when the request uses the default scope", () => {
    const evidence = createBrowserEvidence(
      "analyze_web_bundle",
      input([]),
      result,
      provider,
    );

    expect(evidence.parameters.allowed_origins).toEqual([
      "https://app.example.test",
    ]);
  });

  it("preserves an explicit caller origin scope", () => {
    const evidence = createBrowserEvidence(
      "analyze_web_bundle",
      input(["https://explicit.example.test"]),
      result,
      provider,
    );

    expect(evidence.parameters.allowed_origins).toEqual([
      "https://explicit.example.test",
    ]);
  });

  it("does not infer an origin from a URL without one", () => {
    const evidence = createBrowserEvidence(
      "analyze_web_bundle",
      input([]),
      webBundleAnalysisSchema.parse({
        ...result,
        capture: {
          ...result.capture,
          target_url: "file:///tmp/app.html",
          target_origin: null,
        },
      }),
      provider,
    );

    expect(evidence.parameters.allowed_origins).toEqual([]);
  });

  it("does not infer a non-HTTP origin from a bundle URL", () => {
    const evidence = createBrowserEvidence(
      "analyze_web_bundle",
      input([]),
      webBundleAnalysisSchema.parse({
        ...result,
        capture: {
          ...result.capture,
          target_url: "ftp://host/app",
          target_origin: null,
        },
      }),
      provider,
    );

    expect(evidence.parameters.allowed_origins).toEqual([]);
  });
});
