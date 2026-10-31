import { once } from "node:events";
import { describe, expect } from "vitest";

import { MCP_SHUTDOWN_FAILED } from "../../../src/main/messages.js";
import { rawHttpRequest } from "../../support/http/rawRequest.js";
import { startMcpHttpProcess } from "../../support/mcp/streamableHttpProcess.js";
import { processTest } from "../../support/process/processFixture.js";

const SHUTDOWN_TIMEOUT_MS = 90_000;

const shutdownSignals: readonly (readonly [NodeJS.Signals, number])[] = [
  ["SIGTERM", 143],
  ["SIGINT", 130],
];

// Windows child.kill() force-terminates even for SIGINT; it does not deliver a console interrupt.
describe.skipIf(process.platform === "win32")("rea mcp --http shutdown", () => {
  for (const [signal, status] of shutdownSignals)
    processTest(
      `releases the listener and exits ${String(status)} on ${signal}`,
      async ({ processes }) => {
        const started = await startMcpHttpProcess(processes);
        // The live transport refuses a GET that does not accept an event stream.
        const before = await rawHttpRequest(started.url);
        expect(before.status).toBe(406);
        started.child.kill(signal);
        const [code, signalCode] = await once(started.child, "close");
        expect(code).toBe(status);
        expect(signalCode).toBeNull();
        expect(started.stderr()).not.toContain(MCP_SHUTDOWN_FAILED);
        await expect(rawHttpRequest(started.url)).rejects.toMatchObject({
          code: "ECONNREFUSED",
        });
      },
      SHUTDOWN_TIMEOUT_MS,
    );

  processTest(
    "exits with the signal status when the signal lands as startup completes",
    async ({ processes }) => {
      const started = await startMcpHttpProcess(processes);
      // No request first: the signal arrives at the edge between startup and the lifecycle owner.
      const [signal, status] = shutdownSignals[0]!;
      started.child.kill(signal);
      const [code, signalCode] = await once(started.child, "close");
      expect(code).toBe(status);
      expect(signalCode).toBeNull();
      expect(started.stderr()).not.toContain(MCP_SHUTDOWN_FAILED);
    },
    SHUTDOWN_TIMEOUT_MS,
  );
});
