import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { createDeferred } from "../../fixtures/binarySession.js";

import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProcessCaptureError } from "../../../src/process/capture/ProcessCaptureError.js";
import {
  ProcessCaptureResourceScope,
  resolveProcessResult,
  type ProcessCaptureCleanupHost,
  type ProcessCaptureResourceCleanupOptions,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";

const cleanupOptions = (
  temporaryRoot: string,
  removeTemporaryRoot: (path: string) => Promise<void>,
): ProcessCaptureResourceCleanupOptions => {
  const host: ProcessCaptureCleanupHost = {
    platform: process.platform,
    cleanupProcessGroup: async () => ({ cleaned: true, signaled: false }),
    removeTemporaryRoot,
  };
  return {
    timers: new Set(),
    terminal: undefined,
    renderer: undefined,
    runId: "cleanup-retry-boundary",
    temporaryRoot,
    host,
  };
};

const createRoot = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "rea-process-cleanup-retry-"));

const expectCaptureError = (operation: () => unknown): ProcessCaptureError => {
  try {
    operation();
  } catch (cause: unknown) {
    if (cause instanceof ProcessCaptureError) return cause;
    throw cause;
  }
  throw new Error("Expected process capture failure");
};

it("resolves the origin and finalization copy after the exact root retry", async () => {
  const scope = new ProcessCaptureResourceScope();
  const root = await createRoot();
  const primaryCause = new Error("capture failed before root cleanup");
  const primary = new ProcessCaptureError("capture failed", {
    cause: primaryCause,
    reason: "cleanup_incomplete",
    cleanup: {
      reason: "temporary root removal failed",
      resources: ["temporary_root"],
    },
  });
  let denyRemoval = true;
  const release = await scope.release(
    cleanupOptions(root, async (path) => {
      if (denyRemoval) throw new Error("controlled root removal denial");
      await rm(path, { recursive: true });
    }),
  );

  try {
    if (release.cleanupLease === undefined)
      throw new Error("Expected the failed root's exact cleanup lease");
    release.cleanupLease.bindCleanupError(primary);
    const reported = expectCaptureError(() =>
      resolveProcessResult(undefined, primary, release),
    );
    const historicalReport = reported.cleanupReport;
    expect(reported).not.toBe(primary);
    expect(primary.cleanupIncomplete).toBe(true);
    expect(reported.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(reported).code).toBe("cleanup_incomplete");
    expect(reported.cause).toBe(primaryCause);
    expect(historicalReport?.temporary_root).toEqual({
      state: "failed",
      reason: "controlled root removal denial",
    });

    denyRemoval = false;
    await scope.retryCleanup();
    await scope.close();

    expect(primary.cleanupIncomplete).toBe(false);
    expect(reported.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(reported).code).not.toBe("cleanup_incomplete");
    expect(reported.cause).toBe(primaryCause);
    expect(reported.cleanupReport).toBe(historicalReport);
    expect(reported.cleanupReport?.temporary_root).toEqual({
      state: "failed",
      reason: "controlled root removal denial",
    });
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    denyRemoval = false;
    await scope.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps mixed root errors and retry aggregates bound to only unresolved roots", async () => {
  const scope = new ProcessCaptureResourceScope();
  const roots = [await createRoot(), await createRoot()] as const;
  const denied = new Set(roots);
  const outcomes = new Map<string, Awaited<ReturnType<typeof scope.release>>>();

  try {
    for (const root of roots) {
      outcomes.set(
        root,
        await scope.release(
          cleanupOptions(root, async (path) => {
            if (denied.has(path))
              throw new Error(`controlled removal denial: ${path}`);
            await rm(path, { recursive: true });
          }),
        ),
      );
    }
    const firstOutcome = outcomes.get(roots[0]);
    const secondOutcome = outcomes.get(roots[1]);
    if (firstOutcome === undefined || secondOutcome === undefined)
      throw new Error("Expected both retained cleanup outcomes");
    const first = expectCaptureError(() =>
      resolveProcessResult(
        undefined,
        new ProcessCaptureError("first primary failure"),
        firstOutcome,
      ),
    );
    const second = expectCaptureError(() =>
      resolveProcessResult(
        undefined,
        new ProcessCaptureError("second primary failure"),
        secondOutcome,
      ),
    );
    expect(first.cleanupIncomplete).toBe(true);
    expect(second.cleanupIncomplete).toBe(true);

    const bothUnresolved: unknown = await scope
      .retryCleanup()
      .catch((cause: unknown) => cause);
    expect(bothUnresolved).toBeInstanceOf(ProcessCaptureError);
    if (!(bothUnresolved instanceof ProcessCaptureError))
      throw new Error("Expected both owners in a typed retry aggregate");
    expect(bothUnresolved.cleanupIncomplete).toBe(true);
    expect(bothUnresolved.cause).toBeInstanceOf(AggregateError);
    if (!(bothUnresolved.cause instanceof AggregateError))
      throw new Error("Expected retained child retry failures");
    expect(bothUnresolved.cause.errors).toHaveLength(2);

    denied.delete(roots[0]);
    const retryFailure: unknown = await scope
      .retryCleanup()
      .catch((cause: unknown) => cause);
    expect(retryFailure).toBeInstanceOf(ProcessCaptureError);
    if (!(retryFailure instanceof ProcessCaptureError))
      throw new Error("Expected a typed retry aggregate");
    expect(first.cleanupIncomplete).toBe(false);
    expect(second.cleanupIncomplete).toBe(true);
    expect(bothUnresolved.cleanupIncomplete).toBe(true);
    expect(retryFailure.cleanupIncomplete).toBe(true);
    expect(retryFailure.cleanupResources).toEqual([roots[1]]);

    denied.clear();
    await scope.retryCleanup();
    await scope.close();
    expect(second.cleanupIncomplete).toBe(false);
    expect(retryFailure.cleanupIncomplete).toBe(false);
    expect(bothUnresolved.cleanupIncomplete).toBe(false);
    expect(first.cleanupReport?.temporary_root.state).toBe("failed");
    expect(second.cleanupReport?.temporary_root.state).toBe("failed");
    for (const root of roots)
      await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    denied.clear();
    await scope.close();
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true })),
    );
  }
});

it("joins an already-started release when shutdown begins", async () => {
  const scope = new ProcessCaptureResourceScope();
  const root = await createRoot();
  const entered = createDeferred<void>();
  const unblock = createDeferred<void>();
  let attempts = 0;
  const releasing = scope.release(
    cleanupOptions(root, async (path) => {
      attempts += 1;
      entered.resolve();
      await unblock.promise;
      await rm(path, { recursive: true });
    }),
  );
  await entered.promise;
  let closed = false;
  const closing = scope.close().then(() => {
    closed = true;
  });
  try {
    await setImmediate();
    expect(closed).toBe(false);
    await expect(stat(root)).resolves.toBeDefined();
  } finally {
    unblock.resolve();
    await Promise.all([releasing, closing]);
    await rm(root, { recursive: true, force: true });
  }
  expect(attempts).toBe(1);
  expect(closed).toBe(true);
  await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("binds a historical failed report after its owner already retried", async () => {
  const scope = new ProcessCaptureResourceScope();
  const root = await createRoot();
  let denyRemoval = true;
  const release = await scope.release(
    cleanupOptions(root, async (path) => {
      if (denyRemoval) throw new Error("controlled root removal denial");
      await rm(path, { recursive: true });
    }),
  );

  try {
    denyRemoval = false;
    await scope.retryCleanup();
    await scope.close();

    const reported = expectCaptureError(() =>
      resolveProcessResult(
        undefined,
        new ProcessCaptureError("primary failure after release"),
        release,
      ),
    );
    expect(reported.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(reported).code).not.toBe("cleanup_incomplete");
    expect(reported.cleanupReport?.temporary_root).toMatchObject({
      state: "failed",
    });
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    denyRemoval = false;
    await scope.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("blocks scope admission on owner-bound retry failure and resumes after release", async () => {
  const scope = new ProcessCaptureResourceScope();
  const root = await createRoot();
  let denyRemoval = true;
  const release = await scope.release(
    cleanupOptions(root, async (path) => {
      if (denyRemoval) throw new Error("controlled root removal denial");
      await rm(path, { recursive: true });
    }),
  );
  const origin = expectCaptureError(() =>
    resolveProcessResult(
      undefined,
      new ProcessCaptureError("primary failure"),
      release,
    ),
  );

  try {
    let admitted = false;
    const retryFailure: unknown = await scope
      .run(async () => {
        admitted = true;
      })
      .catch((cause: unknown) => cause);
    expect(admitted).toBe(false);
    expect(retryFailure).toBeInstanceOf(ProcessCaptureError);
    if (!(retryFailure instanceof ProcessCaptureError))
      throw new Error("Expected a typed owner-bound retry failure");
    expect(retryFailure.cleanupIncomplete).toBe(true);
    expect(retryFailure.cleanupResources).toEqual([root]);
    expect(origin.cleanupIncomplete).toBe(true);

    denyRemoval = false;
    await expect(
      scope.run(async () => {
        admitted = true;
        return "admitted after cleanup";
      }),
    ).resolves.toBe("admitted after cleanup");
    await scope.close();
    expect(admitted).toBe(true);
    expect(origin.cleanupIncomplete).toBe(false);
    expect(retryFailure.cleanupIncomplete).toBe(false);
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    denyRemoval = false;
    await scope.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps historical report edits separate from cleanup authority", async () => {
  const scope = new ProcessCaptureResourceScope();
  const root = await createRoot();
  let denied = true;
  let attempts = 0;
  try {
    const outcome = await scope.release(
      cleanupOptions(root, async (path) => {
        attempts += 1;
        if (denied) throw new Error("controlled root removal denial");
        await rm(path, { recursive: true });
      }),
    );
    Reflect.set(outcome.report.temporary_root, "state", "cleaned");
    await expect(scope.retryCleanup()).rejects.toBeInstanceOf(
      ProcessCaptureError,
    );
    expect(attempts).toBe(2);
    expect(outcome.cleanupLease?.released).toBe(false);
    await expect(stat(root)).resolves.toBeDefined();
    denied = false;
    await scope.close();
    expect(attempts).toBe(3);
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    denied = false;
    await scope.close();
    await rm(root, { recursive: true, force: true });
  }
});
