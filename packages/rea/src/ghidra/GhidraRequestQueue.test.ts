import { describe, expect, it, vi } from "vitest";

import { err, ok, type Result } from "../domain/result.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { GhidraRequestQueue } from "./GhidraRequestQueue.js";
import {
  bindGhidraSessionFailure,
  GhidraSessionError,
} from "./GhidraSessionError.js";

const failure = bindGhidraSessionFailure(() => ({
  target_path: "/tmp/queue-fixture",
}));

describe("Ghidra request queue failure settlement", () => {
  it("forwards the request deadline to the executor", async () => {
    const optionsSeen: { timeoutMs?: number }[] = [];
    const queue = new GhidraRequestQueue(
      (_method, _parameters, options) => {
        optionsSeen.push(options);
        return Promise.resolve(
          options.timeoutMs === 0
            ? err(
                failure(
                  "timeout",
                  "Ghidra request deadline elapsed",
                  undefined,
                  { timeoutMs: 0 },
                ),
              )
            : ok(null),
        );
      },
      failure,
      () => Promise.resolve(ok(null)),
    );

    await expect(
      queue.run("ping", {}, { timeoutMs: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "timeout", timeoutMs: 0 },
    });
    expect(optionsSeen).toEqual([{ timeoutMs: 0 }]);
  });

  it.each([new TypeError("Decoder rejected"), "decoder rejected", null])(
    "preserves a rejected executor cause (%j) and drains the next request",
    async (cause) => {
      const executed: string[] = [];
      const queue = new GhidraRequestQueue(
        async (method) => {
          executed.push(method);
          if (method === "first") throw cause;
          return ok({ method });
        },
        failure,
        () => Promise.resolve(ok(null)),
      );
      const first = queue.run("first", {}, {});
      const second = queue.run("second", {}, {});
      const result = await first;
      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: "protocol",
          message: "Ghidra serial request execution rejected unexpectedly",
          diagnostics: { target_path: "/tmp/queue-fixture" },
        },
      });
      if (result.ok) throw new Error("Expected queue failure");
      expect(result.error.cause).toBe(cause);
      expect(result.error.diagnostics).toHaveProperty("failure_cause");
      await expect(second).resolves.toEqual(ok({ method: "second" }));
      expect(executed).toEqual(["first", "second"]);
    },
  );

  it("does not replace an executor's typed failure", async () => {
    const original = failure("timeout", "Request deadline elapsed");
    const queue = new GhidraRequestQueue(
      () => Promise.resolve(err(original)),
      failure,
      () => Promise.resolve(ok(null)),
    );
    const result = await queue.run("first", {}, {});
    expect(result).toEqual(err(original));
    if (!result.ok) expect(result.error).toBe(original);
  });
});

describe("Ghidra request queue cancellation", () => {
  it("preserves cancellation cleanup failures and rejects queued work", async () => {
    const controller = new AbortController();
    const cause = new Error("Runtime removal failed");
    const cleanupFailure = new ProviderCleanupError(
      "ghidra",
      ["/tmp/runtime"],
      { reason: cause.message },
      { cause },
    );
    let release: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new GhidraRequestQueue(
      async () => {
        await completed;
        return err(
          failure("cancelled", "Request cancelled", undefined, {
            cancellation: { reason: null },
          }),
        );
      },
      failure,
      () => Promise.resolve(err(cleanupFailure)),
    );
    const active = queue.run("active", {}, { signal: controller.signal });
    const queued = queue.run("queued", {}, {});
    controller.abort();
    release?.();
    const result = await active;
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "cancelled",
        message: "Request cancelled",
      },
    });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cleanupFailure).toBe(cleanupFailure);
    expect(result.error.cancellation).toEqual({ reason: null });
    await expect(queued).resolves.toMatchObject({
      ok: false,
      error: { kind: "process" },
    });
  });

  it.each([
    {
      cause: new Error("Unexpected cleanup rejection"),
      diagnostic: { message: "Unexpected cleanup rejection" },
    },
    { cause: undefined, diagnostic: { type: "undefined" } },
  ])(
    "keeps cancellation primary when cleanup rejects with $diagnostic",
    async ({ cause, diagnostic }) => {
      const controller = new AbortController();
      const cancellationCause = new Error("Caller cancelled");
      const original = failure(
        "cancelled",
        "Request cancelled",
        cancellationCause,
        { cancellation: { reason: cancellationCause } },
      );
      let release: (() => void) | undefined;
      const completed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const queue = new GhidraRequestQueue(
        async () => {
          await completed;
          return err(original);
        },
        failure,
        async () => {
          throw cause;
        },
      );
      const active = queue.run("active", {}, { signal: controller.signal });
      controller.abort();
      release?.();

      const result = await active;
      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: "cancelled",
          message: "Request cancelled",
          diagnostics: {
            unexpected_cleanup_rejection: diagnostic,
          },
        },
      });
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error.cause).toBe(cancellationCause);
      expect(result.error.cancellation?.reason).toBe(cancellationCause);
      expect(result.error.cleanupFailure).toMatchObject({
        cleanupIncomplete: true,
        cause,
      });
    },
  );

  it("preserves the cancellation result when cleanup succeeds", async () => {
    const controller = new AbortController();
    const original = failure("cancelled", "Request cancelled");
    let release: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new GhidraRequestQueue(
      async () => {
        await completed;
        return err(original);
      },
      failure,
      () => Promise.resolve(ok(null)),
    );
    const active = queue.run("active", {}, { signal: controller.signal });
    controller.abort();
    release?.();

    await expect(active).resolves.toEqual(err(original));
  });
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};
type ExecutionResult = Result<null, GhidraSessionError>;
type CleanupResult = Result<null, ProviderCleanupError>;
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

it("joins a completed response with cancellation cleanup before reporting cancellation", async () => {
  const execution = deferred<ExecutionResult>();
  const cleanup = deferred<CleanupResult>();
  const stop = vi.fn(() => cleanup.promise);
  const controller = new AbortController();
  const queue = new GhidraRequestQueue(() => execution.promise, failure, stop);
  let settled = false;
  const pending = queue
    .run("active", {}, { signal: controller.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  execution.resolve(ok(null));
  controller.abort(null);
  await nextTurn();
  expect(settled).toBe(false);
  cleanup.resolve(ok(null));
  const result = await pending;
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "cancelled", cancellation: { reason: null } },
  });
  expect(stop).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "records the session close on a late remote failure (cleanup failed: %s)",
  async (cleanupFailed) => {
    const execution = deferred<ExecutionResult>();
    const original = new GhidraSessionError(
      "remote",
      "decompile limit reached",
      { remote_code: "decompile_timed_out" },
      { remoteCode: "decompile_timed_out" },
    );
    const controller = new AbortController();
    const reason = new Error("client deadline");
    const cleanupFailure = new ProviderCleanupError(
      "ghidra",
      ["owned session"],
      {
        reason: "Fixture cleanup needs retry",
      },
    );
    const queue = new GhidraRequestQueue(
      () => execution.promise,
      failure,
      () => Promise.resolve(cleanupFailed ? err(cleanupFailure) : ok(null)),
    );
    const pending = queue.run("active", {}, { signal: controller.signal });
    controller.abort(reason);
    execution.resolve(err(original));
    const result = await pending;
    if (result.ok) throw new Error("Expected the remote failure");
    // The observed failure stays primary; only the session close is added.
    expect(result.error).toMatchObject({
      kind: "remote",
      remoteCode: "decompile_timed_out",
      message: "decompile limit reached",
      concurrentCancellation: { reason },
      diagnostics: {
        remote_code: "decompile_timed_out",
        session_closed_by_cancellation: true,
      },
    });
    expect(result.error.cleanupFailure).toBe(
      cleanupFailed ? cleanupFailure : undefined,
    );
    expect(result.error.cancellation).toBeUndefined();
    expect(original.concurrentCancellation).toBeUndefined();
  },
);

it("awaits active cancellation cleanup when execution rejects", async () => {
  const execution = deferred<ExecutionResult>();
  const cleanup = deferred<CleanupResult>();
  const cause = new Error("executor rejected");
  const cleanupFailure = new ProviderCleanupError(
    "ghidra",
    ["owned-runtime"],
    {},
  );
  const controller = new AbortController();
  const queue = new GhidraRequestQueue(
    () => execution.promise,
    failure,
    () => cleanup.promise,
  );
  let settled = false;
  const pending = queue
    .run("active", {}, { signal: controller.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  controller.abort(null);
  execution.reject(cause);
  await nextTurn();
  expect(settled).toBe(false);
  cleanup.resolve(err(cleanupFailure));
  const result = await pending;
  if (result.ok) throw new Error("Expected execution failure");
  expect(result.error).toMatchObject({ kind: "protocol", cause });
  expect(result.error.cleanupFailure).toBe(cleanupFailure);
});

it("normalizes a synchronous executor rejection and drains the next request", async () => {
  const cause = new Error("synchronous execution rejected");
  const queue = new GhidraRequestQueue(
    (method) => {
      if (method === "first") throw cause;
      return Promise.resolve(ok(null));
    },
    failure,
    () => Promise.resolve(ok(null)),
  );
  const result: unknown = await queue
    .run("first", {}, {})
    .catch((failure: unknown) => failure);
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "protocol", cause },
  });
  await expect(queue.run("second", {}, {})).resolves.toEqual(ok(null));
});

it.each([null, "caller stopped", new Error("caller stopped")])(
  "retains the exact queued cancellation reason %j",
  async (reason) => {
    const controller = new AbortController();
    const execution = deferred<ExecutionResult>();
    const queue = new GhidraRequestQueue(
      () => execution.promise,
      failure,
      () => Promise.resolve(ok(null)),
    );
    const active = queue.run("active", {}, {});
    const queued = queue.run("queued", {}, { signal: controller.signal });
    controller.abort(reason);
    const result = await queued;
    execution.resolve(ok(null));
    await active;
    if (result.ok) throw new Error("Expected queued cancellation");
    expect(result.error.cancellation?.reason).toBe(reason);
  },
);

it.each([null, "caller stopped", new Error("caller stopped")])(
  "retains the exact pre-admission cancellation reason %j",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const execute = vi.fn(() => Promise.resolve(ok(null)));
    const queue = new GhidraRequestQueue(execute, failure, () =>
      Promise.resolve(ok(null)),
    );
    const result = await queue.run("active", {}, { signal: controller.signal });
    if (result.ok) throw new Error("Expected pre-admission cancellation");
    expect(result.error.cancellation?.reason).toBe(reason);
    expect(execute).not.toHaveBeenCalled();
  },
);

it.each(["return", "throw"] as const)(
  "captures cleanup rejection before execution can %s",
  async (stage) => {
    const execution = deferred<ExecutionResult>();
    const cleanup = deferred<CleanupResult>();
    const cause = new Error("early cleanup rejection");
    const original = failure("remote", "Observed operation failure");
    const controller = new AbortController();
    const queue = new GhidraRequestQueue(
      () => execution.promise,
      failure,
      () => cleanup.promise,
    );
    let settled = false;
    const pending = queue
      .run("active", {}, { signal: controller.signal })
      .then((result) => {
        settled = true;
        return result;
      });
    controller.abort(null);
    cleanup.reject(cause);
    await nextTurn();
    expect(settled).toBe(false);
    if (stage === "return") execution.resolve(err(original));
    else execution.reject(original);
    const result = await pending;
    if (result.ok) throw new Error("Expected operation and cleanup failure");
    expect(result.error.kind).toBe("remote");
    expect(result.error.cleanupFailure).toMatchObject({
      cleanupIncomplete: true,
      cause,
    });
  },
);

it("retains cleanup uncertainty when the cancellation cleanup callback throws synchronously", async () => {
  const execution = deferred<ExecutionResult>();
  const cause = new Error("synchronous cleanup rejection");
  const controller = new AbortController();
  const queue = new GhidraRequestQueue(
    () => execution.promise,
    failure,
    () => {
      throw cause;
    },
  );
  const pending = queue.run("active", {}, { signal: controller.signal });
  controller.abort(null);
  execution.resolve(ok(null));
  const result = await pending;
  if (result.ok) throw new Error("Expected unconfirmed cancellation cleanup");
  expect(result.error).toMatchObject({
    kind: "cancelled",
    cancellation: { reason: null },
    cleanupFailure: { cleanupIncomplete: true, cause },
  });
});

it.each([
  { order: "execution-first", execution: "returned" },
  { order: "cancellation-first", execution: "returned" },
  { order: "execution-first", execution: "rejected" },
  { order: "cancellation-first", execution: "rejected" },
])(
  "tracks both cleanup owners through $execution execution and $order retry",
  async ({ order, execution }) => {
    const executionCleanup = new ProviderCleanupError(
      "ghidra",
      ["execution-owner"],
      {},
    );
    const cancellationCleanup = new ProviderCleanupError(
      "ghidra",
      ["cancellation-owner"],
      {},
    );
    const primary = new GhidraSessionError(
      "remote",
      "Operation failed",
      {},
      { cleanupFailure: executionCleanup },
    );
    const controller = new AbortController();
    const queue = new GhidraRequestQueue(
      () =>
        execution === "returned"
          ? Promise.resolve(err(primary))
          : Promise.reject(primary),
      failure,
      () => Promise.resolve(err(cancellationCleanup)),
    );
    const pending = queue.run("active", {}, { signal: controller.signal });
    controller.abort(null);
    const result = await pending;
    if (result.ok || result.error.cleanupFailure === undefined)
      throw new Error("Expected both cleanup owners");
    const aggregate = result.error.cleanupFailure;
    expect(aggregate.cleanupIncomplete).toBe(true);
    const owners =
      order === "execution-first"
        ? [executionCleanup, cancellationCleanup]
        : [cancellationCleanup, executionCleanup];
    owners[0]?.resolveCleanup();
    expect(aggregate.cleanupIncomplete).toBe(true);
    owners[1]?.resolveCleanup();
    expect(aggregate.cleanupIncomplete).toBe(false);
  },
);
