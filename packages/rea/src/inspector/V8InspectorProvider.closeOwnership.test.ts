import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it, onTestFinished, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
  withVerifierCleanup,
  closeVerifierResources,
} from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";

import { CdpConnection } from "../browser/CdpConnection.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { observeJavaScriptRuntime } from "../application/javascript/JavaScriptRuntimeObservationService.js";
import { observeJavaScriptRuntimeInputSchema } from "../domain/javascript/javascriptRuntimeObservation.js";
import {
  V8InspectorAdmission,
  V8InspectorProvider,
} from "./V8InspectorProvider.js";

const inspectorCloseFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-inspector-close-owner-"));
  const scriptPath = join(root, "target.js");
  await writeFile(scriptPath, "globalThis.fixture = true;\n");
  const scriptUrl = pathToFileURL(scriptPath).href;
  let endpoint = "";
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version")
      response.end(
        JSON.stringify({
          Browser: "Node.js/v24.18.0",
          "Protocol-Version": "1.3",
          "V8-Version": "fixture",
        }),
      );
    else if (request.url === "/json/list")
      response.end(
        JSON.stringify([
          {
            id: "fixture",
            type: "node",
            url: scriptUrl,
            attached: false,
            webSocketDebuggerUrl: endpoint.replace("http:", "ws:") + "/fixture",
          },
        ]),
      );
    else response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server, path: "/fixture" });
  let acceptedConnections = 0;
  const connectionWaiters = new Map<number, () => void>();
  sockets.on("connection", (socket) => {
    acceptedConnections += 1;
    connectionWaiters.get(acceptedConnections)?.();
    socket.on("message", (raw) => {
      const command = JSON.parse(raw.toString()) as { id: number };
      socket.send(JSON.stringify({ id: command.id, result: {} }));
    });
  });
  const waitForConnections = (count: number): Promise<void> =>
    acceptedConnections >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => connectionWaiters.set(count, resolve));

  const admission = new V8InspectorAdmission();
  let resolveCloseStarted: (() => void) | undefined;
  const closeStarted = new Promise<void>((resolve) => {
    resolveCloseStarted = resolve;
  });
  let rejectFirstClose: ((cause: Error) => void) | undefined;
  let closeCalls = 0;
  const closeFailures = new Set<number>([2]);
  const firstClose = new Promise<void>((_resolve, reject) => {
    rejectFirstClose = reject;
  });
  // Cleanup may reject the gate before a transport consumes it.
  void firstClose.catch(() => undefined);
  const originalClose = CdpConnection.prototype.close;
  const closeSpy = vi
    .spyOn(CdpConnection.prototype, "close")
    .mockImplementation(function (this: CdpConnection): Promise<void> {
      closeCalls += 1;
      if (closeCalls === 1) {
        resolveCloseStarted?.();
        return firstClose;
      }
      if (closeFailures.delete(closeCalls))
        return Promise.reject(new Error("controlled retry remains pending"));
      return originalClose.call(this);
    });

  onTestFinished(async () => {
    await closeVerifierResources([
      () => rejectFirstClose?.(new Error("fixture finalization")),
      () => closeSpy.mockRestore(),
      () => new V8InspectorProvider(undefined, admission).close(),
      () => {
        for (const socket of sockets.clients) socket.terminate();
      },
      () => new Promise<void>((resolve) => sockets.close(() => resolve())),
      async () => {
        if (server.listening)
          await new Promise<void>((resolve) => server.close(() => resolve()));
      },
      () => rm(root, { recursive: true, force: true }),
    ]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Inspector fixture did not bind a TCP port");
  endpoint = `http://127.0.0.1:${String(address.port)}`;
  const input = observeJavaScriptRuntimeInputSchema.parse({
    inspector_endpoint: endpoint,
    target_id: "fixture",
    observation_ms: 0,
  });
  return {
    input,
    endpoint,
    closeStarted,
    closeFailures,
    closeSpy,
    waitForConnections,
    rejectFirstClose: (cause: Error) => rejectFirstClose?.(cause),
    get acceptedConnections() {
      return acceptedConnections;
    },
    admission,
  };
};

it("retains cancelled final-close ownership and retries the exact transport before replacement observation", async () => {
  const fixture = await inspectorCloseFixture();
  const {
    input,
    endpoint,
    closeStarted,
    closeFailures,
    closeSpy,
    waitForConnections,
    rejectFirstClose,
    admission,
  } = fixture;
  const provider = () => new V8InspectorProvider(undefined, admission);
  const controller = new AbortController();
  const cancellationReason = new Error("cancelled during transport close");
  const observing = observeJavaScriptRuntime(provider(), input, {
    signal: controller.signal,
  });
  const result = await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      closeStarted,
      observing,
      "inspector final close",
    );
    controller.abort(cancellationReason);
    let firstObservationSettled = false;
    void observing.then(
      () => {
        firstObservationSettled = true;
      },
      () => {
        firstObservationSettled = true;
      },
    );
    await Promise.resolve();
    expect(firstObservationSettled).toBe(false);
    rejectFirstClose(new Error("controlled final socket close failure"));
    return await observing;
  }, [
    () => controller.abort(new Error("fixture finalization")),
    () => rejectFirstClose(new Error("fixture finalization")),
    async () => {
      await observing;
    },
  ]);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cleanup-incomplete cancellation");
  const error = result.error;
  expect(error.cleanupIncomplete).toBe(true);
  expect(error.cleanupResources).toEqual(["browser_transport"]);
  expect(error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
  expect(error.cleanupPrimary?.cause).toBe(cancellationReason);
  expect(error.partialObservation).toMatchObject({
    predicate_type: "rea.javascript-runtime-observation",
    operation: "observe_javascript_runtime",
    normalized_result: {
      target: { target_id: "fixture" },
    },
  });
  expect(projectAnalysisError(error).code).toBe("cleanup_incomplete");

  const blocked = await observeJavaScriptRuntime(provider(), input);
  expect(blocked.ok).toBe(false);
  if (blocked.ok)
    throw new Error("Expected unresolved transport admission refusal");
  expect(blocked.error.cleanupIncomplete).toBe(true);
  expect(fixture.acceptedConnections).toBe(1);

  const recovered = await observeJavaScriptRuntime(provider(), input);
  expect(recovered.ok).toBe(true);
  expect(error.cleanupIncomplete).toBe(false);
  expect(error.cleanupResources).toEqual([]);
  expect(fixture.acceptedConnections).toBe(2);

  closeFailures.add(5);
  const cleanupOnly = await observeJavaScriptRuntime(provider(), input);
  expect(cleanupOnly.ok).toBe(false);
  if (cleanupOnly.ok) throw new Error("Expected close-only cleanup failure");
  expect(cleanupOnly.error.cleanupIncomplete).toBe(true);
  expect(cleanupOnly.error.cleanupResources).toEqual(["browser_transport"]);
  expect(cleanupOnly.error.partialObservation).toMatchObject({
    predicate_type: "rea.javascript-runtime-observation",
    operation: "observe_javascript_runtime",
  });
  expect(fixture.acceptedConnections).toBe(3);

  const activeInput = observeJavaScriptRuntimeInputSchema.parse({
    inspector_endpoint: endpoint,
    target_id: "fixture",
    observation_ms: 30_000,
  });
  const activeController = new AbortController();
  const activeObservation = observeJavaScriptRuntime(provider(), activeInput, {
    signal: activeController.signal,
  });
  const queuedController = new AbortController();
  let shutdown: Promise<void> | undefined;
  let queuedObservation:
    | ReturnType<typeof observeJavaScriptRuntime>
    | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      waitForConnections(4),
      activeObservation,
      "active inspector connection",
    );
    let shutdownSettled = false;
    shutdown = provider()
      .close()
      .then(() => {
        shutdownSettled = true;
      });
    queuedObservation = observeJavaScriptRuntime(provider(), input, {
      signal: queuedController.signal,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(shutdownSettled).toBe(false);
    expect(fixture.acceptedConnections).toBe(4);
    expect(cleanupOnly.error.cleanupIncomplete).toBe(false);
    expect(cleanupOnly.error.cleanupResources).toEqual([]);
    activeController.abort(new Error("finish the admitted observation"));
    const activeResult = await activeObservation;
    expect(activeResult.ok).toBe(false);
    await shutdown;
    expect(shutdownSettled).toBe(true);
    await awaitAcknowledgement(
      waitForConnections(5),
      queuedObservation,
      "queued inspector connection",
    );
    const queuedResult = await queuedObservation;
    expect(queuedResult.ok).toBe(true);
    expect(fixture.acceptedConnections).toBe(5);
    expect(closeSpy).toHaveBeenCalledTimes(8);
  }, [
    () => activeController.abort(new Error("fixture finalization")),
    () => queuedController.abort(new Error("fixture finalization")),
    async () => {
      await activeObservation;
    },
    async () => {
      await shutdown;
    },
    async () => {
      await queuedObservation;
    },
  ]);
});
