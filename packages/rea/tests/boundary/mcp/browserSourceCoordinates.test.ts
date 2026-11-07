import { expect, it, onTestFinished } from "vitest";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it("reports malformed source coordinates as unknown through MCP", async () => {
  const browser = await startFakeCdpBrowser({
    webMcpTools: true,
    webMcpStackTrace: (origin) => ({
      callFrames: [
        { url: `${origin}/app.js`, lineNumber: -3, columnNumber: 7.5 },
      ],
    }),
    commandEvents(command, origin) {
      const frame = {
        url: `${origin}/app.js`,
        lineNumber: -3,
        columnNumber: 7.5,
      };
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      if (command.method === "Runtime.enable")
        return [
          {
            ...session,
            method: "Runtime.consoleAPICalled",
            params: {
              type: "log",
              timestamp: 1,
              args: [],
              stackTrace: { callFrames: [frame] },
            },
          },
        ];
      if (command.method === "Network.enable")
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId: "bad-coordinates",
              timestamp: 1,
              type: "Script",
              request: { url: `${origin}/app.js`, method: "GET" },
              initiator: { type: "script", stack: { callFrames: [frame] } },
            },
          },
        ];
      return undefined;
    },
  });
  onTestFinished(() => browser.close());
  const { client } = await createApplicationMcpHarness({
    clientIdentity: { name: "source-coordinate-test", version: "1" },
    serverOptions: {
      environment: { ...process.env },
      browserObservation: new CdpBrowserProvider(),
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
      }),
    },
  });
  const args = {
    cdp_endpoint: browser.endpoint,
    allowed_origins: [browser.allowedOrigin],
    target_id: "allowed-page",
    observation_ms: 0,
  };
  const page = await client.callTool({
    name: "inspect_web_page",
    arguments: args,
  });
  expect(page.isError).not.toBe(true);
  expect(page.structuredContent).toMatchObject({
    normalized_result: {
      console: {
        events: [expect.objectContaining({ line: null, column: null })],
      },
      network: {
        requests: expect.arrayContaining([
          expect.objectContaining({
            request_id: "bad-coordinates",
            initiator: expect.objectContaining({ line: null, column: null }),
          }),
        ]),
      },
      completeness: {
        excluded: expect.arrayContaining([
          expect.objectContaining({
            section: "console_events",
            reason: "invalid_protocol_value",
          }),
          expect.objectContaining({
            section: "network_initiators",
            reason: "invalid_protocol_value",
          }),
        ]),
      },
    },
  });
  const tools = await client.callTool({
    name: "discover_webmcp_tools",
    arguments: args,
  });
  expect(tools.isError).not.toBe(true);
  expect(tools.structuredContent).toMatchObject({
    normalized_result: {
      tools: {
        items: [expect.objectContaining({ registration_source: null })],
      },
      completeness: {
        excluded: expect.arrayContaining([
          expect.objectContaining({
            section: "webmcp_tools",
            reason: "invalid_protocol_value",
          }),
        ]),
      },
    },
  });
}, 20_000);
