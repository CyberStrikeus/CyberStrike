import { expect, onTestFinished } from "vitest";
import { z } from "zod";

import { webObservationSessionSchema } from "../../src/domain/browserSession.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { startFakeCdpBrowser } from "../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "filters replayed lifecycle milestones before the observation window through %s",
  async (surface, { cli }) => {
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: [
        "Performance.getMetrics",
        "Page.setLifecycleEventsEnabled",
      ],
      commandResult: (command) => {
        if (command.method === "Performance.enable") return {};
        if (command.method === "Performance.getMetrics")
          return { metrics: [{ name: "Timestamp", value: 20 }] };
        return undefined;
      },
      commandEvents: (command, origin) => {
        if (command.method === "Performance.getMetrics")
          return [
            {
              method: "Page.lifecycleEvent",
              sessionId: command.sessionId,
              params: {
                frameId: "frame-main",
                loaderId: "loader-before-window",
                name: "load",
                timestamp: 19,
              },
            },
            {
              method: "Page.navigatedWithinDocument",
              sessionId: command.sessionId,
              params: {
                frameId: "frame-main",
                url: `${origin}#during-clock-response`,
                navigationType: "historyApi",
              },
            },
          ];
        if (command.method === "Page.setLifecycleEventsEnabled")
          return [
            {
              method: "Page.lifecycleEvent",
              sessionId: command.sessionId,
              params: {
                frameId: "frame-main",
                loaderId: "loader-before-window-replayed-after-arm",
                name: "load",
                timestamp: 19,
              },
            },
            {
              method: "Page.lifecycleEvent",
              sessionId: command.sessionId,
              params: {
                frameId: "frame-main",
                loaderId: "loader-current-window",
                name: "load",
                timestamp: 21,
              },
            },
          ];
        return undefined;
      },
    });
    onTestFinished(() => browser.close());

    let evidence: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
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
      expect(response.exitCode, response.stderr).toBe(0);
      evidence = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("observe_web_session", {
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 5,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      evidence = response.structuredContent;
    }

    const contract = toolContract("observe_web_session");
    const sourceEvidence = contract.outputSchema.parse(evidence);
    const normalized = z
      .object({ normalized_result: webObservationSessionSchema })
      .parse(sourceEvidence).normalized_result;
    expect(normalized.timeline).toContainEqual(
      expect.objectContaining({
        type: "lifecycle",
        loader_id: "loader-current-window",
        timestamp: 21,
      }),
    );
    expect(normalized.timeline).not.toContainEqual(
      expect.objectContaining({ loader_id: "loader-before-window" }),
    );
    expect(normalized.timeline).not.toContainEqual(
      expect.objectContaining({
        loader_id: "loader-before-window-replayed-after-arm",
      }),
    );
    expect(normalized.timeline).toContainEqual(
      expect.objectContaining({
        type: "same_document_navigation",
        url: `${browser.allowedOrigin}#during-clock-response`,
        timestamp: null,
      }),
    );
    expect(normalized.limitations).toContain(
      "Timeline rows without a comparable producer timestamp have a null timestamp. Buffered events with unknown timing are retained as context only; they do not establish activity inside the selected observation window.",
    );
    expect(browser.commands).toContainEqual(
      expect.objectContaining({
        method: "Performance.enable",
        params: { timeDomain: "timeTicks" },
      }),
    );
  },
);
