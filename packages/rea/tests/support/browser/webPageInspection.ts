import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { createWebTextArtifact } from "../../../src/domain/webContentArtifact.js";

export interface WebPageScriptFixture {
  source: string;
  scriptKey: string;
  url: string;
  origin: string;
  cdpHash: string;
}

const origin = "https://app.example.test";

export const createWebPageInspection = (
  scripts: readonly WebPageScriptFixture[],
) =>
  webPageInspectionSchema.parse({
    browser: {
      product: "Fake Chrome",
      protocol_version: "1.3",
      revision: "1",
      user_agent: "fake",
      js_version: "1",
    },
    target: {
      target_id: "page-1",
      type: "page",
      title: "App",
      url: `${origin}/app`,
      origin,
      attached: false,
    },
    capture_window: {
      started_at: "2026-07-14T00:00:00.000Z",
      ended_at: "2026-07-14T00:00:01.000Z",
      observation_ms: 1_000,
    },
    completeness: {
      status: "attach_limited",
      conditions: ["attach_limited"],
      policy_filtered_sections: [],
      attach_limited_sections: ["network_requests"],
      truncated_sections: [],
      unavailable_sections: [],
      excluded: [],
      dropped_events: {
        scripts: 0,
        network_requests: 0,
        console_events: 0,
        websocket_connections: 0,
        websocket_frames: 0,
        webmcp_tools: 0,
        timeline_events: 0,
        total: 0,
      },
    },
    frames: [],
    dom: { total_nodes: 0, nodes: [] },
    accessibility: {
      total_nodes: 0,
      text_capture: {
        status: "not_approved",
        retained_bytes: 0,
        excluded_fields: 0,
      },
      nodes: [],
    },
    scripts: {
      total: scripts.length,
      items: scripts.map(
        ({ source, scriptKey, url, origin: scriptOrigin, cdpHash }) => ({
          script_key: scriptKey,
          url,
          origin: scriptOrigin,
          cdp_hash: cdpHash,
          length: Buffer.byteLength(source),
          is_module: true,
          language: "JavaScript",
          source_map_url: null,
          resource_reconciliation: {
            status: "unmatched",
            reason: "no_exact_sanitized_url",
          },
          source: {
            included: true,
            artifact: createWebTextArtifact(source, "text/javascript"),
          },
        }),
      ),
    },
    resources: [],
    network: {
      requests: [],
      websocket_connections: [],
      coverage_started_at: "2026-07-14T00:00:00.000Z",
      prior_activity_available: false,
    },
    console: {
      events: [],
      coverage_started_at: "2026-07-14T00:00:00.000Z",
      prior_activity_available: false,
    },
    workers: [],
    metadata: {
      responses: [],
      dom_urls: [],
      agent_hints: [],
      excluded_dom_urls: 0,
      headers_allowlisted: true,
    },
    storage: {
      origin,
      usage_bytes: null,
      quota_bytes: null,
      local_storage_keys: [],
      session_storage_keys: [],
      indexed_db_names: [],
      cache_names: [],
      values_redacted: true,
    },
    limitations: [],
  });
