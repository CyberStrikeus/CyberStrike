import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { z } from "zod";

import { safeParseJson } from "../domain/safeJson.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { V8InspectorProvider } from "./V8InspectorProvider.js";

const failureCases = [
  ["disconnect", "disconnected"],
  ["protocol failure", "protocol_error"],
  ["idle protocol failure", "protocol_error"],
  ["cancellation", "cancelled"],
] as const;

const createPartialInspectorServer = (
  failure: (typeof failureCases)[number][0],
  scriptUrl: string,
  reportedScriptUrl: string,
) => {
  let signalScriptSent: (() => void) | undefined;
  const scriptSent = new Promise<void>((resolve) => {
    signalScriptSent = resolve;
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version") {
      response.end(
        JSON.stringify({
          Browser: "Node.js/v24.18.0",
          "Protocol-Version": "1.3",
          "V8-Version": "12.0",
        }),
      );
      return;
    }
    if (request.url === "/json/list") {
      const address = server.address();
      if (address === null || typeof address === "string") {
        response.writeHead(500).end();
        return;
      }
      response.end(
        JSON.stringify([
          {
            id: "target-1",
            type: "node",
            url: scriptUrl,
            attached: false,
            webSocketDebuggerUrl: `ws://127.0.0.1:${String(address.port)}/target-1`,
          },
        ]),
      );
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server, path: "/target-1" });
  sockets.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const parsed = safeParseJson(raw.toString());
      if (!parsed.ok) throw parsed.cause;
      const command = z
        .object({ id: z.number(), method: z.string() })
        .parse(parsed.value);
      if (command.method === "Runtime.enable") {
        socket.send(
          JSON.stringify({
            method: "Runtime.executionContextCreated",
            params: {
              context: { id: 1, name: "main", origin: reportedScriptUrl },
            },
          }),
        );
        socket.send(
          JSON.stringify({
            method: "Debugger.scriptParsed",
            params: {
              scriptId: "1",
              url: reportedScriptUrl,
              executionContextId: 1,
              hash: "captured-before-failure",
              length: 24,
              isModule: false,
            },
          }),
        );
        socket.send(JSON.stringify({ id: command.id, result: {} }));
        return;
      }
      if (command.method === "Debugger.enable") {
        // Receiving the next command proves the preceding events and reply
        // were consumed; cancellation needs no timing assumption.
        signalScriptSent?.();
        if (failure === "protocol failure") {
          socket.send(JSON.stringify({ id: command.id, result: "malformed" }));
        } else {
          socket.send(JSON.stringify({ id: command.id, result: {} }));
          if (failure === "disconnect") socket.close();
          if (failure === "idle protocol failure") {
            setTimeout(() => socket.send("{malformed-json"), 20);
            setTimeout(
              () =>
                socket.send(
                  JSON.stringify({
                    method: "Debugger.scriptParsed",
                    params: { scriptId: "late", url: scriptUrl },
                  }),
                ),
              40,
            );
          }
        }
        return;
      }
      socket.send(JSON.stringify({ id: command.id, result: {} }));
    });
  });
  return { server, sockets, scriptSent };
};

it.each(failureCases)(
  "preserves captured scripts and contexts after %s",
  async (failure, reason) => {
    const root = await mkdtemp(join(tmpdir(), "rea-inspector-partial-"));
    const scriptPath = join(root, "target.js");
    const scriptUrl = pathToFileURL(scriptPath).href;
    const reportedScriptUrl = failure === "cancellation" ? "" : scriptUrl;
    await writeFile(scriptPath, "globalThis.ready = true;\n");

    const { server, sockets, scriptSent } = createPartialInspectorServer(
      failure,
      scriptUrl,
      reportedScriptUrl,
    );

    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Inspector fixture did not bind a TCP port");

      const controller = new AbortController();
      const timerSpy =
        failure === "disconnect" ? vi.spyOn(globalThis, "setTimeout") : null;
      const clearSpy =
        failure === "disconnect" ? vi.spyOn(globalThis, "clearTimeout") : null;
      const executionOptions =
        failure === "cancellation" || failure === "disconnect"
          ? { signal: controller.signal }
          : {};
      const observing = new V8InspectorProvider().observe(
        {
          inspector_endpoint: `http://127.0.0.1:${String(address.port)}`,
          target_id: "target-1",
          observation_ms: failure === "disconnect" ? 12_345 : 10_000,
        },
        executionOptions,
      );
      if (failure === "cancellation") {
        await scriptSent;
        controller.abort();
      }
      const result = await observing;

      if (failure === "disconnect") {
        const observationTimer = timerSpy?.mock.results.find(
          (result, index) => timerSpy.mock.calls[index]?.[1] === 12_345,
        )?.value;
        expect(observationTimer).toBeDefined();
        expect(
          clearSpy?.mock.calls.some(([timer]) => timer === observationTimer),
        ).toBe(true);
        expect(controller.signal.aborted).toBe(false);
      }

      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("Expected the Inspector operation to fail");
      if (failure === "cancellation") {
        expect(result.error).toBeInstanceOf(AnalysisCancelledError);
        expect(result.error.cause).toBe(controller.signal.reason);
      } else {
        expect(result.error).toMatchObject({
          _tag: "BrowserObservationError",
          reason,
        });
      }
      expect(result.error.partialObservation).toMatchObject({
        capture: { events_observed: 2 },
        scripts: {
          observed_total: 1,
          items: [
            {
              location: {
                kind: "unresolved",
                reported_url: reportedScriptUrl,
                reason: "location-authorization-not-attempted",
              },
              cdp_hash: "captured-before-failure",
              length: 24,
            },
          ],
        },
        execution_contexts: [
          { context_key: "1", name: "main", origin: reportedScriptUrl },
        ],
      });
    } finally {
      vi.restoreAllMocks();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
