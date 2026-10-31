import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { createWebTextArtifact } from "../../../src/domain/webContentArtifact.js";
import { stableWebScriptKey } from "../../../src/domain/webInventory.js";
import type { WebMcpDiscovery } from "../../../src/domain/webMcpDiscovery.js";
import {
  type CompareWebCapturesInput,
  type WebCaptureDiff,
  webCaptureDiffSchema,
} from "../../../src/domain/webCaptureDiffSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import {
  passiveNetworkCapture,
  withPassiveDroppedEvents,
} from "../../fixtures/passiveNetworkCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

type Capture = {
  inspection: CompareWebCapturesInput["before"]["inspection"];
  webmcp?: WebMcpDiscovery | null;
};
type Case = {
  name: string;
  before: Capture;
  after: Capture;
  dimension: keyof WebCaptureDiff["dimensions"];
  status: "changed" | "unknown" | "unchanged";
};
const cases: Case[] = [];
const add = (
  name: string,
  before: Capture,
  after: Capture,
  dimension: Case["dimension"],
  status: Case["status"],
) => cases.push({ name, before, after, dimension, status });
const unselectedCapture = (paths: readonly string[] = []) => {
  const capture = passiveNetworkCapture(paths);
  capture.completeness.excluded.push({
    section: "json_body_shapes",
    reason: "not_approved",
    count: null,
  });
  for (const request of capture.network.requests)
    request.body_shapes.status = "not_approved";
  return capture;
};
const full = unselectedCapture(["/a", "/a"]);
full.network.requests[1]!.status = 503;
for (const retained of [0, 1]) {
  const omitted = structuredClone(full);
  omitted.network.requests = [omitted.network.requests[retained]!];
  const partial = withPassiveDroppedEvents(omitted, { network_requests: 1 });
  add(
    `heterogeneous HTTP omission ${retained}`,
    { inspection: full },
    { inspection: partial },
    "network",
    "unknown",
  );
  add(
    `heterogeneous HTTP omission ${retained} reversed`,
    { inspection: partial },
    { inspection: full },
    "network",
    "unknown",
  );
}
const changedResponse = structuredClone(full);
const small = unselectedCapture(["/a"]);
const largerPartial = withPassiveDroppedEvents(
  unselectedCapture(["/a", "/b"]),
  { network_requests: 1 },
);
add(
  "partial inventory retains a request absent from complete peer",
  { inspection: small },
  { inspection: largerPartial },
  "network",
  "changed",
);
add(
  "partial inventory retains a request absent from complete peer reversed",
  { inspection: largerPartial },
  { inspection: small },
  "network",
  "changed",
);
changedResponse.network.requests[1]!.status = 404;
add(
  "complete heterogeneous HTTP change",
  { inspection: full },
  { inspection: changedResponse },
  "network",
  "changed",
);
const partialChanged = withPassiveDroppedEvents(changedResponse, {
  network_requests: 1,
});
add(
  "observed HTTP value absent from complete peer",
  { inspection: full },
  { inspection: partialChanged },
  "network",
  "changed",
);
add(
  "two partial HTTP groups cannot prove correspondence",
  { inspection: withPassiveDroppedEvents(full, { network_requests: 1 }) },
  { inspection: partialChanged },
  "network",
  "unknown",
);

const socket = unselectedCapture();
const initiatorBefore = unselectedCapture(["/a"]);
const initiatorAfter = structuredClone(initiatorBefore);
initiatorAfter.network.requests[0]!.initiator = {
  type: "other",
  url: null,
  line: null,
  column: null,
};
initiatorAfter.completeness.unavailable_sections.push("network_initiators");
add(
  "unavailable initiator is not a changed request",
  { inspection: initiatorBefore },
  { inspection: initiatorAfter },
  "network",
  "unknown",
);
const responseDespiteInitiator = structuredClone(initiatorAfter);
responseDespiteInitiator.network.requests[0]!.status = 503;
add(
  "response change survives unavailable initiator",
  { inspection: initiatorBefore },
  { inspection: responseDespiteInitiator },
  "network",
  "changed",
);
socket.network.websocket_connections.push({
  request_id: "local-socket",
  url: "wss://app.example.test/live",
  events: [1, 2, 3].map((bytes) => ({
    direction: "received",
    opcode: 1,
    payload_bytes: bytes,
    payload_shape: { format: "text", json_shape: null },
  })),
});
for (const index of [0, 1, 2]) {
  const omitted = structuredClone(socket);
  omitted.network.websocket_connections[0]!.events.splice(index, 1);
  const partial = withPassiveDroppedEvents(omitted, { websocket_frames: 1 });
  add(
    `WebSocket dropped frame ${index}`,
    { inspection: socket },
    { inspection: partial },
    "network",
    "unknown",
  );
  add(
    `WebSocket dropped frame ${index} reversed`,
    { inspection: partial },
    { inspection: socket },
    "network",
    "unknown",
  );
}
// Same retained positions/directions/opcodes can describe entirely different
// original frames when both captures dropped a frame.
const leftSocket = structuredClone(socket);
leftSocket.network.websocket_connections[0]!.events.shift();
const rightSocket = structuredClone(socket);
rightSocket.network.websocket_connections[0]!.events.pop();
add(
  "same-length partial WebSocket streams",
  { inspection: withPassiveDroppedEvents(leftSocket, { websocket_frames: 1 }) },
  {
    inspection: withPassiveDroppedEvents(rightSocket, { websocket_frames: 1 }),
  },
  "network",
  "unknown",
);
const changedSocket = structuredClone(socket);
changedSocket.network.websocket_connections[0]!.events[1]!.payload_bytes = 4;
add(
  "complete WebSocket payload change",
  { inspection: socket },
  { inspection: changedSocket },
  "network",
  "changed",
);

const inspection = unselectedCapture();
const discovery: WebMcpDiscovery = {
  browser: inspection.browser,
  target: {
    target_id: "local-page",
    url: inspection.target.url,
    origin: inspection.target.origin!,
  },
  status: "available",
  completeness: structuredClone(inspection.completeness),
  limitations: [],
  tools: {
    total: 1,
    items: [
      {
        tool_key: `webmcp_${"a".repeat(64)}`,
        frame_id: "local-frame-a",
        frame_url: inspection.target.url,
        owner_origin: inspection.target.origin!,
        name: "search",
        description: "Search records",
        declaration_kind: "imperative",
        input_schema: null,
        input_schema_sha256: null,
        annotations: {
          read_only: true,
          untrusted_content: true,
          consequential: false,
          autosubmit: false,
        },
        registration_source: null,
        trust: "page-declared-untrusted",
      },
    ],
  },
};
const renamed = structuredClone(discovery);
renamed.tools.items[0]!.tool_key = `webmcp_${"b".repeat(64)}`;
renamed.tools.items[0]!.frame_id = "local-frame-b";
add(
  "WebMCP capture-local identity renamed",
  { inspection, webmcp: discovery },
  { inspection, webmcp: renamed },
  "webmcp",
  "unchanged",
);
const changedTool = structuredClone(renamed);
changedTool.tools.items[0]!.description = "Changed description";
add(
  "WebMCP content change survives local identity rename",
  { inspection, webmcp: discovery },
  { inspection, webmcp: changedTool },
  "webmcp",
  "changed",
);
const knownSource = structuredClone(discovery);
knownSource.tools.items[0]!.registration_source = {
  url: "https://app.example.test/app.js",
  line: 12,
  column: 3,
};
const malformedSource = structuredClone(discovery);
malformedSource.completeness.unavailable_sections.push("webmcp_tools");
malformedSource.completeness.excluded.push({
  section: "webmcp_tools",
  reason: "invalid_protocol_value",
  count: 1,
});
for (const [name, before, after] of [
  ["WebMCP unknown registration source", knownSource, malformedSource],
  ["WebMCP unknown registration source reversed", malformedSource, knownSource],
] as const)
  add(
    name,
    { inspection, webmcp: before },
    { inspection, webmcp: after },
    "webmcp",
    "unknown",
  );
const malformedChanged = structuredClone(malformedSource);
malformedChanged.tools.items[0]!.description = "Changed description";
add(
  "WebMCP known description change despite unknown source",
  { inspection, webmcp: knownSource },
  { inspection, webmcp: malformedChanged },
  "webmcp",
  "changed",
);
const otherSource = structuredClone(knownSource);
otherSource.tools.items[0]!.registration_source!.line = 13;
add(
  "WebMCP known registration source change",
  { inspection, webmcp: knownSource },
  { inspection, webmcp: otherSource },
  "webmcp",
  "changed",
);
const missingCoordinate = structuredClone(knownSource);
missingCoordinate.tools.items[0]!.registration_source!.line = null;
add(
  "WebMCP unknown registration coordinate",
  { inspection, webmcp: knownSource },
  { inspection, webmcp: missingCoordinate },
  "webmcp",
  "unknown",
);
const malformedAnnotation = structuredClone(discovery);
malformedAnnotation.completeness = structuredClone(
  malformedSource.completeness,
);
malformedAnnotation.tools.items[0]!.annotations.read_only = null;
add(
  "WebMCP malformed annotation",
  { inspection, webmcp: discovery },
  { inspection, webmcp: malformedAnnotation },
  "webmcp",
  "unknown",
);
const knownSchema = structuredClone(discovery);
knownSchema.tools.items[0]!.input_schema = { type: "object" };
knownSchema.tools.items[0]!.input_schema_sha256 = "b".repeat(64);
const malformedSchema = structuredClone(discovery);
malformedSchema.completeness = structuredClone(malformedSource.completeness);
add(
  "WebMCP malformed schema",
  { inspection, webmcp: knownSchema },
  { inspection, webmcp: malformedSchema },
  "webmcp",
  "unknown",
);
const droppedTools = structuredClone(discovery);
droppedTools.completeness = withPassiveDroppedEvents(inspection, {
  webmcp_tools: 1,
}).completeness;
const partialChangedTools = structuredClone(changedTool);
partialChangedTools.completeness = structuredClone(droppedTools.completeness);
add(
  "dropped WebMCP observations cannot establish equality",
  { inspection, webmcp: droppedTools },
  { inspection, webmcp: droppedTools },
  "webmcp",
  "unknown",
);
add(
  "two partial WebMCP groups cannot prove modification",
  { inspection, webmcp: droppedTools },
  { inspection, webmcp: partialChangedTools },
  "webmcp",
  "unknown",
);
add(
  "known WebMCP difference survives one complete inventory",
  { inspection, webmcp: discovery },
  { inspection, webmcp: partialChangedTools },
  "webmcp",
  "changed",
);
const duplicateOwner = structuredClone(discovery);
duplicateOwner.tools.total = 2;
duplicateOwner.tools.items.push({
  ...duplicateOwner.tools.items[0]!,
  tool_key: `webmcp_${"c".repeat(64)}`,
  frame_id: "duplicate-owner",
});
add(
  "WebMCP complete duplicate owner count changes",
  { inspection, webmcp: duplicateOwner },
  { inspection, webmcp: renamed },
  "webmcp",
  "changed",
);

const script = unselectedCapture();
const duplicateRenamed = structuredClone(duplicateOwner);
duplicateRenamed.tools.items.reverse();
for (const [index, tool] of duplicateRenamed.tools.items.entries()) {
  tool.frame_id = `new-owner-${index}`;
  tool.tool_key = `webmcp_${String(index + 1).repeat(64)}`;
}
add(
  "equal-count WebMCP duplicate owners stay unresolved",
  { inspection, webmcp: duplicateOwner },
  { inspection, webmcp: duplicateRenamed },
  "webmcp",
  "unknown",
);
script.scripts = {
  total: 1,
  items: [
    {
      script_key: `scr_${"a".repeat(64)}`,
      frame_id: null,
      url: "https://app.example.test/app.js",
      origin: inspection.target.origin,
      cdp_hash: null,
      length: 1,
      is_module: false,
      language: "JavaScript",
      source_map_url: null,
      resource_reconciliation: {
        status: "unmatched",
        reason: "no_exact_sanitized_url",
      },
      source: {
        included: true,
        artifact: createWebTextArtifact("1", "text/javascript"),
      },
    },
  ],
};
const scriptChanged = structuredClone(script);
const scriptMissingModule = structuredClone(script);
scriptMissingModule.scripts.items[0]!.is_module = null;
scriptMissingModule.scripts.items[0]!.script_key = stableWebScriptKey(
  scriptMissingModule.scripts.items[0]!,
);
add(
  "missing script module metadata is unknown rather than removed and added",
  { inspection: script },
  { inspection: scriptMissingModule },
  "scripts",
  "unknown",
);
const scriptDifferentModule = structuredClone(script);
scriptDifferentModule.scripts.items[0]!.is_module = true;
scriptDifferentModule.scripts.items[0]!.script_key = stableWebScriptKey(
  scriptDifferentModule.scripts.items[0]!,
);
add(
  "known unequal script module metadata remains changed",
  { inspection: script },
  { inspection: scriptDifferentModule },
  "scripts",
  "changed",
);
scriptChanged.scripts.items[0]!.source = {
  included: true,
  artifact: createWebTextArtifact("2", "text/javascript"),
};
add(
  "script retained digest change without producer hash",
  { inspection: script },
  { inspection: scriptChanged },
  "scripts",
  "changed",
);
add(
  "script retained digest agreement",
  { inspection: script },
  { inspection: script },
  "scripts",
  "unchanged",
);
const unavailableScript = structuredClone(script);
unavailableScript.scripts.items[0]!.source = {
  included: false,
  reason: "not selected",
};
add(
  "script digest unavailable",
  { inspection: script },
  { inspection: unavailableScript },
  "scripts",
  "unknown",
);
add(
  "no source digest is unknown",
  { inspection: unavailableScript },
  { inspection: unavailableScript },
  "scripts",
  "unknown",
);

const expectComparison = (document: unknown, scenario: Case) => {
  const evidence = parseEvidence(document);
  expect(evidence.operation).toBe("compare_web_captures");
  const result = webCaptureDiffSchema.parse(evidence.normalized_result);
  expect(result.dimensions[scenario.dimension], scenario.name).toMatchObject({
    status: scenario.status,
    ...(scenario.status === "changed" ? {} : { total_changes: 0, changes: [] }),
  });
};

// The single MCP connection below exercises every semantic permutation. CLI
// subprocesses cover the distinct adapter outcomes without repeating startup
// for each reversed input or dropped-frame position.
const cliCaseNames = new Set([
  "heterogeneous HTTP omission 0",
  "partial inventory retains a request absent from complete peer",
  "observed HTTP value absent from complete peer",
  "same-length partial WebSocket streams",
  "WebMCP capture-local identity renamed",
  "WebMCP unknown registration source",
  "WebMCP known description change despite unknown source",
  "script retained digest change without producer hash",
  "script digest unavailable",
]);

cliTest.for(cases.filter(({ name }) => cliCaseNames.has(name)))(
  "CLI preserves capture correspondence: $name",
  async (scenario, { cli }) => {
    const directory = await createTestTempDirectory(
      "rea-capture-correspondence-",
    );
    const paths = [
      join(directory, "before.json"),
      join(directory, "after.json"),
    ];
    await Promise.all(
      paths.map((path, index) =>
        writeFile(
          path,
          JSON.stringify(index === 0 ? scenario.before : scenario.after),
        ),
      ),
    );
    const invocation = {
      arguments: ["compare-web-captures", ...paths, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    };
    const response = await (scenario.name === "heterogeneous HTTP omission 0"
      ? cli.run(invocation)
      : runFileCli(cli, invocation));
    expect(response.exitCode, response.stderr).toBe(0);
    expectComparison(response.json, scenario);
  },
);

cliTest(
  "stdio MCP preserves capture correspondence on one connection",
  async () => {
    const mcp = await connectLocalToolsMcp();
    for (const scenario of cases) {
      const response = await mcp.call("compare_web_captures", {
        before: scenario.before,
        after: scenario.after,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectComparison(response.structuredContent, scenario);
    }
  },
);
