import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";

import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { cleanupOwnedProcessGroup } from "./ProcessOwnership.js";
import {
  OwnedWorkerRuntime,
  OwnedWorkerRuntimeCleanupError,
  type OwnedWorkerRuntimeOptions,
} from "./OwnedWorkerRuntime.js";
import { spawnOwnedProviderProcess } from "./ProviderProcess.js";

const runtimeOptions = (
  overrides: Partial<OwnedWorkerRuntimeOptions> = {},
): OwnedWorkerRuntimeOptions => ({
  rootPrefix: "rea-owned-worker-test-",
  ...overrides,
});

const startOptions = () => ({
  command: process.execPath,
  arguments: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
  runId: `rea-owned-worker-test-${randomUUID()}`,
  stdin: "pipe" as const,
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for owned worker startup");
};

it("waits for an admitted late handshake before closing its process and root", async () => {
  const runtime = new OwnedWorkerRuntime(runtimeOptions());
  let announceInitialize: () => void = () => {};
  const initializing = new Promise<void>((resolve) => {
    announceInitialize = resolve;
  });
  let releaseInitialize: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseInitialize = resolve;
  });
  let closeSettled = false;
  const starting = runtime.start(startOptions(), async () => {
    announceInitialize();
    await held;
  });
  let closing: Promise<void> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(initializing, starting, "worker initialization");
    await waitFor(() => runtime.supervisor !== undefined);
    const rootPath = runtime.rootPath;
    expect(rootPath).toBeDefined();
    closing = runtime.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closeSettled).toBe(false);
    expect(runtime.supervisor).toBeDefined();
    releaseInitialize();
    await expect(starting).rejects.toThrow("closing");
    await closing;
    expect(runtime.supervisor).toBeUndefined();
    expect(runtime.rootPath).toBeUndefined();
    await expect(access(rootPath as string)).rejects.toThrow();
  }, [
    releaseInitialize,
    async () => {
      await starting.catch(() => undefined);
    },
    async () => {
      await closing;
    },
    () => runtime.close(),
  ]);
});

it("resolves a bound cleanup error after shared pending-owner retry succeeds", async () => {
  let failCleanup = true;
  const runtime = new OwnedWorkerRuntime(
    runtimeOptions({
      launcher: async (options) => {
        const spawned = await spawnOwnedProviderProcess(options);
        return {
          ...spawned,
          cleanup: async () => {
            if (failCleanup) {
              failCleanup = false;
              return { cleaned: false, reason: "controlled cleanup retry" };
            }
            return spawned.cleanup === undefined
              ? cleanupOwnedProcessGroup(spawned.ownership)
              : spawned.cleanup();
          },
        };
      },
    }),
  );
  await withVerifierCleanup(async () => {
    await runtime.start(startOptions());
    const rootPath = runtime.rootPath;
    const error = new ProviderCleanupError("owned-worker-test", [], {
      reason: "controlled cleanup retry",
    });
    await expect(runtime.stop()).resolves.toMatchObject({
      status: "incomplete",
    });
    runtime.bindCleanupFailure(error);
    expect(error.cleanupIncomplete).toBe(true);
    expect(error.cleanupResources).toContain(rootPath);

    await OwnedWorkerRuntime.retryPending();

    expect(error.cleanupIncomplete).toBe(false);
    expect(error.cleanupResources).toEqual([]);
    expect(runtime.rootPath).toBeUndefined();
    await expect(access(rootPath as string)).rejects.toThrow();
  }, [
    () => {
      failCleanup = false;
    },
    () => runtime.close(),
  ]);
});

it("observes request-stream errors and resets them for a fresh child", async () => {
  const runtime = new OwnedWorkerRuntime(runtimeOptions());
  try {
    await runtime.start(startOptions());
    const stdin = runtime.supervisor?.launch.process.stdin;
    expect(stdin).toBeDefined();
    const failure = new Error("controlled request pipe failure");
    stdin?.emit("error", failure);
    expect(runtime.inputFailure).toBe(failure);

    const stopped = await runtime.stop();
    expect(stopped.status).not.toBe("incomplete");
    await runtime.start(startOptions());
    expect(runtime.inputFailure).toBeUndefined();
  } finally {
    await runtime.close();
  }
});

it("retains pending ownership when best-effort stdin.end throws after an incomplete stop", async () => {
  let failCleanup = true;
  const runtime = new OwnedWorkerRuntime(
    runtimeOptions({
      launcher: async (options) => {
        const spawned = await spawnOwnedProviderProcess(options);
        return {
          ...spawned,
          cleanup: async () => {
            if (failCleanup)
              return { cleaned: false, reason: "controlled incomplete stop" };
            return spawned.cleanup === undefined
              ? cleanupOwnedProcessGroup(spawned.ownership)
              : spawned.cleanup();
          },
        };
      },
    }),
  );
  await runtime.start(startOptions());
  const rootPath = runtime.rootPath;
  const stdin = runtime.supervisor?.launch.process.stdin;
  if (stdin === undefined || stdin === null)
    throw new Error("Owned child request stream is unavailable");
  const originalEnd = stdin.end.bind(stdin);
  Object.defineProperty(stdin, "end", {
    configurable: true,
    value: () => {
      throw new Error("controlled stdin.end failure");
    },
  });
  try {
    await expect(runtime.stop()).resolves.toMatchObject({
      status: "incomplete",
    });
    expect(runtime.hasPendingCleanup).toBe(true);
    failCleanup = false;
    Object.defineProperty(stdin, "end", {
      configurable: true,
      value: originalEnd,
    });

    await OwnedWorkerRuntime.retryPending();

    expect(runtime.hasPendingCleanup).toBe(false);
    expect(runtime.rootPath).toBeUndefined();
    await expect(access(rootPath as string)).rejects.toThrow();
  } finally {
    Object.defineProperty(stdin, "end", {
      configurable: true,
      value: originalEnd,
    });
    failCleanup = false;
    await runtime.close();
  }
});

it("binds a late cleanup projection to its released root epoch after runtime reuse", async () => {
  let failCleanup = true;
  const runtime = new OwnedWorkerRuntime(
    runtimeOptions({
      launcher: async (options) => {
        const spawned = await spawnOwnedProviderProcess(options);
        return {
          ...spawned,
          cleanup: async () => {
            if (failCleanup)
              return { cleaned: false, reason: "controlled old-epoch cleanup" };
            return spawned.cleanup === undefined
              ? cleanupOwnedProcessGroup(spawned.ownership)
              : spawned.cleanup();
          },
        };
      },
    }),
  );
  let oldCleanupError: OwnedWorkerRuntimeCleanupError | undefined;
  try {
    await runtime.start(startOptions());
    const oldRoot = runtime.rootPath;
    await expect(runtime.stop()).resolves.toMatchObject({
      status: "incomplete",
    });
    try {
      await OwnedWorkerRuntime.retryPending();
      throw new Error("Expected pending-owner retry to fail");
    } catch (cause) {
      if (!(cause instanceof OwnedWorkerRuntimeCleanupError)) throw cause;
      oldCleanupError = cause;
    }
    if (oldCleanupError === undefined)
      throw new Error("Expected an owned cleanup error from the old root");

    failCleanup = false;
    await OwnedWorkerRuntime.retryPending();
    expect(runtime.rootPath).toBeUndefined();
    await expect(access(oldRoot as string)).rejects.toThrow();

    await runtime.start(startOptions());
    const newRoot = runtime.rootPath;
    expect(newRoot).toBeDefined();
    expect(newRoot).not.toBe(oldRoot);

    const lateProjection = new ProviderCleanupError(
      "owned-worker-test",
      oldCleanupError.cleanupResources,
      { reason: oldCleanupError.message },
    );
    oldCleanupError.bindCleanupFailure(lateProjection);

    expect(lateProjection.cleanupIncomplete).toBe(false);
    expect(lateProjection.cleanupResources).toEqual([]);
    expect(runtime.rootPath).toBe(newRoot);
    expect(runtime.supervisor).toBeDefined();
  } finally {
    failCleanup = false;
    await runtime.close();
  }
});

it("routes shared cleanup retry through the registered higher-level owner", async () => {
  let failCleanup = true;
  let allowOwnerClose = false;
  let delegateCalls = 0;
  let runtime: OwnedWorkerRuntime;
  runtime = new OwnedWorkerRuntime(
    runtimeOptions({
      launcher: async (options) => {
        const spawned = await spawnOwnedProviderProcess(options);
        return {
          ...spawned,
          cleanup: async () => {
            if (failCleanup)
              return { cleaned: false, reason: "controlled delegated cleanup" };
            return spawned.cleanup === undefined
              ? cleanupOwnedProcessGroup(spawned.ownership)
              : spawned.cleanup();
          },
        };
      },
      retryCleanup: async () => {
        delegateCalls += 1;
        if (!allowOwnerClose)
          throw new Error("higher-level owner still retains a descriptor");
        await runtime.close();
      },
    }),
  );
  await runtime.start(startOptions());
  const rootPath = runtime.rootPath;
  try {
    await expect(runtime.stop()).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(OwnedWorkerRuntime.retryPending()).rejects.toThrow(
      "higher-level owner still retains a descriptor",
    );
    expect(delegateCalls).toBe(1);
    // A retained supervisor is not permission to bypass its dependent owner.
    await expect(runtime.start(startOptions())).rejects.toThrow(
      "higher-level owner still retains a descriptor",
    );
    expect(delegateCalls).toBe(2);
    expect(runtime.rootPath).toBe(rootPath);
    await access(rootPath as string);

    allowOwnerClose = true;
    failCleanup = false;
    await OwnedWorkerRuntime.retryPending();

    expect(delegateCalls).toBe(3);
    expect(runtime.rootPath).toBeUndefined();
    await expect(access(rootPath as string)).rejects.toThrow();
  } finally {
    allowOwnerClose = true;
    failCleanup = false;
    await runtime.close();
  }
});

it("runs deferred delegated cleanup before registering a pending start acquisition", async () => {
  let runtime: OwnedWorkerRuntime;
  let delegatedClose: Promise<void> | undefined;
  let delegateTimedOut = false;
  runtime = new OwnedWorkerRuntime(
    runtimeOptions({
      retryCleanup: async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        delegatedClose = runtime.close();
        let timer: NodeJS.Timeout | undefined;
        const outcome = await Promise.race([
          delegatedClose.then(() => "closed" as const),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), 250);
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        delegateTimedOut = outcome === "timeout";
      },
    }),
  );
  try {
    await runtime.start(startOptions());
    const stopped = await runtime.stop();
    expect(stopped.status).not.toBe("incomplete");
    runtime.retainForCleanup();

    await expect(runtime.start(startOptions())).rejects.toMatchObject({
      _tag: "ProcessAdmissionError",
      code: "runtime_closing",
    });
    expect(delegateTimedOut).toBe(false);
    await delegatedClose;
    expect(runtime.rootPath).toBeUndefined();
  } finally {
    await runtime.close();
  }
});
