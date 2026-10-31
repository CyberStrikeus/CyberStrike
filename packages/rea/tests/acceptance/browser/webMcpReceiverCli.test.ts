import { expect } from "vitest";

import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps WebMCP receiver segments exact through the public CLI",
  async ({ cli }) => {
    const source = `
    navigator.modelContext.registerTool({ name: "navigator" });
    const app = { analyticsmodelContext: { registerTool() {} } };
    app.analyticsmodelContext.registerTool({ name: "nested suffix" });
    window["modelContext.registerTool"]({ name: "dotted property" });
  `;
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Debugger.getScriptSource"
          ? { scriptSource: source }
          : undefined,
    });
    try {
      const result = await cli.run({
        arguments: [
          "analyze-web-bundle",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--json",
        ],
      });
      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          observations: {
            webmcp_declarations: [
              expect.objectContaining({
                name: "navigator",
                trust: "page-declared-untrusted",
              }),
            ],
          },
        },
      });

      const inspected = await cli.run({
        arguments: [
          "inspect-web-page",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--include-script-sources",
          "--json",
        ],
      });
      expect(inspected.exitCode, inspected.stdout).toBe(0);
      expect(inspected.json).toMatchObject({
        normalized_result: {
          scripts: {
            items: expect.arrayContaining([
              expect.objectContaining({
                source: expect.objectContaining({
                  artifact: expect.objectContaining({ text: source }),
                }),
              }),
            ]),
          },
        },
      });
      expect(browser.activeConnectionCount()).toBe(0);
    } finally {
      await browser.close();
    }
  },
);
