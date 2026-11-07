import { expect } from "vitest";
import { z } from "zod";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const capturedSource = `
  fetch("/api/orders");
  navigator.modelContext.registerTool({
    name: "search_orders",
    description: "Search orders",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } }
    }
  });
`;

cliTest(
  "retains an aggregate web-analysis timeout and analyzes the next CLI request",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Debugger.getScriptSource"
          ? { scriptSource: capturedSource }
          : undefined,
    });
    const baseArguments = [
      "analyze-web-bundle",
      browser.endpoint,
      "allowed-page",
      "--allowed-origins",
      browser.allowedOrigin,
      "--observation-ms",
      "0",
      "--json",
    ];
    try {
      const interrupted = await cli.run({
        arguments: [
          ...baseArguments,
          "--max-heap-mb",
          "128",
          "--analysis-timeout-ms",
          "1",
          "--total-analysis-timeout-ms",
          "1",
        ],
        timeoutMs: 30_000,
      });
      expect(
        interrupted.exitCode,
        interrupted.stdout + interrupted.stderr,
      ).toBe(1);
      const timeout = z
        .object({
          code: z.literal("provider_timeout"),
          details: z.object({ partial_observation: z.unknown() }),
        })
        .parse(interrupted.json);
      const partial = parseEvidence(timeout.details.partial_observation);
      expect(partial.parameters).toMatchObject({
        max_heap_mb: 128,
        analysis_timeout_ms: 1,
        total_analysis_timeout_ms: 1,
      });
      expect(partial.normalized_result).toMatchObject({
        completeness: { status: "partial", parse_failures: 0 },
        unknowns: expect.arrayContaining([
          expect.objectContaining({ affected_script_keys: expect.any(Array) }),
        ]),
      });

      const recovered = await cli.run({
        arguments: baseArguments,
        timeoutMs: 30_000,
      });
      expect(recovered.exitCode, recovered.stdout + recovered.stderr).toBe(0);
      expect(recovered.json).toMatchObject({
        normalized_result: {
          observations: {
            endpoints: [expect.objectContaining({ value: "/api/orders" })],
            webmcp_declarations: [
              expect.objectContaining({
                name: "search_orders",
                trust: "page-declared-untrusted",
              }),
            ],
          },
        },
      });
      expect(browser.activeConnectionCount()).toBe(0);
    } finally {
      await browser.close();
    }
  },
);
