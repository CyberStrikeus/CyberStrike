import { createServer } from "node:http";

import { describe, expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { browserTargetListSchema } from "../../../src/domain/browserObservationSchemas.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe("CDP target inventory", () => {
  cliTest(
    "returns complete target inventory and original URL paths through the CLI",
    async ({ cli }) => {
      let port = 0;
      const targets = Array.from({ length: 1_101 }, (_, index) => {
        const id = `target-${String(index).padStart(4, "0")}`;
        return {
          id,
          type: "page",
          title: `Page ${String(index)}`,
          url:
            index === 0
              ? String.raw`https://user:pass@allowed.example\path@tail/../keep?x=1#frag`
              : `https://allowed.example/page/${String(index)}`,
          ...(index === 0 ? {} : { attached: index === 1 ? false : true }),
          webSocketDebuggerUrl: `ws://127.0.0.1:${String(port)}/devtools/page/${id}`,
        };
      });
      const server = createServer((request, response) => {
        response.setHeader("content-type", "application/json");
        if (request.url === "/json/version") {
          response.end(
            JSON.stringify({
              Browser: "Chrome/1",
              "Protocol-Version": "1.3",
              "User-Agent": "Chrome",
              "V8-Version": "1",
              "WebKit-Version": "1",
              webSocketDebuggerUrl: `ws://127.0.0.1:${String(port)}/devtools/browser/browser`,
            }),
          );
          return;
        }
        if (request.url === "/json/list") {
          response.end(JSON.stringify(targets));
          return;
        }
        response.writeHead(404).end();
      });

      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new TypeError("Expected a TCP listener address");
        port = address.port;
        const endpoint = `http://127.0.0.1:${String(port)}`;

        const cliResult = await cli.run({
          arguments: [
            "list-browser-targets",
            endpoint,
            "--allowed-origins",
            "https://allowed.example",
            "--json",
          ],
          environment: process.env,
        });
        expect(cliResult.exitCode).toBe(0);
        expect(cliResult.signal).toBeNull();
        const evidence = parseEvidence(cliResult.json);
        const result = browserTargetListSchema.parse(
          evidence.normalized_result,
        );

        expect(result.targets).toHaveLength(targets.length);
        expect(result.targets[0]?.target_id).toBe("target-0000");
        expect(result.targets[0]?.url).toBe(
          String.raw`https://allowed.example\path@tail/../keep?x=1#frag`,
        );
        expect(result.targets[0]?.origin).toBe("https://allowed.example");
        expect(JSON.stringify(evidence)).not.toContain("user:pass");
        expect(result.targets.at(-1)?.target_id).toBe("target-1100");
        expect(
          result.targets.slice(0, 3).map(({ attached }) => attached),
        ).toEqual([null, false, true]);
        expect(
          result.limitations.some((item) => item.includes("attachment state")),
        ).toBe(true);
      } finally {
        if (server.listening)
          await new Promise<void>((resolve, reject) => {
            server.close((error) =>
              error === undefined ? resolve() : reject(error),
            );
          });
      }
    },
  );
});
