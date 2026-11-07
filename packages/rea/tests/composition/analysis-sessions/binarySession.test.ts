import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisProvider,
} from "../../../src/application/AnalysisProvider.js";
import type { BinarySession } from "../../../src/application/binary/BinarySession.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import type { RecordUnknownInput } from "../../../src/domain/residualUnknown.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { HopperStartError } from "../../../src/domain/hopperErrors.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import {
  ControllableAnalysisClient,
  createBinarySessionTargets,
  createCacheProvider,
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  copyFile,
  link,
  mkdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const client = (fail = false): AnalysisClient => ({
  execute: () => Promise.resolve(fail ? err(new HopperStartError()) : ok(null)),
  close: () => Promise.resolve(resultOk(null)),
});

/** Open a target and run one address_name query, asserting both succeed. */
const openAndExecuteAddressName = async (
  session: BinarySession,
  target: string,
  parameters: Readonly<Record<string, JsonValue>>,
): Promise<void> => {
  expect((await session.open(target)).ok).toBe(true);
  expect((await session.execute("address_name", parameters)).ok).toBe(true);
};

/** Shared network-reachability unknown input at one severity. */
const networkReachabilityUnknown = (
  severity: "medium" | "high",
): RecordUnknownInput => ({
  question: "Does this function reach the network?",
  severity,
  domain: "network",
  supporting_evidence_ids: [],
  contradicting_evidence_ids: [],
  required_authority: "shipped-artifact",
  required_confidence: "observed",
  required_environment: null,
  recommended_probes: [
    { operation: "analyze_function", rationale: "Inspect its callers." },
  ],
  relationships: [],
});

/** Record the shared network-reachability unknown, asserting success. */
const recordNetworkReachabilityUnknown = (
  session: BinarySession,
  severity: "medium" | "high",
): void => {
  expect(session.recordUnknown(networkReachabilityUnknown(severity)).ok).toBe(
    true,
  );
};

describe("detached provider and target metadata", () => {
  it("returns detached provider and target metadata", async () => {
    const [first] = await createBinarySessionTargets();
    const session = createTestBinarySession(createCacheProvider([]));
    expect((await session.open(first)).ok).toBe(true);
    expect(await session.status()).toMatchObject({
      analysis_run: {
        run_id: expect.any(String),
        process_lineage: { status: "not_observed" },
      },
    });
    expect(session.listUnknowns()).toEqual([]);
    const identity = session.providerIdentity();
    Reflect.set(identity, "id", "forged");
    expect(session.providerIdentity().id).toBe("fixture");

    const active = session.activeTarget();
    expect(active).toBeDefined();
    if (active !== undefined) Reflect.set(active, "path", "/tmp/forged");
    expect(session.activeTarget()?.path).toBe(first);

    await session.close();
  });

  it("exposes provider operational health in session status", async () => {
    const [first] = await createBinarySessionTargets();
    let healthState: "idle" | "busy" | "exited" = "busy";
    const provider: AnalysisProvider = {
      identity: () => ({ id: "fixture", name: "Fixture", version: "1" }),
      capabilities: () => [],
      createClient: () => ({
        execute: () => Promise.resolve(ok("ok")),
        operationHealthSnapshot: () => ({
          state: healthState,
          stage: "analysis",
          retryAction: healthState === "exited" ? "restart_provider" : "wait",
          exitCode: healthState === "exited" ? 7 : null,
          requests: [
            {
              requestId: 1,
              operation: "find_code_for_string",
              stage: "analysis",
            },
          ],
        }),
        close: () => Promise.resolve(resultOk(null)),
      }),
    };
    const session = createTestBinarySession(provider);
    expect(await session.status()).toMatchObject({
      open: false,
      provider_operation_health: null,
    });
    expect((await session.open(first)).ok).toBe(true);
    expect(await session.status()).toMatchObject({
      open: true,
      provider_operation_health: {
        state: "busy",
        stage: "analysis",
        retry_action: "wait",
        exit_code: null,
        requests: [
          {
            request_id: 1,
            operation: "find_code_for_string",
            stage: "analysis",
          },
        ],
      },
    });
    healthState = "exited";
    expect(await session.status()).toMatchObject({
      open: true,
      provider_operation_health: {
        state: "exited",
        stage: "analysis",
        retry_action: "restart_provider",
        exit_code: 7,
        requests: [
          {
            request_id: 1,
            operation: "find_code_for_string",
            stage: "analysis",
          },
        ],
      },
    });
    await session.close();
    expect(await session.status()).toMatchObject({
      open: false,
      provider_operation_health: null,
    });
  });
});

it("preserves the exact abort reason before external mutation admission", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Cancelled mutation must not start a provider");
  });
  const reason = { request: "cancel before external mutation" };
  const operation = vi.fn(async () => resultOk(null));
  const result = await session.withAdmittedExternalMutation(
    undefined,
    AbortSignal.abort(reason),
    operation,
    (_value, error) => error,
  );
  if (result.ok) throw new Error("Expected external mutation cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(operation).not.toHaveBeenCalled();
  await session.close();
});

it("drains session calls and retires analysis after an admitted external mutation", async () => {
  const [target] = await createBinarySessionTargets();
  const alias = join(dirname(target), "first-alias.hop");
  await symlink(target, alias);
  const calls: string[] = [];
  const clients: { closed: number; targetSha256: string }[] = [];
  const base = createCacheProvider(calls);
  const session = createTestBinarySession({
    ...base,
    createClient: (...arguments_) => {
      const client = base.createClient(...arguments_);
      const tracked = { closed: 0, targetSha256: arguments_[0].sha256 };
      clients.push(tracked);
      return {
        ...client,
        close: async () => {
          tracked.closed += 1;
          return client.close();
        },
      };
    },
  });
  expect((await session.open(target)).ok).toBe(true);
  expect(session.activeTarget()?.path).toBe(target);
  const originalDigest = session.activeTarget()?.sha256;
  expect(originalDigest).toEqual(expect.any(String));
  const started = createDeferred<void>();
  const release = createDeferred<void>();

  const mutation = session.withAdmittedExternalMutation(
    alias,
    undefined,
    async () => {
      expect(session.activeTarget()?.path).toBe(target);
      started.resolve();
      await release.promise;
      await writeFile(alias, "changed by external provider");
      return resultOk("provider finished");
    },
    (_value, error) => error,
  );
  await started.promise;
  const queuedAnalysis = session.execute("address_name", {});
  expect(calls).toEqual([]);

  release.resolve();
  await expect(mutation).resolves.toMatchObject({
    ok: true,
    value: { ok: true, value: "provider finished" },
  });
  expect((await queuedAnalysis).ok).toBe(false);
  expect(session.activeTarget()).toBeUndefined();
  expect(calls).toEqual([]);
  expect(clients).toHaveLength(0);
  expect((await session.open(target)).ok).toBe(true);
  expect((await session.execute("address_name", {})).ok).toBe(true);
  expect(session.activeTarget()?.sha256).toEqual(expect.any(String));
  expect(session.activeTarget()?.sha256).not.toBe(originalDigest);
  expect(clients.at(-1)?.targetSha256).toBe(session.activeTarget()?.sha256);
  expect(calls).toEqual(["address_name"]);
  await session.close();
});

it("leaves analysis unbound when a command returns before its writer finishes", async () => {
  const [target] = await createBinarySessionTargets();
  const session = createTestBinarySession(createCacheProvider([]));
  expect((await session.open(target)).ok).toBe(true);
  const originalDigest = session.activeTarget()?.sha256;
  expect(originalDigest).toEqual(expect.any(String));
  const releaseWriter = createDeferred<void>();
  let writer: Promise<void> | undefined;
  const result = await session.withAdmittedExternalMutation(
    target,
    undefined,
    async () => {
      writer = releaseWriter.promise.then(() =>
        writeFile(target, "delayed write"),
      );
      return resultOk("command replied");
    },
    (_value, error) => error,
  );
  expect(result).toEqual(resultOk(resultOk("command replied")));
  expect(session.activeTarget()).toBeUndefined();
  releaseWriter.resolve();
  await writer;
  expect((await session.execute("address_name", {})).ok).toBe(false);
  expect((await session.open(target)).ok).toBe(true);
  expect(session.activeTarget()?.sha256).toEqual(expect.any(String));
  expect(session.activeTarget()?.sha256).not.toBe(originalDigest);
  await session.close();
});

it("reports an external cleanup blocker until its exact owner confirms release", async () => {
  const [target] = await createBinarySessionTargets();
  const session = createTestBinarySession(createCacheProvider([]));
  const failure = new ProviderCleanupError(
    "external-debugger",
    ["external-run"],
    {},
  );
  let released = false;
  const lease = new AnalysisCleanupLease(async () => {
    released = true;
  }, ["external-run"]);
  lease.bindCleanupError(failure);
  try {
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
    await session.withAdmittedExternalMutation(
      target,
      undefined,
      async () => err(failure),
      (_value, error) => error,
    );
    expect(await session.status()).toMatchObject({ cleanup_pending: true });
    expect(await session.open(target)).toEqual(err(failure));
    await session.close();
    expect(released).toBe(false);
    expect(await session.status()).toMatchObject({ cleanup_pending: true });
    await lease.release();
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
    expect((await session.open(target)).ok).toBe(true);
  } finally {
    await lease.release();
    await session.close();
  }
});

it("retires analysis when an external mutation uses a hard link", async () => {
  const [target] = await createBinarySessionTargets();
  const alias = join(dirname(target), "hard-link-alias.hop");
  await link(target, alias);
  const session = createTestBinarySession(createCacheProvider([]));
  expect((await session.open(target)).ok).toBe(true);
  const before = session.activeTarget()?.sha256;
  expect(before).toEqual(expect.any(String));

  const result = await session.withAdmittedExternalMutation(
    alias,
    undefined,
    async () => {
      await writeFile(alias, "changed through hard link");
      return resultOk("changed");
    },
    (_value, error) => error,
  );

  expect(result).toMatchObject({
    ok: true,
    value: { ok: true, value: "changed" },
  });
  expect(session.activeTarget()).toBeUndefined();
  expect((await session.open(target)).ok).toBe(true);
  expect(session.activeTarget()?.sha256).toEqual(expect.any(String));
  expect(session.activeTarget()?.sha256).not.toBe(before);
  await session.close();
});

it("preserves Evidence records while retiring the client after an external mutation", async () => {
  const [target] = await createBinarySessionTargets();
  const session = createTestBinarySession(createCacheProvider([]));
  expect((await session.open(target)).ok).toBe(true);
  expect(
    (await session.execute("address_name", { address: "0x1000" })).ok,
  ).toBe(true);
  recordNetworkReachabilityUnknown(session, "medium");
  const before = session.exportEvidenceBundle();

  const result = await session.withAdmittedExternalMutation(
    target,
    undefined,
    async () => resultOk("observed"),
    (_value, error) => error,
  );

  expect(result.ok).toBe(true);
  expect(session.exportEvidenceBundle().records).toEqual(before.records);
  expect(session.listUnknowns()).toHaveLength(1);
  await session.close();
});

it("requires explicitly reopening an app bundle after a session mutation", async () => {
  const directory = await createTestTempDirectory("rea-session-app-rebind-");
  const app = join(directory, "Fixture.app");
  const executable = join(app, "Fixture");
  await mkdir(app, { recursive: true });
  await writeFile(
    join(app, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
  );
  await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
  const session = createTestBinarySession(createCacheProvider([]));
  expect((await session.open(app)).ok).toBe(true);
  const initial = session.activeTarget();
  expect(initial?.sourcePath).toBe(await realpath(app));

  const result = await session.withAdmittedExternalMutation(
    initial?.path ?? executable,
    undefined,
    async () => resultOk("observed"),
    (_value, error) => error,
  );

  if (!result.ok) throw result.error;
  expect(result).toMatchObject({
    ok: true,
    value: { ok: true, value: "observed" },
  });
  expect(session.activeTarget()).toBeUndefined();
  expect((await session.open(app)).ok).toBe(true);
  expect(session.activeTarget()).toMatchObject({
    path: await realpath(executable),
    sourcePath: await realpath(app),
    bundleInfoPlist: await realpath(join(app, "Info.plist")),
  });
  await session.close();
});

it("retires an auxiliary-only session after an external mutation", async () => {
  const [target] = await createBinarySessionTargets();
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(ok(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  expect((await session.open(target)).ok).toBe(true);

  const result = await session.withAdmittedExternalMutation(
    target,
    undefined,
    async () => resultOk("observed"),
    (_value, error) => error,
  );

  expect(result).toMatchObject({
    ok: true,
    value: { ok: true, value: "observed" },
  });
  expect(session.activeTarget()).toBeUndefined();
  await session.close();
});

it("keeps an externally mutated session unbound until cleanup is retried", async () => {
  const [target] = await createBinarySessionTargets();
  const cleanupError = new ProviderCleanupError("fixture", ["provider-child"], {
    reason: "process group is still alive",
  });
  let created = 0;
  let closeAttempts = 0;
  const session = createTestBinarySession(() => {
    created += 1;
    return {
      execute: () => Promise.resolve(ok(null)),
      close: () =>
        Promise.resolve(
          ++closeAttempts === 1 ? err(cleanupError) : resultOk(null),
        ),
    };
  });
  expect((await session.open(target)).ok).toBe(true);
  expect(session.activeTarget()).toBeDefined();
  expect(created).toBe(1);

  const mutation = await session.withAdmittedExternalMutation(
    target,
    undefined,
    async () => resultOk("dispatched"),
    (_value, error) => error,
  );

  expect(closeAttempts).toBe(1);
  expect(mutation.ok).toBe(false);
  if (mutation.ok) throw new Error("Expected cleanup failure");
  expect(mutation.error).toBeInstanceOf(ProviderCleanupError);
  expect(mutation.error.cleanupIncomplete).toBe(true);
  expect(session.activeTarget()).toBeUndefined();
  expect((await session.execute("address_name", {})).ok).toBe(false);
  expect(created).toBe(1);
  expect((await session.open(target)).ok).toBe(true);
  expect(created).toBe(2);
  await session.close();
});

describe("opening previewed targets", () => {
  it("rechecks the active target after another serialized transition", async () => {
    const [first, second] = await createBinarySessionTargets();
    const calls: string[] = [];
    const session = createTestBinarySession(createCacheProvider(calls));
    try {
      expect((await session.open(first)).ok).toBe(true);
      const target = session.activeTarget();
      if (target === undefined) throw new Error("Expected an active target");
      const preview = await session.previewTarget(target);
      if (!preview.ok) throw preview.error;
      expect(preview.value.sameTarget).toBe(true);
      expect((await session.open(second)).ok).toBe(true);
      expect((await session.openResolvedTarget(preview.value)).ok).toBe(true);
      expect(session.activeTarget()?.path).toBe(first);
      expect(calls).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it("rejects cancellation and a staged snapshot changed after preview without startup", async () => {
    const [first, second] = await createBinarySessionTargets();
    const calls: string[] = [];
    const session = createTestBinarySession(createCacheProvider(calls));
    const other = createTestBinarySession(createCacheProvider([]));
    try {
      const parsed = await parseBinaryTarget(first);
      if (!parsed.ok) throw parsed.error;
      const preview = await session.previewTarget(parsed.value);
      if (!preview.ok) throw preview.error;
      const controller = new AbortController();
      controller.abort();
      const cancelled = await session.openResolvedTarget(preview.value, {
        signal: controller.signal,
      });
      expect(cancelled).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });

      expect((await other.open(second)).ok).toBe(true);
      const snapshot = other.exportAnalysisSnapshot();
      if (!snapshot.ok) throw snapshot.error;
      expect(session.importAnalysisSnapshot(snapshot.value).ok).toBe(true);
      const rejected = await session.openResolvedTarget(preview.value);
      expect(rejected).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceIntegrityError" },
      });
      expect(calls).toEqual([]);
      expect(session.activeTarget()).toBeUndefined();
    } finally {
      await session.close();
      await other.close();
    }
  });
});

describe("fresh run identity", () => {
  it("allocates one fresh run identity per provider client lifetime", async () => {
    const [first, second] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    const createClient = provider.createClient.bind(provider);
    const runIds: string[] = [];
    provider.createClient = (target, profile, context) => {
      if (context === undefined)
        throw new Error("missing analysis run context");
      runIds.push(context.runId);
      return createClient(target, profile, context);
    };
    const session = createTestBinarySession(provider);

    expect((await session.open(first)).ok).toBe(true);
    expect(
      (
        await session.execute("address_name", {
          address: "0x1000",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    expect((await session.open(first)).ok).toBe(true);
    expect((await session.open(second)).ok).toBe(true);
    expect(
      (
        await session.execute("address_name", {
          address: "0x1000",
          document: "second",
        })
      ).ok,
    ).toBe(true);

    expect(runIds).toHaveLength(2);
    expect(new Set(runIds).size).toBe(2);
    await session.close();
  });
});

describe("evidence metadata imports and snapshot cache", () => {
  it("retains cached queries and exports after additive evidence imports", async () => {
    const [target] = await createBinarySessionTargets();
    const calls: string[] = [];
    const session = createTestBinarySession(createCacheProvider(calls));
    expect((await session.open(target)).ok).toBe(true);
    expect(
      (
        await session.execute("address_name", {
          address: "0x1000",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    const before = session.exportAnalysisSnapshot();
    if (!before.ok) throw before.error;
    const existing = session.exportEvidenceBundle().records[0];
    if (existing === undefined || existing.subject === null)
      throw new Error("Expected artifact-bound Evidence");
    const addition = createEvidence(
      {
        path: existing.subject.local_path,
        sha256: existing.subject.digest.sha256,
        format: existing.subject.format,
        ...(existing.subject.architecture === null
          ? {}
          : { architecture: existing.subject.architecture }),
      },
      { id: "fixture", name: "Fixture", version: "1" },
      {
        predicateType: "rea.analysis",
        operation: "health",
        parameters: { source: "additive-import" },
        result: true,
      },
    );
    expect(
      session.importEvidenceBundle(createEvidenceBundle([addition])),
    ).toEqual({
      ok: true,
      value: {
        recordsAdded: 1,
        unknownsAdded: 0,
        totalRecords: before.value.evidence_bundle.records.length + 1,
      },
    });
    expect(
      session.importEvidenceBundle(createEvidenceBundle([addition])),
    ).toEqual({
      ok: true,
      value: {
        recordsAdded: 0,
        unknownsAdded: 0,
        totalRecords: before.value.evidence_bundle.records.length + 1,
      },
    });
    expect(session.exportAnalysisSnapshot()).toMatchObject({
      ok: true,
      value: {
        entries: before.value.entries,
        evidence_bundle: { records: expect.arrayContaining([addition]) },
      },
    });
    const callsAfterInitialRead = [...calls];
    expect(
      (
        await session.execute("address_name", {
          address: "0x1000",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    expect(calls).toEqual(callsAfterInitialRead);
    expect(session.exportAnalysisSnapshot().ok).toBe(true);
    await session.close();
  });
});

describe("Evidence display metadata refresh", () => {
  it.each(["active", "unrelated"] as const)(
    "refreshes %s Evidence display metadata without invalidating provider observations",
    async (scope) => {
      const [target] = await createBinarySessionTargets();
      const calls: string[] = [];
      const session = createTestBinarySession(createCacheProvider(calls));
      try {
        expect((await session.open(target)).ok).toBe(true);
        const parameters = { address: "0x1000", document: "first" };
        const initial = await session.execute("address_name", parameters);
        if (!initial.ok) throw initial.error;
        const baseline = session.exportAnalysisSnapshot();
        if (!baseline.ok) throw baseline.error;
        const activeEvidence = baseline.value.evidence_bundle.records.find(
          ({ operation }) => operation === "address_name",
        );
        if (activeEvidence === undefined || activeEvidence.subject === null)
          throw new Error("Expected artifact-bound Evidence");
        const evidence =
          scope === "active"
            ? activeEvidence
            : createEvidence(
                { path: "/unrelated", sha256: "f".repeat(64), format: "elf" },
                { id: "fixture", name: "Fixture", version: "1" },
                { operation: "health", parameters: {}, result: true },
              );
        expect(session.recordEvidence(evidence).ok).toBe(true);
        if (evidence.subject === null) throw new Error("Expected a subject");
        const relocated = {
          ...evidence,
          subject: {
            ...evidence.subject,
            local_path: `${evidence.subject.local_path}.moved`,
            name: `${evidence.subject.name}.moved`,
          },
        };
        const changed = vi.fn();
        const unsubscribe = session.onAnalysisSnapshotChanged(changed);
        expect(
          session.importEvidenceBundle(createEvidenceBundle([relocated])),
        ).toEqual({
          ok: true,
          value: {
            recordsAdded: 0,
            unknownsAdded: 0,
            totalRecords: session.immutableEvidenceBundle().records.length,
          },
        });
        expect(changed).toHaveBeenCalledTimes(1);
        unsubscribe();
        expect(session.evidenceById(evidence.evidence_id)).toEqual(relocated);
        const refreshed = session.exportAnalysisSnapshot();
        if (!refreshed.ok) throw refreshed.error;
        if (scope === "active") {
          expect(refreshed.value.entries[0]?.execution.subject?.path).toBe(
            relocated.subject.local_path,
          );
          expect(refreshed.value.evidence_bundle.records).toContainEqual(
            relocated,
          );
        } else {
          expect(refreshed.value.entries).toEqual(baseline.value.entries);
          expect(refreshed.value.evidence_bundle.records).not.toContainEqual(
            relocated,
          );
        }
        const callsAfterInitialRead = [...calls];
        const replay = await session.execute("address_name", parameters);
        if (!replay.ok) throw replay.error;
        expect(replay.value.result).toEqual(initial.value.result);
        expect(replay.value.subject?.path).toBe(target);
        expect(calls).toEqual(callsAfterInitialRead);
        // Import follows the same display-refresh path without poisoning the session.
        expect(
          session.importAnalysisSnapshot({
            ...baseline.value,
            entries: [],
            workflow_entries: [],
          }).ok,
        ).toBe(true);
        expect(session.exportAnalysisSnapshot()).toMatchObject({
          ok: true,
          value: { entries: baseline.value.entries },
        });
      } finally {
        expect(await session.close()).toEqual({ ok: true, value: null });
      }
    },
  );
});

describe("snapshot invalidation at mutation dispatch", () => {
  it.each(["provider failure", "invalid reply identity"] as const)(
    "does not replay metadata after a write followed by %s",
    async (failure) => {
      const [target] = await createBinarySessionTargets();
      const provider = createCacheProvider([]);
      let name = "before";
      provider.createClient = () => ({
        execute: (operation) => {
          if (operation === "health") return Promise.resolve(ok(null));
          if (operation === "address_name") return Promise.resolve(ok(name));
          if (operation !== "set_address_name")
            throw new Error(`Unexpected operation: ${operation}`);
          name = "after";
          return Promise.resolve(
            failure === "provider failure"
              ? err(new ProviderAdapterError("fixture", operation))
              : resultOk(
                  createAnalysisExecution(true, {
                    id: "wrong",
                    name: "Wrong",
                    version: "1",
                  }),
                ),
          );
        },
        close: () => Promise.resolve(resultOk(null)),
      });
      const session = createTestBinarySession(provider);
      try {
        const opened = await session.open(target);
        if (!opened.ok) throw opened.error;
        const parameters = { address: "0x1000", document: "first" };
        const before = await session.execute("address_name", parameters);
        if (!before.ok) throw before.error;
        expect(before.value.result).toBe("before");
        const baseline = session.exportAnalysisSnapshot();
        if (!baseline.ok) throw baseline.error;

        const written = await session.execute("set_address_name", {
          ...parameters,
          name: "after",
        });
        expect(written).toMatchObject({ ok: false });
        const after = await session.execute("address_name", parameters);
        if (!after.ok) throw after.error;
        expect(after.value.result).toBe("after");
        expect(session.exportAnalysisSnapshot()).toMatchObject({ ok: false });
        expect(session.importAnalysisSnapshot(baseline.value)).toMatchObject({
          ok: false,
        });
      } finally {
        expect(await session.close()).toEqual({ ok: true, value: null });
      }
    },
  );

  it("stops replay while a dispatched write is still awaiting its reply", async () => {
    const [target] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    const started = createDeferred<void>();
    const reply = createDeferred<ReturnType<typeof ok>>();
    let name = "before";
    provider.createClient = () => ({
      execute: (operation) => {
        if (operation === "health") return Promise.resolve(ok(null));
        if (operation === "address_name") return Promise.resolve(ok(name));
        if (operation !== "set_address_name")
          throw new Error(`Unexpected operation: ${operation}`);
        name = "after";
        started.resolve();
        return reply.promise;
      },
      close: () => Promise.resolve(resultOk(null)),
    });
    const session = createTestBinarySession(provider);
    try {
      const opened = await session.open(target);
      if (!opened.ok) throw opened.error;
      const parameters = { address: "0x1000", document: "first" };
      const before = await session.execute("address_name", parameters);
      if (!before.ok) throw before.error;
      const writing = session.execute("set_address_name", {
        ...parameters,
        name: "after",
      });
      await started.promise;
      try {
        const during = await session.execute("address_name", parameters);
        if (!during.ok) throw during.error;
        expect(during.value.result).toBe("after");
        expect(session.exportAnalysisSnapshot()).toMatchObject({ ok: false });
      } finally {
        reply.resolve(ok(true));
        expect(await writing).toMatchObject({ ok: true });
      }
    } finally {
      expect(await session.close()).toEqual({ ok: true, value: null });
    }
  });
});

describe("replay of exact immutable calls", () => {
  it("replays exact immutable calls from a matching provider-neutral snapshot", async () => {
    const [first, second] = await createBinarySessionTargets();
    const initialCalls: string[] = [];
    const initial = createTestBinarySession(createCacheProvider(initialCalls));
    expect((await initial.open(first)).ok).toBe(true);
    expect(
      (
        await initial.execute("address_name", {
          address: "0x1000",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    const snapshot = initial.exportAnalysisSnapshot();
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.entries).toHaveLength(1);
    await initial.close();

    const replayCalls: string[] = [];
    const replay = createTestBinarySession(createCacheProvider(replayCalls));
    expect(replay.importAnalysisSnapshot(snapshot.value)).toEqual({
      ok: true,
      value: 1,
    });
    expect((await replay.open(first)).ok).toBe(true);
    const cached = await replay.execute("address_name", {
      address: "0x1000",
      document: "first",
    });
    expect(cached.ok).toBe(true);
    if (cached.ok)
      expect(cached.value.limitations).toContainEqual(
        expect.stringContaining("local REA analysis snapshot"),
      );
    expect(
      (
        await replay.execute("set_address_name", {
          address: "0x1000",
          name: "renamed",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await replay.execute("address_name", {
          address: "0x1000",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    expect(replayCalls).toEqual(["set_address_name", "address_name"]);
    expect(replay.exportAnalysisSnapshot().ok).toBe(false);
    await replay.close();

    const mismatch = createTestBinarySession(createCacheProvider([]));
    expect(mismatch.importAnalysisSnapshot(snapshot.value).ok).toBe(true);
    const opened = await mismatch.open(second);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error._tag).toBe("EvidenceIntegrityError");
    await mismatch.close();

    const profileMismatchCalls: string[] = [];
    const profileMismatchProvider = createCacheProvider(profileMismatchCalls);
    const identity = profileMismatchProvider.identity();
    profileMismatchProvider.resolveAnalysisProfile = () =>
      Promise.resolve(
        resultOk({
          profile: createAnalysisProfile(
            {
              id: identity.id,
              name: identity.name,
              version: identity.version ?? "fixture-unresolved",
            },
            { fixture: "different-profile" },
          ),
        }),
      );
    const profileMismatch = createTestBinarySession(profileMismatchProvider);
    expect(profileMismatch.importAnalysisSnapshot(snapshot.value).ok).toBe(
      true,
    );
    const profileOpened = await profileMismatch.open(first);
    expect(profileOpened.ok).toBe(false);
    if (!profileOpened.ok) {
      expect(profileOpened.error._tag).toBe("EvidenceIntegrityError");
      expect(profileOpened.error.message).toContain("profile_mismatch");
    }
    expect(profileMismatchCalls).toEqual([]);
    await profileMismatch.close();

    const activeProfileMismatch = createTestBinarySession(
      profileMismatchProvider,
    );
    expect((await activeProfileMismatch.open(first)).ok).toBe(true);
    const activeImport = activeProfileMismatch.importAnalysisSnapshot(
      snapshot.value,
    );
    expect(activeImport.ok).toBe(false);
    if (!activeImport.ok)
      expect(activeImport.error.message).toContain("profile_mismatch");
    await activeProfileMismatch.close();
  });
});

describe("snapshot switch rollback", () => {
  it("retains the previous cache when a target switch snapshot conflicts", async () => {
    const [first] = await createBinarySessionTargets();
    const directory = await createTestTempDirectory("rea-session-copy-");
    const second = join(directory, `second${extname(first)}`);
    await copyFile(first, second);
    const calls: string[] = [];
    const session = createTestBinarySession(createCacheProvider(calls));
    await openAndExecuteAddressName(session, first, {
      address: "0x1000",
      document: "first",
    });
    recordNetworkReachabilityUnknown(session, "medium");
    const originalCache = session.exportAnalysisSnapshot();
    expect(originalCache).toMatchObject({
      ok: true,
      value: { entries: [{ operation: "address_name" }] },
    });

    const conflicting = createTestBinarySession(createCacheProvider([]));
    expect((await conflicting.open(second)).ok).toBe(true);
    recordNetworkReachabilityUnknown(conflicting, "high");
    const conflictingSnapshot = conflicting.exportAnalysisSnapshot();
    expect(conflictingSnapshot.ok).toBe(true);
    if (!conflictingSnapshot.ok || !originalCache.ok) return;
    await conflicting.close();

    expect(
      await session.open(second, { snapshot: conflictingSnapshot.value }),
    ).toMatchObject({ ok: false });
    expect(session.activeTarget()?.path).toBe(first);
    expect(
      (
        await session.execute("address_name", {
          address: "0x1000",
          document: "first",
        })
      ).ok,
    ).toBe(true);
    expect(calls).toEqual(["address_name"]);
    await session.close();
  });
});

describe("snapshot cache eligibility", () => {
  it.each([
    "decode_interface_builder",
    "inspect_asset_catalog",
    "inspect_keyed_archive",
    "trace_dylib_resolution",
  ] as const)(
    "reobserves resource-scoped %s without executable snapshot Evidence",
    async (operation) => {
      const [target] = await createBinarySessionTargets();
      const provider = createCacheProvider([]);
      const [baseCapability] = provider.capabilities();
      if (baseCapability === undefined)
        throw new Error("Expected fixture capability");
      provider.capabilities = () => [
        { ...baseCapability, operation, cachePolicy: "snapshot" },
      ];
      let observations = 0;
      provider.createClient = () => ({
        execute: async (name) =>
          resultOk(
            createAnalysisExecution(
              name === "health" ? null : ++observations,
              provider.identity(),
            ),
          ),
        close: async () => resultOk(null),
      });
      const session = createTestBinarySession(provider);
      try {
        expect((await session.open(target)).ok).toBe(true);
        for (const observation of [1, 2]) {
          const result = await session.execute(operation, {});
          expect(result).toMatchObject({
            ok: true,
            value: { result: observation },
          });
          if (result.ok) expect(result.value.evidenceId).toBeUndefined();
        }
        expect(session.exportEvidenceBundle().records).toEqual([]);
        expect(session.exportAnalysisSnapshot()).toMatchObject({
          ok: true,
          value: { entries: [] },
        });
      } finally {
        await session.close();
      }
    },
  );

  it.each([false, true])(
    "retains source Evidence independently of snapshot eligibility (live=%s)",
    async (live) => {
      const [target] = await createBinarySessionTargets();
      const provider = createCacheProvider([]);
      const capabilities = provider.capabilities();
      provider.capabilities = () =>
        capabilities.map((capability) => ({
          ...capability,
          ...(live ? { cachePolicy: "live" as const } : {}),
        }));
      const source = createEvidence(
        undefined,
        provider.identity(),
        {
          operation: "health",
          parameters: { facet: "saved-analysis-report" },
          result: { original_analysis: "unknown" },
        },
        { immutable: true },
      );
      provider.createClient = () => ({
        execute: async () =>
          resultOk(
            createAnalysisExecution("name", provider.identity(), {
              sourceEvidence: [source],
            }),
          ),
        close: async () => resultOk(null),
      });
      const session = createTestBinarySession(provider);
      try {
        expect((await session.open(target)).ok).toBe(true);
        const parameters: Readonly<Record<string, JsonValue>> = live
          ? { address: "0x1000", document: "main" }
          : {};
        const evidenceIds: Array<string | undefined> = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await session.execute("address_name", parameters);
          if (!result.ok) throw result.error;
          evidenceIds.push(result.value.evidenceId);
        }
        const records = session.exportEvidenceBundle().records;
        if (live) {
          expect(evidenceIds).toEqual([expect.any(String), evidenceIds[0]]);
          expect(records.map((record) => record.evidence_id)).toEqual(
            expect.arrayContaining([source.evidence_id, evidenceIds[0]]),
          );
        } else {
          expect(evidenceIds).toEqual([undefined, undefined]);
          expect(records).toEqual([source]);
        }
        expect(session.exportAnalysisSnapshot()).toMatchObject({
          ok: true,
          value: { entries: [] },
        });
      } finally {
        await session.close();
      }
    },
  );

  it("rejects invalid source Evidence on a non-replayable observation", async () => {
    const [target] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    const source = createEvidence(undefined, provider.identity(), {
      operation: "health",
      parameters: {},
      result: "original",
    });
    provider.createClient = () => ({
      execute: async () =>
        resultOk(
          createAnalysisExecution("name", provider.identity(), {
            sourceEvidence: [{ ...source, normalized_result: "tampered" }],
          }),
        ),
      close: async () => resultOk(null),
    });
    const session = createTestBinarySession(provider);
    try {
      expect((await session.open(target)).ok).toBe(true);
      const result = await session.execute("address_name", {});
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "EvidenceIntegrityError" },
      });
      expect(session.exportEvidenceBundle().records).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

it("does not snapshot reads that depend on the provider cursor", async () => {
  const [first] = await createBinarySessionTargets();
  const calls: string[] = [];
  const session = createTestBinarySession(createCacheProvider(calls));
  await openAndExecuteAddressName(session, first, {});
  expect((await session.execute("address_name", {})).ok).toBe(true);
  expect(calls).toEqual(["address_name", "address_name"]);
  expect(session.exportAnalysisSnapshot()).toMatchObject({
    ok: true,
    value: { entries: [] },
  });
  await session.close();
});

describe("provider health and availability", () => {
  it("publishes provider-health availability changes and resets on target switch", async () => {
    const [first, second] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    provider.createClient = () => ({
      execute: (operation) =>
        Promise.resolve(
          operation === "health"
            ? ok(null)
            : err(new ProviderAdapterError("fixture", operation)),
        ),
      close: () => Promise.resolve(resultOk(null)),
    });
    const session = createTestBinarySession(provider);
    let changes = 0;
    session.onAvailabilityChanged(() => {
      changes += 1;
    });
    expect((await session.open(first)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(false);
    expect(await session.status()).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          provider: {
            id: "fixture",
            name: "Fixture analysis provider",
            version: "1",
          },
          groups: expect.arrayContaining([
            expect.objectContaining({
              operations: expect.arrayContaining(["address_name"]),
              available: false,
              reason:
                "ProviderAdapterError: Provider fixture adapter failed during address_name",
            }),
          ]),
        }),
      ]),
    });
    expect(changes).toBe(1);
    expect((await session.open(second)).ok).toBe(true);
    expect(await session.status()).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          provider: {
            id: "fixture",
            name: "Fixture analysis provider",
            version: "1",
          },
          groups: expect.arrayContaining([
            expect.objectContaining({
              operations: expect.arrayContaining(["address_name"]),
              available: true,
              reason: null,
            }),
          ]),
        }),
      ]),
    });
    expect(changes).toBe(2);
  });

  it("isolates availability observers from execution results and session state", async () => {
    const [first] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    let providerCalls = 0;
    provider.createClient = () => ({
      execute: (operation) => {
        if (operation === "health") return Promise.resolve(ok(null));
        providerCalls += 1;
        return Promise.resolve(
          providerCalls === 1
            ? err(new ProviderAdapterError("fixture", operation))
            : ok(operation),
        );
      },
      close: () => Promise.resolve(resultOk(null)),
    });
    const session = createTestBinarySession(provider);
    expect((await session.open(first)).ok).toBe(true);
    const input = { address: "0x1000", document: "first" };
    expect((await session.execute("address_name", input)).ok).toBe(false);

    session.onAvailabilityChanged(() => {
      throw new Error("external observer failed");
    });
    session.onAvailabilityChanged(() =>
      Promise.reject(new Error("async external observer failed")),
    );
    let delivered = 0;
    session.onAvailabilityChanged(() => {
      delivered += 1;
    });

    await expect(session.execute("address_name", input)).resolves.toMatchObject(
      { ok: true },
    );
    expect(delivered).toBe(1);
    expect(await session.status()).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          provider: {
            id: "fixture",
            name: "Fixture analysis provider",
            version: "1",
          },
          groups: expect.arrayContaining([
            expect.objectContaining({
              operations: expect.arrayContaining(["address_name"]),
              available: true,
              reason: null,
            }),
          ]),
        }),
      ]),
    });
    expect((await session.execute("address_name", input)).ok).toBe(true);
    expect(providerCalls).toBe(2);
  });

  it("does not replay operations with filesystem side effects", async () => {
    const [first] = await createBinarySessionTargets();
    const calls: string[] = [];
    const session = createTestBinarySession(createCacheProvider(calls, true));
    expect((await session.open(first)).ok).toBe(true);
    const input = { address: "0x1000", document: "first" };
    expect((await session.execute("address_name", input)).ok).toBe(true);
    expect((await session.execute("address_name", input)).ok).toBe(true);
    expect(calls).toEqual(["address_name", "address_name"]);
    await session.close();
  });
});

it("preserves the exact abort reason before composed admission", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Cancelled admission must not start a provider");
  });
  const reason = { request: "cancel before composed admission" };
  const operation = vi.fn(async () => null);
  const result = await session.withAdmittedAnalysis(
    "binary_overview",
    AbortSignal.abort(reason),
    operation,
  );
  if (result.ok) throw new Error("Expected composed admission cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(operation).not.toHaveBeenCalled();
  await session.close();
});

describe("typed unavailability without dispatching", () => {
  it("returns typed unavailability without dispatching a partial provider", async () => {
    const [first] = await createBinarySessionTargets();
    const operations: string[] = [];
    const provider: AnalysisProvider = {
      identity: () => ({ id: "partial", name: "Partial", version: "1" }),
      capabilities: () => [
        {
          provider: { id: "partial", name: "Partial", version: "1" },
          operation: "address_name",
          available: false,
          reason: "fixture intentionally omits symbol lookup",
          effects: {
            mutatesArtifact: false,
            launchesProcess: false,
            mayShowUi: false,
            mayAccessNetwork: false,
            mayWriteFilesystem: false,
            changesPermissions: false,
            requiresRoot: false,
          },
          limitations: ["No symbol lookup implementation."],
        },
      ],
      createClient: () => ({
        execute: (operation) => {
          operations.push(operation);
          return Promise.resolve(ok(operation));
        },
        close: () => Promise.resolve(resultOk(null)),
      }),
    };
    const session = createTestBinarySession(provider);
    expect((await session.open(first)).ok).toBe(true);
    const result = await session.execute("address_name", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        providerId: "partial",
        operation: "address_name",
        reason: "fixture intentionally omits symbol lookup",
      });
    }
    expect(operations).toEqual(["health"]);
    await session.close();
  });

  it("drains an admitted call before closing and closes idempotently", async () => {
    const [first] = await createBinarySessionTargets();
    const session = createTestBinarySession(() => client());
    expect((await session.execute("binary_overview", {})).ok).toBe(false);
    expect((await session.open(first)).ok).toBe(true);
    // The call has been admitted but has not resumed after the transition wait.
    const admitted = session.execute("binary_overview", {});
    const closing = session.close();
    expect((await admitted).ok).toBe(true);
    expect(await closing).toEqual({ ok: true, value: null });
    expect(await session.close()).toEqual({ ok: true, value: null });
    expect(await session.close()).toEqual({ ok: true, value: null });
  });

  it("keeps the active client when a switch fails", async () => {
    const [first, second] = await createBinarySessionTargets();
    let created = 0;
    const session = createTestBinarySession(() => client(created++ === 1));
    expect((await session.open(first)).ok).toBe(true);
    expect((await session.open(second)).ok).toBe(false);
    expect(await session.status()).toMatchObject({
      open: true,
      sha256:
        "7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed",
      architecture: null,
    });
    expect(JSON.stringify(await session.status())).toContain("first.hop");
    expect(created).toBe(3);
  });

  it("orders calls between queued transitions without deadlocking", async () => {
    const [first, second] = await createBinarySessionTargets();
    const clients: ControllableAnalysisClient[] = [];
    const session = createTestBinarySession(() => {
      const value = new ControllableAnalysisClient();
      clients.push(value);
      return value;
    });
    const one = session.open(first);
    const firstCall = session.execute("binary_overview", {});
    const controller = new AbortController();
    const cancelled = session.execute(
      "binary_overview",
      {},
      { signal: controller.signal },
    );
    controller.abort();
    const two = session.open(second);
    const secondCall = session.execute("binary_overview", {});
    const closing = session.close();
    const afterClose = session.execute("binary_overview", {});
    expect((await one).ok).toBe(true);
    expect((await firstCall).ok).toBe(true);
    expect(await cancelled).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect((await two).ok).toBe(true);
    expect((await secondCall).ok).toBe(true);
    expect((await closing).ok).toBe(true);
    expect((await afterClose).ok).toBe(false);
    expect(await session.status()).toMatchObject({ open: false });
    expect(clients[0]?.closed).toBe(1);
    expect(clients[1]?.closed).toBe(1);
  });

  it("cancels a composed admission queued behind open without invoking it", async () => {
    const [first] = await createBinarySessionTargets();
    const health = createDeferred<ReturnType<typeof ok>>();
    const session = createTestBinarySession(
      () => new ControllableAnalysisClient(health.promise),
    );
    const opening = session.open(first);
    const controller = new AbortController();
    let invoked = false;
    const admitted = session.withAdmittedAnalysis(
      "binary_overview",
      controller.signal,
      async () => {
        invoked = true;
        return null;
      },
    );
    const reason = { request: "cancel queued composed admission" };
    controller.abort(reason);
    try {
      const result = await admitted;
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          operation: "binary_overview",
        },
      });
      if (result.ok) throw new Error("Expected queued admission cancellation");
      expect(result.error.cause).toBe(reason);
      expect(invoked).toBe(false);
    } finally {
      health.resolve(ok(null));
      const opened = await opening;
      await session.close();
      expect(opened.ok).toBe(true);
    }
  });
});

describe("active client replacement", () => {
  it("replaces the active client when a canonical path changes contents", async () => {
    const directory = await createTestTempDirectory("bb-session-");
    const path = join(directory, "mutable.hop");
    await writeFile(path, "one");
    const clients: Array<{
      readonly targetSha256: string;
      readonly calls: string[];
      closed: number;
    }> = [];
    const session = createTestBinarySession((target) => {
      const state = {
        targetSha256: target.sha256,
        calls: [] as string[],
        closed: 0,
      };
      clients.push(state);
      return {
        execute: (operation) => {
          state.calls.push(operation);
          return Promise.resolve(
            ok(operation === "health" ? null : target.sha256),
          );
        },
        close: () => {
          state.closed += 1;
          return Promise.resolve(resultOk(null));
        },
      };
    });

    const first = await session.open(path);
    expect(first.ok).toBe(true);
    await writeFile(path, "two");
    const second = await session.open(path);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.sha256).not.toBe(first.value.sha256);
    expect(session.activeTarget()?.sha256).toBe(second.value.sha256);
    expect(await session.execute("binary_overview", {})).toMatchObject({
      ok: true,
      value: { result: second.value.sha256 },
    });
    expect(clients).toMatchObject([
      {
        targetSha256: first.value.sha256,
        calls: ["health"],
        closed: 1,
      },
      {
        targetSha256: second.value.sha256,
        calls: ["health", "binary_overview"],
        closed: 0,
      },
    ]);
    await session.close();
  });

  it("waits for an active call before closing its client during a switch", async () => {
    const [first, second] = await createBinarySessionTargets();
    const active = createDeferred<ReturnType<typeof ok>>();
    const clients: ControllableAnalysisClient[] = [];
    const session = createTestBinarySession(() => {
      const value = new ControllableAnalysisClient(
        undefined,
        false,
        clients.length === 0 ? active.promise : undefined,
      );
      clients.push(value);
      return value;
    });
    expect((await session.open(first)).ok).toBe(true);
    const current = session.activeTarget();
    if (current === undefined) throw new Error("Missing active target");
    const preview = await session.previewTarget(current);
    if (!preview.ok) throw preview.error;
    const call = session.execute("procedure_pseudo_code", {});
    const controller = new AbortController();
    const reopening = session.openResolvedTarget(preview.value, {
      signal: controller.signal,
    });
    // The resolved route needs no I/O; one event-loop turn lets it reach the drain.
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    const switching = session.open(second);
    await Promise.resolve();
    expect(clients[0]?.closed).toBe(0);
    active.resolve(ok(null));
    expect((await call).ok).toBe(true);
    expect(await reopening).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", operation: "open_binary" },
    });
    expect((await switching).ok).toBe(true);
    expect(clients[0]?.closed).toBe(1);
  });

  it("cancels an open queued behind another transition without creating a client", async () => {
    const [first, second] = await createBinarySessionTargets();
    const health = createDeferred<ReturnType<typeof ok>>();
    let created = 0;
    const session = createTestBinarySession(() => {
      created += 1;
      return new ControllableAnalysisClient(
        created === 1 ? health.promise : undefined,
      );
    });
    const opening = session.open(first);
    const controller = new AbortController();
    const queued = session.open(second, { signal: controller.signal });
    controller.abort();
    health.resolve(ok(null));
    await opening;
    const result = await queued;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(created).toBe(1);
  });
});

describe("cancellation during profile resolution", () => {
  it("owns provider rejection when profile resolution synchronously cancels opening", async () => {
    const [first] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    const controller = new AbortController();
    const failure = new Error("Profile resolution failed before cancellation");
    provider.resolveAnalysisProfile = () => {
      controller.abort({ caller: "late profile rejection" });
      return Promise.reject(failure);
    };
    const session = createTestBinarySession(provider);
    try {
      await expect(
        session.open(first, { signal: controller.signal }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          _tag: "ProviderAdapterError",
          operation: "resolve_analysis_profile",
          cause: failure,
        },
      });
      // Allow Node to report any rejection abandoned by the cancellation path.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(session.activeTarget()).toBeUndefined();
    } finally {
      await session.close();
    }
  });

  it("joins a signal-ignoring profile producer before cancellation and session close settle", async () => {
    const [first] = await createBinarySessionTargets();
    const provider = createCacheProvider([]);
    if (provider.resolveAnalysisProfile === undefined)
      throw new Error("Expected the fixture profile resolver");
    const resolveProfile = provider.resolveAnalysisProfile.bind(provider);
    const admitted = createDeferred<void>();
    const release = createDeferred<void>();
    let observedSignal: AbortSignal | undefined;
    let created = 0;
    provider.resolveAnalysisProfile = async (target, options) => {
      observedSignal = options?.signal;
      admitted.resolve();
      await release.promise;
      return resolveProfile(target);
    };
    provider.createClient = () => {
      created++;
      return new ControllableAnalysisClient();
    };
    const session = createTestBinarySession(provider);
    const controller = new AbortController();
    const reason = { caller: "profile cancellation" };
    let openSettled = false;
    const opening = session
      .open(first, { signal: controller.signal })
      .then((result) => {
        openSettled = true;
        return result;
      });
    await admitted.promise;
    controller.abort(reason);
    let closeSettled = false;
    const closing = session.close().then((result) => {
      closeSettled = true;
      return result;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(observedSignal?.reason).toBe(reason);
      expect(openSettled).toBe(false);
      expect(closeSettled).toBe(false);
      expect(await session.status()).toMatchObject({ cleanup_pending: true });
      release.resolve();
      await expect(opening).resolves.toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError", cause: reason },
      });
      expect(await closing).toEqual(resultOk(null));
      expect(created).toBe(0);
      expect(await session.status()).toMatchObject({ cleanup_pending: false });
    } finally {
      release.resolve();
      await Promise.all([opening, closing]);
      await session.close();
    }
  });
});

describe("cancellation during client transitions", () => {
  it("cancels a call while it waits for a transition", async () => {
    const [first] = await createBinarySessionTargets();
    const health = createDeferred<ReturnType<typeof ok>>();
    const session = createTestBinarySession(
      () => new ControllableAnalysisClient(health.promise),
    );
    const opening = session.open(first);
    const controller = new AbortController();
    const call = session.execute(
      "binary_overview",
      {},
      {
        signal: controller.signal,
      },
    );
    controller.abort();
    const result = await call;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
    health.resolve(ok(null));
    await opening;
  });

  it("closes a failed candidate and reopens the previous target", async () => {
    const [first, second] = await createBinarySessionTargets();
    const clients: ControllableAnalysisClient[] = [];
    const session = createTestBinarySession(() => {
      const value = new ControllableAnalysisClient(
        undefined,
        clients.length === 1,
      );
      clients.push(value);
      return value;
    });
    expect((await session.open(first)).ok).toBe(true);
    expect((await session.open(second)).ok).toBe(false);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(clients[1]?.closed).toBe(1);
    expect(clients[0]?.closed).toBe(1);
    expect(clients[2]?.closed).toBe(0);
    expect(JSON.stringify(await session.status())).toContain("first.hop");
    await session.close();
    await session.close();
    expect(clients[2]?.closed).toBe(1);
  });

  it("closes the active bridge before starting a replacement", async () => {
    const [first, second] = await createBinarySessionTargets();
    let liveClients = 0;
    let overlapped = false;
    const session = createTestBinarySession(() => ({
      execute: () => {
        if (liveClients > 0) overlapped = true;
        liveClients += 1;
        return Promise.resolve(ok(null));
      },
      close: () => {
        liveClients -= 1;
        return Promise.resolve(resultOk(null));
      },
    }));
    expect((await session.open(first)).ok).toBe(true);
    expect((await session.open(second)).ok).toBe(true);
    expect(liveClients).toBe(1);
    expect(overlapped).toBe(false);
    await session.close();
    expect(liveClients).toBe(0);
  });

  it("clears session state while preserving a typed provider cleanup failure", async () => {
    const [first] = await createBinarySessionTargets();
    const cleanupError = new ProviderCleanupError(
      "fixture",
      ["fixture-document"],
      { reason: "shutdown acknowledgement missing" },
    );
    const session = createTestBinarySession(() => ({
      execute: () => Promise.resolve(ok(null)),
      close: () => Promise.resolve(err(cleanupError)),
    }));
    expect((await session.open(first)).ok).toBe(true);

    expect(await session.close()).toEqual(err(cleanupError));
    expect(await session.status()).toMatchObject({
      open: false,
      analysis_activity: { status: "not_observed", providers: [] },
    });
  });
});

describe("no replacement start", () => {
  it("does not start a replacement after the active provider cleanup is unconfirmed", async () => {
    const [first, second] = await createBinarySessionTargets();
    const cleanupError = new ProviderCleanupError(
      "fixture",
      ["fixture-document"],
      { reason: "shutdown acknowledgement missing" },
    );
    let created = 0;
    const session = createTestBinarySession(() => {
      created += 1;
      return {
        execute: () => Promise.resolve(ok(null)),
        close: () => Promise.resolve(err(cleanupError)),
      };
    });
    expect((await session.open(first)).ok).toBe(true);

    expect(await session.open(second)).toEqual(err(cleanupError));
    expect(created).toBe(1);
    expect(await session.status()).toMatchObject({ open: false });
  });
});

describe("selector origin forwarding", () => {
  it("forwards the per-call selector origin to the provider client on both execution paths", async () => {
    const [first] = await createBinarySessionTargets();
    const seen: unknown[] = [];
    const session = createTestBinarySession(() => ({
      execute: (_operation, _parameters, options) => {
        seen.push(options?.selectorOrigin);
        return Promise.resolve(ok(null));
      },
      close: () => Promise.resolve(resultOk(null)),
    }));
    expect((await session.open(first)).ok, "the target opens").toBe(true);
    seen.length = 0;

    await session.execute(
      "address_name",
      { address: "0x1000" },
      { selectorOrigin: "provider" },
    );
    await session.withAdmittedAnalysis(
      "binary_overview",
      undefined,
      (analysis) =>
        analysis.execute(
          "address_name",
          { address: "0x2000" },
          { selectorOrigin: "provider" },
        ),
    );
    await session.execute("address_name", { address: "0x3000" });

    expect(
      seen,
      "direct and admitted calls forward the origin; an unmarked call carries none",
    ).toEqual(["provider", "provider", undefined]);
  });
});

it("blocks analysis rebinding until the external writer cleanup settles", async () => {
  const [target] = await createBinarySessionTargets();
  const session = createTestBinarySession(createCacheProvider([]));
  expect((await session.open(target)).ok).toBe(true);
  const failure = new ProviderCleanupError("rizin", ["writer"], {
    reason: "writer remains alive",
  });
  const result = await session.withAdmittedExternalMutation(
    target,
    undefined,
    async () => err(failure),
    (_value, error) => error,
  );
  expect(result).toEqual(resultOk(err(failure)));
  expect(session.activeTarget()).toBeUndefined();
  expect(await session.open(target)).toEqual(err(failure));
  const anotherMutation = vi.fn(async () => resultOk("unrelated command"));
  expect(
    await session.withAdmittedExternalMutation(
      target,
      undefined,
      anotherMutation,
      (_value, error) => error,
    ),
  ).toEqual(err(failure));
  expect(anotherMutation).not.toHaveBeenCalled();
  // Only the resource owner may acknowledge completed cleanup.
  failure.resolveCleanup();
  expect((await session.open(target)).ok).toBe(true);
  await session.close();
});

it("requires explicit close before an external mutation of an active Ghidra session", async () => {
  const [target] = await createBinarySessionTargets();
  const base = createCacheProvider([]);
  const identity = { id: "ghidra", name: "Ghidra", version: "fixture" };
  const session = createTestBinarySession({
    ...base,
    identity: () => identity,
    resolveAnalysisProfile: async () =>
      resultOk({
        profile: createAnalysisProfile(identity, { fixture: true }),
      }),
    capabilities: () =>
      base.capabilities().map((capability) => ({
        ...capability,
        provider: identity,
      })),
  });
  expect((await session.open(target)).ok).toBe(true);
  expect(session.providerIdentity().id).toBe("ghidra");
  const mutate = vi.fn(async () => resultOk("mutated"));
  const result = await session.withAdmittedExternalMutation(
    target,
    undefined,
    mutate,
    (_value, error) => error,
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      message: expect.stringContaining(
        "Close the active Ghidra session explicitly",
      ),
    },
  });
  expect(mutate).not.toHaveBeenCalled();
  expect(session.activeTarget()?.path).toBe(target);
  await session.close();
});

describe("reference truncation forwarding", () => {
  const referenceProvider = (
    referencesTruncated: boolean | undefined,
    calls: string[],
  ): AnalysisProvider => {
    const identity = {
      id: "fixture",
      name: "Fixture analysis provider",
      version: "1",
    } as const;
    return {
      identity: () => identity,
      resolveAnalysisProfile: () =>
        Promise.resolve(
          resultOk({
            profile: createAnalysisProfile(identity, { fixture: true }),
          }),
        ),
      capabilities: () => [
        {
          provider: identity,
          operation: "xrefs",
          available: true,
          reason: null,
          effects: {
            mutatesArtifact: false,
            launchesProcess: false,
            mayShowUi: false,
            mayAccessNetwork: false,
            mayWriteFilesystem: false,
            changesPermissions: false,
            requiresRoot: false,
          },
          limitations: [],
        },
      ],
      createClient: () => ({
        execute: (operation) => {
          calls.push(operation);
          return Promise.resolve(
            resultOk(
              createAnalysisExecution(
                ["0x2000"],
                identity,
                referencesTruncated === undefined
                  ? {}
                  : { referencesTruncated },
              ),
            ),
          );
        },
        close: () => Promise.resolve(resultOk(null)),
      }),
    };
  };
  const parameters = { address: "0x1000", document: "fixture" };

  it("forwards a truncation on both execution paths and never replays it from the snapshot", async () => {
    const [first] = await createBinarySessionTargets();
    const calls: string[] = [];
    const session = createTestBinarySession(referenceProvider(true, calls));
    expect((await session.open(first)).ok).toBe(true);
    calls.length = 0;

    const direct = await session.execute("xrefs", parameters);
    const admitted = await session.withAdmittedAnalysis(
      "trace_feature",
      undefined,
      (analysis) => analysis.execute("xrefs", parameters),
    );

    expect(direct.ok && direct.value.referencesTruncated).toBe(true);
    if (!admitted.ok) throw admitted.error;
    expect(admitted.value.ok && admitted.value.value.referencesTruncated).toBe(
      true,
    );
    expect(
      calls,
      "a truncated read is not recorded, so every call reaches the provider",
    ).toEqual(["xrefs", "xrefs"]);
  });

  it("keeps an explicit complete report out of the way of snapshot replay", async () => {
    const [first] = await createBinarySessionTargets();
    const calls: string[] = [];
    const session = createTestBinarySession(referenceProvider(false, calls));
    expect((await session.open(first)).ok).toBe(true);
    calls.length = 0;

    const live = await session.execute("xrefs", parameters);
    await session.execute("xrefs", parameters);

    expect(live.ok && live.value.referencesTruncated).toBe(false);
    expect(calls, "the complete read is recorded and replayed").toEqual([
      "xrefs",
    ]);
  });
});
