import { runWithExecutionLimits } from "./PlaywrightElectronExecution.js";
// Fixture-backed action coverage; real Electron verification lives in
// `npm run verify:electron`.
import { afterEach, expect, it, vi } from "vitest";
import type { ElectronApplication } from "playwright-core";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { createDeferred } from "../../tests/fixtures/binarySession.js";

import {
  electronActiveObservationInputSchema,
  electronActiveObservationResultSchema,
} from "../domain/javascript/electronActiveObservation.js";
import { createElectronActiveObservationFixtureResult } from "../domain/javascript/electronActiveObservation.fixture.js";
import {
  readFinalApplicationState,
  runElectronActions,
} from "./PlaywrightElectronActiveActions.js";

const fixtureBrowserWindow = async () => ({
  evaluate: async (read: (window: { id: number }) => unknown) =>
    read({ id: 42 }),
  dispose: async () => {},
});

afterEach(() => {
  vi.useRealTimers();
});

it("requires observed Electron retention and coverage instead of repairing old results", () => {
  const result = createElectronActiveObservationFixtureResult("/opt/app");
  for (const field of ["retention", "timeline", "coverage"] as const) {
    expect(
      electronActiveObservationResultSchema.safeParse({
        ...result,
        [field]: undefined,
      }).success,
    ).toBe(false);
  }
  for (const section of ["ipc", "timeline"] as const) {
    expect(
      electronActiveObservationResultSchema.safeParse({
        ...result,
        [section]: { ...result[section], dropped: undefined },
      }).success,
    ).toBe(false);
  }
  expect(
    electronActiveObservationResultSchema.safeParse({
      ...result,
      retention: null,
    }).success,
  ).toBe(false);
  expect(
    electronActiveObservationResultSchema.safeParse({
      ...result,
      ipc: {
        ...result.ipc,
        events: [{ ...result.ipc.events[0], source: undefined }],
      },
    }).success,
  ).toBe(false);
});

it("parses window, renderer, and deep-link actions for agents", () => {
  const input = electronActiveObservationInputSchema.parse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    actions: [
      { step_id: "first-window", kind: "click", selector: "#run" },
      { step_id: "second-window", kind: "renderer-reload", window_index: 1 },
      { step_id: "restart", kind: "renderer-crash", window_index: 1 },
      {
        step_id: "deep-link",
        kind: "deep-link",
        delivery: "second-instance",
        url: "rea-fixture://open/item",
      },
    ],
  });

  expect(input.actions).toEqual([
    {
      step_id: "first-window",
      kind: "click",
      selector: "#run",
      window_index: 0,
    },
    { step_id: "second-window", kind: "renderer-reload", window_index: 1 },
    { step_id: "restart", kind: "renderer-crash", window_index: 1 },
    {
      step_id: "deep-link",
      kind: "deep-link",
      delivery: "second-instance",
      url: "rea-fixture://open/item",
    },
  ]);
});

it("rejects non-absolute deep-link values", () => {
  const result = electronActiveObservationInputSchema.safeParse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    actions: [
      {
        step_id: "bad-link",
        kind: "deep-link",
        delivery: "open-url",
        url: "not a URL",
      },
    ],
  });

  expect(result.success).toBe(false);
});

it("keeps long Electron arguments and deep-link URLs intact", () => {
  const longArgument = "x".repeat(5_000);
  const longUrl = `rea-fixture://open/${"item".repeat(2_000)}`;
  const longStepId = "step".repeat(100);
  const input = electronActiveObservationInputSchema.parse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    args: [longArgument],
    actions: [
      {
        step_id: longStepId,
        kind: "deep-link",
        delivery: "open-url",
        url: longUrl,
      },
    ],
  });

  expect(input.args).toEqual([longArgument]);
  expect(input.actions[0]).toMatchObject({
    step_id: longStepId,
    url: longUrl,
  });
  expect(
    electronActiveObservationResultSchema.parse({
      ...createElectronActiveObservationFixtureResult("/opt/app"),
      actions: [
        {
          step_id: longStepId,
          kind: "deep-link",
          window_index: null,
          target: null,
          status: "completed",
          elapsed_ms: 0,
          error: null,
        },
      ],
    }).actions[0]?.step_id,
  ).toBe(longStepId);
});

it("preserves local Playwright action diagnostics", async () => {
  const selector = "#secret-selector";
  const input = electronActiveObservationInputSchema.parse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    actions: [{ step_id: "click-step", kind: "click", selector }],
  });
  const page = {
    locator: () => ({
      click: async () => {
        throw new Error(`locator ${selector} failed with token=raw-secret`);
      },
    }),
  };
  const application = {
    windows: () => [page],
    browserWindow: fixtureBrowserWindow,
  };

  const { actions: result } = await runElectronActions(
    application as never,
    input,
    {},
    new ArtifactResourceScope(),
  );

  expect(result[0]).toMatchObject({
    status: "failed",
    error: `locator ${selector} failed with token=raw-secret`,
  });
  expect(result[0]?.error).toContain(selector);
  expect(result[0]?.error).toContain("raw-secret");
});

it("retains complete action errors and Electron window text", async () => {
  const longError = `locator failed ${"detail ".repeat(300)}`;
  const input = electronActiveObservationInputSchema.parse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    actions: [{ step_id: "click-step", kind: "click", selector: "#run" }],
  });
  const page = {
    locator: () => ({
      click: async () => Promise.reject(new Error(longError)),
    }),
  };
  const { actions } = await runElectronActions(
    { windows: () => [page], browserWindow: fixtureBrowserWindow } as never,
    input,
    {},
    new ArtifactResourceScope(),
  );
  const result = createElectronActiveObservationFixtureResult("/opt/app");
  const longUrl = `file://${"/segment".repeat(10_000)}`;
  const longTitle = "title".repeat(4_000);

  expect(actions[0]?.error).toBe(longError);
  expect(
    electronActiveObservationResultSchema.parse({
      ...result,
      windows: [{ ...result.windows[0], url: longUrl, title: longTitle }],
      actions: [
        {
          step_id: "click-step",
          kind: "click",
          window_index: 0,
          target: "window:0",
          status: "failed",
          elapsed_ms: 1,
          error: longError,
        },
      ],
    }).windows[0],
  ).toMatchObject({ url: longUrl, title: longTitle });
});

it("accepts complete Electron input and observation strings", () => {
  const longText = "evidence-".repeat(3_000);
  const longPath = `/opt/${"directory/".repeat(2_000)}app`;
  const input = electronActiveObservationInputSchema.parse({
    executable_path: longPath,
    application_path: `${longPath}/main.js`,
    application_root: longPath,
    actions: [
      { step_id: longText, kind: "click", selector: longText },
      {
        step_id: longText,
        kind: "deep-link",
        delivery: "open-url",
        url: `custom://${longText}`,
      },
    ],
  });
  const fixture = createElectronActiveObservationFixtureResult("/opt/app");
  const event = {
    ...fixture.ipc.events[0],
    correlation_id: longText,
    event: longText,
    channel: longText,
    sender: longText,
    receiver: longText,
    frame: longText,
    target: longText,
    result_shape: longText,
    process_type: longText,
    source: longText,
    artifact_path: longPath,
  };
  const result = electronActiveObservationResultSchema.parse({
    ...fixture,
    application: {
      ...fixture.application,
      application_path: longPath,
      electron_version: longText,
    },
    actions: [
      {
        ...fixture.actions[0],
        step_id: longText,
        target: longText,
        error: longText,
        status: "failed",
      },
    ],
    windows: [
      {
        ...fixture.windows[0],
        window_id: longText,
        web_contents_id: longText,
        url: longText,
        title: longText,
      },
    ],
    ipc: { events: [event], observed: 1, dropped: 0 },
    timeline: {
      events: [
        {
          ...event,
          kind: "navigation",
          phase: "observed",
          direction: null,
          capture_method: "event-emitter",
        },
      ],
      observed: 1,
      dropped: 0,
    },
    limitations: [longText],
  });

  expect(input.actions[0]?.step_id).toBe(longText);
  expect(input.actions[0]?.kind === "click" && input.actions[0].selector).toBe(
    longText,
  );
  expect(result.ipc.events[0]?.channel).toBe(longText);
  expect(result.windows[0]?.title).toBe(longText);
  expect(result.limitations[0]).toBe(longText);
});

it("runs an untargeted deep-link without requiring a BrowserWindow", async () => {
  const input = electronActiveObservationInputSchema.parse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    actions: [
      {
        step_id: "open-deep-link",
        kind: "deep-link",
        delivery: "second-instance",
        url: "rea-fixture://open/item",
      },
    ],
  });
  const application = {
    windows: () => [],
    evaluate: async () => true,
  };

  const { actions: result } = await runElectronActions(
    application as never,
    input,
    {},
    new ArtifactResourceScope(),
  );

  expect(result).toMatchObject([
    {
      step_id: "open-deep-link",
      status: "completed",
      error: null,
    },
  ]);
});

it("honors caller-selected Electron waits beyond the former action timeout", async () => {
  const input = electronActiveObservationInputSchema.parse({
    executable_path: "/opt/electron",
    application_path: "/opt/app/main.js",
    application_root: "/opt/app",
    actions: [{ step_id: "wait-long", kind: "wait", duration_ms: 60_000 }],
  });
  let duration = 0;
  const page = {
    waitForTimeout: async (value: number) => {
      duration = value;
    },
  };
  const application = {
    windows: () => [page],
    browserWindow: fixtureBrowserWindow,
    firstWindow: async () => page,
  };

  const { actions: result } = await runElectronActions(
    application as never,
    input,
    {},
    new ArtifactResourceScope(),
  );

  expect(result[0]).toMatchObject({ status: "completed" });
  expect(duration).toBe(60_000);
});

it("rejects action outcomes that disagree with their error state", () => {
  const result = createElectronActiveObservationFixtureResult("/opt/app");
  const action = result.actions[0];
  expect(action).toBeDefined();
  if (action === undefined) return;

  expect(
    electronActiveObservationResultSchema.safeParse({
      ...result,
      actions: [{ ...action, error: "unexpected failure" }],
    }).success,
  ).toBe(false);
  expect(
    electronActiveObservationResultSchema.safeParse({
      ...result,
      actions: [{ ...action, status: "failed", error: null }],
    }).success,
  ).toBe(false);
});

it("cancels a wait without window_index while the app has no window", async () => {
  const controller = new AbortController();
  const application = {
    firstWindow: vi.fn(() => {
      queueMicrotask(() => controller.abort());
      return new Promise<never>(() => undefined);
    }),
  } as unknown as ElectronApplication;

  const { actions } = await runElectronActions(
    application,
    electronActiveObservationInputSchema.parse({
      executable_path: "/opt/electron",
      application_path: "/opt/app/main.js",
      application_root: "/opt/app",
      actions: [{ step_id: "settle", kind: "wait", duration_ms: 10 }],
    }),
    { signal: controller.signal },
    new ArtifactResourceScope(),
  );

  expect(actions).toEqual([
    {
      step_id: "settle",
      kind: "wait",
      window_index: null,
      target: null,
      status: "cancelled",
      elapsed_ms: expect.any(Number),
      error: expect.stringContaining("cancel"),
    },
  ]);
});

it("records actions after a cancelled action as not executed", async () => {
  const controller = new AbortController();
  const reload = vi.fn(async () => undefined);
  const page = {
    locator: () => ({
      click: () => {
        queueMicrotask(() => controller.abort());
        return new Promise<never>(() => undefined);
      },
    }),
    reload,
  };

  const { actions } = await runElectronActions(
    {
      windows: () => [page],
      browserWindow: fixtureBrowserWindow,
    } as unknown as ElectronApplication,
    electronActiveObservationInputSchema.parse({
      executable_path: "/opt/electron",
      application_path: "/opt/app/main.js",
      application_root: "/opt/app",
      actions: [
        { step_id: "open", kind: "click", selector: "#open" },
        { step_id: "reload", kind: "renderer-reload" },
      ],
    }),
    { signal: controller.signal },
    new ArtifactResourceScope(),
  );

  expect(reload).not.toHaveBeenCalled();
  expect(actions.map(({ step_id, status }) => [step_id, status])).toEqual([
    ["open", "cancelled"],
    ["reload", "cancelled"],
  ]);
  expect(actions[1]).toMatchObject({
    window_index: 0,
    target: null,
    elapsed_ms: 0,
    error: "not executed after scenario request cancellation",
  });
});

it("bounds a final state read that is still pending after cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const application = {
    evaluate: vi.fn(() => new Promise<never>(() => undefined)),
  } as unknown as ElectronApplication;

  const reason = new Error("caller-reason");

  const state = readFinalApplicationState(application, controller.signal);
  const outcome = state.then(
    () => null,
    (cause: unknown) => cause,
  );
  controller.abort(reason);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe(
    "pending",
  );
  await vi.advanceTimersByTimeAsync(1_000);

  const cause = await outcome;
  expect(cause).toMatchObject({
    _tag: "BrowserObservationError",
    reason: "cancelled",
    diagnostics: {
      final_state_read: "cancellation_grace_expired",
      cancellation_grace_ms: 5_000,
    },
  });
  expect((cause as Error).cause).toBe(reason);
});

it("keeps a final state read failure inside the cancellation grace period primary", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller-reason"));
  const failure = new Error("renderer state unavailable");
  const application = {
    evaluate: vi.fn(() => Promise.reject(failure)),
  } as unknown as ElectronApplication;

  await expect(
    readFinalApplicationState(application, controller.signal),
  ).rejects.toBe(failure);
});

const finalState = {
  windows: [],
  metrics: [],
  electronVersion: "44.0.0",
  hookSnapshot: {
    events: [],
    retention_budget_bytes: 0,
    estimated_retained_bytes: 0,
    event_serialized_byte_upper_bound: 0,
    retained: 0,
    dropped: 0,
    dropped_ipc: 0,
    dropped_runtime: 0,
    dropped_event_families: [],
    dropped_event_roles: [],
    observed: 0,
    observed_ipc: 0,
    observed_runtime: 0,
    hook_error: false,
  },
};

/** An application whose four state reads settle only when `release` runs. */
const gatedStateApplication = () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evaluate = vi
    .fn()
    .mockImplementationOnce(() => gate.then(() => finalState.windows))
    .mockImplementationOnce(() => gate.then(() => finalState.metrics))
    .mockImplementationOnce(() => gate.then(() => finalState.electronVersion))
    .mockImplementationOnce(() => gate.then(() => finalState.hookSnapshot));
  return {
    application: { evaluate } as unknown as ElectronApplication,
    release,
  };
};

it("returns a final state read that settles in the grace period after cancellation during the read", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const { application, release } = gatedStateApplication();

  const state = readFinalApplicationState(application, controller.signal);
  controller.abort();
  await vi.advanceTimersByTimeAsync(1_000);
  release();

  await expect(state).resolves.toEqual(finalState);
});

it("returns a final state read that settles in the grace period when cancellation preceded it", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  controller.abort();
  const { application, release } = gatedStateApplication();

  const state = readFinalApplicationState(application, controller.signal);
  await vi.advanceTimersByTimeAsync(1_000);
  release();

  await expect(state).resolves.toEqual(finalState);
});

it("observes an operation abandoned by an already-cancelled signal", async () => {
  const unhandled: unknown[] = [];
  const recordUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", recordUnhandled);
  try {
    const controller = new AbortController();
    const reason = new Error("caller-reason");
    controller.abort(reason);
    let reject = (_cause: Error): void => undefined;
    const operation = new Promise<never>((_, rejectOperation) => {
      reject = rejectOperation;
    });

    await expect(
      runWithExecutionLimits(operation, controller.signal),
    ).rejects.toMatchObject({
      _tag: "BrowserObservationError",
      reason: "cancelled",
      cause: reason,
    });
    reject(new Error("application closed during cleanup"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", recordUnhandled);
  }
});

it.each(["click", "renderer-crash"] as const)(
  "keeps the selected Page's native identity and completed %s through handle cleanup failure",
  async (kind) => {
    const selectedEffect = vi.fn();
    const page = {
      locator: () => ({
        click: async () => {
          selectedEffect();
        },
      }),
    };
    const other = {};
    const pages = [other, page];
    const dispose = vi
      .fn()
      .mockRejectedValueOnce(new Error("handle disposal failed"))
      .mockResolvedValue(undefined);
    const nativeWindow = {
      id: 99,
      isDestroyed: () => false,
      webContents: { forcefullyCrashRenderer: selectedEffect },
    };
    const browserWindow = vi.fn(async (selected: unknown) => {
      expect(selected).toBe(page);
      pages.reverse();
      return {
        evaluate: async (read: (window: typeof nativeWindow) => unknown) =>
          read(nativeWindow),
        dispose,
      };
    });
    const resources = new ArtifactResourceScope();
    const outcome = await runElectronActions(
      { windows: () => pages, browserWindow } as unknown as ElectronApplication,
      electronActiveObservationInputSchema.parse({
        executable_path: "/opt/electron",
        application_path: "/opt/app/main.js",
        application_root: "/opt/app",
        actions: [
          {
            step_id: "selected",
            kind,
            window_index: 1,
            ...(kind === "click" ? { selector: "#selected" } : {}),
          },
          { step_id: "later", kind: "renderer-reload", window_index: 0 },
        ],
      }),
      {},
      resources,
    );
    expect(selectedEffect).toHaveBeenCalledOnce();
    expect(browserWindow).toHaveBeenCalledOnce();
    expect(outcome.actions).toMatchObject([
      { target: "window:99", status: "completed" },
      { target: null, status: "cancelled" },
    ]);
    expect(outcome.cleanupError?.cleanupIncomplete).toBe(true);
    expect(resources.hasPending).toBe(true);
    await resources.close();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(outcome.cleanupError?.cleanupIncomplete).toBe(false);
  },
);

it.each(["acquisition", "identity"] as const)(
  "owns a late handle when cancellation interrupts window %s",
  async (phase) => {
    const started = createDeferred<void>();
    const finish = createDeferred<void>();
    const controller = new AbortController();
    const page = { locator: vi.fn() };
    const dispose = vi.fn(async () => {});
    const handle = {
      evaluate: async () => {
        if (phase === "identity") {
          started.resolve();
          await finish.promise;
        }
        return 77;
      },
      dispose,
    };
    const application = {
      windows: () => [page],
      browserWindow: async () => {
        if (phase === "acquisition") {
          started.resolve();
          await finish.promise;
        }
        return handle;
      },
    };
    const resources = new ArtifactResourceScope();
    const running = runElectronActions(
      application as unknown as ElectronApplication,
      electronActiveObservationInputSchema.parse({
        executable_path: "/opt/electron",
        application_path: "/opt/app/main.js",
        application_root: "/opt/app",
        actions: [
          { step_id: "selected", kind: "click", selector: "#selected" },
        ],
      }),
      { signal: controller.signal },
      resources,
    );
    await started.promise;
    controller.abort(new Error("stop during selected window read"));
    await Promise.resolve();
    finish.resolve();
    const outcome = await running;
    expect(outcome.actions[0]).toMatchObject({
      status: "cancelled",
      target: null,
    });
    expect(page.locator).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(resources.hasPending).toBe(false);
    await resources.close();
    expect(dispose).toHaveBeenCalledOnce();
  },
);

it("retains the caller reason when cancellation precedes failed handle disposal", async () => {
  const controller = new AbortController();
  const reason = { stop: "during handle disposal" };
  const dispose = vi
    .fn()
    .mockImplementationOnce(async () => {
      controller.abort(reason);
      throw new Error("dispose rejected");
    })
    .mockResolvedValue(undefined);
  const page = { locator: () => ({ click: async () => {} }) };
  const resources = new ArtifactResourceScope();
  const outcome = await runElectronActions(
    {
      windows: () => [page],
      browserWindow: async () => ({ evaluate: async () => 99, dispose }),
    } as unknown as ElectronApplication,
    electronActiveObservationInputSchema.parse({
      executable_path: "/opt/electron",
      application_path: "/opt/app/main.js",
      application_root: "/opt/app",
      actions: [{ step_id: "selected", kind: "click", selector: "#selected" }],
    }),
    { signal: controller.signal },
    resources,
  );
  expect(outcome.actions[0]).toMatchObject({
    status: "completed",
    target: "window:99",
  });
  expect(outcome.cleanupError?.cleanupPrimary?.cause).toBe(reason);
  expect(outcome.cleanupError?.cleanupIncomplete).toBe(true);
  await resources.close();
  expect(outcome.cleanupError?.cleanupIncomplete).toBe(false);
  expect(outcome.cleanupError?.cleanupPrimary?.cause).toBe(reason);
});
