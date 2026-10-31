import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../../../src/artifacts/AnalysisCleanupLease.js";
import type { AnalysisClient } from "../../../src/application/AnalysisProvider.js";
import { HopperStartError } from "../../../src/domain/hopperErrors.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import {
  createBinarySessionTargets,
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const retryFixture = async (
  execute: AnalysisClient["execute"] = () => Promise.resolve(ok(null)),
  onClose?: () => void,
) => {
  const parent = await createTestTempDirectory("rea-session-cleanup-retry-");
  const runtime = join(parent, "owned-runtime");
  const document = join(parent, "retained-document");
  await mkdir(runtime);
  await writeFile(join(runtime, "observation"), "owned observation");
  await writeFile(document, "caller-retained document");
  const targets = await createBinarySessionTargets();
  let allowed = false;
  let created = 0;
  const runIds: string[] = [];
  const cleanupError = new ProviderCleanupError("fixture", [runtime], {
    reason: "owned runtime removal denied",
    leftover_paths: [runtime],
  });
  const cleanupLease = new AnalysisCleanupLease(
    () => rm(runtime, { recursive: true, force: true }),
    [runtime],
  );
  new AnalysisCleanupLeaseGroup(cleanupError, [cleanupLease]);
  const client: AnalysisClient = {
    execute,
    operationHealthSnapshot: () => ({
      state: "unreachable",
      stage: "connection",
      retryAction: "restart_provider",
      exitCode: null,
      requests: [],
    }),
    close: async (options) => {
      onClose?.();
      if (!allowed) return err(cleanupError);
      await cleanupLease.release();
      if (options?.retainDocument !== true) await rm(document, { force: true });
      return resultOk(null);
    },
  };
  const session = createTestBinarySession((_target, _profile, context) => {
    if (context === undefined) throw new Error("missing analysis run context");
    runIds.push(context.runId);
    created += 1;
    return created === 1
      ? {
          ...client,
          runtimeLineageSnapshots: () => [
            {
              provider: {
                id: "fixture",
                name: "Fixture analysis provider",
                version: "1",
              },
              observation: {
                status: "unavailable" as const,
                observedAt: "2026-10-16T00:00:00Z",
                runId: context.runId,
                launcherPid: 123,
                processGroupId: 123,
                reason: "fixture lineage unavailable",
              },
            },
          ],
        }
      : {
          execute: () => Promise.resolve(ok(null)),
          close: () => Promise.resolve(resultOk(null)),
        };
  });
  onTestFinished(async () => {
    allowed = true;
    await session.close();
  });
  return {
    session,
    targets,
    runtime,
    document,
    cleanupError,
    runIds,
    allowCleanup: () => {
      allowed = true;
    },
    created: () => created,
  };
};

it.each(["close", "switch", "open after close"] as const)(
  "retries owned cleanup before completing %s",
  async (transition) => {
    const fixture = await retryFixture();
    const {
      session,
      targets: [first, second],
      runtime,
      cleanupError,
    } = fixture;
    expect((await session.open(first)).ok).toBe(true);
    const attempt = () =>
      transition === "close" ? session.close() : session.open(second);
    const initial =
      transition === "switch" ? await attempt() : await session.close();
    expect(initial).toEqual(err(cleanupError));
    expect(session.activeTarget()).toBeUndefined();
    expect(await session.status()).toMatchObject({
      open: false,
      cleanup_pending: true,
      analysis_run: {
        run_id: fixture.runIds[0],
        process_lineage: {
          status: "snapshots",
          snapshots: [
            { observation: { reason: "fixture lineage unavailable" } },
          ],
        },
      },
      provider_operation_health: { state: "unreachable", stage: "connection" },
    });
    expect(await session.execute("address_name", {})).toMatchObject({
      ok: false,
    });
    await access(runtime);

    expect(await attempt()).toEqual(err(cleanupError));
    expect(await session.status()).toMatchObject({
      analysis_run: { run_id: fixture.runIds[0] },
    });
    expect(fixture.created()).toBe(1);
    await access(runtime);

    fixture.allowCleanup();
    expect((await attempt()).ok).toBe(true);
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
    await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.created()).toBe(transition === "close" ? 1 : 2);
    expect(await session.status()).toMatchObject({
      analysis_run:
        transition === "close"
          ? null
          : {
              run_id: fixture.runIds[1],
              process_lineage: { status: "not_observed" },
            },
    });
    expect(new Set(fixture.runIds).size).toBe(fixture.created());
  },
);

it("keeps a failed candidate for cleanup and preserves its startup failure", async () => {
  const primary = new HopperStartError();
  const fixture = await retryFixture(() => Promise.resolve(err(primary)));
  const result = await fixture.session.open(fixture.targets[0]);
  expect(result).toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      cleanupResources: [fixture.runtime],
      diagnostics: {
        primary_error: projectAnalysisError(primary),
        cleanup_error: projectAnalysisError(fixture.cleanupError),
      },
    },
  });
  expect(fixture.session.activeTarget()).toBeUndefined();
  expect(await fixture.session.status()).toMatchObject({
    open: false,
    cleanup_pending: true,
    analysis_run: {
      run_id: fixture.runIds[0],
      process_lineage: { status: "snapshots" },
    },
  });
  fixture.allowCleanup();
  expect((await fixture.session.close()).ok).toBe(true);
  await expect(access(fixture.runtime)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("retains cancelled startup cleanup and the cancellation reason", async () => {
  const controller = new AbortController();
  const fixture = await retryFixture(() => {
    controller.abort();
    return Promise.resolve(ok(null));
  });
  expect(
    await fixture.session.open(fixture.targets[0], {
      signal: controller.signal,
    }),
  ).toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      cleanupResources: [fixture.runtime],
      diagnostics: { primary_error: { code: "cancelled" } },
    },
  });
  expect(await fixture.session.status()).toMatchObject({
    open: false,
    cleanup_pending: true,
    analysis_run: {
      run_id: fixture.runIds[0],
      process_lineage: { status: "snapshots" },
    },
  });
  fixture.allowCleanup();
  expect((await fixture.session.close()).ok).toBe(true);
  await expect(access(fixture.runtime)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps cancellation as the primary when previous-client retirement fails after abort", async () => {
  const controller = new AbortController();
  const reason = { phase: "binary-retirement" };
  const fixture = await retryFixture(undefined, () => controller.abort(reason));
  expect((await fixture.session.open(fixture.targets[0])).ok).toBe(true);
  const result = await fixture.session.open(fixture.targets[1], {
    signal: controller.signal,
  });
  if (result.ok) throw new Error("Expected cancelled retirement");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupPrimary).toMatchObject({
    _tag: "AnalysisCancelledError",
  });
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
  expect(await fixture.session.status()).toMatchObject({
    open: false,
    cleanup_pending: true,
  });
  fixture.allowCleanup();
  expect((await fixture.session.close()).ok).toBe(true);
  expect(fixture.cleanupError.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
  });
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
});

it("preserves caller-selected document retention when retrying cleanup", async () => {
  const fixture = await retryFixture();
  expect((await fixture.session.open(fixture.targets[0])).ok).toBe(true);
  expect(
    await fixture.session.close({ retainProviderDocuments: true }),
  ).toEqual(err(fixture.cleanupError));
  fixture.allowCleanup();
  expect((await fixture.session.close()).ok).toBe(true);
  await expect(access(fixture.runtime)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(fixture.document, "utf8")).toBe(
    "caller-retained document",
  );
});

it("honors an explicit retention choice on a cleanup retry", async () => {
  const fixture = await retryFixture();
  expect((await fixture.session.open(fixture.targets[0])).ok).toBe(true);
  expect(await fixture.session.close()).toEqual(err(fixture.cleanupError));
  fixture.allowCleanup();
  expect(
    (await fixture.session.close({ retainProviderDocuments: true })).ok,
  ).toBe(true);
  await expect(access(fixture.runtime)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(fixture.document, "utf8")).toBe(
    "caller-retained document",
  );
});

it("keeps failed restoration resources available for a close retry", async () => {
  const parent = await createTestTempDirectory("rea-restore-cleanup-retry-");
  const runtime = join(parent, "restore-runtime");
  await mkdir(runtime);
  await writeFile(join(runtime, "observation"), "restore observation");
  const [first, second] = await createBinarySessionTargets();
  let created = 0;
  let allowed = false;
  const runIds: string[] = [];
  const session = createTestBinarySession((_target, _profile, context) => {
    if (context === undefined) throw new Error("missing analysis run context");
    runIds.push(context.runId);
    const index = ++created;
    return {
      execute: () =>
        Promise.resolve(index === 1 ? ok(null) : err(new HopperStartError())),
      close: async () => {
        if (index !== 3) return resultOk(null);
        if (!allowed)
          throw new ProviderCleanupError("fixture", [runtime], {
            reason: "restoration cleanup denied",
          });
        await rm(runtime, { recursive: true, force: true });
        return resultOk(null);
      },
    };
  });
  onTestFinished(async () => {
    allowed = true;
    await session.close();
  });
  expect((await session.open(first)).ok).toBe(true);
  expect(await session.open(second)).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true, cleanupResources: [runtime] },
  });
  expect(session.activeTarget()).toBeUndefined();
  expect(await session.status()).toMatchObject({
    open: false,
    cleanup_pending: true,
    analysis_run: { run_id: runIds[2] },
  });
  expect(new Set(runIds).size).toBe(3);
  allowed = true;
  expect((await session.close()).ok).toBe(true);
  await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not start a replacement cancelled while pending cleanup completes", async () => {
  const parent = await createTestTempDirectory("rea-cancel-cleanup-retry-");
  const runtime = join(parent, "owned-runtime");
  await mkdir(runtime);
  await writeFile(join(runtime, "observation"), "owned observation");
  const [first, second] = await createBinarySessionTargets();
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  let allowed = false;
  let created = 0;
  const session = createTestBinarySession(() => {
    const index = ++created;
    return {
      execute: () => Promise.resolve(ok(null)),
      close: async () => {
        if (index !== 1) return resultOk(null);
        if (!allowed)
          return err(
            new ProviderCleanupError("fixture", [runtime], {
              reason: "cleanup denied",
            }),
          );
        entered.resolve();
        await release.promise;
        await rm(runtime, { recursive: true, force: true });
        return resultOk(null);
      },
    };
  });
  onTestFinished(async () => {
    allowed = true;
    release.resolve();
    await session.close();
  });
  expect((await session.open(first)).ok).toBe(true);
  expect((await session.close()).ok).toBe(false);
  allowed = true;
  const controller = new AbortController();
  const opening = session.open(second, { signal: controller.signal });
  await entered.promise;
  controller.abort();
  release.resolve();
  expect(await opening).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(created).toBe(1);
  await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
});
