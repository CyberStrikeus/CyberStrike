import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { expect, it } from "vitest";

import { fetchWebSourceMapsOk } from "../../fixtures/fetchWebSourceMapsOk.js";
import { analyzeWebBundleInputSchema } from "../../../src/domain/webBundleAnalysis.js";

it("retains unshadowed optional require dependencies from HTTP source-map originals", async () => {
  const source = [
    'require("./normal.cjs");',
    'require?.("./optional.cjs");',
    'function local(require) { require?.("./shadowed.cjs"); }',
    "require?.(selectedModule);",
  ].join("\n");
  const text = JSON.stringify({
    version: 3,
    names: [],
    mappings: "AAAA",
    sources: ["main.cjs"],
    sourcesContent: [source],
  });
  const server = createServer((_request, response) => response.end(text));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new TypeError("Expected a TCP listener address");
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const url = `${origin}/app.js.map`;
    const result = await fetchWebSourceMapsOk(
      [{ scriptKey: `scr_${"1".repeat(64)}`, declaredUrl: url, fetchUrl: url }],
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: origin,
        target_id: "fixture",
        allowed_origins: [origin],
        fetch_source_maps: true,
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: "included",
      artifact: {
        text,
        bytes: Buffer.byteLength(text),
        sha256: createHash("sha256").update(text).digest("hex"),
      },
      original_sources: [{ artifact: { text: source } }],
      original_module_edges: ["./normal.cjs", "./optional.cjs"].map(
        (specifier) => ({
          from_source: `${origin}/main.cjs`,
          kind: "require",
          specifier,
          resolved_source: new URL(specifier, origin).href,
        }),
      ),
    });
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
  }
});
