import { access } from "node:fs/promises";
import { expect, it, onTestFinished } from "vitest";
import { SqliteDatabaseProvider } from "../../../src/sqlite/SqliteDatabaseProvider.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { OwnedCommandFailure } from "../../../src/process/OwnedCommand.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  spawnProviderProcessFixture,
  stopProviderProcessFixture,
  waitForProviderProcessReady,
} from "../../fixtures/providerProcess.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { createSqliteDatabaseFixture } from "../../fixtures/sqlite/database.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const createUnavailableProvider = (
  createRuntime: SqliteDatabaseProvider["createRuntime"],
) =>
  new SqliteDatabaseProvider(
    {},
    () => {
      throw new Error("SQLite worker deliberately unavailable");
    },
    createRuntime,
  );

const cleanupFixture = async () => {
  const workspace = await createTestWorkspace("rea-sqlite-cleanup-");
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  const roots: PrivateRuntimeRoot[] = [];
  let removalAllowed = false;
  let attempts = 0;
  const provider = createUnavailableProvider(async () => {
    const root = await PrivateRuntimeRoot.create({ parent: workspace.root });
    roots.push(root);
    return {
      path: root.path,
      close: async () => {
        attempts += 1;
        if (!removalAllowed) throw new Error("snapshot removal denied");
        await root.close();
      },
    };
  });
  onTestFinished(async () => {
    await Promise.all(roots.map((root) => root.close()));
    await removeTestWorkspace(workspace.root);
  });
  return {
    provider,
    roots,
    path: database.path,
    allowRemoval: () => {
      removalAllowed = true;
    },
    attempts: () => attempts,
  };
};

it("retains failed snapshot owners and blocks new acquisition until retry succeeds", async () => {
  const fixture = await cleanupFixture();
  const first = await fixture.provider.inspect({ path: fixture.path });
  if (first.ok) throw new Error("Expected retained snapshot cleanup");
  expect(first).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  const root = fixture.roots[0];
  if (root === undefined) throw new Error("Missing owned root");
  await expect(access(root.path)).resolves.toBeUndefined();
  const second = await fixture.provider.inspect({ path: fixture.path });
  expect(second).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(fixture.roots).toHaveLength(1);
  expect(fixture.attempts()).toBe(2);
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(first.error.cleanupResources).toEqual([root.path]);
  fixture.allowRemoval();
  await fixture.provider.inspect({ path: fixture.path });
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(first.error.cleanupResources).toEqual([]);
  expect(fixture.roots).toHaveLength(2);
  await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  await fixture.provider.close();
});

it("shrinks inspect and close errors as each retained root is released", async () => {
  const workspace = await createTestWorkspace(
    "rea-sqlite-multiple-root-cleanup-",
  );
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  const roots: Array<{
    readonly root: PrivateRuntimeRoot;
    allowed: boolean;
    attempts: number;
  }> = [];
  const provider = createUnavailableProvider(async () => {
    const root = await PrivateRuntimeRoot.create({ parent: workspace.root });
    const owner = { root, allowed: false, attempts: 0 };
    roots.push(owner);
    return {
      path: root.path,
      close: async () => {
        owner.attempts += 1;
        if (!owner.allowed) throw new Error("SQLite root removal denied");
        await root.close();
      },
    };
  });
  onTestFinished(async () => {
    for (const owner of roots) owner.allowed = true;
    await provider.close();
    await Promise.all(roots.map(({ root }) => root.close()));
    await removeTestWorkspace(workspace.root);
  });

  const outcomes = await Promise.all([
    provider.inspect({ path: database.path }),
    provider.inspect({ path: database.path }),
  ]);
  const inspectionErrors = outcomes.map((outcome) => {
    if (outcome.ok) throw new Error("Expected retained root cleanup");
    expect(outcome.error.cleanupIncomplete).toBe(true);
    return outcome.error;
  });
  expect(roots).toHaveLength(2);
  for (const error of inspectionErrors)
    expect(error.cleanupResources).toHaveLength(1);
  expect(
    new Set(inspectionErrors.flatMap((error) => error.cleanupResources)),
  ).toEqual(new Set(roots.map(({ root }) => root.path)));
  const firstOwner = roots[0];
  const secondOwner = roots[1];
  if (firstOwner === undefined || secondOwner === undefined)
    throw new Error("Missing retained runtime root");
  const firstError = inspectionErrors.find((error) =>
    error.cleanupResources.includes(firstOwner.root.path),
  );
  const secondError = inspectionErrors.find((error) =>
    error.cleanupResources.includes(secondOwner.root.path),
  );
  if (firstError === undefined || secondError === undefined)
    throw new Error("Missing cleanup error for its retained runtime root");

  const initialCloseFailure = await provider.close().then(
    () => {
      throw new Error("Expected both roots to remain owned");
    },
    (cause: unknown) => cause,
  );
  if (!(initialCloseFailure instanceof ProviderCleanupError))
    throw new Error("Expected aggregate provider cleanup failure");
  expect(initialCloseFailure.cleanupResources).toHaveLength(2);
  expect(new Set(initialCloseFailure.cleanupResources)).toEqual(
    new Set(roots.map(({ root }) => root.path)),
  );

  firstOwner.allowed = true;
  const secondCloseFailure = await provider.close().then(
    () => {
      throw new Error("Expected the second root to remain owned");
    },
    (cause: unknown) => cause,
  );
  expect(secondCloseFailure).toMatchObject({
    cleanupIncomplete: true,
    cleanupResources: [secondOwner.root.path],
  });
  expect(firstError.cleanupIncomplete).toBe(false);
  expect(firstError.cleanupResources).toEqual([]);
  expect(secondError.cleanupResources).toEqual([secondOwner.root.path]);
  expect(initialCloseFailure.cleanupIncomplete).toBe(true);
  expect(initialCloseFailure.cleanupResources).toEqual([secondOwner.root.path]);
  await expect(access(firstOwner.root.path)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(secondOwner.root.path)).resolves.toBeUndefined();

  secondOwner.allowed = true;
  await provider.close();
  expect(inspectionErrors.every((error) => !error.cleanupIncomplete)).toBe(
    true,
  );
  expect(
    inspectionErrors.every((error) => error.cleanupResources.length === 0),
  ).toBe(true);
  expect(initialCloseFailure.cleanupIncomplete).toBe(false);
  expect(initialCloseFailure.cleanupResources).toEqual([]);
  await expect(access(secondOwner.root.path)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("preserves the caller reason when cancellation arrives during awaited cleanup retry", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-retry-cancel-");
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  const retryStarted = createDeferred<void>();
  const releaseRetry = createDeferred<void>();
  let closeAttempts = 0;
  const provider = new SqliteDatabaseProvider(
    {},
    () => {
      throw new Error("SQLite worker deliberately unavailable");
    },
    async () => {
      const root = await PrivateRuntimeRoot.create({ parent: workspace.root });
      return {
        path: root.path,
        close: async () => {
          closeAttempts += 1;
          if (closeAttempts === 1)
            throw new Error("snapshot removal denied once");
          if (closeAttempts === 2) {
            retryStarted.resolve();
            await releaseRetry.promise;
          }
          await root.close();
        },
      };
    },
  );
  onTestFinished(async () => {
    releaseRetry.resolve();
    await provider.close();
    await removeTestWorkspace(workspace.root);
  });

  const first = await provider.inspect({ path: database.path });
  expect(first).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });

  const controller = new AbortController();
  const reason = { requested: "cancel after retry cleanup" };
  const inspection = provider.inspect(
    { path: database.path },
    { signal: controller.signal },
  );
  await retryStarted.promise;
  controller.abort(reason);
  releaseRetry.resolve();
  const result = await inspection;
  if (result.ok || result.error._tag !== "AnalysisCancelledError")
    throw new Error("Expected cancellation after cleanup retry");
  expect(result.error.cause).toBe(reason);
  expect(closeAttempts).toBe(2);
});

it("awaits shared shutdown cleanup and retains failures for a later close", async () => {
  const fixture = await cleanupFixture();
  await fixture.provider.inspect({ path: fixture.path });
  const closed = await Promise.allSettled([
    fixture.provider.close(),
    fixture.provider.close(),
  ]);
  expect(closed.map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(fixture.attempts()).toBe(2);
  expect(await fixture.provider.inspect({ path: fixture.path })).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  fixture.allowRemoval();
  await fixture.provider.close();
  await fixture.provider.close();
  expect(fixture.attempts()).toBe(3);
  for (const root of fixture.roots)
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("waits for concurrent acquisitions and releases only owners whose cleanup succeeds", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-concurrent-cleanup-");
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  const acquired = createDeferred<void>();
  const release = createDeferred<void>();
  const roots: PrivateRuntimeRoot[] = [];
  const allowed = new Set<PrivateRuntimeRoot>();
  const provider = createUnavailableProvider(async () => {
    const root = await PrivateRuntimeRoot.create({ parent: workspace.root });
    roots.push(root);
    if (roots.length === 2) acquired.resolve();
    await release.promise;
    return {
      path: root.path,
      close: async () => {
        if (!allowed.has(root)) throw new Error("snapshot removal denied");
        await root.close();
      },
    };
  });
  onTestFinished(async () => {
    release.resolve();
    roots.forEach((root) => allowed.add(root));
    await provider.close();
    await removeTestWorkspace(workspace.root);
  });
  const inspections = [
    provider.inspect({ path: database.path }),
    provider.inspect({ path: database.path }),
  ];
  await acquired.promise;
  // Two admitted snapshots occupy capacity even before the worker launches.
  expect(await provider.inspect({ path: database.path })).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError", resource: "capacity" },
  });
  expect(roots).toHaveLength(2);
  expect(
    await provider.inspect(
      { path: database.path },
      { signal: AbortSignal.abort() },
    ),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  let settled = false;
  const closing = provider.close().finally(() => {
    settled = true;
  });
  const rejected = expect(closing).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  release.resolve();
  await Promise.all(inspections);
  await rejected;
  const [first, second] = roots;
  if (first === undefined || second === undefined)
    throw new Error("Missing owned roots");
  allowed.add(first);
  await expect(provider.close()).rejects.toMatchObject({
    cleanupResources: [second.path],
  });
  await expect(access(first.path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(second.path)).resolves.toBeUndefined();
  allowed.add(second);
  await provider.close();
  await expect(access(second.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains the snapshot until a failed worker cleanup owner can be stopped", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-worker-cleanup-");
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  const child = spawnProviderProcessFixture("graceful");
  let workerRemovalAllowed = false;
  let rootRemovalAllowed = false;
  let workerAttempts = 0;
  let rootAttempts = 0;
  const roots: PrivateRuntimeRoot[] = [];
  const supervisor = new ProviderProcessSupervisor({
    process: child,
    ownsProcessLifetime: true,
    cleanup: async () => {
      workerAttempts += 1;
      if (!workerRemovalAllowed)
        return { cleaned: false, reason: "SQLite worker cleanup denied" };
      await stopProviderProcessFixture(child);
      return { cleaned: true, signaled: true };
    },
  });
  const provider = new SqliteDatabaseProvider(
    {},
    async (spawn) => {
      const stopped = await supervisor.stop();
      if (stopped.status !== "incomplete")
        throw new Error("Expected retained worker");
      throw new OwnedCommandFailure(
        "process",
        "SQLite worker cleanup failed",
        supervisor.snapshot(),
        stopped.reason,
        undefined,
        [spawn.runId, spawn.cwd ?? ""],
        supervisor,
      );
    },
    async () => {
      const root = await PrivateRuntimeRoot.create({ parent: workspace.root });
      roots.push(root);
      return {
        path: root.path,
        close: async () => {
          rootAttempts += 1;
          if (!rootRemovalAllowed)
            throw new Error("SQLite snapshot removal denied");
          await root.close();
        },
      };
    },
  );
  onTestFinished(async () => {
    workerRemovalAllowed = true;
    rootRemovalAllowed = true;
    await supervisor.stop();
    await provider.close();
    await Promise.all(roots.map((root) => root.close()));
    await removeTestWorkspace(workspace.root);
  });
  await waitForProviderProcessReady(child);
  const original = await provider.inspect({ path: database.path });
  expect(original).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  if (original.ok) throw new Error("Expected unresolved worker cleanup");
  // The snapshot cannot be removed while its worker may still use it.
  expect(rootAttempts).toBe(0);
  const root = roots[0];
  if (root === undefined) throw new Error("Missing retained snapshot");
  expect(original.error.cleanupResources).toEqual([
    "owned-sqlite-worker",
    root.path,
  ]);
  await expect(access(root.path)).resolves.toBeUndefined();
  expect(await provider.inspect({ path: database.path })).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(roots).toHaveLength(1);
  expect(workerAttempts).toBe(2);
  const workerCloseFailure = await provider.close().then(
    () => {
      throw new Error("Expected worker cleanup failure");
    },
    (cause: unknown) => cause,
  );
  if (!(workerCloseFailure instanceof ProviderCleanupError))
    throw new Error("Expected provider cleanup failure");
  expect(workerCloseFailure.cleanupIncomplete).toBe(true);
  expect(rootAttempts).toBe(0);
  workerRemovalAllowed = true;
  await expect(provider.close()).rejects.toMatchObject({
    cleanupResources: [root.path],
  });
  expect(original.error.cleanupIncomplete).toBe(true);
  expect(original.error.cleanupResources).toEqual([root.path]);
  expect(workerCloseFailure.cleanupIncomplete).toBe(true);
  expect(workerCloseFailure.cleanupResources).toEqual([root.path]);
  expect(child.signalCode).toBe("SIGKILL");
  expect(workerAttempts).toBe(4);
  expect(rootAttempts).toBe(1);
  rootRemovalAllowed = true;
  await provider.close();
  expect(original.error.cleanupIncomplete).toBe(false);
  expect(original.error.cleanupResources).toEqual([]);
  expect(workerCloseFailure.cleanupIncomplete).toBe(false);
  expect(workerCloseFailure.cleanupResources).toEqual([]);
  expect(workerAttempts).toBe(4);
  await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps a retained worker owner when the worker fails and its cleanup is unresolved", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-retained-worker-");
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  let mayClean = false;
  let launches = 0;
  // runOwnedCommand retains the incomplete cleanup and then rethrows the
  // worker failure without an owner of its own.
  const provider = new SqliteDatabaseProvider({}, async (spawn) => {
    launches += 1;
    const launched = await spawnOwnedProviderProcess({
      ...spawn,
      command: process.execPath,
      arguments: ["-e", "process.exit(3)"],
    });
    const cleanupOwned =
      launched.cleanup ?? (() => cleanupOwnedProcessGroup(launched.ownership));
    return {
      ...launched,
      cleanup: async () => {
        const cleaned = await cleanupOwned();
        if (!mayClean) throw new Error("injected retained cleanup failure");
        return cleaned;
      },
    };
  });
  onTestFinished(async () => {
    mayClean = true;
    await provider.close();
    await removeTestWorkspace(workspace.root);
  });
  expect(await provider.inspect({ path: database.path })).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  // The retained owner blocks a new worker until its cleanup succeeds.
  expect(await provider.inspect({ path: database.path })).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(launches).toBe(1);
  mayClean = true;
  await provider.close();
});
