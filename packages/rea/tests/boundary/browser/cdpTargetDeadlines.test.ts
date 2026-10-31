import { createServer, type Socket } from "node:net";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { CdpConnection } from "../../../src/browser/CdpConnection.js";
import { openCdpEndpoint } from "../../../src/browser/CdpTargetSession.js";
import {
  PlaywrightScenarioServiceWorkers,
  SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS,
} from "../../../src/browser/PlaywrightScenarioServiceWorkers.js";
import { AnalysisTimeoutError } from "../../../src/domain/analysisErrorCore.js";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { CDP_DISCOVERY_RESPONSE_TIMEOUT_MS } from "../../../src/domain/browserDeadline.js";
import { BrowserObservationError } from "../../../src/domain/browserObservationError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  browserObservationEndpointSchema,
  inspectWebPageInputSchema,
} from "../../../src/domain/browserObservation.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { WEB_RUNTIME_LIMITS } from "../../../src/domain/webRuntime.js";
import { V8InspectorProvider } from "../../../src/inspector/V8InspectorProvider.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";
import { startFakeV8Inspector } from "../../fixtures/inspector/fakeV8Inspector.js";

// Keep real socket scheduling; expire only a timer whose owning phase is ready.
beforeEach(() => {
  vi.spyOn(globalThis, "setTimeout");
  vi.spyOn(globalThis, "clearTimeout");
});

afterEach(() => vi.restoreAllMocks());

const activeTimers = (milliseconds: number) => {
  const scheduled = vi.mocked(globalThis.setTimeout);
  const cleared = vi.mocked(globalThis.clearTimeout);
  return scheduled.mock.calls.flatMap(([callback, delay], index) => {
    const result = scheduled.mock.results[index];
    if (
      delay !== milliseconds ||
      result?.type !== "return" ||
      cleared.mock.calls.some(([timer]) => timer === result.value)
    )
      return [];
    return [{ callback, timer: result.value }];
  });
};

const expireTimer = (milliseconds: number): void => {
  const timers = activeTimers(milliseconds);
  expect(timers).toHaveLength(1);
  const timer = timers[0];
  if (timer === undefined) throw new Error("Expected one active timer");
  try {
    timer.callback();
    if (milliseconds === WEB_RUNTIME_LIMITS.commandTimeoutMs)
      expect(globalThis.clearTimeout).toHaveBeenCalledWith(timer.timer);
  } finally {
    // The observation callback resolves naturally without cancelling its timer.
    clearTimeout(timer.timer);
  }
};

const expireEveryTimer = (milliseconds: number): void => {
  const timers = activeTimers(milliseconds);
  expect(timers.length).toBeGreaterThan(0);
  for (const timer of timers) {
    timer.callback();
    clearTimeout(timer.timer);
  }
};

it("bounds a stalled WebSocket handshake and releases its socket", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP address");
  try {
    const rejection = expect(
      CdpConnection.connect(
        `ws://127.0.0.1:${String(address.port)}/target`,
        "inspect_web_page",
        AbortSignal.timeout(10_000),
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
    await vi.waitFor(() => expect(sockets.size).toBe(1), { timeout: 5_000 });
    expireTimer(WEB_RUNTIME_LIMITS.commandTimeoutMs);
    await rejection;
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each(["Target.attachToTarget", "Page.enable", "Runtime.enable"])(
  "times out %s after HTTP discovery and closes the target session",
  async (hangOnMethod) => {
    const browser = await startFakeCdpBrowser({ hangOnMethod });
    try {
      const pending = new CdpBrowserProvider().inspectPage(
        inspectWebPageInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          observation_ms: 0,
        }),
        { signal: AbortSignal.timeout(10_000) },
      );
      await vi.waitFor(
        () =>
          expect(browser.commands.map(({ method }) => method)).toContain(
            hangOnMethod,
          ),
        { timeout: 5_000 },
      );
      expireTimer(WEB_RUNTIME_LIMITS.commandTimeoutMs);
      const result = await pending;
      if (result.ok) throw new Error("Expected a target command timeout");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "provider_timeout",
        category: "timeout",
      });
      expect(browser.commands.map(({ method }) => method)).toContain(
        hangOnMethod,
      );
      await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
    } finally {
      await browser.close();
    }
  },
);

it("ignores a late timed-out reply and keeps following commands correlated", async () => {
  const browser = await startFakeCdpBrowser({ hangOnMethod: "Page.enable" });
  const connection = await CdpConnection.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
  );
  try {
    const rejection = expect(
      connection.send(
        "Page.enable",
        {},
        undefined,
        AbortSignal.timeout(10_000),
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
    await vi.waitFor(() => expect(browser.commands).toHaveLength(1), {
      timeout: 5_000,
    });
    expireTimer(WEB_RUNTIME_LIMITS.commandTimeoutMs);
    await rejection;
    const command = browser.commands[0];
    if (command === undefined)
      throw new Error("Expected the timed-out command");
    browser.emitRawMessage(JSON.stringify({ id: command.id, result: {} }));
    await expect(connection.send("Runtime.enable")).resolves.toEqual({});
  } finally {
    await connection.close();
    await browser.close();
  }
});

it.each(["success", "rejection", "abort", "disconnect"])(
  "releases handshake and command timers on %s",
  async (outcome) => {
    const cleared = vi.mocked(globalThis.clearTimeout);
    const browser = await startFakeCdpBrowser({
      ...(outcome === "abort" || outcome === "success"
        ? { hangOnMethod: "Runtime.enable" }
        : {}),
      ...(outcome === "disconnect" ? { closeOnMethod: "Runtime.enable" } : {}),
    });
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, "removeEventListener");
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "inspect_web_page",
      controller.signal,
    );
    try {
      const pending = connection.send(
        outcome === "rejection" ? "Fixture.unmodeledMethod" : "Runtime.enable",
        {},
        undefined,
        controller.signal,
      );
      const assertion =
        outcome === "success"
          ? expect(pending).resolves.toEqual({})
          : expect(pending).rejects.toMatchObject({
              _tag:
                outcome === "abort"
                  ? "AnalysisCancelledError"
                  : "BrowserObservationError",
            });
      if (outcome === "success") {
        await vi.waitFor(() => expect(browser.commands).toHaveLength(1), {
          timeout: 5_000,
        });
        // A healthy reply may take longer than the former 100 ms test budget.
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        const command = browser.commands[0];
        if (command === undefined)
          throw new Error("Expected a pending command");
        browser.emitRawMessage(JSON.stringify({ id: command.id, result: {} }));
      }
      if (outcome === "abort") controller.abort();
      await assertion;
      const scheduled = vi.mocked(globalThis.setTimeout);
      const deadlines = scheduled.mock.calls.flatMap((call, index) =>
        call[1] === WEB_RUNTIME_LIMITS.commandTimeoutMs
          ? [scheduled.mock.results[index]?.value]
          : [],
      );
      expect(deadlines).toHaveLength(2);
      for (const timer of deadlines)
        expect(cleared).toHaveBeenCalledWith(timer);
      expect(removeAbort).toHaveBeenCalledTimes(2);
    } finally {
      await connection.close();
      await browser.close();
    }
  },
);

it.each(["Runtime.enable", "Debugger.enable"])(
  "times out Inspector %s and preserves observations received before expiry",
  async (hangOnMethod) => {
    const inspector = await startFakeV8Inspector({
      targetUrl: "https://fixture.example/app.js",
      hangOnMethod,
    });
    try {
      const pending = new V8InspectorProvider().observe(
        {
          inspector_endpoint: inspector.endpoint,
          target_id: inspector.targetId,
          observation_ms: 0,
        },
        { signal: AbortSignal.timeout(10_000) },
      );
      await vi.waitFor(
        () =>
          expect(inspector.commands.map(({ method }) => method)).toContain(
            hangOnMethod,
          ),
        { timeout: 5_000 },
      );
      expireTimer(WEB_RUNTIME_LIMITS.commandTimeoutMs);
      const result = await pending;
      if (result.ok) throw new Error("Expected an Inspector command timeout");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "provider_timeout",
        category: "timeout",
      });
      expect(result.error.partialObservation).toMatchObject({
        capture: {
          events_observed: hangOnMethod === "Debugger.enable" ? 1 : 0,
        },
      });
      expect(result.error.userMessage ?? "").not.toContain(
        "command_timeout_ms",
      );
      expect(result.error.userMessage ?? "").not.toContain(
        "--command-timeout-ms",
      );
    } finally {
      await inspector.close();
    }
  },
);

it("keeps the chosen observation window independent of command deadlines", async () => {
  const browser = await startFakeCdpBrowser();
  const observationMs = WEB_RUNTIME_LIMITS.commandTimeoutMs + 250;
  try {
    const pending = new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: observationMs,
      }),
    );
    await vi.waitFor(
      () => expect(activeTimers(observationMs)).toHaveLength(1),
      {
        timeout: 5_000,
      },
    );
    expect(activeTimers(WEB_RUNTIME_LIMITS.commandTimeoutMs)).toHaveLength(0);
    expireTimer(observationMs);
    const result = await pending;
    expect(result.ok).toBe(true);
  } finally {
    await browser.close();
  }
});

it("keeps a short command deadline off HTTP discovery and names Page.getFrameTree", async () => {
  const browser = await startFakeCdpBrowser({
    hangOnMethod: "Page.getFrameTree",
    discoveryDelayMs: 180,
  });
  const provider = new CdpWebRuntimeProvider();
  const started = performance.now();
  try {
    const pending = provider.observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 1,
        command_timeout_ms: 40,
      }),
      { signal: AbortSignal.timeout(10_000) },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(activeTimers(40)).toHaveLength(0);
    const result = await pending;
    expect(performance.now() - started).toBeGreaterThan(300);
    if (result.ok) throw new Error("Expected a command deadline");
    const text = `${result.error.userMessage ?? ""}\n${result.error.message}`;
    expect(text).toContain("40 ms command_timeout_ms");
    expect(text).toContain("Page.getFrameTree");
    expect(text).not.toContain("WebSocket handshake");
    expect(browser.httpRequests.map(({ url }) => url)).toEqual(
      expect.arrayContaining(["/json/version", "/json/list"]),
    );
    await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
  } finally {
    await provider.close();
    await browser.close();
  }
});

it("gives browser-socket attach its own command deadline after the handshake", async () => {
  const commandTimeoutMs = 80;
  const browser = await startFakeCdpBrowser({
    handshakeDelayMs: 50,
    hangOnMethod: "Target.attachToTarget",
  });
  const provider = new CdpWebRuntimeProvider();
  try {
    const pending = provider.observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 1,
        command_timeout_ms: commandTimeoutMs,
      }),
      { signal: AbortSignal.timeout(10_000) },
    );
    await vi.waitFor(
      () =>
        expect(browser.commands.map(({ method }) => method)).toContain(
          "Target.attachToTarget",
        ),
      { timeout: 5_000 },
    );
    expect(activeTimers(commandTimeoutMs)).toHaveLength(1);
    expireTimer(commandTimeoutMs);
    const result = await pending;
    if (result.ok) throw new Error("Expected an attach deadline");
    const text = `${result.error.userMessage ?? ""}\n${result.error.message}`;
    expect(text).toContain(
      `CDP command Target.attachToTarget exceeded its ${String(commandTimeoutMs)} ms command_timeout_ms`,
    );
    expect(text).not.toContain("WebSocket handshake exceeded");
    await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
  } finally {
    await provider.close();
    await browser.close();
  }
});

it("stops a stalled blocked-service-worker check before discovery", async () => {
  const commandTimeoutMs = 25_000;
  const browser = await startFakeCdpBrowser();
  const frame = {
    evaluate: () => new Promise<null>(() => undefined),
    isDetached: () => false,
    url: () => `${browser.allowedOrigin}/app`,
  };
  const workers = new PlaywrightScenarioServiceWorkers(
    {
      frames: () => [frame],
      isClosed: () => false,
      mainFrame: () => frame,
    } as unknown as ConstructorParameters<
      typeof PlaywrightScenarioServiceWorkers
    >[0],
    browser.endpoint,
    "allowed-page",
    commandTimeoutMs,
  );
  // Keep the monotonic deadline and its explicitly expired timer in sync.
  const clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
  const pending = workers.initialize();
  try {
    await vi.waitFor(() =>
      expect(activeTimers(SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS)).toHaveLength(
        1,
      ),
    );
    expect(browser.httpRequests).toHaveLength(0);
    expect(browser.commands).toHaveLength(0);
    expect(activeTimers(commandTimeoutMs)).toHaveLength(0);
    clock.mockReturnValue(1_000 + SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS);
    expireTimer(SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS);
    const failure = await pending.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisTimeoutError);
    if (!(failure instanceof AnalysisTimeoutError))
      throw new Error("Expected a policy-check deadline");
    const text = `${failure.userMessage ?? ""}\n${failure.message}`;
    expect(text).toContain(
      `${String(SERVICE_WORKER_POLICY_CHECK_TIMEOUT_MS)} ms deadline before CDP discovery`,
    );
    expect(text).toContain("command_timeout_ms does not apply");
    expect(browser.httpRequests).toHaveLength(0);
    expect(activeTimers(commandTimeoutMs)).toHaveLength(0);
  } finally {
    clock.mockRestore();
    const closing = workers.close().catch(() => undefined);
    await browser.close();
    await closing;
    await pending.catch(() => undefined);
  }
});

it("keeps blocked service-worker attachment outside the discovery deadline", async () => {
  const commandTimeoutMs = 25_000;
  const browser = await startFakeCdpBrowser({
    hangOnMethod: "Target.attachToTarget",
  });
  const frame = {
    evaluate: async () => null,
    isDetached: () => false,
    url: () => `${browser.allowedOrigin}/app`,
  };
  const workers = new PlaywrightScenarioServiceWorkers(
    {
      frames: () => [frame],
      isClosed: () => false,
      mainFrame: () => frame,
    } as unknown as ConstructorParameters<
      typeof PlaywrightScenarioServiceWorkers
    >[0],
    browser.endpoint,
    "allowed-page",
    commandTimeoutMs,
  );
  const pending = workers.initialize();
  try {
    await vi.waitFor(
      () =>
        expect(browser.commands.map(({ method }) => method)).toContain(
          "Target.attachToTarget",
        ),
      { timeout: 5_000 },
    );
    expect(activeTimers(CDP_DISCOVERY_RESPONSE_TIMEOUT_MS)).toHaveLength(0);
    expect(activeTimers(commandTimeoutMs)).toHaveLength(1);
  } finally {
    const closing = workers.close().catch(() => undefined);
    await browser.close();
    await closing;
    await pending.catch(() => undefined);
  }
});

it("reports browser-socket discovery on its own deadline", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP address");
  const started = performance.now();
  try {
    const failure = await openCdpEndpoint(
      browserObservationEndpointSchema.parse(
        `ws://127.0.0.1:${String(address.port)}/devtools/browser/stalled`,
      ),
      "list_browser_targets",
      undefined,
      80,
      undefined,
      30,
    ).catch((cause: unknown) => cause);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThan(60);
    expect(elapsed).toBeLessThan(1_500);
    expect(failure).toBeInstanceOf(BrowserObservationError);
    if (!(failure instanceof BrowserObservationError))
      throw new Error("Expected a browser-socket discovery failure");
    const text = `${failure.userMessage ?? ""}\n${failure.message}`;
    expect(text).toContain("80");
    expect(text).not.toContain("30 ms");
    expect(text).toContain("browser-socket discovery");
    expect(text).toContain(
      `${String(WEB_RUNTIME_LIMITS.protocolBytes)}-byte browser-socket message budget`,
    );
    expect(text).not.toContain("8388608-byte discovery document budget");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("applies a non-default handshake deadline and releases its socket", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP address");
  try {
    let captured: unknown;
    const pending = CdpConnection.connect(
      `ws://127.0.0.1:${String(address.port)}/target`,
      "inspect_web_page",
      AbortSignal.timeout(10_000),
      { commandTimeoutMs: 1_500 },
    ).then(
      () => {
        throw new Error("Expected a handshake deadline");
      },
      (cause: unknown) => {
        captured = cause;
        throw cause;
      },
    );
    const rejection = expect(pending).rejects.toMatchObject({
      reason: "timeout",
    });
    await vi.waitFor(() => expect(sockets.size).toBe(1), { timeout: 5_000 });
    expireTimer(1_500);
    await rejection;
    expect(captured).toBeInstanceOf(BrowserObservationError);
    if (!(captured instanceof BrowserObservationError))
      throw new Error("Expected a handshake deadline");
    expect(captured.userMessage).toContain("1500 ms command_timeout_ms");
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("applies a non-default command deadline after HTTP discovery", async () => {
  const browser = await startFakeCdpBrowser({ hangOnMethod: "Page.enable" });
  try {
    const pending = new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
        command_timeout_ms: 1_500,
      }),
      { signal: AbortSignal.timeout(10_000) },
    );
    await vi.waitFor(
      () =>
        expect(browser.commands.map(({ method }) => method)).toContain(
          "Page.enable",
        ),
      { timeout: 5_000 },
    );
    expireTimer(1_500);
    const result = await pending;
    if (result.ok) throw new Error("Expected a selected command timeout");
    expect(result.error.userMessage ?? "").toContain(
      "1500 ms command_timeout_ms",
    );
    await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
  } finally {
    await browser.close();
  }
});

it("reschedules a raised command deadline onto the fixed cleanup grace", async () => {
  const browser = await startFakeCdpBrowser({ hangOnMethod: "Runtime.enable" });
  const connection = await CdpConnection.connect(
    browser.browserWebSocketUrl,
    "inspect_web_page",
    undefined,
    { commandTimeoutMs: 60_000 },
  );
  try {
    const pending = connection.send("Runtime.enable");
    await vi.waitFor(() => expect(browser.commands).toHaveLength(1), {
      timeout: 5_000,
    });
    expect(activeTimers(60_000)).toHaveLength(1);
    connection.beginCleanupGrace(5_000);
    expect(activeTimers(60_000)).toHaveLength(0);
    expireTimer(5_000);
    const error = await pending.catch((cause: unknown) => cause);
    expect(error).toMatchObject({ reason: "timeout" });
    if (!(error instanceof BrowserObservationError))
      throw new Error("Expected cleanup grace timeout");
    expect(error.userMessage).toContain("5000 ms");
    expect(error.userMessage).not.toContain("Increase command_timeout_ms");
    expect(error.remediationAction).toContain("no runtime override");
  } finally {
    await connection.close();
    await browser.close();
  }
});

it("keeps runtime cleanup on the fixed grace when command_timeout_ms is shorter", async () => {
  const commandTimeoutMs = 250;
  const browser = await startRuntimeBrowser({
    hangOnMethod: "Profiler.disable",
  });
  const provider = new CdpWebRuntimeProvider();
  try {
    const pending = provider.observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 1,
        command_timeout_ms: commandTimeoutMs,
      }),
      { signal: AbortSignal.timeout(10_000) },
    );
    await vi.waitFor(
      () =>
        expect(browser.commands.map(({ method }) => method)).toContain(
          "Profiler.disable",
        ),
      { timeout: 5_000 },
    );
    expect(activeTimers(commandTimeoutMs)).toHaveLength(0);
    expect(
      activeTimers(WEB_RUNTIME_LIMITS.cleanupTimeoutMs).length,
    ).toBeGreaterThan(0);
    const hung = browser.commands.find(
      ({ method }) => method === "Profiler.disable",
    );
    if (hung === undefined) throw new Error("Expected Profiler.disable");
    browser.emitRawMessage(
      JSON.stringify({
        id: hung.id,
        ...(hung.sessionId === undefined ? {} : { sessionId: hung.sessionId }),
        result: {},
      }),
    );
    const result = await pending;
    expect(result.ok).toBe(true);
  } finally {
    await provider.close();
    await browser.close();
  }
});

it("names the fixed cleanup grace when runtime restoration stalls", async () => {
  const commandTimeoutMs = 250;
  const browser = await startRuntimeBrowser({
    hangOnMethod: "Profiler.disable",
  });
  const provider = new CdpWebRuntimeProvider();
  try {
    const pending = provider.observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 1,
        command_timeout_ms: commandTimeoutMs,
      }),
      { signal: AbortSignal.timeout(10_000) },
    );
    await vi.waitFor(
      () =>
        expect(browser.commands.map(({ method }) => method)).toContain(
          "Profiler.disable",
        ),
      { timeout: 5_000 },
    );
    expect(activeTimers(commandTimeoutMs)).toHaveLength(0);
    expireEveryTimer(WEB_RUNTIME_LIMITS.cleanupTimeoutMs);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cleanup grace failure");
    const text = JSON.stringify(result.error.diagnostics);
    expect(text).toContain("5000 ms");
    expect(text).toContain("no runtime override");
    expect(text).not.toContain(
      `${String(commandTimeoutMs)} ms command_timeout_ms`,
    );
    expect(text).not.toContain("Increase command_timeout_ms");
  } finally {
    await provider.close();
    await browser.close();
  }
});
