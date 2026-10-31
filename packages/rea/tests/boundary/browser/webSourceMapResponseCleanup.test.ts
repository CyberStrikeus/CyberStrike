import { createServer } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { fetchWebSourceMapsOk } from "../../fixtures/fetchWebSourceMapsOk.js";
import { analyzeWebBundleInputSchema } from "../../../src/domain/webBundleAnalysis.js";

describe("source-map discarded HTTP response ownership", () => {
  it.each([302, 400])(
    "closes an unfinished discarded HTTP %s body",
    async (status) => {
      let didClose = false;
      let notifyClosed: (() => void) | undefined;
      const closed = new Promise<void>((resolve) => {
        notifyClosed = resolve;
      });
      const server = createServer((incoming, response) => {
        if (incoming.url === "/final.map") {
          response.end(
            JSON.stringify({
              version: 3,
              names: [],
              sources: [],
              mappings: "",
            }),
          );
          return;
        }
        response.writeHead(
          status,
          status === 302 ? { location: "/final.map" } : {},
        );
        response.write("unfinished response body");
        response.on("close", () => {
          didClose = true;
          notifyClosed?.();
        });
      });
      const closeServer = async (): Promise<void> => {
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve) => server.close(() => resolve()));
      };
      onTestFinished(closeServer);
      try {
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new Error("Expected TCP listener");
        const origin = `http://127.0.0.1:${String(address.port)}`;
        const url = `${origin}/first.map`;
        const input = analyzeWebBundleInputSchema.parse({
          cdp_endpoint: "http://127.0.0.1:9222",
          allowed_origins: [origin],
          target_id: "page-1",
          fetch_source_maps: true,
        });
        const result = await fetchWebSourceMapsOk(
          [
            {
              scriptKey: `scr_${"1".repeat(64)}`,
              declaredUrl: url,
              fetchUrl: url,
            },
          ],
          input,
        );
        expect(result.items[0]?.status).toBe(
          status === 302 ? "included" : "fetch_failed",
        );
        await closed;
        expect(didClose).toBe(true);
      } finally {
        await closeServer();
      }
    },
  );
});
