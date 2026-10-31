import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const websocketEvents = (origin: string) => {
  const cases = [
    { requestId: "missing-opcode", response: { payloadData: "text" } },
    {
      requestId: "wrong-type-opcode",
      response: { opcode: "1", payloadData: "text" },
    },
    { requestId: "null-opcode", response: { opcode: null, payloadData: "" } },
    { requestId: "negative-opcode", response: { opcode: -1, payloadData: "" } },
    {
      requestId: "fractional-opcode",
      response: { opcode: 1.5, payloadData: "text" },
    },
    { requestId: "observed-zero", response: { opcode: 0, payloadData: "" } },
    { requestId: "observed-text", response: { opcode: 1, payloadData: "" } },
    { requestId: "bad-width", response: { opcode: 16, payloadData: "" } },
    { requestId: "missing-payload", response: { opcode: 1 } },
  ];
  return cases.flatMap(({ requestId, response }) => [
    {
      method: "Network.webSocketCreated",
      params: { requestId, url: `${origin.replace(/^http/u, "ws")}/live` },
    },
    {
      method: "Network.webSocketFrameReceived",
      params: { requestId, response },
    },
  ]);
};

cliTest(
  "preserves unknown WebSocket opcodes and known zero through public CLI and stdio MCP",
  async ({ cli }) => {
    const { call } = await connectLocalToolsMcp();
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: ["Network.enable"],
      commandEvents: (command, origin) =>
        command.method === "Network.enable"
          ? websocketEvents(origin).map((event) => ({
              ...event,
              ...(command.sessionId === undefined
                ? {}
                : { sessionId: command.sessionId }),
            }))
          : undefined,
    });
    try {
      const cliResponse = await cli.run({
        arguments: [
          "inspect-web-page",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--include-websocket-shapes",
          "--json",
        ],
      });
      expect(cliResponse.exitCode, cliResponse.stdout).toBe(0);
      const cliContract = toolContract("inspect_web_page").outputSchema.parse(
        cliResponse.json,
      );
      const cliEvidence = parseEvidence(cliContract);

      const mcpResponse = await call("inspect_web_page", {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 0,
        include_websocket_shapes: true,
      });
      expect(mcpResponse.isError).not.toBe(true);
      const mcpEvidence = parseEvidence(
        toolContract("inspect_web_page").outputSchema.parse(
          mcpResponse.structuredContent,
        ),
      );

      for (const evidence of [cliEvidence, mcpEvidence]) {
        const page = webPageInspectionSchema.parse(evidence.normalized_result);
        const frames = new Map(
          page.network.websocket_connections.map((connection) => [
            connection.request_id,
            connection.events[0],
          ]),
        );
        expect(frames.get("missing-opcode")).toMatchObject({
          opcode: null,
          payload_bytes: null,
          payload_shape: null,
        });
        expect(frames.get("wrong-type-opcode")).toMatchObject({
          opcode: null,
          payload_bytes: null,
          payload_shape: null,
        });
        expect(frames.get("bad-width")).toMatchObject({
          opcode: null,
          payload_bytes: null,
          payload_shape: null,
        });
        for (const requestId of [
          "null-opcode",
          "negative-opcode",
          "fractional-opcode",
        ])
          expect(frames.get(requestId)).toMatchObject({
            opcode: null,
            payload_bytes: null,
            payload_shape: null,
          });
        expect(frames.get("missing-payload")).toMatchObject({
          opcode: 1,
          payload_bytes: null,
          payload_shape: null,
        });
        expect(frames.get("observed-zero")).toMatchObject({
          opcode: 0,
          payload_bytes: 0,
          payload_shape: { format: "binary", json_shape: null },
        });
        expect(frames.get("observed-text")).toMatchObject({
          opcode: 1,
          payload_bytes: 0,
          payload_shape: { format: "text", json_shape: null },
        });
        expect(page.completeness.excluded).toContainEqual({
          section: "websocket_frames",
          reason: "invalid_protocol_value",
          count: 7,
        });
      }
    } finally {
      await browser.close();
    }
  },
);
