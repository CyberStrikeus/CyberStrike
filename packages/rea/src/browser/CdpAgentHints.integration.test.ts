import { expect, it } from "vitest";
import { startFakeCdpBrowser } from "../../tests/fixtures/fakeCdpBrowser.js";
import { createBrowserObservationProvider } from "../composition/browserObservation.js";
import { inspectWebPage } from "../application/BrowserObservationService.js";
import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { webPageInspectionSchema } from "../domain/browserObservationSchemas.js";

it.each(["", "h:"])(
  "retains agent hints from XHTML links with prefix %j",
  async (prefix) => {
    const declarations = ["mcp", "model-context", "ai-plugin", "service-desc"];
    const browser = await startFakeCdpBrowser({
      commandResult: (command, origin) =>
        command.method === "DOMSnapshot.captureSnapshot"
          ? {
              strings: [
                "#document",
                `${prefix}html`,
                `${prefix}head`,
                `${prefix}link`,
                "",
                prefix ? "xmlns:h" : "xmlns",
                "http://www.w3.org/1999/xhtml",
                "rel",
                declarations.join(" "),
                "href",
                "/agent",
                `${origin}/root/page.xhtml`,
              ],
              documents: [
                {
                  documentURL: 11,
                  nodes: {
                    nodeType: [9, 1, 1, 1],
                    nodeName: [0, 1, 2, 3],
                    nodeValue: [4, 4, 4, 4],
                    parentIndex: [-1, 0, 1, 2],
                    attributes: [[], [5, 6], [], [7, 8, 9, 10]],
                  },
                },
              ],
            }
          : undefined,
    });
    const provider = createBrowserObservationProvider();
    try {
      const result = await inspectWebPage(
        provider,
        inspectWebPageInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          observation_ms: 1,
        }),
      );
      if (!result.ok) throw result.error;
      const value = webPageInspectionSchema.parse(
        result.value.normalized_result,
      );
      expect(value.metadata.dom_urls).toEqual([
        {
          node_index: 3,
          attribute: "href",
          url: `${browser.allowedOrigin}/agent`,
          destination_scope: "approved",
        },
      ]);
      expect(
        value.metadata.agent_hints.filter(
          (hint) => hint.mechanism === "dom_link_rel",
        ),
      ).toEqual(
        declarations.map((declaration) => ({
          mechanism: "dom_link_rel",
          declaration,
          url: `${browser.allowedOrigin}/agent`,
          trust: "page-declared-untrusted",
        })),
      );
      expect(
        browser.commands.some(
          (command) => command.method === "DOMSnapshot.captureSnapshot",
        ),
      ).toBe(true);
    } finally {
      await provider.close?.();
      await browser.close();
    }
  },
  30_000,
);
