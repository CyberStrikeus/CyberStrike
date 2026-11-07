import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../../tests/fixtures/lifecycleAcknowledgement.js";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { elf } from "../../domain/binaryTarget.fixture.js";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type AnalysisProvider,
  type AnalysisProviderCandidate,
  type CapabilityDescriptor,
  type ProviderAvailability,
  type ProviderIdentity,
  type ProviderTargetSupport,
} from "../AnalysisProvider.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import type { ProviderOperationHealth } from "../../domain/providerOperationHealth.js";
import { err, ok } from "../../domain/result.js";
import { buildCapabilityInventory } from "../CapabilityInventory.js";
import { InvestigationRecords } from "../investigation/InvestigationRecords.js";
import { AnalysisProviderRegistry } from "./AnalysisProviderRegistry.js";
import { BinarySession } from "./BinarySession.js";
import { SessionProviderRouter } from "./SessionProviderRouter.js";

/**
 * Regression coverage for https://github.com/morluto/rea/issues/1719:
 * `BinarySession#open` must not short-circuit on the `sameTarget &&
 * sameProfile` fast path when the retained provider client is dead. It must
 * start a fresh client instead.
 *
 * The fixtures are production-composed: a deep provider plus an auxiliary
 * provider, so `SessionProviderRouter` wraps them in a real
 * `CompositeProvider` exactly like `src/composition/binary.ts` does for the
 * CLI/MCP runtime. The composite's `health` answers unconditionally ok
 * without touching a child, so a probe that only calls `health` cannot see a
 * dead child — the liveness signal must reach the actual child through
 * `operationHealthSnapshot`, the way `HopperClient.operationHealth` reports a
 * recorded process exit.
 */
it("binds omitted provider subjects to the selected target", async () => {
  const { session } = openSession();
  const opened = await session.open(process.execPath);
  expect(opened.ok).toBe(true);
  const execution = await session.execute("address_name", {});
  expect(execution.ok).toBe(true);
  if (!execution.ok || !opened.ok) return;
  expect(execution.value.subject).toEqual({
    path: opened.value.path,
    sha256: opened.value.sha256,
    format: opened.value.format,
    ...(opened.value.architecture === undefined
      ? {}
      : { architecture: opened.value.architecture }),
  });
});

it("preserves an explicitly unbound provider observation", async () => {
  const { session } = openSession({ explicitNullSubject: true });
  expect((await session.open(process.execPath)).ok).toBe(true);
  const execution = await session.execute("address_name", {});
  expect(execution.ok).toBe(true);
  if (execution.ok) expect(execution.value.subject).toBeNull();
});

it("retains live source Evidence without replaying a prior observation", async () => {
  const { session, deep } = openSession({ live: true });
  expect((await session.open(process.execPath)).ok).toBe(true);
  expect(
    (
      await session.execute("address_name", {
        document: "0",
        address: "0x9999",
      })
    ).ok,
  ).toBe(true);
  const child = deep.created[0];
  if (child === undefined) throw new Error("expected provider child");
  let reads = 0;
  child.execute = () =>
    Promise.resolve(
      ok(createAnalysisExecution(`live ${++reads}`, deepIdentity)),
    );
  const parameters = { document: "0", address: "0x1000" };
  const first = await session.execute("address_name", parameters);
  const second = await session.execute("address_name", parameters);
  expect(first.ok && first.value.result).toBe("live 1");
  expect(second.ok && second.value.result).toBe("live 2");
  if (!first.ok || !second.ok) return;
  expect(first.value.evidenceId).toBeDefined();
  expect(second.value.evidenceId).toBeDefined();
  expect(first.value.evidenceId).not.toBe(second.value.evidenceId);
  expect(session.exportEvidenceBundle().records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ normalized_result: "live 1" }),
      expect.objectContaining({ normalized_result: "live 2" }),
    ]),
  );
  const snapshot = session.exportAnalysisSnapshot();
  expect(snapshot.ok, snapshot.ok ? undefined : snapshot.error.message).toBe(
    true,
  );
  if (!snapshot.ok) return;
  expect(snapshot.value.entries).toEqual([]);
});

it("keeps unbound observations out of persisted target snapshots", async () => {
  const { session, deep } = openSession();
  const directory = await createTestTempDirectory("rea-unbound-snapshot-");
  const path = join(directory, "snapshot.json");
  const parameters = { document: "0", address: "0x1000" };
  expect((await session.open(process.execPath)).ok).toBe(true);
  const bound = await session.execute("address_name", parameters);
  expect(bound.ok).toBe(true);
  const child = deep.created[0];
  if (child === undefined || !bound.ok) throw new Error("Expected bound read");
  child.execute = () =>
    Promise.resolve(
      ok(
        createAnalysisExecution("unbound observation", deepIdentity, {
          subject: null,
        }),
      ),
    );
  const execution = await session.execute("address_name", {
    ...parameters,
    address: "0x2000",
  });
  expect(execution.ok).toBe(true);
  if (!execution.ok) return;
  expect(execution.value.subject).toBeNull();
  expect(session.exportEvidenceBundle().records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        subject: null,
        normalized_result: "unbound observation",
      }),
    ]),
  );
  const snapshot = session.exportAnalysisSnapshot();
  expect(snapshot.ok, snapshot.ok ? undefined : snapshot.error.message).toBe(
    true,
  );
  if (!snapshot.ok) return;
  expect(snapshot.value.entries).toHaveLength(1);
  expect(snapshot.value.entries[0]?.parameters).toEqual(parameters);
  const unboundReplay = await session.execute("address_name", {
    ...parameters,
    address: "0x2000",
  });
  expect(unboundReplay.ok).toBe(true);
  if (unboundReplay.ok) {
    expect(unboundReplay.value.subject).toBeNull();
    expect(unboundReplay.value.evidenceId).toBe(execution.value.evidenceId);
  }
  expect(
    (await session.writeAnalysisSnapshot(snapshot.value, path, false)).ok,
  ).toBe(true);
  expect((await session.close()).ok).toBe(true);
  expect(
    (
      await session.open(process.execPath, {
        loadSnapshot: () => session.readAnalysisSnapshot(path),
      })
    ).ok,
  ).toBe(true);
  const replay = await session.execute("address_name", parameters);
  expect(replay.ok).toBe(true);
  if (replay.ok) {
    expect(replay.value.evidenceId).toBe(bound.value.evidenceId);
    expect(replay.value.limitations).toContain(
      "Loaded from a local REA analysis snapshot; this call did not re-run the provider.",
    );
  }
});

describe("BinarySession open liveness", () => {
  it("retires a locally blocked owner even when its native health is idle", async () => {
    const { session, deep } = openSession();
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    const retained = deep.created[0];
    if (retained === undefined) throw new Error("Expected an acquired child");
    retained.reuseReadiness = () => "blocked";
    expect(retained.operationHealthSnapshot?.()?.state).toBe("idle");
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect(retained.closeCalled).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(2);
  });
  it("reuses the retained client while the child stays live", async () => {
    const { session, deep } = openSession();
    expect((await session.open(process.execPath)).ok).toBe(true);
    // Instantiate the deep child inside the composite, like a real query would.
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(1);

    const second = await session.open(process.execPath);
    expect(second.ok).toBe(true);
    // Still the same composite and child: nothing was retired or recreated.
    expect(deep.created).toHaveLength(1);
    expect(deep.created[0]?.closeCalled).toBe(false);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(1);
  });

  it("starts a fresh client when the retained child died", async () => {
    const { session, deep } = openSession();
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(1);

    // Kill the provider process out from under the session, then re-open
    // the same target: the session must not short-circuit on the dead
    // child — it must retire it and start a real one.
    const dead = deep.created[0];
    dead?.kill();

    const second = await session.open(process.execPath);
    expect(second.ok).toBe(true);
    // The dead binding was retired, not retained.
    expect(dead?.closeCalled).toBe(true);
    // The next query runs against a freshly created child, not the dead one.
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(2);
  });

  it("treats an uncharacterized operation failure as dead", async () => {
    // A recorded failure the provider could not characterize ("unknown",
    // e.g. a Hopper spawn failure with no observed exit code) is never
    // evidence of health: the gate fails closed.
    const { session, deep } = openSession();
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(1);

    const dead = deep.created[0];
    dead?.kill("unknown");

    const second = await session.open(process.execPath);
    expect(second.ok).toBe(true);
    expect(dead?.closeCalled).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(2);
  });

  it("retires a retained client whose startup never completed", async () => {
    // A Hopper startup timeout leaves the operation-health snapshot in
    // "not_started" while the retained resources block the next start()
    // until close() retries cleanup. Classifying that state as live would return success
    // without entering the retire path, so subsequent analysis still hits
    // the wedged client.
    const { session, deep } = openSession();
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(1);

    const wedged = deep.created[0];
    wedged?.kill("not_started");

    const second = await session.open(process.execPath);
    expect(second.ok).toBe(true);
    // The wedged binding was retired (close ran, so cleanup is retried),
    // not reused.
    expect(wedged?.closeCalled).toBe(true);
    // The next query runs against a freshly created child, not the wedged one.
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(2);
  });

  it("probes instantiated children through health when snapshots are absent", async () => {
    const { session, deep } = openSession({ operationHealth: false });
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(1);

    const second = await session.open(process.execPath);
    expect(second.ok).toBe(true);
    // The composite probes this already-instantiated child rather than
    // answering health without contacting it.
    expect(deep.created).toHaveLength(1);
    expect(deep.created[0]?.closeCalled).toBe(false);
    expect(deep.created[0]?.healthCalls).toBe(1);
  });

  it("retires a dead no-snapshot child after its health probe fails", async () => {
    const { session, deep } = openSession({ operationHealth: false });
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    const dead = deep.created[0];
    dead?.kill();

    expect((await session.open(process.execPath)).ok).toBe(true);
    expect(dead?.healthCalls).toBe(1);
    expect(dead?.closeCalled).toBe(true);
    expect(deep.created).toHaveLength(1);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect(deep.created).toHaveLength(2);
  });

  it("does not instantiate a child to answer health before first use", async () => {
    const { session, deep } = openSession({ operationHealth: false });
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect(deep.created).toEqual([]);
  });

  it("reports cancellation without touching the session when aborted mid-probe", async () => {
    const { session, deep, onProbe } = openSession();
    expect((await session.open(process.execPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);

    const controller = new AbortController();
    // Fire the abort while the fast-path liveness probe is in flight: the
    // hook runs synchronously inside the snapshot read, so the abort lands
    // after the probe started but before the fast-path decision completes.
    let fired = false;
    onProbe(() => {
      if (!fired) {
        fired = true;
        controller.abort();
      }
    });

    const cancelled = await session.open(process.execPath, {
      signal: controller.signal,
    });
    expect(cancelled).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    // The dead-or-live question is moot: the session must be untouched.
    expect(deep.created).toHaveLength(1);
    expect(deep.created[0]?.closeCalled).toBe(false);
    const reopened = await session.open(process.execPath);
    expect(reopened.ok).toBe(true);
    expect(deep.created).toHaveLength(1);
  });
});

it("clears retired runtime availability after cancelled-switch restoration", async () => {
  let closeStarted!: () => void;
  const closing = new Promise<void>((resolve) => {
    closeStarted = resolve;
  });
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  const { session, deep } = openSession({
    failOperationInitially: true,
    releaseBeforeCleanup: releaseClose,
    beforeFirstClose: async () => {
      closeStarted();
      await closeGate;
    },
  });
  expect((await session.open(process.execPath)).ok).toBe(true);
  expect((await session.execute("address_name", {})).ok).toBe(false);
  const availability = async () =>
    buildCapabilityInventory(await session.status(), {
      processCaptureEnabled: false,
    }).find(({ name }) => name === "address_name");
  const initialAvailability = await availability();
  expect(initialAvailability).toMatchObject({
    available: false,
    reason: "provider_unavailable",
  });
  const originalTarget = session.activeTarget();
  const initialRunId = sessionRunId(await session.status());

  const controller = new AbortController();
  const alternate = join(
    await createTestTempDirectory("rea-liveness-switch-"),
    "alternate.elf",
  );
  await writeFile(alternate, elf(2, 1, 62));
  const switching = session.open(alternate, { signal: controller.signal });
  const cancelled = await withVerifierCleanup(async () => {
    await awaitAcknowledgement(closing, switching, "provider close");
    controller.abort();
    releaseClose();
    return await switching;
  }, [
    releaseClose,
    async () => {
      await switching;
    },
  ]);
  expect(cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(session.activeTarget()).toEqual(originalTarget);
  expect(deep.created).toHaveLength(1);
  expect(deep.created[0]?.closeCalled).toBe(true);
  const restoredStatus = await session.status();
  expect(sessionRunId(restoredStatus)).not.toBe(initialRunId);
  expect(await availability()).toMatchObject({
    available: true,
    reason: "available",
    remediation: null,
  });
  // Cancellation remains the caller-visible outcome after cleanup and
  // restoration, while the new restored client is healthy and usable.
  expect((await session.execute("address_name", {})).ok).toBe(true);
  expect(deep.created).toHaveLength(2);
  expect(await availability()).toMatchObject({
    available: true,
    reason: "available",
    remediation: null,
  });
  deep.created[1]?.setOperationFailure(true);
  expect((await session.execute("address_name", {})).ok).toBe(false);
  expect(await availability()).toMatchObject({
    available: false,
    reason: "provider_unavailable",
  });
  deep.created[1]?.setOperationFailure(false);
  expect((await session.execute("address_name", {})).ok).toBe(true);
  expect(await availability()).toMatchObject({
    available: true,
    reason: "available",
    remediation: null,
  });
});

const sessionRunId = (
  status: Awaited<ReturnType<BinarySession["status"]>>,
): string => {
  if (typeof status !== "object" || status === null || Array.isArray(status))
    throw new Error("Expected a binary session status object");
  const analysisRun = status.analysis_run;
  if (
    typeof analysisRun !== "object" ||
    analysisRun === null ||
    Array.isArray(analysisRun) ||
    typeof analysisRun.run_id !== "string"
  )
    throw new Error("Expected an active analysis run");
  return analysisRun.run_id;
};

interface KillableChild extends AnalysisClient {
  kill(state?: "exited" | "unreachable" | "unknown" | "not_started"): void;
  setOperationFailure(value: boolean): void;
  closeCalled: boolean;
  healthCalls: number;
}

const deepIdentity: ProviderIdentity = {
  id: "liveness-deep",
  name: "Liveness deep provider",
  version: "1",
};

const auxIdentity: ProviderIdentity = {
  id: "liveness-aux",
  name: "Liveness auxiliary provider",
  version: "1",
};

const capability = (
  identity: ProviderIdentity,
  operation: Exclude<AnalysisOperation, "health">,
): CapabilityDescriptor => ({
  provider: identity,
  operation,
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
});

const openSession = (
  options: {
    operationHealth?: boolean;
    failOperationInitially?: boolean;
    beforeFirstClose?: () => Promise<void>;
    releaseBeforeCleanup?: () => void;
    explicitNullSubject?: boolean;
    live?: boolean;
  } = {},
): {
  session: BinarySession;
  deep: { created: KillableChild[] };
  onProbe: (hook: () => void) => void;
} => {
  const { provider, created, onProbe } = killableDeepProvider(options);
  // Mirror the production composition: a deep provider plus auxiliary
  // providers, so the route wraps them in a real CompositeProvider (whose
  // trivially-ok `health` must not mask a dead child).
  const aux: AnalysisProvider = {
    identity: () => auxIdentity,
    capabilities: () => [],
    createClient: (): AnalysisClient => ({
      execute: (operation) =>
        Promise.resolve(
          ok(createAnalysisExecution(`aux:${operation}`, auxIdentity)),
        ),
      close: () => Promise.resolve(ok(null)),
    }),
  };
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([provider]), [
      aux,
    ]),
    new InvestigationRecords(),
  );
  onTestFinished(async () => {
    options.releaseBeforeCleanup?.();
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  return { session, deep: { created }, onProbe };
};

const killableDeepProvider = (options: {
  operationHealth?: boolean;
  failOperationInitially?: boolean;
  beforeFirstClose?: () => Promise<void>;
  explicitNullSubject?: boolean;
  live?: boolean;
}): {
  provider: AnalysisProviderCandidate;
  created: KillableChild[];
  onProbe: (hook: () => void) => void;
} => {
  const created: KillableChild[] = [];
  let probeHook: (() => void) | undefined;
  const withOperationHealth = options.operationHealth !== false;
  const provider: AnalysisProviderCandidate = {
    identity: () => deepIdentity,
    capabilities: () => [
      {
        ...capability(deepIdentity, "address_name"),
        ...(options.live ? { cachePolicy: "live" as const } : {}),
      },
    ],
    inspectAvailability: (): ProviderAvailability => ({
      status: "available",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    inspectTargetSupport: (): ProviderTargetSupport => ({
      status: "supported",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    resolveAnalysisProfile: () =>
      Promise.resolve(
        ok({
          profile: createAnalysisProfile(
            { id: deepIdentity.id, name: deepIdentity.name, version: "1" },
            { fixture: "liveness" },
          ),
        }),
      ),
    createClient: (): KillableChild => {
      const firstClient = created.length === 0;
      let alive = true;
      let failOperation =
        firstClient && options.failOperationInitially === true;
      let closeCalled = false;
      let healthCalls = 0;
      let deadState: "exited" | "unreachable" | "unknown" | "not_started" =
        "exited";
      const client: KillableChild = {
        execute: (operation) => {
          if (operation === "health") healthCalls += 1;
          return alive && !(operation !== "health" && failOperation)
            ? Promise.resolve(
                ok(
                  createAnalysisExecution(
                    operation === "health" ? null : `liveness:${operation}`,
                    deepIdentity,
                    operation !== "health" &&
                      options.explicitNullSubject === true
                      ? { subject: null }
                      : {},
                  ),
                ),
              )
            : Promise.resolve(
                err(
                  new ProviderAdapterError(deepIdentity.id, operation, {
                    diagnostics: { reason: "process_killed" },
                  }),
                ),
              );
        },
        // Genuine child-liveness signal, like HopperClient.operationHealth:
        // a recorded process exit stays visible after the kill.
        ...(withOperationHealth
          ? {
              operationHealthSnapshot: (): ProviderOperationHealth => {
                probeHook?.();
                return {
                  state: alive ? "idle" : deadState,
                  stage: alive ? null : "connection",
                  retryAction: alive ? null : "restart_provider",
                  exitCode: alive ? null : 1,
                  requests: [],
                };
              },
            }
          : {}),
        close: async () => {
          closeCalled = true;
          if (firstClient && options.beforeFirstClose !== undefined)
            await options.beforeFirstClose();
          return ok(null);
        },
        get closeCalled() {
          return closeCalled;
        },
        get healthCalls() {
          return healthCalls;
        },
        kill: (
          state:
            | "exited"
            | "unreachable"
            | "unknown"
            | "not_started" = "exited",
        ) => {
          alive = false;
          deadState = state;
        },
        setOperationFailure: (value: boolean) => {
          failOperation = value;
        },
      };
      created.push(client);
      return client;
    },
  };
  return {
    provider,
    created,
    onProbe: (hook: () => void) => {
      probeHook = hook;
    },
  };
};
