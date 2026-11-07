import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { DarwinProcessOwnershipInspectionError } from "./DarwinProcessRunTokenReader.js";
import {
  OwnedCommandFailure,
  prepareOwnedCommand,
  runOwnedCommand,
} from "./OwnedCommand.js";
import {
  prepareProcessOwnershipInspection,
  systemProcessOwnershipHost,
} from "./ProcessOwnershipObservation.js";

const platform = Object.getOwnPropertyDescriptor(
  systemProcessOwnershipHost,
  "platform",
)!;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(systemProcessOwnershipHost, "platform", platform);
  vi.useRealTimers();
});
const hostPlatform = (value: NodeJS.Platform) =>
  Object.defineProperty(systemProcessOwnershipHost, "platform", {
    value,
    configurable: true,
  });

it("gives bounded macOS preparation the caller signal and no command deadline", async () => {
  hostPlatform("darwin");
  vi.useFakeTimers();
  const prepared = createDeferred<void>();
  const controller = new AbortController();
  const prepare = vi
    .spyOn(systemProcessOwnershipHost, "prepare")
    .mockImplementation(async (signal) => {
      expect(signal).toBe(controller.signal);
      await prepared.promise;
    });
  let completed = false;
  const pending = prepareOwnedCommand(controller.signal).then(() => {
    completed = true;
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(completed).toBe(false);
  expect(controller.signal.aborted).toBe(false);
  prepared.resolve();
  await pending;
  expect(prepare).toHaveBeenCalledOnce();
});

it.each(["linux", "win32"] as const)(
  "leaves %s preparation inside the command deadline",
  async (value) => {
    hostPlatform(value);
    const prepare = vi.spyOn(systemProcessOwnershipHost, "prepare");
    await prepareOwnedCommand();
    expect(prepare).not.toHaveBeenCalled();
  },
);

it("keeps an observed compiler failure primary when cancellation is also observed", async () => {
  hostPlatform("darwin");
  const failure = new DarwinProcessOwnershipInspectionError(
    "physical compiler failure",
  );
  const controller = new AbortController();
  vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
    async () => {
      controller.abort({ caller: "after compiler failure" });
      throw failure;
    },
  );
  await expect(prepareOwnedCommand(controller.signal)).rejects.toBe(failure);
});

it.each(["before", "during"] as const)(
  "does not reinterpret a typed opaque caller reason as a helper failure: %s",
  async (phase) => {
    hostPlatform("darwin");
    const reason = new DarwinProcessOwnershipInspectionError(
      "caller-owned reason",
    );
    const controller = new AbortController();
    const prepare = vi
      .spyOn(systemProcessOwnershipHost, "prepare")
      .mockImplementation(async () => {
        controller.abort(reason);
        throw reason;
      });
    if (phase === "before") controller.abort(reason);
    let observed: unknown;
    try {
      await prepareOwnedCommand(controller.signal);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(OwnedCommandFailure);
    if (!(observed instanceof OwnedCommandFailure)) throw observed;
    expect(observed.reason).toBe("cancelled");
    expect(observed.cancellation?.reason).toBe(reason);
    expect(observed.preparationFailure).toBeUndefined();
    expect(prepare).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
  },
);

it("preserves exact cancelled preparation cleanup capabilities", async () => {
  hostPlatform("darwin");
  const reason = { caller: "during helper final cleanup" };
  const controller = new AbortController();
  const cleanup = new ProviderCleanupError(
    "process-ownership",
    ["authored-owned-helper"],
    {},
  );
  const owner = {
    close: vi.fn(async () => {
      cleanup.resolveCleanup();
    }),
  };
  const failure = new DarwinProcessOwnershipInspectionError(
    "cancelled helper",
    { cancellation: { reason }, cleanupFailure: cleanup, cleanupOwner: owner },
  );
  vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
    async () => {
      controller.abort(reason);
      throw failure;
    },
  );
  let observed: unknown;
  try {
    await prepareOwnedCommand(controller.signal);
  } catch (error) {
    observed = error;
  }
  if (!(observed instanceof OwnedCommandFailure)) throw observed;
  expect(observed.cancellation?.reason).toBe(reason);
  expect(observed.preparationFailure).toBe(failure);
  if (observed.preparationFailure === undefined)
    throw new Error("Expected retained preparation failure");
  expect(observed.preparationFailure.cleanupOwner).toBe(owner);
  expect(observed.preparationFailure.cleanupFailure).toBe(cleanup);
  await observed.preparationFailure.cleanupOwner!.close();
  expect(cleanup.cleanupIncomplete).toBe(false);
});

it("bounds simulated Linux preparation by the command deadline before launch", async () => {
  hostPlatform("linux");
  vi.useFakeTimers();
  const preparing = vi
    .spyOn(systemProcessOwnershipHost, "prepare")
    .mockImplementation(async (signal) => {
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    });
  await prepareOwnedCommand();
  expect(preparing).not.toHaveBeenCalled();
  let enteredLaunch = false;
  const pending = runOwnedCommand(
    {
      command: "never-launched",
      arguments: [],
      runId: "authored-linux-prepare",
    },
    { timeoutMs: 50, diagnosticBytes: 1024 },
    {
      launcher: async (input) => {
        await prepareProcessOwnershipInspection(input.signal);
        enteredLaunch = true;
        throw new Error("Preparation should time out before launch");
      },
    },
  );
  const expected = expect(pending).rejects.toMatchObject({
    reason: "timeout",
    message: "Command deadline elapsed during ownership preparation.",
  });
  await vi.advanceTimersByTimeAsync(51);
  await expected;
  expect(enteredLaunch).toBe(false);
});

it.each([false, true])(
  "keeps no-deadline preparation pending without a timer (caller signal: %s)",
  async (withCallerSignal) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const prepared = createDeferred<void>();
    const failure = new Error("authored preparation failure");
    let preparationSignal: AbortSignal | undefined;
    const pending = runOwnedCommand(
      {
        command: "never-launched",
        arguments: [],
        runId: "authored-no-deadline-prepare",
      },
      { timeoutMs: null, diagnosticBytes: 1024 },
      {
        ...(withCallerSignal ? { signal: controller.signal } : {}),
        launcher: async (input) => {
          preparationSignal = input.signal;
          await prepared.promise;
          throw failure;
        },
      },
    );
    const expected = expect(pending).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(preparationSignal?.aborted).toBe(false);
    if (withCallerSignal) expect(preparationSignal).toBe(controller.signal);
    expect(vi.getTimerCount()).toBe(0);
    prepared.resolve();
    await expected;
  },
);

it("cancels no-deadline preparation with the caller's exact opaque reason", async () => {
  const controller = new AbortController();
  const reason = new DarwinProcessOwnershipInspectionError(
    "opaque caller reason",
  );
  const started = createDeferred<void>();
  const pending = runOwnedCommand(
    {
      command: "never-launched",
      arguments: [],
      runId: "authored-no-deadline-cancel",
    },
    { timeoutMs: null, diagnosticBytes: 1024 },
    {
      signal: controller.signal,
      launcher: async (input) => {
        expect(input.signal).toBe(controller.signal);
        started.resolve();
        await new Promise<void>((_resolve, reject) =>
          input.signal?.addEventListener(
            "abort",
            () => reject(input.signal?.reason),
            {
              once: true,
            },
          ),
        );
        throw new Error("Cancelled preparation must not launch");
      },
    },
  );
  const expected = expect(pending).rejects.toMatchObject({
    reason: "cancelled",
    cancellation: { reason },
    preparationFailure: undefined,
    snapshot: null,
  });
  await started.promise;
  controller.abort(reason);
  await expected;
});
