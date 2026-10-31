import { expect, onTestFinished } from "vitest";
import { z } from "zod";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { webObservationSessionSchema } from "../../src/domain/browserSession.js";
import { startFakeCdpBrowser } from "../fixtures/fakeCdpBrowser.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains admitted redirect response facts and historical omission through %s",
  async (surface, { cli }) => {
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: ["Page.setLifecycleEventsEnabled"],
      commandResult: (command) =>
        command.method === "Performance.getMetrics"
          ? { metrics: [{ name: "Timestamp", value: 20 }] }
          : undefined,
      commandEvents: (command, origin) =>
        command.method === "Page.setLifecycleEventsEnabled"
          ? [
              {
                method: "Network.requestWillBeSent",
                sessionId: command.sessionId,
                params: {
                  requestId: "redirect-chain",
                  frameId: "frame-main",
                  type: "Document",
                  timestamp: 21,
                  request: { url: `${origin}/after`, method: "GET" },
                  redirectResponse: {
                    url: `${origin}/before?token=visible`,
                    status: 302,
                    headers: { Authorization: "discard-redirect-header" },
                    body: "discard-redirect-body",
                  },
                },
              },
            ]
          : undefined,
    });
    onTestFinished(() => browser.close());
    let evidence: unknown;
    if (surface === "CLI") {
      const reply = await cli.run({
        arguments: [
          "observe-web-session",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "5",
          "--json",
        ],
      });
      expect(reply.exitCode, reply.stderr).toBe(0);
      evidence = reply.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const reply = await call("observe_web_session", {
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 5,
      });
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      evidence = reply.structuredContent;
    }
    const source = toolContract("observe_web_session").outputSchema.parse(
      evidence,
    );
    const result = z
      .object({ normalized_result: webObservationSessionSchema })
      .parse(source).normalized_result;
    expect(result.timeline).toContainEqual(
      expect.objectContaining({
        type: "redirect",
        request_id: "redirect-chain",
        timestamp: 21,
        url: `${browser.allowedOrigin}/after`,
        redirect_response: {
          url: `${browser.allowedOrigin}/before?token=visible`,
          status: 302,
          scope: "approved",
        },
      }),
    );
    expect(JSON.stringify(source)).not.toContain("discard-redirect-");
    const historical = {
      ...result,
      timeline: result.timeline.map(({ redirect_response, ...row }) => {
        void redirect_response;
        return row;
      }),
    };
    expect(webObservationSessionSchema.parse(historical)).toStrictEqual(
      historical,
    );
  },
);
