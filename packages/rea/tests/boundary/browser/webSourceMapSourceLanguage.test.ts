import { once } from "node:events";
import { createServer } from "node:http";

import { expect, it } from "vitest";

import { analyzeWebBundleInputSchema } from "../../../src/domain/webBundleAnalysis.js";
import { fetchWebSourceMapsOk } from "../../fixtures/fetchWebSourceMapsOk.js";

it("selects original source language from decoded URL paths while retaining URL evidence", async () => {
  const declarations = [
    "plain.ts?revision=2#view.tsx",
    "escaped%2Ets?revision=2#view.tsx",
    "escaped.%74s?revision=2#view.tsx",
    "invalid%.ts?revision=2#view.tsx",
  ];
  const content = 'import "./dep.ts"; const value = <number>1;';
  const text = JSON.stringify({
    version: 3,
    names: [],
    sources: declarations,
    sourcesContent: declarations.map(() => content),
    mappings: "AAAA,ACAA,ACAA,ACAA",
  });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "content-type": "application/json" }).end(text);
  });
  try {
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new TypeError("Expected TCP listener");
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const url = `${origin}/maps/app.js.map`;
    const result = await fetchWebSourceMapsOk(
      [{ scriptKey: "script", declaredUrl: url, fetchUrl: url }],
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "selected-page",
        allowed_origins: [origin],
        fetch_source_maps: true,
      }),
    );
    const sources = declarations.map((source) => `${origin}/maps/${source}`);
    expect(requests).toEqual(["/maps/app.js.map"]);
    expect(result.status).toBe("included");
    expect(result.items[0]).toMatchObject({
      status: "included",
      limitation: null,
      artifact: { text },
      original_sources: sources.map((source) => ({
        source,
        artifact: { media_type: "text/typescript", text: content },
      })),
      mappings: sources.map((source) => ({ source })),
      original_module_edges: sources.map((source) => ({
        from_source: source,
        kind: "static_import",
        specifier: "./dep.ts",
        resolved_source: `${origin}/maps/dep.ts`,
      })),
    });
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  }
});
