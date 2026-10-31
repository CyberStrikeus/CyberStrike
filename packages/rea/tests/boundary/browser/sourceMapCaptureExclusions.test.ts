import { expect, it } from "vitest";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { analyzeWebBundleInputSchema } from "../../../src/domain/webBundleAnalysis.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it.each(["none", "excluded", "mixed", "redirect", "not-selected"] as const)(
  "preserves captured source-map exclusion coverage: %s",
  async (mode) => {
    const source = "export const observed = true;";
    const browser = await startFakeCdpBrowser({
      sourceMapBody: JSON.stringify({
        version: 3,
        names: [],
        sources: ["main.js"],
        sourcesContent: [source],
        mappings: "AAAA",
      }),
      ...(mode === "redirect"
        ? { sourceMapRedirect: "https://outside.example.test/main.js.map" }
        : {}),
      commandResult: ({ method }) =>
        method === "Debugger.getScriptSource"
          ? { scriptSource: source }
          : undefined,
      commandEvents: (command, origin) => {
        if (command.method !== "Debugger.enable") return undefined;
        const script = (id: string, sourceMapURL?: string) => ({
          method: "Debugger.scriptParsed",
          ...(command.sessionId === undefined
            ? {}
            : { sessionId: command.sessionId }),
          params: {
            scriptId: id,
            url: `${origin}/${id}.js`,
            hash: id,
            length: Buffer.byteLength(source),
            isModule: true,
            executionContextId: 1,
            scriptLanguage: "JavaScript",
            ...(sourceMapURL === undefined ? {} : { sourceMapURL }),
          },
        });
        return [
          script(
            "main",
            mode === "none"
              ? undefined
              : mode === "redirect"
                ? "/app.js.map"
                : "https://outside.example.test/main.js.map",
          ),
          ...(mode === "mixed" ? [script("second", "/app.js.map")] : []),
        ];
      },
    });
    trackBrowser(browser);
    const provider = new CdpBrowserProvider();
    try {
      const result = await provider.analyzeBundle(
        analyzeWebBundleInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          allowed_origins: [browser.allowedOrigin],
          target_id: "allowed-page",
          observation_ms: 0,
          fetch_source_maps: mode !== "not-selected",
        }),
      );
      if (!result.ok) throw result.error;
      const maps = result.value.observations.source_maps;
      if (mode === "none" || mode === "not-selected") {
        expect(maps).toEqual({
          status: "not_requested",
          requested: 0,
          processed: 0,
          items: [],
        });
        expect(result.value.completeness.status).toBe("complete");
        expect(result.value.unknowns).toEqual([]);
      } else {
        expect(maps.status).toBe(mode === "mixed" ? "partial" : "unavailable");
        expect(result.value.completeness.status).toBe("partial");
        expect(result.value.unknowns).toContainEqual(
          expect.objectContaining({ dimension: "source_maps" }),
        );
        if (mode === "redirect") {
          expect(maps.excluded).toBeUndefined();
          expect(maps.items[0]?.status).toBe("policy_filtered");
        } else {
          expect(maps.excluded).toEqual([
            { section: "source_maps", reason: "disallowed_origin", count: 1 },
          ]);
          expect(maps.requested).toBe(mode === "mixed" ? 1 : 0);
          expect(maps.processed).toBe(mode === "mixed" ? 1 : 0);
          if (mode === "mixed") expect(maps.items[0]?.status).toBe("included");
        }
      }
      expect(JSON.stringify(result.value)).not.toContain(
        "outside.example.test",
      );
      expect(
        browser.httpRequests.filter(({ url }) => url.startsWith("/app.js.map")),
      ).toHaveLength(mode === "mixed" || mode === "redirect" ? 1 : 0);
    } finally {
      await provider.close();
    }
  },
);
