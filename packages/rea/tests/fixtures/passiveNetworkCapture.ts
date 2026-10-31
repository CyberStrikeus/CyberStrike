import { webPageInspectionSchema } from "../../src/domain/browserObservationSchemas.js";
import type { WebPageInspection } from "../../src/domain/browserObservationSchemas.js";
import {
  classifyBrowserCompleteness,
  type BrowserDroppedEventKind,
} from "../../src/domain/browserCompleteness.js";

/** Owned normalized comparison input, not a claim about live CDP inventory coverage. */
export const passiveNetworkCapture = (paths: readonly string[] = ["/a"]) => {
  const origin = "https://app.example.test";
  const timestamp = "2026-10-14T00:00:00.000Z";
  return webPageInspectionSchema.parse({
    browser: {
      product: "normalized-fixture",
      protocol_version: "1.3",
      revision: "fixture",
      user_agent: "fixture",
      js_version: "fixture",
    },
    target: {
      target_id: "page",
      type: "page",
      title: "Fixture",
      url: origin,
      origin,
      attached: false,
    },
    capture_window: {
      started_at: timestamp,
      ended_at: timestamp,
      observation_ms: 0,
    },
    completeness: {
      status: "complete_within_window",
      conditions: ["complete_within_window"],
      policy_filtered_sections: [],
      attach_limited_sections: [],
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
    network: {
      requests: paths.map((path, index) => ({
        request_id: `request-${String(index)}`,
        url: `${origin}${path}`,
        origin,
        method: "GET",
        resource_type: "Document",
        status: 200,
        mime_type: "text/html",
        encoded_data_length: 10,
        initiator: { type: "parser", url: null, line: null, column: null },
        body_shapes: { status: "unavailable", request: null, response: null },
      })),
      websocket_connections: [],
      coverage_started_at: timestamp,
      prior_activity_available: false,
    },
    frames: [],
    dom: { total_nodes: 0, nodes: [] },
    accessibility: {
      total_nodes: 0,
      nodes: [],
      text_capture: {
        status: "not_approved",
        retained_bytes: 0,
        excluded_fields: 0,
      },
    },
    scripts: { total: 0, items: [] },
    resources: [],
    workers: [],
    console: {
      events: [],
      coverage_started_at: timestamp,
      prior_activity_available: false,
    },
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
    limitations: [
      "Synthetic normalized inventory for offline comparison tests; not recorded from a live browser.",
    ],
  });
};

/** Use the production completeness classifier without inventing section-list entries. */
export const withPassiveDroppedEvents = (
  capture: WebPageInspection,
  dropped: Partial<Record<BrowserDroppedEventKind, number>>,
): WebPageInspection => {
  const { completeness } = capture;
  const { total: _total, ...counts } = completeness.dropped_events;
  return {
    ...capture,
    completeness: classifyBrowserCompleteness({
      policyFilteredSections: new Set(completeness.policy_filtered_sections),
      attachLimitedSections: new Set(completeness.attach_limited_sections),
      truncatedSections: new Set(completeness.truncated_sections),
      unavailableSections: new Set(completeness.unavailable_sections),
      excluded: completeness.excluded,
      droppedEvents: { ...counts, ...dropped },
    }),
  };
};
