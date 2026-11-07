import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { webCaptureDiffSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import {
  passiveNetworkCapture,
  withPassiveDroppedEvents,
} from "../../fixtures/passiveNetworkCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

const comparisonCases = () => {
  const before = passiveNetworkCapture();
  const after = passiveNetworkCapture(["/a", "/b"]);
  const incomplete = structuredClone(before);
  incomplete.completeness.attach_limited_sections.push("network_requests");
  const wsBefore = structuredClone(before);
  const wsAfter = structuredClone(after);
  for (const capture of [wsBefore, wsAfter])
    capture.completeness.attach_limited_sections.push(
      "websocket_connections",
      "websocket_frames",
    );
  wsAfter.network.websocket_connections.push({
    request_id: "ws",
    url: "wss://app.example.test/live",
    events: [],
  });
  const repeated = passiveNetworkCapture(["/a", "/a"]);
  const repeatedUnknown = structuredClone(repeated);
  repeatedUnknown.network.requests[1]!.resource_type = null;
  const unknownIdentity = structuredClone(before);
  unknownIdentity.network.requests[0]!.resource_type = null;
  const unknownIdentityAdded = structuredClone(after);
  unknownIdentityAdded.network.requests[0]!.resource_type = null;
  const unselectedUnknownIdentity = structuredClone(unknownIdentity);
  unselectedUnknownIdentity.completeness.excluded.push({
    section: "json_body_shapes",
    reason: "not_approved",
    count: null,
  });
  unselectedUnknownIdentity.network.requests[0]!.body_shapes.status =
    "not_approved";
  const droppedRequest = withPassiveDroppedEvents(before, {
    network_requests: 1,
  });
  const droppedWebSocket = withPassiveDroppedEvents(before, {
    websocket_connections: 1,
    websocket_frames: 1,
  });
  const unrelatedDrop = withPassiveDroppedEvents(before, {
    console_events: 1,
  });
  const droppedUnselected = withPassiveDroppedEvents(structuredClone(before), {
    network_requests: 1,
  });
  droppedUnselected.completeness.excluded.push({
    section: "json_body_shapes",
    reason: "not_approved",
    count: null,
  });
  droppedUnselected.network.requests[0]!.body_shapes.status = "not_approved";
  const droppedRepeated = withPassiveDroppedEvents(before, {
    network_requests: 1,
  });
  const redirectKnown = structuredClone(before);
  redirectKnown.network.requests[0]!.redirects = [
    {
      url: "https://app.example.test/start",
      response_url: "https://app.example.test/start",
      method: "GET",
      resource_type: "Document",
      status: 302,
      mime_type: "text/html",
      encoded_data_length: 20,
      request_timestamp: 1,
      redirect_event_timestamp: 2,
    },
  ];
  const redirectUnknown = structuredClone(redirectKnown);
  redirectUnknown.network.requests[0]!.redirects![0]!.resource_type = null;
  return [
    ["added", before, after, "added"],
    ["removed", after, before, "removed"],
    ["equal unavailable", before, before, null],
    ["incomplete inventory", incomplete, after, null],
    ["limited WebSocket inventory", wsBefore, wsAfter, "added"],
    ["repeated request type uncertainty", repeated, repeatedUnknown, null],
    [
      "repeated request type uncertainty reversed",
      repeatedUnknown,
      repeated,
      null,
    ],
    ["unknown request identity", before, unknownIdentity, null],
    ["unknown request identity reversed", unknownIdentity, before, null],
    [
      "unknown identity without selected shapes",
      unselectedUnknownIdentity,
      unselectedUnknownIdentity,
      null,
    ],
    [
      "different URL beside unknown identity",
      before,
      unknownIdentityAdded,
      "added",
    ],
    ["dropped request count", droppedRequest, after, null],
    ["dropped request count reversed", after, droppedRequest, null],
    [
      "dropped request with shapes unselected",
      droppedUnselected,
      droppedUnselected,
      null,
    ],
    [
      "WebSocket drops do not hide HTTP additions",
      droppedWebSocket,
      after,
      "added",
    ],
    [
      "unrelated drops do not hide HTTP additions",
      unrelatedDrop,
      after,
      "added",
    ],
    [
      "duplicate samples with dropped inventory",
      droppedRepeated,
      repeated,
      null,
    ],
    [
      "duplicate samples with dropped inventory reversed",
      repeated,
      droppedRepeated,
      null,
    ],
    ["unknown redirect type", redirectKnown, redirectUnknown, null],
    ["unknown redirect type reversed", redirectUnknown, redirectKnown, null],
  ] as const;
};

const cases = comparisonCases().map(([name, left, right, change]) => ({
  name,
  left,
  right,
  change,
}));

const expectComparison = (
  document: unknown,
  name: string,
  change: "added" | "removed" | null,
): void => {
  const evidence = parseEvidence(document);
  expect(evidence.operation).toBe("compare_web_captures");
  const result = webCaptureDiffSchema.parse(evidence.normalized_result);
  expect(result.dimensions.network, name).toMatchObject({
    status: change === null ? "unknown" : "changed",
    total_changes: change === null ? 0 : 1,
    changes:
      change === null
        ? []
        : [{ identity: expect.stringMatching(/^net_/u), change }],
  });
  expect(result.overall_status).toBe(change === null ? "unknown" : "changed");
};

cliTest.for(cases)(
  "CLI preserves passive inventory evidence: $name",
  async ({ name, left, right, change }, { cli }) => {
    const root = await createTestTempDirectory("rea-passive-inventory-");
    const paths = [
      join(root, "before.json"),
      join(root, "after.json"),
    ] as const;
    const serialized = [
      JSON.stringify({ inspection: left }),
      JSON.stringify({ inspection: right }),
    ];
    await Promise.all(
      paths.map((path, index) => writeFile(path, serialized[index]!)),
    );
    const options = {
      arguments: ["compare-web-captures", ...paths, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    };
    const response = await (name === "added" || name === "removed"
      ? cli.run(options)
      : runFileCli(cli, options));
    expect(response.exitCode, response.stderr).toBe(0);
    expectComparison(response.json, name, change);
    expect(
      await Promise.all(paths.map((path) => readFile(path, "utf8"))),
    ).toEqual(serialized);
  },
);

cliTest(
  "stdio MCP preserves passive inventory evidence on one owned connection",
  async () => {
    const mcp = await connectLocalToolsMcp();
    for (const { name, left, right, change } of cases) {
      const response = await mcp.call("compare_web_captures", {
        before: { inspection: left },
        after: { inspection: right },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectComparison(response.structuredContent, name, change);
    }
  },
);
