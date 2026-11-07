import {
  AnalysisCleanupLeaseGroup,
  AnalysisCleanupLease,
} from "../artifacts/AnalysisCleanupLease.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { PlaywrightBrowserScenarioProvider } from "./PlaywrightBrowserScenarioProvider.js";
import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi, type Mock } from "vitest";
import type { PlaywrightScenarioStorage } from "./PlaywrightScenarioStorage.js";

const mocks = vi.hoisted(() => ({
  openBrowser: vi.fn(),
  storage: undefined as
    | {
        initialize: Mock<PlaywrightScenarioStorage["initialize"]>;
        settle: Mock<PlaywrightScenarioStorage["settle"]>;
        limitations: Mock<PlaywrightScenarioStorage["limitations"]>;
        close: Mock<PlaywrightScenarioStorage["close"]>;
      }
    | undefined,
  finishEvents: vi.fn(),
  policySend: vi.fn(),
  policyTransportClose: vi.fn(),
  policyBeginCleanupGrace: vi.fn(),
  policyEvent: undefined as
    | ((event: { method: string; params: unknown; sessionId?: string }) => void)
    | undefined,
}));

vi.mock("./CdpTargetSession.js", () => ({
  openCdpEndpoint: async (
    _endpoint: unknown,
    operation: Parameters<
      import("./CdpTargetSessionOwner.js").CdpTargetSessionOwner["register"]
    >[1],
    _signal: unknown,
    _limits: unknown,
    owner: import("./CdpTargetSessionOwner.js").CdpTargetSessionOwner,
  ) => {
    const connection = {
      send: mocks.policySend,
      onEvent: (listener: typeof mocks.policyEvent) => {
        mocks.policyEvent = listener;
        return () => undefined;
      },
      close: mocks.policyTransportClose,
      beginCleanupGrace: mocks.policyBeginCleanupGrace,
    } as unknown as import("./CdpConnection.js").CdpConnection;
    owner.register(connection, operation, "target");
    return {
      discovery: { targets: [{ id: "target" }] },
      connection,
    };
  },
  attachCdpTargetSession: async (connection: unknown) => ({
    connection,
    sessionId: "policy-session",
  }),
}));

vi.mock("./PlaywrightScenarioBrowser.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./PlaywrightScenarioBrowser.js")>()),
  openPlaywrightScenarioBrowser: mocks.openBrowser,
  failBrowserScenarioOperation: async (
    cleanup: { release(): Promise<void> },
    cause: unknown,
  ) => {
    try {
      await cleanup.release();
    } catch (cleanupCause: unknown) {
      throw new AggregateError([cause, cleanupCause]);
    }
    throw cause;
  },
}));

vi.mock("./PlaywrightScenarioStorage.js", () => ({
  PlaywrightScenarioStorage: {
    create: vi.fn(async () => mocks.storage),
  },
}));

vi.mock("./PlaywrightScenarioEvents.js", () => ({
  PlaywrightScenarioEvents: class {
    finish() {
      return mocks.finishEvents();
    }

    result() {
      return {
        retained: 0,
        dropped: 0,
        items: [],
        omissions: {
          by_kind: [],
          network_transactions: [],
          network_transaction_range: null,
        },
      };
    }

    limitations() {
      return [];
    }

    setStep() {}

    nextSequence() {
      return 1;
    }

    lastSequence() {
      return 0;
    }
  },
}));

import { browserScenarioSchema } from "../domain/browserScenario.js";
import { PlaywrightScenarioSession } from "./PlaywrightScenarioSession.js";
import { PlaywrightScenarioBrowserCleanupOwner } from "./PlaywrightScenarioBrowser.js";

const scenario = browserScenarioSchema.parse({
  browser: { mode: "launch", executable_path: process.execPath },
  start_url: { url: "https://storage.example.test/" },
  actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  storage: {
    local_storage: [
      {
        origin: "https://storage.example.test",
        entries: [{ name: "seed", value: { source: "literal", value: "v" } }],
      },
    ],
  },
});

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const connectedScenario = (serviceWorkers: "block" | "allow") =>
  browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: serviceWorkers },
  });

const fixture = () => {
  const page = Object.assign(new EventEmitter(), {
    url: () => "about:blank",
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async (_script: unknown): Promise<unknown> => null),
    addInitScript: vi.fn(async (_script: unknown) => undefined),
    context: () => context,
    frames: () => [page],
    mainFrame: () => page,
    isDetached: () => false,
    isClosed: (): boolean => false,
    waitForLoadState: vi.fn(async () => undefined),
  });
  const context = Object.assign(new EventEmitter(), {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    addCookies: vi.fn(async () => undefined),
    browser: () => browser,
  });
  const browser = Object.assign(new EventEmitter(), {
    version: () => "Chrome 154",
  });
  let browserClosed = false;
  const close = vi.fn(
    async (
      finishEvents?: () => Promise<void>,
      releaseGate?: { readonly revision: number; run(): Promise<void> },
    ) => {
      await finishEvents?.();
      if (releaseGate !== undefined) {
        for (;;) {
          const revision = releaseGate.revision;
          await releaseGate.run();
          if (releaseGate.revision === revision) break;
        }
      }
      browserClosed = true;
    },
  );
  const cleanup = {
    close,
    release: close,
    cleanupLease: new AnalysisCleanupLease(
      async () => {
        await close();
      },
      {
        get cleanupResources() {
          return browserClosed ? [] : ["browser_transport"];
        },
      },
    ),
    get cleanupResources() {
      return browserClosed ? [] : ["browser_transport"];
    },
    get browserClosed() {
      return browserClosed;
    },
  };
  const opened = {
    page,
    context,
    browser,
    cleanup,
    profilePath: "/tmp/profile",
  };
  mocks.openBrowser.mockResolvedValue(opened);
  mocks.storage = {
    initialize: vi.fn<PlaywrightScenarioStorage["initialize"]>(
      async () => undefined,
    ),
    settle: vi.fn<PlaywrightScenarioStorage["settle"]>(async () => undefined),
    limitations: vi.fn<PlaywrightScenarioStorage["limitations"]>(() => []),
    close: vi.fn<PlaywrightScenarioStorage["close"]>(
      async (stopLoading = false) => ({
        loadingStopped: stopLoading,
      }),
    ),
  };
  return { cleanup, page, context, storage: mocks.storage, opened };
};

const policyResponse = (method: string): unknown =>
  method === "Page.addScriptToEvaluateOnNewDocument"
    ? { identifier: "owned-policy-script" }
    : method === "Runtime.evaluate"
      ? { result: { value: null } }
      : {};

const prepareHeldPolicyRestoration = async () => {
  const { cleanup, page, storage } = fixture();
  const cancellation = new AbortController();
  storage?.close.mockResolvedValue({ loadingStopped: false });
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    { signal: cancellation.signal },
  );
  const { promise: held, resolve: finishRestoration } = deferred();
  const { promise: started, resolve: restorationStarted } = deferred();
  const { promise: transportClosed, resolve: signalTransportClosed } =
    deferred();
  mocks.policyTransportClose.mockImplementation(async () => {
    signalTransportClosed();
  });
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Runtime.evaluate") {
      restorationStarted();
      await held;
    }
    return policyResponse(method);
  });

  return {
    cleanup,
    page,
    storage,
    cancellation,
    session,
    finishRestoration,
    started,
    transportClosed,
  };
};

const prepareLateStopRetry = async () => {
  const {
    cleanup,
    page,
    cancellation,
    session,
    finishRestoration,
    started,
    transportClosed,
  } = await prepareHeldPolicyRestoration();
  vi.useFakeTimers();
  try {
    const firstClose = session.close(false).then(
      () => ({ ok: true as const }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );
    await started;
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(firstClose).resolves.toMatchObject({ ok: false });
    finishRestoration();
    await transportClosed;
    await vi.advanceTimersByTimeAsync(0);
    cancellation.abort();
    return { cleanup, page, session };
  } catch (cause) {
    vi.useRealTimers();
    throw cause;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.policySend.mockReset();
  mocks.policyTransportClose.mockReset();
  mocks.policyEvent = undefined;
  mocks.policySend.mockImplementation(async (method: string) =>
    policyResponse(method),
  );
  mocks.policyTransportClose.mockResolvedValue(undefined);
});

it("stops attached navigation without storage and retries rejected policy cleanup", async () => {
  const { cleanup } = fixture();
  mocks.storage = undefined;
  const attached = browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: "block" },
    storage: {},
  });
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  const failure = new Error("stopLoading rejected");
  mocks.policySend.mockRejectedValueOnce(failure);
  await expect(session.close(true)).rejects.toMatchObject({
    cause: failure,
    cleanupIncomplete: true,
  });
  expect(cleanup.close).not.toHaveBeenCalled();
  await expect(session.close(true)).resolves.toBe("disconnected-external");
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(2);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("stops attached navigation when cancellation precedes the first close", async () => {
  const { cleanup, page } = fixture();
  mocks.storage = undefined;
  const cancellation = new AbortController();
  const attached = browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: "block" },
    storage: {},
  });
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    { signal: cancellation.signal },
  );
  cancellation.abort();

  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(1);
  expect(
    page.evaluate.mock.calls.filter(
      ([script]) => script === "globalThis.stop()",
    ),
  ).toHaveLength(0);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("assigns attached navigation stopping to the storage owner once", async () => {
  const { cleanup, storage } = fixture();
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(attached, {}, {});

  await expect(session.close(true)).resolves.toBe("disconnected-external");
  expect(storage?.close).toHaveBeenCalledWith(true);
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(0);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("transfers attached navigation stopping after storage cleanup fails", async () => {
  const { cleanup, storage } = fixture();
  const storageFailure = new Error("storage stop unconfirmed");
  storage?.close.mockRejectedValueOnce(storageFailure);
  const policyFailure = new Error("policy stop unconfirmed");
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  mocks.policySend.mockRejectedValueOnce(policyFailure);

  await expect(session.close(true)).rejects.toMatchObject({
    cause: { errors: [policyFailure, storageFailure] },
    cleanupIncomplete: true,
  });
  expect(cleanup.close).not.toHaveBeenCalled();
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(storage?.close).toHaveBeenCalledWith(true);
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(2);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("transfers a late stop request after storage has already released", async () => {
  const { cleanup, storage } = fixture();
  const cancellation = new AbortController();
  storage?.close.mockResolvedValue({ loadingStopped: false });
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    {
      signal: cancellation.signal,
    },
  );
  const restorationFailure = new Error("registration restoration failed");
  let failRestoration = true;
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Runtime.evaluate" && failRestoration) {
      failRestoration = false;
      throw restorationFailure;
    }
    return policyResponse(method);
  });

  await expect(session.close(false)).rejects.toMatchObject({
    cause: restorationFailure,
    cleanupIncomplete: true,
  });
  expect(cleanup.close).not.toHaveBeenCalled();
  cancellation.abort();
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(storage?.close.mock.calls).toEqual([[false]]);
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it.each(["pending", "settled"] as const)(
  "honors a late stop after policy restoration is %s",
  async (phase) => {
    const {
      cleanup,
      page,
      storage,
      cancellation,
      session,
      finishRestoration,
      started,
      transportClosed,
    } = await prepareHeldPolicyRestoration();

    vi.useFakeTimers();
    try {
      const firstClose = session.close(false).then(
        () => ({ ok: true as const }),
        (cause: unknown) => ({ ok: false as const, cause }),
      );
      await started;
      await vi.advanceTimersByTimeAsync(5_001);
      await expect(firstClose).resolves.toMatchObject({
        ok: false,
        cause: { cleanupIncomplete: true },
      });
      expect(cleanup.close).not.toHaveBeenCalled();

      if (phase === "settled") {
        finishRestoration();
        await transportClosed;
        await vi.advanceTimersByTimeAsync(0);
      }
      cancellation.abort();
      const retry = session.close();
      if (phase === "pending") {
        finishRestoration();
        await transportClosed;
        await vi.advanceTimersByTimeAsync(0);
      }
      await expect(retry).resolves.toBe("disconnected-external");
    } finally {
      vi.useRealTimers();
    }

    expect(storage?.close.mock.calls).toEqual([[false]]);
    const policyStops = mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ).length;
    const frameStops = page.evaluate.mock.calls.filter(
      ([script]) => script === "globalThis.stop()",
    ).length;
    expect(policyStops + frameStops).toBe(1);
    expect(cleanup.close).toHaveBeenCalledTimes(1);
    expect(mocks.policyTransportClose).toHaveBeenCalledTimes(1);
  },
);

it("transfers cancellation to a no-stop cleanup already in progress", async () => {
  const { cleanup, page, storage } = fixture();
  const cancellation = new AbortController();
  storage?.close.mockResolvedValue({ loadingStopped: false });
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    { signal: cancellation.signal },
  );
  const { promise: held, resolve: finishRestoration } = deferred();
  const { promise: started, resolve: restorationStarted } = deferred();
  let browserWasOpenAtStop = false;
  page.evaluate.mockImplementation(async (script: unknown) => {
    if (script === "globalThis.stop()")
      browserWasOpenAtStop = cleanup.browserClosed === false;
    return null;
  });
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Runtime.evaluate") {
      restorationStarted();
      await held;
    }
    if (method === "Page.stopLoading")
      browserWasOpenAtStop = cleanup.browserClosed === false;
    return policyResponse(method);
  });

  const firstClose = session.close(false);
  await started;
  cancellation.abort();
  const retry = session.close();
  finishRestoration();
  await expect(Promise.all([firstClose, retry])).resolves.toEqual([
    "disconnected-external",
    "disconnected-external",
  ]);

  const policyStops = mocks.policySend.mock.calls.filter(
    ([method]) => method === "Page.stopLoading",
  ).length;
  const frameStops = page.evaluate.mock.calls.filter(
    ([script]) => script === "globalThis.stop()",
  ).length;
  expect(policyStops + frameStops).toBe(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
  expect(browserWasOpenAtStop).toBe(true);
});

it("does not repeat a stop confirmed by storage during a late retry", async () => {
  const { cleanup, page, storage } = fixture();
  const cancellation = new AbortController();
  storage?.close.mockResolvedValue({ loadingStopped: true });
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    { signal: cancellation.signal },
  );
  const { promise: held, resolve: finishRestoration } = deferred();
  const { promise: started, resolve: restorationStarted } = deferred();
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Runtime.evaluate") {
      restorationStarted();
      await held;
    }
    return policyResponse(method);
  });

  const firstClose = session.close(false);
  await started;
  cancellation.abort();
  const retry = session.close();
  finishRestoration();
  await expect(Promise.all([firstClose, retry])).resolves.toEqual([
    "disconnected-external",
    "disconnected-external",
  ]);

  expect(storage?.close).toHaveBeenCalledWith(false);
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(0);
  expect(
    page.evaluate.mock.calls.filter(
      ([script]) => script === "globalThis.stop()",
    ),
  ).toHaveLength(0);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it.each(["block", "allow"] as const)(
  "transfers cancellation during final event cleanup with service workers set to %s",
  async (serviceWorkers) => {
    const { cleanup, page, storage } = fixture();
    const cancellation = new AbortController();
    storage?.close.mockResolvedValue({ loadingStopped: false });
    const attached = connectedScenario(serviceWorkers);
    const session = await PlaywrightScenarioSession.open(
      attached,
      {},
      { signal: cancellation.signal },
    );
    const { promise: heldEvents, resolve: finishEvents } = deferred();
    const { promise: eventsStarted, resolve: finishStarted } = deferred();
    mocks.finishEvents.mockImplementation(async () => {
      finishStarted();
      await heldEvents;
    });
    let browserWasOpenAtStop = false;
    page.evaluate.mockImplementation(async (script: unknown) => {
      if (script === "globalThis.stop()")
        browserWasOpenAtStop = cleanup.browserClosed === false;
      return null;
    });

    const firstClose = session.close(false);
    await eventsStarted;
    cancellation.abort();
    const retry = session.close();
    finishEvents();
    await expect(Promise.all([firstClose, retry])).resolves.toEqual([
      "disconnected-external",
      "disconnected-external",
    ]);

    expect(page.evaluate).toHaveBeenCalledWith("globalThis.stop()");
    if (serviceWorkers === "allow")
      expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(storage?.close).toHaveBeenCalledWith(false);
    expect(browserWasOpenAtStop).toBe(true);
    expect(cleanup.close).toHaveBeenCalledTimes(1);
  },
);

it("stops a connected page without storage or a service-worker policy owner", async () => {
  const { cleanup, page } = fixture();
  mocks.storage = undefined;
  const cancellation = new AbortController();
  const attached = connectedScenario("allow");
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    { signal: cancellation.signal },
  );
  const { promise: heldEvents, resolve: finishEvents } = deferred();
  const { promise: eventsStarted, resolve: finishStarted } = deferred();
  mocks.finishEvents.mockImplementation(async () => {
    finishStarted();
    await heldEvents;
  });

  const firstClose = session.close(false);
  await eventsStarted;
  cancellation.abort();
  const retry = session.close();
  finishEvents();
  await expect(Promise.all([firstClose, retry])).resolves.toEqual([
    "disconnected-external",
    "disconnected-external",
  ]);

  expect(page.evaluate).toHaveBeenCalledWith("globalThis.stop()");
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("retries a failed connected-page stop when service workers are allowed", async () => {
  const { cleanup, page, storage } = fixture();
  const cancellation = new AbortController();
  storage?.close.mockResolvedValue({ loadingStopped: false });
  const attached = connectedScenario("allow");
  const session = await PlaywrightScenarioSession.open(
    attached,
    {},
    { signal: cancellation.signal },
  );
  const { promise: heldEvents, resolve: finishEvents } = deferred();
  const { promise: eventsStarted, resolve: finishStarted } = deferred();
  mocks.finishEvents.mockImplementation(async () => {
    finishStarted();
    await heldEvents;
  });
  const failedFrame = {
    isDetached: () => false,
    evaluate: vi.fn(async () => {
      throw new Error("main frame stop failed");
    }),
  } as unknown as ReturnType<typeof page.mainFrame>;
  const freshFrame = {
    isDetached: () => false,
    evaluate: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof page.mainFrame>;
  vi.spyOn(page, "mainFrame")
    .mockReturnValueOnce(failedFrame)
    .mockReturnValue(freshFrame);

  const firstClose = session.close(false);
  await eventsStarted;
  cancellation.abort();
  const concurrentClose = session.close();
  finishEvents();
  await expect(
    Promise.allSettled([firstClose, concurrentClose]),
  ).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: "rejected" }),
      expect.objectContaining({ status: "rejected" }),
    ]),
  );

  expect(cleanup.browserClosed).toBe(false);
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(failedFrame.evaluate).toHaveBeenCalledTimes(1);
  expect(freshFrame.evaluate).toHaveBeenCalledTimes(1);
  expect(storage?.close).toHaveBeenCalledTimes(1);
  expect(cleanup.close).toHaveBeenCalledTimes(2);
});

it("retains a late fallback stop failure for retry", async () => {
  const { cleanup, page, session } = await prepareLateStopRetry();
  try {
    const stopFailure = new Error("late main-frame stop failed");
    const detachedFrame = {
      evaluate: vi.fn(async () => {
        throw stopFailure;
      }),
      isDetached: () => true,
    } as unknown as ReturnType<typeof page.mainFrame>;
    const freshFrame = {
      evaluate: vi.fn(async () => null),
      isDetached: () => false,
    } as unknown as ReturnType<typeof page.mainFrame>;
    vi.spyOn(page, "mainFrame")
      .mockReturnValueOnce(detachedFrame)
      .mockReturnValue(freshFrame);
    const failedRetry = session.close().then(
      () => ({ ok: true as const }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );
    await expect(failedRetry).resolves.toMatchObject({
      ok: false,
      cause: { cleanupIncomplete: true },
    });
    expect(cleanup.close).not.toHaveBeenCalled();

    await expect(session.close()).resolves.toBe("disconnected-external");
    expect(detachedFrame.evaluate).toHaveBeenCalledWith("globalThis.stop()");
    expect(freshFrame.evaluate).toHaveBeenCalledWith("globalThis.stop()");
  } finally {
    vi.useRealTimers();
  }

  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("coalesces concurrent late-stop close retries", async () => {
  const { cleanup, page, session } = await prepareLateStopRetry();
  try {
    const { promise: heldStop, resolve: finishStop } = deferred();
    const { promise: startedStop, resolve: stopStarted } = deferred();
    page.evaluate.mockImplementation(async (script: unknown) => {
      if (script === "globalThis.stop()") {
        stopStarted();
        await heldStop;
      }
      return null;
    });
    const firstRetry = session.close();
    await startedStop;
    const secondRetry = session.close();
    expect(
      page.evaluate.mock.calls.filter(
        ([script]) => script === "globalThis.stop()",
      ),
    ).toHaveLength(1);
    finishStop();
    await expect(Promise.all([firstRetry, secondRetry])).resolves.toEqual([
      "disconnected-external",
      "disconnected-external",
    ]);
  } finally {
    vi.useRealTimers();
  }

  expect(
    page.evaluate.mock.calls.filter(
      ([script]) => script === "globalThis.stop()",
    ),
  ).toHaveLength(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("retains transferred navigation stopping after setup cleanup fails", async () => {
  const { cleanup, storage } = fixture();
  const cancellation = new AbortController();
  const setupFailure = new Error("storage initialization failed");
  storage?.initialize.mockImplementationOnce(async () => {
    cancellation.abort();
    throw setupFailure;
  });
  storage?.close.mockRejectedValueOnce(new Error("storage stop unconfirmed"));
  const policyFailure = new Error("policy stop unconfirmed");
  let failPolicyStop = true;
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Page.stopLoading" && failPolicyStop) {
      failPolicyStop = false;
      throw policyFailure;
    }
    return policyResponse(method);
  });
  let retainedCleanup: AnalysisCleanupLease | undefined;
  const attached = connectedScenario("block");

  await expect(
    PlaywrightScenarioSession.open(
      attached,
      {},
      {
        signal: cancellation.signal,
        retainCleanup: (close) => {
          retainedCleanup = close;
        },
      },
    ),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(cleanup.close).not.toHaveBeenCalled();
  if (retainedCleanup === undefined)
    throw new Error("failed cleanup was not retained");
  await expect(retainedCleanup.release()).resolves.toBeUndefined();
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(2);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("allows the bounded policy cleanup chain to cross one second", async () => {
  const { cleanup } = fixture();
  mocks.storage = undefined;
  const attached = browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: "block" },
    storage: {},
  });
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  const { promise: stopped, resolve: releaseStop } = deferred();
  const { promise: started, resolve: stopStarted } = deferred();
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Page.stopLoading") {
      stopStarted();
      await stopped;
    }
    return policyResponse(method);
  });

  vi.useFakeTimers();
  try {
    let settled = false;
    const closing = session.close(true).then(
      () => {
        settled = true;
        return { ok: true as const };
      },
      (cause: unknown) => {
        settled = true;
        return { ok: false as const, cause };
      },
    );
    await started;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(settled).toBe(false);
    releaseStop();
    await expect(closing).resolves.toEqual({ ok: true });
  } finally {
    vi.useRealTimers();
  }
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("does not await policy initialization after its child target detaches", async () => {
  const { cleanup } = fixture();
  mocks.storage = undefined;
  const attached = browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: "block" },
    storage: {},
  });
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  const { promise: started, resolve: childStarted } = deferred();
  const { promise: held, resolve: releaseChild } = deferred();
  mocks.policySend.mockImplementation(
    async (method: string, _params: unknown, target: string) => {
      if (method === "Page.enable" && target === "child-session") {
        childStarted();
        await held;
      }
      return policyResponse(method);
    },
  );
  mocks.policyEvent?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "child-session",
      targetInfo: { type: "iframe" },
    },
    sessionId: "policy-session",
  });
  await started;
  const closing = session.close();
  mocks.policyEvent?.({
    method: "Target.detachedFromTarget",
    params: { sessionId: "child-session" },
  });
  try {
    await expect(closing).resolves.toBe("disconnected-external");
  } finally {
    releaseChild();
  }
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("skips policy restoration for a child without a committed document", async () => {
  const { cleanup, page } = fixture();
  mocks.storage = undefined;
  const pendingChild = {
    url: () => "",
    isDetached: () => false,
    evaluate: vi.fn(() => new Promise(() => undefined)),
  };
  const session = await PlaywrightScenarioSession.open(
    browserScenarioSchema.parse({
      ...scenario,
      browser: {
        mode: "connect",
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "target",
      },
      environment: { service_workers: "block" },
      storage: {},
    }),
    {},
    {},
  );
  page.frames = () => [page, pendingChild as unknown as typeof page];

  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(pendingChild.evaluate).not.toHaveBeenCalled();
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("rejects an init script accepted by CDP when the live realm is unprotected", async () => {
  const { page, cleanup } = fixture();
  page.evaluate
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("policy_unprotected");
  const attached = connectedScenario("block");
  await expect(
    PlaywrightScenarioSession.open(attached, {}, {}),
  ).rejects.toMatchObject({
    reason: "target_not_allowed",
  });
  expect(
    mocks.policySend.mock.calls.some(
      ([method]) => method === "Page.addScriptToEvaluateOnNewDocument",
    ),
  ).toBe(true);
  expect(
    mocks.policySend.mock.calls.some(
      ([method]) => method === "Page.removeScriptToEvaluateOnNewDocument",
    ),
  ).toBe(true);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("restores an owned policy script after later setup fails", async () => {
  const { cleanup } = fixture();
  const setupFailure = new Error("auto-attach rejected");
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Target.setAutoAttach") throw setupFailure;
    return policyResponse(method);
  });
  const attached = connectedScenario("block");

  await expect(PlaywrightScenarioSession.open(attached, {}, {})).rejects.toBe(
    setupFailure,
  );
  expect(mocks.policySend).toHaveBeenCalledWith(
    "Page.removeScriptToEvaluateOnNewDocument",
    { identifier: "owned-policy-script" },
    "policy-session",
  );
  expect(
    mocks.policySend.mock.calls.some(
      ([method]) => method === "Runtime.evaluate",
    ),
  ).toBe(true);
  expect(mocks.policyTransportClose).toHaveBeenCalledTimes(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("retains an owned script identifier after rejected removal", async () => {
  const { cleanup } = fixture();
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  const failure = new Error("removeScript rejected");
  mocks.policySend.mockRejectedValueOnce(failure);
  await expect(session.close()).rejects.toMatchObject({
    cause: failure,
    cleanupIncomplete: true,
  });
  expect(cleanup.close).not.toHaveBeenCalled();
  await expect(session.close()).resolves.toBe("disconnected-external");
  const removals = mocks.policySend.mock.calls.filter(
    ([method]) => method === "Page.removeScriptToEvaluateOnNewDocument",
  );
  expect(removals).toHaveLength(2);
  expect(
    removals.every(([, params]) => params.identifier === "owned-policy-script"),
  ).toBe(true);
});

it("retries transport close without detaching an already released policy session", async () => {
  fixture();
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  const failure = new Error("transport close rejected");
  mocks.policyTransportClose.mockRejectedValueOnce(failure);
  await expect(session.close()).rejects.toMatchObject({
    cause: { cause: failure },
    cleanupIncomplete: true,
  });
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Target.detachFromTarget",
    ),
  ).toHaveLength(1);
  expect(mocks.policyTransportClose).toHaveBeenCalledTimes(2);
});

it.each(["closed page", "detached target"])(
  "releases its policy transport after a %s",
  async (terminal) => {
    const { page } = fixture();
    mocks.storage = undefined;
    const attached = browserScenarioSchema.parse({
      ...scenario,
      browser: {
        mode: "connect",
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "target",
      },
      environment: { service_workers: "block" },
      storage: {},
    });
    const session = await PlaywrightScenarioSession.open(attached, {}, {});
    if (terminal === "closed page") page.isClosed = () => true;
    else
      mocks.policyEvent?.({
        method: "Target.detachedFromTarget",
        params: { sessionId: "policy-session" },
      });
    await expect(session.close(true)).resolves.toBe("disconnected-external");
    expect(
      mocks.policySend.mock.calls.some(
        ([method]) => method === "Target.detachFromTarget",
      ),
    ).toBe(false);
    expect(mocks.policyTransportClose).toHaveBeenCalledTimes(1);
    if (terminal === "detached target") {
      expect(page.evaluate).toHaveBeenCalledWith("globalThis.stop()");
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("policy_owned"),
      );
    }
  },
);

it("retains a detached policy connection until the main realm is restored", async () => {
  const { cleanup, page } = fixture();
  mocks.storage = undefined;
  const attached = browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: "block" },
    storage: {},
  });
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  mocks.policyEvent?.({
    method: "Target.detachedFromTarget",
    params: { sessionId: "policy-session" },
  });
  page.evaluate
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce("policy_owned")
    .mockResolvedValueOnce(null);

  await expect(session.close(true)).rejects.toMatchObject({
    cause: {
      message: expect.stringContaining(
        "service-worker policy restoration could not be confirmed",
      ),
    },
    cleanupIncomplete: true,
  });
  expect(cleanup.close).not.toHaveBeenCalled();
  expect(mocks.policyTransportClose).not.toHaveBeenCalled();
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(page.evaluate).toHaveBeenCalledWith("globalThis.stop()");
  expect(
    page.evaluate.mock.calls.filter(
      ([script]) => script === "globalThis.stop()",
    ),
  ).toHaveLength(1);
  expect(mocks.policyTransportClose).toHaveBeenCalledTimes(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("finishes initialization cleanup independently of request cancellation", async () => {
  const { context, opened } = fixture();
  const controller = new AbortController();
  const closeBrowser = vi.fn(async () => undefined);
  const removeProfile = vi.fn(async () => undefined);
  mocks.openBrowser.mockResolvedValue({
    ...opened,
    cleanup: new PlaywrightScenarioBrowserCleanupOwner({
      closeBrowser,
      removeProfile,
    }),
  });
  context.addCookies.mockImplementationOnce(async () => {
    controller.abort();
  });
  const retainCleanup = vi.fn();

  await expect(
    PlaywrightScenarioSession.open(
      scenario,
      {},
      {
        signal: controller.signal,
        retainCleanup,
      },
    ),
  ).rejects.toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(closeBrowser).toHaveBeenCalledTimes(1);
  expect(removeProfile).toHaveBeenCalledTimes(1);
  expect(retainCleanup).not.toHaveBeenCalled();
});

it("can retry cleanup of a browser that opened after request cancellation", async () => {
  const { opened } = fixture();
  const closeBrowser = vi
    .fn()
    .mockRejectedValueOnce(new Error("transport close failed"))
    .mockResolvedValueOnce(undefined);
  const removeProfile = vi.fn(async () => undefined);
  const lateOpened = {
    ...opened,
    cleanup: new PlaywrightScenarioBrowserCleanupOwner({
      closeBrowser,
      removeProfile,
    }),
  };
  let resolveOpening: ((value: typeof lateOpened) => void) | undefined;
  const opening = new Promise<typeof lateOpened>((resolve) => {
    resolveOpening = resolve;
  });
  mocks.openBrowser.mockReturnValueOnce(opening);
  const controller = new AbortController();
  const retained: AnalysisCleanupLease[] = [];
  const result = PlaywrightScenarioSession.open(
    scenario,
    {},
    {
      signal: controller.signal,
      retainCleanup: (close) => retained.push(close),
    },
  );
  const cancelled = expect(result).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
  });
  controller.abort();
  await cancelled;
  resolveOpening?.(lateOpened);
  await vi.waitFor(() => expect(closeBrowser).toHaveBeenCalledTimes(1));
  expect(retained).toHaveLength(1);
  await expect(retained[0]?.release()).resolves.toBeUndefined();
  expect(closeBrowser).toHaveBeenCalledTimes(2);
  expect(removeProfile).toHaveBeenCalledTimes(1);
});

it("uses browser disconnect as terminal storage release after detach failure", async () => {
  const { cleanup, storage } = fixture();
  const detachFailure = new Error("CDP detach rejected");
  storage.close.mockRejectedValueOnce(detachFailure);
  const session = await PlaywrightScenarioSession.open(scenario, {}, {});

  await expect(session.close()).resolves.toBe("terminated-owned-process");
  expect(storage.close).toHaveBeenCalledTimes(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
  expect(mocks.finishEvents).toHaveBeenCalledTimes(1);
  await expect(session.close()).resolves.toBe("terminated-owned-process");
  expect(storage.close).toHaveBeenCalledTimes(1);
});

it("leaves attached service-worker state alone when the policy allows it", async () => {
  const { cleanup, page } = fixture();
  const attached = connectedScenario("allow");
  const session = await PlaywrightScenarioSession.open(attached, {}, {});

  expect(mocks.openBrowser).toHaveBeenCalledWith(
    attached,
    {},
    expect.any(Object),
  );
  expect(page.evaluate).not.toHaveBeenCalled();
  expect(page.addInitScript).not.toHaveBeenCalled();
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("blocks new attached service-worker registration without removing existing registrations", async () => {
  const { cleanup, page } = fixture();
  const attached = connectedScenario("block");
  const session = await PlaywrightScenarioSession.open(attached, {}, {});

  expect(page.evaluate).toHaveBeenCalledTimes(3);
  const injection = mocks.policySend.mock.calls.find(
    ([method]) => method === "Page.addScriptToEvaluateOnNewDocument",
  )?.[1];
  expect(injection.source).toContain(
    "service workers are blocked by scenario policy",
  );
  expect(injection.source).not.toContain("getRegistrations");
  expect(injection.source).not.toContain("unregister");
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(mocks.policySend).toHaveBeenCalledWith(
    "Page.removeScriptToEvaluateOnNewDocument",
    { identifier: "owned-policy-script" },
    "policy-session",
  );
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("retains the attached connection when registration restoration fails", async () => {
  const { cleanup } = fixture();
  mocks.storage = undefined;
  const attached = browserScenarioSchema.parse({
    ...scenario,
    browser: {
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target",
    },
    environment: { service_workers: "block" },
    storage: {},
  });
  const session = await PlaywrightScenarioSession.open(attached, {}, {});
  const failure = new Error("registration restoration failed");
  let failRestoration = true;
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Runtime.evaluate" && failRestoration) {
      failRestoration = false;
      throw failure;
    }
    return policyResponse(method);
  });
  await expect(session.close(true)).rejects.toMatchObject({
    cause: failure,
    cleanupIncomplete: true,
  });
  expect(cleanup.close).not.toHaveBeenCalled();
  await expect(session.close()).resolves.toBe("disconnected-external");
  expect(
    mocks.policySend.mock.calls.filter(
      ([method]) => method === "Page.stopLoading",
    ),
  ).toHaveLength(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);
  await expect(session.close()).resolves.toBe("disconnected-external");
});

it("cancels a stalled policy preflight without allowing late setup", async () => {
  const { cleanup, page } = fixture();
  let release: () => void = () => undefined;
  const { promise: started, resolve: entered } = deferred();
  page.evaluate.mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return false;
  });
  const cancellation = new AbortController();
  const opening = PlaywrightScenarioSession.open(
    connectedScenario("block"),
    {},
    { signal: cancellation.signal },
  );
  const outcome = expect(opening).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
  });
  await started;
  cancellation.abort();
  await outcome;
  expect(cleanup.close).toHaveBeenCalledTimes(1);
  expect(cleanup.close.mock.calls[0]).toHaveLength(1);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mocks.policySend).not.toHaveBeenCalled();
});

it("waits for a pending registration installation before cancelled cleanup", async () => {
  const { cleanup, page } = fixture();
  const { promise: installed, resolve: releaseInstallation } = deferred();
  const { promise: started, resolve: installationStarted } = deferred();
  mocks.policySend.mockImplementation(async (method: string) => {
    if (method === "Page.addScriptToEvaluateOnNewDocument") {
      installationStarted();
      await installed;
      return { identifier: "owned-policy-script" };
    }
    return policyResponse(method);
  });
  const cancellation = new AbortController();
  const opening = PlaywrightScenarioSession.open(
    connectedScenario("block"),
    {},
    { signal: cancellation.signal },
  );
  const outcome = expect(opening).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
  });
  await started;
  cancellation.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(cleanup.close).not.toHaveBeenCalled();
  expect(page.evaluate).toHaveBeenCalledTimes(1);
  releaseInstallation();
  await outcome;
  const restoration = mocks.policySend.mock.calls.find(
    ([method]) => method === "Runtime.evaluate",
  )?.[1];
  expect(restoration).toMatchObject({
    expression: expect.stringContaining("policy_owned"),
  });
  expect(mocks.policySend).toHaveBeenCalledWith(
    "Page.stopLoading",
    {},
    "policy-session",
  );
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("rejects attached block when caller-owned registrations already exist", async () => {
  const { cleanup, page } = fixture();
  page.evaluate.mockResolvedValueOnce("service_worker_blocked");
  const attached = connectedScenario("block");

  await expect(
    PlaywrightScenarioSession.open(attached, {}, {}),
  ).rejects.toMatchObject({
    _tag: "BrowserObservationError",
    reason: "service_worker_blocked",
  });
  expect(page.addInitScript).not.toHaveBeenCalled();
  expect(cleanup.close).toHaveBeenCalledTimes(1);
});

it("preserves both cleanup failures and retries retained owners", async () => {
  const { cleanup, storage } = fixture();
  const detachFailure = new Error("CDP detach rejected");
  const transportFailure = new Error("Playwright transport close failed");
  storage.close.mockRejectedValueOnce(detachFailure);
  cleanup.close
    .mockRejectedValueOnce(transportFailure)
    .mockImplementationOnce(async (finishEvents?: () => Promise<void>) => {
      await finishEvents?.();
    });
  const session = await PlaywrightScenarioSession.open(scenario, {}, {});

  let failure: unknown;
  try {
    await session.close();
  } catch (cause: unknown) {
    failure = cause;
  }
  expect(failure).toMatchObject({ cleanupIncomplete: true });
  const physical = (failure as Error).cause;
  expect(physical).toBeInstanceOf(AggregateError);
  expect((physical as AggregateError).errors).toEqual([
    detachFailure,
    transportFailure,
  ]);
  expect(storage.close).toHaveBeenCalledTimes(1);
  expect(cleanup.close).toHaveBeenCalledTimes(1);

  await expect(session.close()).resolves.toBe("terminated-owned-process");
  expect(failure).toMatchObject({
    cleanupIncomplete: false,
    cleanupResources: [],
  });
  expect(storage.close).toHaveBeenCalledTimes(2);
  expect(cleanup.close).toHaveBeenCalledTimes(2);
});

it("keeps the session's exact cleanup lease pending after response timeout until browser acknowledgement", async () => {
  vi.useFakeTimers();
  const { cleanup } = fixture();
  const session = await PlaywrightScenarioSession.open(scenario, {}, {});
  let acknowledge: () => void = () => {};
  const late = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  cleanup.release = vi.fn(async (finishEvents?: () => Promise<void>) => {
    await late;
    await cleanup.close(finishEvents);
  });
  try {
    const pending = session.close().catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(30_000);
    const failure = await pending;
    expect(failure).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: ["browser_transport"],
    });
    expect(session.cleanupLease.released).toBe(false);
    acknowledge();
    await session.cleanupLease.release();
    expect(failure).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(cleanup.close).toHaveBeenCalledTimes(1);
  } finally {
    acknowledge();
    await session.cleanupLease.release();
    vi.useRealTimers();
  }
});

it("retains late opening failure cleanup after cancellation until the exact profile lease recovers", async () => {
  let finishOpening: () => void = () => {};
  const terminal = new Promise<void>((resolve) => {
    finishOpening = resolve;
  });
  let profileStarted: () => void = () => {};
  const profileAttempt = new Promise<void>((resolve) => {
    profileStarted = resolve;
  });
  let denied = true;
  const lease = new AnalysisCleanupLease(async () => {
    profileStarted();
    if (denied) throw new Error("authored profile removal denial");
  }, ["browser_profile"]);
  const failure = new ProviderCleanupError("fixture", ["browser_profile"], {
    reason: "late opening profile cleanup",
  });
  new AnalysisCleanupLeaseGroup(failure, [lease]);
  let launchStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    launchStarted = resolve;
  });
  mocks.openBrowser.mockImplementation(
    async (
      _scenario: unknown,
      _env: unknown,
      options: { retainCleanup?: (lease: AnalysisCleanupLease) => void },
    ) => {
      launchStarted();
      await terminal;
      options.retainCleanup?.(lease);
      throw failure;
    },
  );
  const provider = new PlaywrightBrowserScenarioProvider((input, options) =>
    PlaywrightScenarioSession.open(input, {}, options),
  );
  const caller = new AbortController();
  const reason = { caller: "before late launch rejection" };
  try {
    const pending = provider.captureScenario(scenario, {
      signal: caller.signal,
    });
    await started;
    caller.abort(reason);
    const result = await pending;
    if (result.ok) throw new Error("Expected cancelled opening");
    expect(result.error.cleanupIncomplete).toBe(true);
    finishOpening();
    await profileAttempt;
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(result.error).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: ["browser_profile"],
    });
    denied = false;
    await provider.close();
    expect(result.error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(failure.cleanupIncomplete).toBe(false);
  } finally {
    denied = false;
    finishOpening();
    await provider.close();
  }
});

it.each([
  { mode: "launch", selected: undefined, deadline: 20_000 },
  { mode: "connect", selected: undefined, deadline: 20_000 },
  { mode: "launch", selected: 250, deadline: 250 },
  { mode: "connect", selected: 250, deadline: 250 },
] as const)(
  "bounds never-settling initial navigation in $mode mode with deadline $deadline and awaits cleanup",
  async ({ mode, selected, deadline }) => {
    vi.useFakeTimers();
    const { cleanup, page, storage } = fixture();
    const request = browserScenarioSchema.parse({
      ...(mode === "launch" ? scenario : connectedScenario("allow")),
      ...(selected === undefined ? {} : { command_timeout_ms: selected }),
    });
    page.goto.mockImplementation(() => new Promise<never>(() => {}));
    try {
      const opening = PlaywrightScenarioSession.open(request, {}, {}).catch(
        (cause: unknown) => cause,
      );
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(cleanup.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const failure = await opening;
      expect(failure).toMatchObject({
        _tag: "AnalysisTimeoutError",
        operation: "capture_browser_scenario",
        timeoutMs: deadline,
        partialObservation: {
          kind: "browser-scenario-observation",
          capture: {
            browser: {
              cleanup:
                mode === "launch"
                  ? "terminated-owned-process"
                  : "disconnected-external",
            },
            steps: [],
          },
        },
      });
      expect(cleanup.close).toHaveBeenCalledOnce();
      expect(storage?.close).toHaveBeenCalledWith(true);
      expect(page.goto).toHaveBeenCalledOnce();
    } finally {
      await cleanup.cleanupLease.release();
      vi.useRealTimers();
    }
  },
);

it.each([false, true])(
  "checks attached worker policy after final artifacts, worker takeover=%s",
  async (takeover) => {
    const { page, cleanup } = fixture();
    let controlled = false;
    let captures = 0;
    Object.assign(page, {
      waitForTimeout: vi.fn(async () => undefined),
      content: vi.fn(async () => {
        captures += 1;
        controlled = takeover && captures === 2;
        return controlled ? "<worker-response/>" : "<uncontrolled-response/>";
      }),
    });
    page.evaluate.mockImplementation(async (script: unknown) =>
      controlled &&
      typeof script === "string" &&
      script.includes("serviceWorker.controller")
        ? "service_worker_blocked"
        : null,
    );
    const input = browserScenarioSchema.parse({
      ...connectedScenario("block"),
      capture: { after_each_step: ["dom"], at_end: ["dom"], events: [] },
    });
    const provider = new PlaywrightBrowserScenarioProvider(
      (scenario, options) =>
        PlaywrightScenarioSession.open(scenario, {}, options),
    );
    try {
      const result = await provider.captureScenario(input, {});
      expect(captures).toBe(2);
      expect(cleanup.browserClosed).toBe(true);
      if (takeover) {
        if (result.ok)
          throw new Error("Expected final worker policy rejection");
        expect(projectAnalysisError(result.error)).toMatchObject({
          details: {
            diagnostics: {
              collected_artifacts: {
                dom: { value: { text: "<worker-response/>" } },
              },
            },
          },
        });
        expect(result.error).toMatchObject({
          reason: "service_worker_blocked",
          cleanupIncomplete: false,
          diagnostics: {
            collected_artifacts: {
              dom: { state: "captured", value: { text: "<worker-response/>" } },
            },
          },
          partialObservation: {
            capture: {
              browser: { cleanup: "disconnected-external" },
              steps: [{ action: "goto_start" }],
            },
          },
        });
      } else {
        if (!result.ok) throw result.error;
        expect(result.value.steps).toHaveLength(2);
        expect(result.value.steps[1]).toMatchObject({
          status: "completed",
          completeness: { status: "complete", equality_eligible: true },
        });
      }
    } finally {
      await provider.close();
    }
  },
);

it.each(["absent", "undefined", "inherited", "empty"] as const)(
  "resolves declared environment secrets before browser acquisition: %s",
  async (state) => {
    const { page } = fixture();
    Object.assign(page, { waitForTimeout: async () => undefined });
    const environment: Record<string, string | undefined> = {
      AVAILABLE_SECRET: "already-supplied-private-value",
    };
    if (state === "inherited")
      Object.setPrototypeOf(environment, {
        REQUIRED_SECRET: "inherited-value",
      });
    if (state === "undefined") environment.REQUIRED_SECRET = undefined;
    if (state === "empty") environment.REQUIRED_SECRET = "";
    const input = browserScenarioSchema.parse({
      ...scenario,
      secrets: [
        { secret_id: "available", environment_variable: "AVAILABLE_SECRET" },
        { secret_id: "required", environment_variable: "REQUIRED_SECRET" },
      ],
    });
    const provider = new PlaywrightBrowserScenarioProvider(
      (scenario, options) =>
        PlaywrightScenarioSession.open(scenario, environment, options),
    );
    try {
      const result = await provider.captureScenario(input, {});
      if (state === "empty") {
        if (!result.ok) throw result.error;
        expect(mocks.openBrowser).toHaveBeenCalledOnce();
      } else {
        if (result.ok) throw new Error("Expected unresolved environment input");
        const projected = projectAnalysisError(result.error);
        expect(projected).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
          details: {
            issues: [
              {
                path: ["secrets", 1, "environment_variable"],
                reason: "missing_argument",
                expected: {
                  secret_id: "required",
                  environment_variable: "REQUIRED_SECRET",
                },
              },
            ],
          },
        });
        expect(projected.message).toContain(
          "Set environment variable REQUIRED_SECRET",
        );
        expect(JSON.stringify(projected)).not.toContain(
          environment.AVAILABLE_SECRET,
        );
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(mocks.openBrowser).not.toHaveBeenCalled();
      }
    } finally {
      await provider.close();
    }
  },
);

it("keeps declared secrets out of final cleanup and retry failure diagnostics", async () => {
  const { page, cleanup } = fixture();
  Object.assign(page, { waitForTimeout: vi.fn(async () => undefined) });
  const input = browserScenarioSchema.parse({
    ...connectedScenario("allow"),
    secrets: [
      {
        secret_id: "credential",
        environment_variable: "REA_SCENARIO_TEST_SECRET",
      },
    ],
    capture: { after_each_step: ["url"], at_end: [], events: [] },
  });
  const secret = "declared-cleanup-private-value";
  vi.spyOn(cleanup, "cleanupResources", "get").mockImplementation(() =>
    cleanup.browserClosed ? [] : [`browser_transport:${secret}`],
  );
  const originalClose = cleanup.close.getMockImplementation()!;
  let blocked = true;
  cleanup.close.mockImplementation(async (...args) => {
    if (blocked) throw new Error(`Close failed after ${secret}`);
    return originalClose(...args);
  });
  const provider = new PlaywrightBrowserScenarioProvider((scenario, options) =>
    PlaywrightScenarioSession.open(
      scenario,
      { REA_SCENARIO_TEST_SECRET: secret },
      options,
    ),
  );
  try {
    const result = await provider.captureScenario(input, {});
    if (result.ok) throw new Error("Expected final cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.partialObservation).toMatchObject({
      kind: "browser-scenario-observation",
      capture: {
        browser: { cleanup: "incomplete" },
        steps: [{ action: "goto_start" }, { action: "wait_for_timeout" }],
      },
    });
    expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
      secret,
    );
    let retried: unknown;
    try {
      await provider.close();
    } catch (error) {
      retried = error;
    }
    if (!(retried instanceof ProviderCleanupError))
      throw new Error("Expected retained cleanup failure");
    expect(JSON.stringify(projectAnalysisError(retried))).not.toContain(secret);
    blocked = false;
    await provider.close();
    expect(cleanup.browserClosed).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    blocked = false;
    await provider.close();
  }
});

it("projects both request and route cleanup failures with declared secrets redacted", async () => {
  const { page } = fixture();
  const secret = "private-request-diagnostic-value";
  const route = vi.fn(async () => undefined);
  const unroute = vi.fn(async () => {
    throw new Error(`page.unroute: closed ${secret}`);
  });
  Object.assign(page, {
    url: () => "https://app.example.test/",
    route,
    unroute,
  });
  const input = browserScenarioSchema.parse({
    ...connectedScenario("allow"),
    start_url: { url: "https://app.example.test/" },
    actions: [
      { step_id: "request", action: "request", method: "POST", path: "/api" },
    ],
    secrets: [
      { secret_id: "credential", environment_variable: "REQUEST_SECRET" },
    ],
    capture: { after_each_step: ["url"], at_end: [], events: [] },
  });
  const provider = new PlaywrightBrowserScenarioProvider((scenario, options) =>
    PlaywrightScenarioSession.open(
      scenario,
      { REQUEST_SECRET: secret },
      options,
    ),
  );
  page.evaluate.mockRejectedValue(new Error(`page.evaluate: closed ${secret}`));
  try {
    const result = await provider.captureScenario(input, {});
    if (!result.ok) throw result.error;
    const step = result.value.steps.find((step) => step.step_id === "request");
    expect(step).toMatchObject({ status: "failed" });
    expect(step?.error).toContain("page.evaluate: closed");
    expect(step?.error).toContain("page.unroute: closed");
    expect(JSON.stringify(result.value)).not.toContain(secret);
    expect(unroute).toHaveBeenCalledOnce();
  } finally {
    await provider.close();
  }
});
