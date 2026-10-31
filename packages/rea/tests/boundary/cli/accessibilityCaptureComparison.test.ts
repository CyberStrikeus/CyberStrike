import { expect } from "vitest";

import { classifyBrowserCompleteness } from "../../../src/domain/browserCompleteness.js";
import type { WebPageInspection } from "../../../src/domain/browserObservationSchemas.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";
import { passiveNetworkCapture } from "../../fixtures/passiveNetworkCapture.js";

type Capture = WebPageInspection;
type Coverage =
  | "truncated"
  | "unavailable"
  | "attach_limited"
  | "policy_filtered";

const accessibleCapture = (): Capture => {
  const capture = passiveNetworkCapture();
  capture.accessibility = {
    total_nodes: 2,
    text_capture: {
      status: "included",
      retained_bytes: 10,
      excluded_fields: 0,
    },
    nodes: [
      {
        node_id: "root",
        parent_id: null,
        role: "RootWebArea",
        name: "Page",
        description: null,
        ignored: false,
        states: [],
      },
      {
        node_id: "button",
        parent_id: "root",
        role: "button",
        name: "Submit",
        description: null,
        ignored: false,
        states: [],
      },
    ],
  };
  return capture;
};

const setCoverage = (capture: Capture, coverage: Coverage): void => {
  capture.completeness = classifyBrowserCompleteness({
    policyFilteredSections: new Set(
      coverage === "policy_filtered" ? ["accessibility"] : [],
    ),
    attachLimitedSections: new Set(
      coverage === "attach_limited" ? ["accessibility"] : [],
    ),
    truncatedSections: new Set(
      coverage === "truncated" ? ["accessibility"] : [],
    ),
    unavailableSections: new Set(
      coverage === "unavailable" ? ["accessibility"] : [],
    ),
    excluded:
      coverage === "policy_filtered"
        ? [{ section: "accessibility", reason: "disallowed_origin", count: 1 }]
        : coverage === "unavailable"
          ? [
              {
                section: "accessibility",
                reason: "invalid_protocol_value",
                count: null,
              },
            ]
          : [],
    droppedEvents: {
      scripts: 0,
      network_requests: 0,
      console_events: 0,
      websocket_connections: 0,
      websocket_frames: 0,
      webmcp_tools: 0,
      timeline_events: 0,
    },
  });
};

const compare = async (cli: TestCli, before: Capture, after: Capture) =>
  await cli.run({
    arguments: [
      "compare-web-captures",
      JSON.stringify({ inspection: before }),
      JSON.stringify({ inspection: after }),
      "--json",
    ],
    environment: process.env,
  });

cliTest.for([
  "truncated",
  "unavailable",
  "attach_limited",
  "policy_filtered",
] as const)(
  "does not infer an accessibility change from a %s tree",
  { timeout: 60_000 },
  async (coverage, { cli }) => {
    const before = accessibleCapture();
    const after = structuredClone(before);
    after.accessibility.nodes.pop();
    after.accessibility.total_nodes = after.accessibility.nodes.length;
    after.accessibility.text_capture.retained_bytes = 4;
    setCoverage(after, coverage);

    const result = await compare(cli, before, after);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal).toBeNull();

    expect(result.json).toMatchObject({
      operation: "compare_web_captures",
      normalized_result: {
        dimensions: {
          accessibility: {
            status: "unknown",
            total_changes: 0,
            changes: [],
            reason: expect.stringContaining("incomplete"),
          },
        },
      },
    });
  },
);

cliTest(
  "keeps a count-mismatched tree unknown without a completeness marker",
  async ({ cli }) => {
    const before = accessibleCapture();
    const after = structuredClone(before);
    after.accessibility.total_nodes += 1;

    const result = await compare(cli, before, after);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal).toBeNull();

    expect(result.json).toMatchObject({
      normalized_result: {
        dimensions: {
          accessibility: { status: "unknown", total_changes: 0, changes: [] },
        },
      },
    });
  },
);

cliTest.for([
  ["known to missing role", "button", null, "unknown"],
  ["missing to known role", null, "button", "unknown"],
  ["both roles missing", null, null, "unknown"],
  ["known roles differ", "button", "link", "changed"],
] as const)(
  "does not infer role equality or change when %s",
  { timeout: 60_000 },
  async ([_label, beforeRole, afterRole, status], { cli }) => {
    const before = accessibleCapture();
    const after = structuredClone(before);
    before.accessibility.nodes[1]!.role = beforeRole;
    after.accessibility.nodes[1]!.role = afterRole;

    const result = await compare(cli, before, after);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal).toBeNull();

    expect(result.json).toMatchObject({
      normalized_result: {
        dimensions: {
          accessibility: {
            status,
            ...(status === "unknown"
              ? {
                  total_changes: 0,
                  changes: [],
                  reason: expect.stringContaining("incomplete"),
                }
              : {
                  total_changes: 1,
                  changes: [
                    { identity: "accessibility_tree", change: "modified" },
                  ],
                }),
          },
        },
      },
    });
  },
);

cliTest(
  "retains an independent accessibility difference when another role is missing",
  async ({ cli }) => {
    const before = accessibleCapture();
    const after = structuredClone(before);
    before.accessibility.nodes[1]!.role = null;
    after.accessibility.nodes[1]!.role = "button";
    after.accessibility.nodes[1]!.name = "Send";

    const result = await compare(cli, before, after);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal).toBeNull();

    expect(result.json).toMatchObject({
      normalized_result: {
        dimensions: {
          accessibility: {
            status: "changed",
            total_changes: 1,
            changes: [{ identity: "accessibility_tree", change: "modified" }],
          },
        },
      },
    });
  },
  60_000,
);

cliTest(
  "compares known structure when only text was not approved",
  async ({ cli }) => {
    const before = accessibleCapture();
    const after = structuredClone(before);
    after.accessibility.text_capture = {
      status: "not_approved",
      retained_bytes: 0,
      excluded_fields: 2,
    };
    for (const node of after.accessibility.nodes) {
      node.name = null;
      node.description = null;
    }
    after.completeness = classifyBrowserCompleteness({
      policyFilteredSections: new Set(["accessibility"]),
      attachLimitedSections: new Set(),
      truncatedSections: new Set(),
      unavailableSections: new Set(),
      excluded: [
        { section: "accessibility", reason: "not_approved", count: 2 },
      ],
      droppedEvents: {
        scripts: 0,
        network_requests: 0,
        console_events: 0,
        websocket_connections: 0,
        websocket_frames: 0,
        webmcp_tools: 0,
        timeline_events: 0,
      },
    });
    after.accessibility.nodes[1]!.role = "menuitem";

    const result = await compare(cli, before, after);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal).toBeNull();

    expect(result.json).toMatchObject({
      normalized_result: {
        dimensions: {
          accessibility: {
            status: "changed",
            total_changes: 1,
            changes: [{ identity: "accessibility_tree", change: "modified" }],
          },
        },
      },
    });
  },
);

cliTest(
  "keeps independent resource changes visible beside an unknown tree",
  async ({ cli }) => {
    const before = accessibleCapture();
    const after = structuredClone(before);
    after.accessibility.nodes.pop();
    after.accessibility.total_nodes = after.accessibility.nodes.length;
    setCoverage(after, "truncated");
    after.resources.push({
      resource_key: `res_${"a".repeat(64)}`,
      url: "https://app.example.test/new.css",
      origin: "https://app.example.test",
      type: "Stylesheet",
      mime_type: "text/css",
      content_size: 10,
    });

    const result = await compare(cli, before, after);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal).toBeNull();

    expect(result.json).toMatchObject({
      normalized_result: {
        overall_status: "changed",
        dimensions: {
          accessibility: { status: "unknown", total_changes: 0 },
          resources: { status: "changed", total_changes: 1 },
        },
      },
    });
  },
);
