import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  verifyNoTokenOwnedProcesses,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessRunTokenObservation,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

const row = (pid: number, parentPid: number): ProcessTableEntry => ({
  pid,
  parentPid,
  processGroupId: pid,
  state: "R",
  command: "/fixture/node",
});
const identity = (
  process: ProcessTableEntry,
  exiting: boolean,
): ProcessIdentityObservation => ({
  state: "readable",
  identity: `start:${process.pid}`,
  lifecycle: {
    state: "observed",
    lifecycle: exiting ? "exiting" : "non-zombie",
  },
  relation: {
    state: "observed",
    parentPid: process.parentPid,
    processGroupId: process.processGroupId,
  },
});

it.each([
  "readable",
  "retried",
  "reused",
  "retained-parent",
  "retained-parent-esrch",
] as const)(
  "keeps child scope tied to its native generation after parent exit (%s)",
  async (mode) => {
    const parent = row(200, 1);
    const child = row(300, parent.pid);
    const owner = new ProcessOwnershipEvidenceOwner();
    if (mode === "retained-parent" || mode === "retained-parent-esrch")
      owner.reconcile(
        [
          {
            process: parent,
            state: "same-generation",
            identityBefore: identity(parent, false),
            token: { state: "readable", runId: "run" },
            identityAfter: identity(parent, false),
          },
        ],
        {
          runId: "run",
          listedRows: 1,
          listedPids: new Set([parent.pid]),
          leaderPid: 100,
          processGroupIds: new Set([100]),
        },
      );
    const priorSnapshots = owner.coverage.snapshotCount;
    let parentReads = 0;
    let childTokenReads = 0;
    let reparented = false;
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [parent, child],
      environment: async (pid) =>
        pid === parent.pid ? { REA_PROCESS_RUN_ID: "run" } : {},
      runTokens: async (selected) =>
        new Map<number, ProcessRunTokenObservation>(
          selected.map((process) => [
            process.pid,
            process.pid === parent.pid
              ? mode === "retained-parent-esrch"
                ? {
                    state: "unavailable",
                    reason: "opaque failure",
                    code: "ESRCH",
                  }
                : mode === "retained-parent"
                  ? { state: "unavailable", reason: "EACCES" }
                  : { state: "readable", runId: "run" }
              : ++childTokenReads === 1 && mode !== "readable"
                ? { state: "unavailable", reason: "EACCES" }
                : { state: "readable", runId: undefined },
          ]),
        ),
      processIdentities: async (selected) =>
        new Map<number, ProcessIdentityObservation>(
          selected.map((process) => {
            if (process.pid === parent.pid && ++parentReads > 2) {
              reparented = true;
              return [
                process.pid,
                { state: "absent", reason: "not-in-snapshot" },
              ];
            }
            const observed =
              process.pid === child.pid && reparented
                ? { ...process, parentPid: 1 }
                : process;
            const current = identity(
              observed,
              process.pid === parent.pid && parentReads === 2,
            );
            return [
              process.pid,
              process.pid === child.pid &&
              reparented &&
              mode === "reused" &&
              current.state === "readable"
                ? { ...current, identity: "start:replacement" }
                : current,
            ];
          }),
        ),
      signalGroup: vi.fn(),
    };
    const result = await verifyNoTokenOwnedProcesses("run", host, undefined, {
      leaderPid: 100,
      processGroupId: 100,
      evidenceOwner: owner,
    });
    if (mode === "reused") {
      // A replacement process cannot inherit the original child's history.
      expect(result.cleaned).toBe(true);
      expect(owner.candidates).not.toContainEqual(
        expect.objectContaining({ pid: child.pid }),
      );
    } else {
      // The original child stays live even though its parent has exited.
      expect(result.cleaned).toBe(false);
      expect(owner.candidates).toContainEqual(
        expect.objectContaining({
          pid: child.pid,
          identity: "start:300",
          applicability: "related-ownership-unresolved",
        }),
      );
    }
    expect(host.signalGroup).not.toHaveBeenCalled();
    expect(owner.coverage.snapshotCount).toBe(priorSnapshots + 1);
  },
);

it("shares native exit waiting before signaling healthy groups in one cleanup attempt", async () => {
  const root = row(100, 1);
  const rows = [
    root,
    row(200, root.pid),
    row(300, root.pid),
    row(400, root.pid),
  ];
  let clock = 0;
  let firstSignalAt: number | undefined;
  const nativeClock = vi
    .spyOn(performance, "now")
    .mockImplementation(() => clock);
  const host: ProcessOwnershipHost = {
    listProcesses: async () => rows,
    environment: async () => ({ REA_PROCESS_RUN_ID: "run" }),
    processIdentities: async (selected) => {
      clock += 25;
      return new Map<number, ProcessIdentityObservation>(
        selected.map((process) => [
          process.pid,
          identity(process, process.pid !== root.pid),
        ]),
      );
    },
    signalGroup: vi.fn((group) => {
      expect(group).toBe(root.pid);
      firstSignalAt ??= clock;
    }),
  };
  try {
    const result = await cleanupOwnedProcessGroup(
      {
        runId: "run",
        leaderPid: root.pid,
        processGroupId: root.pid,
        sweepTokenOwnedProcesses: true,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      },
      host,
    );
    expect(result.cleaned).toBe(false);
    expect(firstSignalAt).toBeDefined();
    // Controlled native-observation time, not a wall-clock timeout: three
    // stuck helpers must not each add another full second before root signal.
    expect(firstSignalAt).toBeLessThan(2_000);
  } finally {
    nativeClock.mockRestore();
  }
});
