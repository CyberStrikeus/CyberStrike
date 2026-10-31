import { describe, expect, it } from "vitest";

import { createEvidence } from "./evidence.js";
import {
  createEvidenceBundle,
  parseEvidenceBundle,
  serializeEvidenceBundle,
} from "./evidenceBundle.js";
import {
  webMcpDiscoverySchema,
  type WebMcpDiscovery,
} from "./webMcpDiscovery.js";

const PROVIDER = { id: "fixture", name: "Fixture provider", version: "1" };

const discovery = (annotations: Record<string, unknown>): WebMcpDiscovery =>
  webMcpDiscoverySchema.parse({
    browser: {
      product: "Chrome",
      protocol_version: "1.3",
      revision: "test",
      user_agent: "test",
      js_version: "test",
    },
    target: {
      target_id: "page-1",
      url: "http://127.0.0.1:3000/",
      origin: "http://127.0.0.1:3000",
    },
    status: "available",
    tools: {
      total: 1,
      items: [
        {
          tool_key: `webmcp_${"a".repeat(64)}`,
          name: "book_flight",
          description: "Book a flight",
          frame_id: "frame-main",
          frame_url: "http://127.0.0.1:3000/",
          owner_origin: "http://127.0.0.1:3000",
          declaration_kind: "imperative",
          input_schema: null,
          input_schema_sha256: null,
          annotations,
          registration_source: null,
          trust: "page-declared-untrusted",
        },
      ],
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
    limitations: [],
  });

describe("WebMCP discovery consequential annotation", () => {
  it.each([true, false, null])(
    "preserves a declared consequential value of %s",
    (consequential) => {
      const parsed = discovery({
        read_only: null,
        untrusted_content: null,
        consequential,
        autosubmit: null,
      });
      expect(parsed.tools.items[0]?.annotations.consequential).toBe(
        consequential,
      );
    },
  );

  it("admits historical captures recorded before consequential was surfaced", () => {
    const parsed = discovery({
      read_only: true,
      untrusted_content: null,
      autosubmit: false,
    });
    expect(parsed.tools.items[0]?.annotations.consequential).toBeUndefined();
  });

  it("survives the Evidence bundle export and re-read round-trip", () => {
    const result = discovery({
      read_only: null,
      untrusted_content: null,
      consequential: true,
      autosubmit: null,
    });
    const evidence = createEvidence(undefined, PROVIDER, {
      predicateType: "rea.webmcp-discovery",
      operation: "discover_webmcp_tools",
      parameters: {},
      result,
    });
    const bundle = createEvidenceBundle([evidence]);
    const reread = parseEvidenceBundle(
      JSON.parse(serializeEvidenceBundle(bundle)),
    );
    const record = reread.records[0];
    expect(record?.normalized_result).toMatchObject({
      tools: {
        items: [
          {
            annotations: {
              consequential: true,
            },
          },
        ],
      },
    });
  });
});
