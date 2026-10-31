import { expect, it } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../../tests/fixtures/lifecycleAcknowledgement.js";
import { DeferredAnalysisClient } from "../../providers/DeferredAnalysisClient.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
} from "../AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { resolvedAnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok } from "../../domain/result.js";

const identity = { id: "controlled", name: "Controlled client", version: "1" };

it.each([
  new AnalysisAccessDeniedError(
    "ghidra:installation",
    "/selected/properties",
    "EACCES",
  ),
  new AnalysisArtifactChangedError(
    "ghidra:installation",
    "/selected/properties",
    "selected name changed",
  ),
  new AnalysisResourceConstraintError(
    "ghidra:installation",
    "file-size",
    "metadata budget",
    { maximum_bytes: 1024 },
    { retryable: false },
  ),
])(
  "attributes prerequisite $_tag to the requested operation without changing its facts",
  async (physical) => {
    const client = new DeferredAnalysisClient(async () => {
      throw physical;
    }, identity.id);
    try {
      const result = await client.execute("analyze_function", {});
      if (result.ok) throw new Error("Expected prerequisite failure");
      expect(result.error).toMatchObject({
        _tag: physical._tag,
        operation: "analyze_function",
      });
      expect(result.error.cause).toBe(physical);
      if (physical instanceof AnalysisResourceConstraintError)
        expect(result.error).toMatchObject({
          resource: "file-size",
          reportedLimits: { maximum_bytes: 1024 },
          retryable: false,
        });
      else expect(result.error).toMatchObject({ path: "/selected/properties" });
    } finally {
      await client.close();
    }
  },
);
const gate = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};
const child = (
  close: AnalysisClient["close"] = async () => ok(null),
): AnalysisClient => ({
  execute: async () => ok(createAnalysisExecution(null, identity)),
  close,
  operationHealthSnapshot: () => ({
    state: "idle",
    stage: null,
    retryAction: null,
    exitCode: null,
    requests: [],
  }),
});

it("refuses dispatch when close starts after a ready client was acquired", async () => {
  let operations = 0;
  const acquired: AnalysisClient = {
    ...child(),
    execute: async () => {
      operations++;
      return ok(createAnalysisExecution(null, identity));
    },
  };
  const client = new DeferredAnalysisClient(async () => acquired, identity.id);
  expect((await client.execute("health", {})).ok).toBe(true);
  const pending = client.execute("analyze_function", {});
  const closing = client.close();
  try {
    expect(await pending).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        operation: "analyze_function",
        diagnostics: { reason: "client_closed" },
      },
    });
    expect(operations).toBe(1);
    expect(
      await client.executeIfReady?.("analyze_function", {}),
    ).toBeUndefined();
    expect(await closing).toEqual(ok(null));
  } finally {
    await pending;
    await closing;
    await client.close();
  }
});

it.each([
  null,
  "caller reason",
  new ProviderCleanupError("foreign", ["foreign resource"], {
    reason: "caller metadata",
  }),
])(
  "does not acquire or adopt resources for pre-aborted opaque reasons (%s)",
  async (reason) => {
    let creates = 0;
    const controller = new AbortController();
    controller.abort(reason);
    const client = new DeferredAnalysisClient(async () => {
      creates++;
      return child();
    }, identity.id);
    const result = await client.execute(
      "health",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(creates).toBe(0);
    expect(await client.close()).toEqual(ok(null));
  },
);

it("keeps a shared creation alive for an interested peer", async () => {
  const entered = gate(),
    loading = gate<AnalysisClient>();
  let observed: AbortSignal | undefined,
    creates = 0,
    closes = 0;
  const client = new DeferredAnalysisClient(async (signal) => {
    creates++;
    observed = signal;
    entered.resolve();
    return loading.promise;
  }, identity.id);
  const controller = new AbortController(),
    reason = { request: "one peer leaves" };
  const first = client.execute("health", {}, { signal: controller.signal });
  const second = client.execute("health", {});
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      entered.promise,
      first,
      "shared client creation",
    );
    controller.abort(reason);
    const cancelled = await first;
    if (cancelled.ok) throw new Error("Expected peer cancellation");
    expect(cancelled.error.cause).toBe(reason);
    expect(observed?.aborted).toBe(false);
    loading.resolve(
      child(async () => {
        closes++;
        return ok(null);
      }),
    );
    expect((await second).ok).toBe(true);
    expect(creates).toBe(1);
    expect(await client.close()).toEqual(ok(null));
    expect(closes).toBe(1);
  }, [
    () => controller.abort(),
    () => loading.resolve(child()),
    async () => {
      await Promise.allSettled([first, second]);
    },
    async () => {
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    },
  ]);
});

it("joins a late acquired client's final cleanup before cancellation settles", async () => {
  const entered = gate(),
    loading = gate<AnalysisClient>(),
    closeEntered = gate(),
    closing = gate();
  let closes = 0,
    settled = false;
  const client = new DeferredAnalysisClient(async () => {
    entered.resolve();
    return loading.promise;
  }, identity.id);
  const controller = new AbortController(),
    reason = { request: "late acquisition" };
  const pending = client
    .execute("analyze_function", {}, { signal: controller.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered.promise, pending, "client creation");
    controller.abort(reason);
    loading.resolve(
      child(async () => {
        closes++;
        closeEntered.resolve();
        await closing.promise;
        return ok(null);
      }),
    );
    await awaitAcknowledgement(closeEntered.promise, pending, "client cleanup");
    expect(settled).toBe(false);
    expect(client.operationHealthSnapshot()?.state).toBe("idle");
    expect(client.reuseReadiness()).toBe("blocked");
    closing.resolve();
    const result = await pending;
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(await client.close()).toEqual(ok(null));
    expect(closes).toBe(1);
  }, [
    () => controller.abort(),
    () => loading.resolve(child()),
    () => closing.resolve(),
    async () => {
      await pending;
    },
    async () => {
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    },
  ]);
});

it("keeps a producer-authored physical failure primary even when it is the caller's abort reason", async () => {
  const entered = gate(),
    finishing = gate();
  const physical = new ProviderAdapterError(
    identity.id,
    "create_analysis_client",
    { diagnostics: { reason: "physical fixture fault" } },
  );
  const client = new DeferredAnalysisClient(async () => {
    entered.resolve();
    await finishing.promise;
    throw physical;
  }, identity.id);
  const controller = new AbortController();
  const pending = client.execute(
    "analyze_function",
    {},
    { signal: controller.signal },
  );
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered.promise, pending, "client creation");
    controller.abort(physical);
    finishing.resolve();
    const result = await pending;
    if (result.ok) throw new Error("Expected physical failure");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      operation: "analyze_function",
      diagnostics: {
        reason: "physical fixture fault",
      },
    });
    expect(result.error.cause).toBe(physical);
    expect(physical.cause).toBeUndefined();
    expect(projectAnalysisError(result.error).code).toBe("execution_failure");
  }, [
    () => controller.abort(),
    () => finishing.resolve(),
    async () => {
      await pending;
    },
    async () => {
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    },
  ]);
});

it("retains a failed late client's exact close owner and restores cancellation after confirmed retry", async () => {
  let denied = true,
    closes = 0;
  const controller = new AbortController(),
    reason = { request: "late cleanup refusal" };
  const client = new DeferredAnalysisClient(async () => {
    controller.abort(reason);
    return child(async () => {
      closes++;
      return denied
        ? err(
            new ProviderCleanupError(identity.id, ["controlled child"], {
              reason: "controlled close refusal",
            }),
          )
        : ok(null);
    });
  }, identity.id);
  const result = await client.execute(
    "analyze_function",
    {},
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Expected cancellation with cleanup");
  try {
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual(["controlled child"]);
    expect(client.reuseReadiness()).toBe("blocked");
    const firstClose = await client.close();
    if (firstClose.ok) throw new Error("Expected retained close failure");
    expect(firstClose.error.cleanupIncomplete).toBe(true);
    expect(closes).toBe(2);
    denied = false;
    expect(await client.close()).toEqual(ok(null));
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(firstClose.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
    expect(resolvedAnalysisError(result.error).cause).toBe(reason);
    expect(await client.close()).toEqual(ok(null));
    expect(closes).toBe(3);
  } finally {
    denied = false;
    await client.close();
  }
});

it("retains a failed prerequisite owner without creating a native client", async () => {
  let denied = true,
    releases = 0;
  const cleanup = new ProviderCleanupError(
    identity.id,
    ["controlled prerequisite"],
    { reason: "controlled refusal" },
  );
  const reason = { request: "prerequisite finalization" };
  const client = new DeferredAnalysisClient(async (_signal, resources) => {
    resources.retain(
      {
        close: async () => {
          releases++;
          if (denied) throw cleanup;
          cleanup.resolveCleanup();
        },
      },
      "controlled prerequisite",
    );
    throw new AnalysisCancelledError("create_analysis_client", {
      cause: reason,
      cleanup: {
        reason: "controlled refusal",
        resources: cleanup.cleanupResources,
      },
    }).bindCleanupDependencies([cleanup]);
  }, identity.id);
  const result = await client.execute("analyze_function", {});
  if (result.ok) throw new Error("Expected prerequisite failure");
  try {
    expect(result.error.cleanupIncomplete).toBe(true);
    expect((await client.close()).ok).toBe(false);
    denied = false;
    expect(await client.close()).toEqual(ok(null));
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
    expect(resolvedAnalysisError(result.error).cause).toBe(reason);
    expect(releases).toBe(3);
  } finally {
    denied = false;
    await client.close();
  }
});

it("retries only unresolved prerequisite and native owners across mixed cleanup outcomes", async () => {
  let denyPrerequisite = true,
    denyChild = true,
    prerequisites = 0,
    closes = 0;
  const prerequisiteFailure = new ProviderCleanupError(
    identity.id,
    ["mixed prerequisite"],
    { reason: "controlled prerequisite refusal" },
  );
  const client = new DeferredAnalysisClient(async (_signal, resources) => {
    resources.retain(
      {
        close: async () => {
          prerequisites++;
          if (denyPrerequisite) throw prerequisiteFailure;
          prerequisiteFailure.resolveCleanup();
        },
      },
      "mixed prerequisite",
    );
    return child(async () => {
      closes++;
      return denyChild
        ? err(
            new ProviderCleanupError(identity.id, ["mixed child"], {
              reason: "controlled child refusal",
            }),
          )
        : ok(null);
    });
  }, identity.id);
  const result = await client.execute("analyze_function", {});
  if (result.ok)
    throw new Error("Expected mixed initialization cleanup failure");
  try {
    expect(result.error.cleanupResources).toEqual(
      expect.arrayContaining(["mixed prerequisite", "mixed child"]),
    );
    expect(client.reuseReadiness()).toBe("blocked");
    denyPrerequisite = false;
    const first = await client.close();
    expect(first.ok).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual(["mixed child"]);
    expect(prerequisites).toBe(2);
    denyChild = false;
    expect(await client.close()).toEqual(ok(null));
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(prerequisites).toBe(2);
    expect(closes).toBe(3);
  } finally {
    denyPrerequisite = false;
    denyChild = false;
    await client.close();
  }
});
