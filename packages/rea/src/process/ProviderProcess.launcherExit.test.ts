import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  type OwnedProcessGroup,
  type ProcessCleanupResult,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";
import { ProviderProcessSupervisor } from "./ProviderProcess.js";

const JAVA = "/usr/lib/jvm/java-21-openjdk-amd64/bin/java";

const ownership = (): OwnedProcessGroup => ({
  runId: "run-6134",
  leaderPid: 910,
  processGroupId: 910,
  expectedParentPid: 17,
  expectedCommand: JAVA,
  sweepTokenOwnedProcesses: true,
  evidenceOwner: new ProcessOwnershipEvidenceOwner(),
});

const launcherRow = (command: string): ProcessTableEntry => ({
  pid: 910,
  parentPid: 17,
  processGroupId: 910,
  state: "R",
  command,
});

const nativeIdentity = (
  lifecycle: "non-zombie" | "exiting",
): ProcessIdentityObservation => ({
  state: "readable",
  identity: "linux-starttime:4242",
  lifecycle: { state: "observed", lifecycle },
  relation: { state: "observed", parentPid: 17, processGroupId: 910 },
});

/** A launcher child whose exit the supervisor observes only when the test says so. */
const launcherChild = () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => false),
  });
  let exited = false;
  return {
    child,
    get exited() {
      return exited;
    },
    exit() {
      exited = true;
      child.emit("exit", 0, null);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    },
  };
};

/** Linux-like host: the launcher row stays listed until the child exits. */
const hostFor = (
  launcher: ReturnType<typeof launcherChild>,
  row: ProcessTableEntry,
  lifecycle?: "non-zombie" | "exiting",
): ProcessOwnershipHost => {
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: vi.fn(async () => (launcher.exited ? [] : [row])),
    environment: vi.fn(async () => ({ REA_PROCESS_RUN_ID: "run-6134" })),
    signalGroup: vi.fn(),
  };
  if (lifecycle === undefined) return host;
  return {
    ...host,
    processIdentities: vi.fn(async (rows: readonly ProcessTableEntry[]) => {
      const observation: ProcessIdentityObservation = launcher.exited
        ? { state: "absent", reason: "not-found-in-caller-pid-namespace" }
        : nativeIdentity(lifecycle);
      return new Map(rows.map(({ pid }) => [pid, observation] as const));
    }),
  };
};

const supervise = (
  launcher: ReturnType<typeof launcherChild>,
  host: ProcessOwnershipHost,
) => {
  const results: ProcessCleanupResult[] = [];
  const supervisor = new ProviderProcessSupervisor({
    process: launcher.child,
    ownsProcessLifetime: true,
    ownership: ownership(),
    cleanup: async () => {
      const result = await cleanupOwnedProcessGroup(ownership(), host);
      results.push(result);
      return result;
    },
  });
  return { supervisor, results };
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("re-verifies after the launcher's own exit settles an exiting procps row", async () => {
  const launcher = launcherChild();
  const host = hostFor(launcher, launcherRow("[java]"));
  const { supervisor, results } = supervise(launcher, host);
  // The JVM finishes tearing down only after the single table refresh.
  vi.mocked(host.listProcesses).mockImplementation(async () => {
    if (launcher.exited) return [];
    setTimeout(() => launcher.exit(), 20);
    return [launcherRow("[java]")];
  });

  await expect(supervisor.stop()).resolves.toEqual({
    status: "verified-cleanup",
  });
  expect(results).toEqual([
    {
      cleaned: false,
      reason: `owned launcher command identity did not match (observed=[java]; expected=${JAVA})`,
    },
    { cleaned: true, signaled: false },
  ]);
  expect(host.signalGroup).not.toHaveBeenCalled();
  expect(launcher.child.kill).not.toHaveBeenCalled();
});

it("re-verifies after native exit-in-progress outlasts the settlement deadline", async () => {
  const launcher = launcherChild();
  const host = hostFor(launcher, launcherRow("[java]"), "exiting");
  const { supervisor, results } = supervise(launcher, host);
  const exitTimer = setTimeout(() => launcher.exit(), 1_200);
  try {
    await expect(supervisor.stop({ killGraceMs: 2_000 })).resolves.toEqual({
      status: "verified-cleanup",
    });
  } finally {
    clearTimeout(exitTimer);
  }
  expect(results).toEqual([
    { cleaned: false, reason: "owned launcher exit could not be confirmed" },
    { cleaned: true, signaled: false },
  ]);
  expect(host.signalGroup).not.toHaveBeenCalled();
});

it.each([
  ["identityless", undefined],
  ["native", "non-zombie"],
] as const)(
  "keeps a still-live mismatched %s launcher incomplete without signaling",
  async (_host, lifecycle) => {
    const launcher = launcherChild();
    const host = hostFor(launcher, launcherRow("/usr/bin/other"), lifecycle);
    const { supervisor, results } = supervise(launcher, host);
    const started = performance.now();

    const stopped = await supervisor.stop({ killGraceMs: 50 });

    expect(performance.now() - started).toBeGreaterThanOrEqual(45);
    expect(stopped).toEqual({
      status: "incomplete",
      reason: `owned launcher command identity did not match (observed=/usr/bin/other; expected=${JAVA})`,
      cleanupResult: results[0],
    });
    expect(results).toHaveLength(1);
    expect(host.signalGroup).not.toHaveBeenCalled();
    expect(launcher.child.kill).not.toHaveBeenCalled();
    supervisor.dispose();
  },
);

it("does not repeat verification without new launcher exit evidence", async () => {
  const launcher = launcherChild();
  const cleanup = vi.fn(async (): Promise<ProcessCleanupResult> => ({
    cleaned: false,
    reason: "process table could not be inspected: spawn EPERM",
  }));
  const supervisor = new ProviderProcessSupervisor({
    process: launcher.child,
    ownsProcessLifetime: true,
    ownership: ownership(),
    cleanup,
  });
  launcher.exit();
  const started = performance.now();

  await expect(supervisor.stop()).resolves.toMatchObject({
    status: "incomplete",
    reason: "process table could not be inspected: spawn EPERM",
  });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(performance.now() - started).toBeLessThan(500);
});

it("retains the post-exit verification failure for a later owned retry", async () => {
  const launcher = launcherChild();
  const outcomes: ProcessCleanupResult[] = [
    { cleaned: false, reason: "owned launcher exit could not be confirmed" },
    {
      cleaned: false,
      reason: "process ownership could not be revalidated for PID 911: EACCES",
    },
    { cleaned: true, signaled: true },
  ];
  const cleanup = vi.fn(async (): Promise<ProcessCleanupResult> => {
    const next = outcomes.shift();
    if (next === undefined) throw new Error("unexpected cleanup attempt");
    if (cleanup.mock.calls.length === 1) setTimeout(() => launcher.exit(), 10);
    return next;
  });
  const supervisor = new ProviderProcessSupervisor({
    process: launcher.child,
    ownsProcessLifetime: true,
    ownership: ownership(),
    cleanup,
  });

  await expect(supervisor.stop()).resolves.toMatchObject({
    status: "incomplete",
    reason: "process ownership could not be revalidated for PID 911: EACCES",
  });
  expect(cleanup).toHaveBeenCalledTimes(2);
  await expect(supervisor.stop()).resolves.toEqual({
    status: "verified-cleanup",
  });
  expect(cleanup).toHaveBeenCalledTimes(3);
});
