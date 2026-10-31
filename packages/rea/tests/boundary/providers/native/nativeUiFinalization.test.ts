import { AnalysisCleanupLease } from "../../../../src/artifacts/AnalysisCleanupLease.js";
import { expect, it, vi, onTestFinished } from "vitest";
import * as runtimes from "../../../../src/native/NativeUiHelperRuntime.js";
import { observeNativeUi } from "../../../../src/native/NativeUiObservation.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { ExecFileOutputCancelledError } from "../../../../src/process/ExecFileOutput.js";
import { resolvedAnalysisError } from "../../../../src/domain/analysisErrorBase.js";

const target = nativeMachoTarget("/fixture/App");
const input = {
  pid: 123,
  window_id: 456,
  screenshot: false,
  accessibility: true,
};
const snapshot = {
  window: {
    pid: 123,
    window_id: 456,
    executable: target.path,
    launch_time: 1,
    title: "Fixture",
  },
  nodes: [],
  screenshot: null,
  gaps: [],
  truncated: false,
};

const controlledRuntime = (
  cleanup: () => Promise<void>,
  signal = new AbortController().signal,
) => {
  const cleanupLease = new AnalysisCleanupLease(cleanup);
  return {
    cleanupLease,
    signal,
    invoke: vi.fn(async () => ({ ok: true, result: snapshot })),
    close: vi.fn(() => cleanupLease.release()),
    resources: () => (cleanupLease.released ? [] : ["controlled-ui-runtime"]),
  };
};

it("preserves the exact native UI admission cancellation reason", async () => {
  const controller = new AbortController();
  const reason = { phase: "admission" };
  controller.abort(reason);
  const invoke = vi.fn(async () => ({ ok: true, result: snapshot }));
  const result = await observeNativeUi(target, "observe_native_ui", input, {
    environment: {},
    signal: controller.signal,
    invoke,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(invoke).not.toHaveBeenCalled();
});

it("uses the command owner's cancellation fact without guessing from ambient signal", async () => {
  const reason = { phase: "command-owner" };
  const result = await observeNativeUi(target, "observe_native_ui", input, {
    environment: {},
    invoke: async () => {
      throw new ExecFileOutputCancelledError(reason);
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected command cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
});

it("preserves malformed helper output when a later abort is already visible", async () => {
  const controller = new AbortController();
  const result = await observeNativeUi(target, "observe_native_ui", input, {
    environment: {},
    signal: controller.signal,
    invoke: async () => {
      controller.abort({ phase: "late-output" });
      return { ok: true, result: {} };
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected invalid output");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(result.error.cause).toMatchObject({ name: "ZodError" });
});

it("retains native UI facts and caller reason when cancellation arrives during final cleanup", async () => {
  const controller = new AbortController();
  const reason = { phase: "runtime-close" };
  const runtime = controlledRuntime(async () => {
    controller.abort(reason);
  });
  const factory = vi
    .spyOn(runtimes, "createNativeUiHelperRuntime")
    .mockReturnValue(runtime);
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createClient(target);
  onTestFinished(async () => {
    factory.mockRestore();
    await client.close();
  });
  const result = await client.execute("observe_native_ui", input, {
    signal: controller.signal,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected finalization cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    initial: snapshot,
    steps: [],
  });
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(runtime.close).toHaveBeenCalledTimes(1);
});

it("resolves every native UI cleanup error only after its exact runtime releases", async () => {
  let allowClose = false;
  const runtime = controlledRuntime(async () => {
    if (!allowClose) throw new Error("controlled native UI cleanup failure");
  });
  const factory = vi
    .spyOn(runtimes, "createNativeUiHelperRuntime")
    .mockReturnValue(runtime);
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createClient(target);
  onTestFinished(async () => {
    allowClose = true;
    await client.close();
    factory.mockRestore();
  });
  const observed = await client.execute("observe_native_ui", input);
  expect(observed.ok).toBe(false);
  if (observed.ok) throw new Error("Expected cleanup failure");
  expect(observed.error.cleanupIncomplete).toBe(true);
  expect(observed.error.partialObservation).toMatchObject({
    initial: snapshot,
  });
  const blocked = await client.execute("observe_native_ui", input);
  expect(blocked.ok).toBe(false);
  if (blocked.ok) throw new Error("Expected retained admission blocker");
  expect(runtime.invoke).toHaveBeenCalledTimes(1);
  const retry = await client.close();
  expect(retry.ok).toBe(false);
  allowClose = true;
  expect((await client.close()).ok).toBe(true);
  for (const error of [
    observed.error,
    blocked.error,
    ...(retry.ok ? [] : [retry.error]),
  ]) {
    expect(error.cleanupIncomplete).toBe(false);
    expect(error.cleanupResources).toEqual([]);
    expect(resolvedAnalysisError(error).cleanupIncomplete).toBe(false);
  }
});

it("retains a completed standalone report and its exact runtime after cleanup failure", async () => {
  const controller = new AbortController();
  const reason = { phase: "standalone-close" };
  let allowClose = false;
  const runtime = controlledRuntime(async () => {
    controller.abort(reason);
    if (!allowClose) throw new Error("controlled standalone close failure");
  });
  const factory = vi
    .spyOn(runtimes, "createNativeUiHelperRuntime")
    .mockReturnValue(runtime);
  onTestFinished(async () => {
    allowClose = true;
    await runtime.close();
    factory.mockRestore();
  });
  const result = await observeNativeUi(target, "observe_native_ui", input, {
    environment: {},
    signal: controller.signal,
  });
  expect(result.ok).toBe(false);
  if (result.ok)
    throw new Error("Expected standalone cancellation and cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual(["controlled-ui-runtime"]);
  expect(result.error.partialObservation).toMatchObject({ initial: snapshot });
  expect(result.error.cleanupPrimary?._tag).toBe("AnalysisCancelledError");
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
  allowClose = true;
  await runtime.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(result.error).cause).toBe(reason);
});

it("preserves a physical helper failure and all cleanup facts across a late abort", async () => {
  const controller = new AbortController();
  const failure = new Error("controlled physical helper failure");
  let allowClose = false;
  const runtime = controlledRuntime(async () => {
    controller.abort({ phase: "late-failing-close" });
    if (!allowClose) throw new Error("controlled cleanup failure");
  });
  runtime.invoke.mockImplementation(async () => {
    throw failure;
  });
  const factory = vi
    .spyOn(runtimes, "createNativeUiHelperRuntime")
    .mockReturnValue(runtime);
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createClient(target);
  onTestFinished(async () => {
    allowClose = true;
    await client.close();
    factory.mockRestore();
  });
  const result = await client.execute("observe_native_ui", input, {
    signal: controller.signal,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected helper and cleanup failures");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupPrimary?._tag).toBe("ProviderAdapterError");
  expect(result.error.cleanupPrimary?.cause).toBe(failure);
  allowClose = true;
  expect((await client.close()).ok).toBe(true);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(result.error).cause).toBe(failure);
});

it.each([false, true])(
  "keeps the runtime deadline through final cleanup (close fails: %s)",
  async (fails) => {
    const deadline = new AbortController();
    const reason = { phase: "owned-deadline-close" };
    let allowClose = !fails;
    const runtime = controlledRuntime(async () => {
      deadline.abort(reason);
      if (!allowClose) throw new Error("controlled deadline close failure");
    }, deadline.signal);
    const factory = vi
      .spyOn(runtimes, "createNativeUiHelperRuntime")
      .mockReturnValue(runtime);
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
    ).createClient(target);
    onTestFinished(async () => {
      allowClose = true;
      await client.close();
      factory.mockRestore();
    });
    const result = await client.execute("observe_native_ui", input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected owned deadline timeout");
    const primary = resolvedAnalysisError(
      result.error.cleanupPrimary ?? result.error,
    );
    expect(primary._tag).toBe("AnalysisTimeoutError");
    expect(primary.cause).toBe(reason);
    expect(result.error.partialObservation).toMatchObject({
      initial: snapshot,
    });
    expect(result.error.cleanupIncomplete).toBe(fails);
    allowClose = true;
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
  },
);

it.each(["physical", "cancelled"] as const)(
  "preserves the scenario step's %s outcome through report finalization",
  async (outcome) => {
    const controller = new AbortController();
    const reason = { phase: "scenario-command-owner" };
    const failure = new Error("controlled action capture failure");
    let calls = 0;
    const result = await observeNativeUi(
      target,
      "capture_native_ui_scenario",
      {
        ...input,
        steps: [
          { kind: "click", path: [] },
          { kind: "click", path: [1] },
        ],
      },
      {
        environment: {},
        signal: controller.signal,
        invoke: async () => {
          if (++calls === 1) return { ok: true, result: snapshot };
          if (outcome === "cancelled")
            throw new ExecFileOutputCancelledError(reason);
          controller.abort({ phase: "later-caller-abort" });
          throw failure;
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected typed scenario failure");
    expect(result.error._tag).toBe(
      outcome === "cancelled"
        ? "AnalysisCancelledError"
        : "ProviderAdapterError",
    );
    expect(result.error.cause).toBe(outcome === "cancelled" ? reason : failure);
    expect(result.error.partialObservation).toMatchObject({
      initial: snapshot,
      steps: [
        {
          index: 0,
          before: snapshot,
          after: null,
          outcome: outcome === "cancelled" ? "cancelled" : "failed",
        },
      ],
    });
    expect(calls).toBe(2);
  },
);
