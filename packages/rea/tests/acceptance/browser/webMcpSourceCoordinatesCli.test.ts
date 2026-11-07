import { expect } from "vitest";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains a WebMCP registration with malformed source coordinates unknown",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser({
      webMcpTools: true,
      webMcpStackTrace: (origin) => ({
        callFrames: [
          { url: `${origin}/app.js`, lineNumber: -3, columnNumber: 7.5 },
        ],
      }),
    });
    try {
      const result = await cli.run({
        arguments: [
          "discover-webmcp-tools",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--json",
        ],
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.json).toMatchObject({
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
    } finally {
      await browser.close();
    }
  },
);
