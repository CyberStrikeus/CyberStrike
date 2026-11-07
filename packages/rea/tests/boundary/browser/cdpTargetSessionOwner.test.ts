import { createServer } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import { expect, it, onTestFinished, vi } from "vitest";

import { CdpTargetSessionOwner } from "../../../src/browser/CdpTargetSessionOwner.js";
import { CdpConnection } from "../../../src/browser/CdpConnection.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it("joins a late owned handshake and waits for its active operation", async () => {
  const http = createServer();
  const webSockets = new WebSocketServer({ noServer: true });
  let port = 0;
  let releaseUpgrade: (() => void) | undefined;
  let upgradeReceived: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    upgradeReceived = resolve;
  });
  const allow = new Promise<void>((resolve) => {
    releaseUpgrade = resolve;
  });
  http.on("upgrade", (request, socket, head) => {
    upgradeReceived?.();
    void allow.then(() =>
      webSockets.handleUpgrade(request, socket, head, (webSocket) =>
        webSockets.emit("connection", webSocket, request),
      ),
    );
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind a TCP port");
  port = address.port;
  const owner = new CdpTargetSessionOwner();
  let connecting: Promise<CdpConnection> | undefined;
  onTestFinished(async () => {
    releaseUpgrade?.();
    if (connecting !== undefined) {
      const pendingConnection = await connecting;
      await owner.finish(pendingConnection);
    }
    await owner.close();
    await new Promise<void>((resolve, reject) =>
      webSockets.close((cause) => (cause ? reject(cause) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      http.close((cause) => (cause ? reject(cause) : resolve())),
    );
  });

  connecting = owner.connect(
    `ws://127.0.0.1:${String(port)}/devtools/browser/late`,
    "inspect_web_page",
    {},
    "late-handshake",
  );
  await received;
  const closing = owner.close();
  let closed = false;
  void closing.then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  releaseUpgrade?.();
  const connection = await connecting;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  await owner.finish(connection);
  await closing;
  await vi.waitFor(() => expect(webSockets.clients.size).toBe(0));
});

it("retries only the failed transport and does not repeat successful child cleanup", async () => {
  const browser = await startFakeCdpBrowser();
  const owner = new CdpTargetSessionOwner();
  let active: CdpConnection | undefined;
  onTestFinished(async () => {
    if (active !== undefined) await owner.finish(active);
    await owner.close();
    await browser.close();
  });
  const failed = await owner.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    {},
    "failed-session",
  );
  active = await owner.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    {},
    "active-peer",
  );
  const close = vi
    .spyOn(WebSocket.prototype, "close")
    .mockImplementationOnce(() => {
      throw new Error("controlled close failure");
    });
  const terminate = vi
    .spyOn(WebSocket.prototype, "terminate")
    .mockImplementation(() => undefined);
  try {
    const failure = await owner.finish(failed).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(ProviderCleanupError);
    expect(failure).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: ["failed-session"],
    });
  } finally {
    close.mockRestore();
    terminate.mockRestore();
  }

  await owner.retryPending();
  await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(1));
  const cleanup = vi.fn(async () => undefined);
  await owner.finish(active, cleanup);
  await owner.retryPending();
  await owner.close();
  expect(cleanup).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
  expect(browser.commands.map(({ method }) => method)).not.toContain(
    "Target.closeTarget",
  );
  expect(browser.commands.map(({ method }) => method)).not.toContain(
    "Browser.close",
  );
});

it("accepts asynchronous terminate success only after the close event", async () => {
  const browser = await startFakeCdpBrowser();
  const owner = new CdpTargetSessionOwner();
  onTestFinished(async () => {
    await owner.close();
    await browser.close();
  });
  const connection = await owner.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    {},
    "forced-close",
  );
  const originalTerminate = WebSocket.prototype.terminate;
  const close = vi
    .spyOn(WebSocket.prototype, "close")
    .mockImplementation(() => undefined);
  const terminate = vi
    .spyOn(WebSocket.prototype, "terminate")
    .mockImplementation(function (this: WebSocket) {
      return originalTerminate.call(this);
    });
  try {
    await owner.finish(connection);
  } finally {
    close.mockRestore();
    terminate.mockRestore();
  }
  await owner.close();
  await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
});

it("clears returned inspection and shutdown cleanup status only after socket release", async () => {
  const browser = await startFakeCdpBrowser();
  const provider = new CdpBrowserProvider();
  const originalClose = CdpConnection.prototype.close;
  let denied = true;
  const closing = vi
    .spyOn(CdpConnection.prototype, "close")
    .mockImplementation(function (this: CdpConnection) {
      return denied
        ? Promise.reject(new Error("controlled transport close failure"))
        : originalClose.call(this);
    });
  onTestFinished(async () => {
    closing.mockRestore();
    await provider.close();
    await browser.close();
  });
  const result = await provider.inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    }),
  );
  if (result.ok) throw new Error("Expected retained socket cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.partialObservation).toBeDefined();
  const observation = result.error.partialObservation;
  const retry = await provider.close().catch((cause: unknown) => cause);
  expect(retry).toBeInstanceOf(AnalysisError);
  if (!(retry instanceof AnalysisError))
    throw new Error("Missing retry failure");
  expect(retry.cleanupIncomplete).toBe(true);
  expect(browser.activeConnectionCount()).toBe(1);
  denied = false;
  await provider.close();
  await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(retry.cleanupIncomplete).toBe(false);
  expect(result.error.partialObservation).toBe(observation);
  expect(browser.commands.map(({ method }) => method)).not.toContain(
    "Browser.close",
  );
  expect(browser.commands.map(({ method }) => method)).not.toContain(
    "Target.closeTarget",
  );
});

it("keeps retry aggregates incomplete until every reported socket is released", async () => {
  const browser = await startFakeCdpBrowser();
  const owner = new CdpTargetSessionOwner();
  const first = await owner.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    {},
    "first-socket",
  );
  const second = await owner.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    {},
    "second-socket",
  );
  const active = await owner.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    {},
    "active-peer",
  );
  const originalClose = CdpConnection.prototype.close;
  const denied = new Set([first, second]);
  const closing = vi
    .spyOn(CdpConnection.prototype, "close")
    .mockImplementation(function (this: CdpConnection) {
      return denied.has(this)
        ? Promise.reject(new Error("controlled mixed close failure"))
        : originalClose.call(this);
    });
  onTestFinished(async () => {
    closing.mockRestore();
    await owner.finish(active);
    await owner.close();
    await browser.close();
  });
  const errors = await Promise.all(
    [first, second].map((connection) =>
      owner.finish(connection).catch((cause: unknown) => cause),
    ),
  );
  const aggregate = await owner.retryPending().catch((cause: unknown) => cause);
  if (
    !(aggregate instanceof AnalysisError) ||
    !errors.every((error) => error instanceof AnalysisError)
  )
    throw new Error("Missing typed cleanup errors");
  expect(aggregate.cleanupResources).toEqual(["first-socket", "second-socket"]);
  denied.delete(first);
  const mixed = await owner.retryPending().catch((cause: unknown) => cause);
  if (!(mixed instanceof AnalysisError))
    throw new Error("Missing mixed retry error");
  expect(errors.map((error) => error.cleanupIncomplete)).toEqual([false, true]);
  expect(aggregate.cleanupIncomplete).toBe(true);
  expect(mixed.cleanupResources).toEqual(["second-socket"]);
  await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(2));
  denied.clear();
  await owner.retryPending();
  expect(errors.map((error) => error.cleanupIncomplete)).toEqual([
    false,
    false,
  ]);
  expect(aggregate.cleanupIncomplete).toBe(false);
  expect(mixed.cleanupIncomplete).toBe(false);
  await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(1));
  await owner.finish(active);
});
