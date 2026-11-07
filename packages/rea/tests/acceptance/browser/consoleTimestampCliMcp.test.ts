import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const consoleTimestampCases = [
  { label: "missing", timestamp: undefined, expected: null, incomplete: true },
  { label: "wrong type", timestamp: "123", expected: null, incomplete: true },
  { label: "actual zero", timestamp: 0, expected: 0, incomplete: false },
] as const;

cliTest(
  "preserves missing and observed console timestamps through built CLI and stdio MCP schemas",
  async ({ cli }) => {
    const { call } = await connectLocalToolsMcp();

    for (const { timestamp, expected, incomplete } of consoleTimestampCases) {
      const browser = await startFakeCdpBrowser({
        eventsBeforeReply: ["Runtime.enable"],
        commandEvents: (command, origin) => {
          if (command.method !== "Runtime.enable") return undefined;
          const session =
            command.sessionId === undefined
              ? {}
              : { sessionId: command.sessionId };
          return [
            {
              ...session,
              method: "Runtime.executionContextCreated",
              params: {
                context: {
                  id: 1,
                  origin,
                  auxData: { frameId: "frame-main", isDefault: true },
                },
              },
            },
            {
              ...session,
              method: "Runtime.consoleAPICalled",
              params: {
                type: "log",
                ...(timestamp === undefined ? {} : { timestamp }),
                args: [{ type: "string", value: "in-scope-console" }],
                stackTrace: {
                  callFrames: [
                    {
                      url: `${origin}/app.js`,
                      lineNumber: 0,
                      columnNumber: 0,
                    },
                  ],
                },
              },
            },
            {
              ...session,
              method: "Runtime.consoleAPICalled",
              params: {
                type: "log",
                timestamp: 124,
                args: [{ type: "string", value: "out-of-scope-console" }],
                stackTrace: {
                  callFrames: [
                    {
                      url: "https://outside.invalid/foreign.js",
                      lineNumber: 0,
                      columnNumber: 0,
                    },
                  ],
                },
              },
            },
          ];
        },
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
        });
        expect(mcpResponse.isError).not.toBe(true);
        const mcpEvidence = parseEvidence(
          toolContract("inspect_web_page").outputSchema.parse(
            mcpResponse.structuredContent,
          ),
        );

        for (const evidence of [cliEvidence, mcpEvidence]) {
          const page = webPageInspectionSchema.parse(
            evidence.normalized_result,
          );
          expect(page.console.events).toEqual([
            expect.objectContaining({
              timestamp: expected,
              url: `${browser.allowedOrigin}/app.js`,
              argument_types: ["string"],
            }),
          ]);
          expect(JSON.stringify(evidence)).not.toContain("outside.invalid");
          expect(JSON.stringify(evidence)).not.toContain(
            "out-of-scope-console",
          );
          if (incomplete) {
            expect(page.completeness.unavailable_sections).toContain(
              "console_events",
            );
            expect(page.completeness.excluded).toContainEqual({
              section: "console_events",
              reason: "invalid_protocol_value",
              count: 1,
            });
          } else {
            expect(page.completeness.unavailable_sections).not.toContain(
              "console_events",
            );
            expect(page.completeness.excluded).not.toContainEqual(
              expect.objectContaining({
                section: "console_events",
                reason: "invalid_protocol_value",
              }),
            );
          }
        }
      } finally {
        await browser.close();
      }
    }
  },
);
