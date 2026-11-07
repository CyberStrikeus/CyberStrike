import { describe, expect, it, vi } from "vitest";
import type {
  OwnedProcessGroup,
  ProcessLineageObservation,
  ProcessOwnershipHost,
  ProcessTableEntry,
} from "../process/ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "../process/ProcessOwnershipEvidence.js";
import { cleanupElectronProcesses } from "./ElectronProcessCleanup.js";
import { observeOwnedProcessLineage } from "../process/ProcessOwnershipObservation.js";

describe.skipIf(process.platform === "win32")(
  "Electron cleanup ownership evidence",
  () => {
    it("keeps a previously token-owned helper unresolved after it reparents and changes groups", async () => {
      let rows: readonly ProcessTableEntry[] = [
        {
          pid: 100,
          parentPid: 1,
          processGroupId: 100,
          state: "S",
          command: "electron",
        },
        {
          pid: 101,
          parentPid: 100,
          processGroupId: 100,
          state: "S",
          command: "electron-helper",
        },
      ];
      let withholdToken = false;
      const evidenceOwner = new ProcessOwnershipEvidenceOwner();
      const ownership: OwnedProcessGroup = {
        runId: "electron-run",
        leaderPid: 100,
        processGroupId: 100,
        expectedParentPid: 1,
        expectedCommand: "electron",
        sweepTokenOwnedProcesses: true,
        evidenceOwner,
      };
      const host: ProcessOwnershipHost = {
        platform: process.platform,
        listProcesses: () => Promise.resolve(rows),
        environment: () => Promise.resolve({}),
        runTokens: (members) =>
          Promise.resolve(
            new Map(
              members.map(({ pid }) => [
                pid,
                withholdToken
                  ? {
                      state: "unavailable" as const,
                      reason: "platform_binary_environment_withheld",
                    }
                  : { state: "readable" as const, runId: "electron-run" },
              ]),
            ),
          ),
        processIdentities: (members) =>
          Promise.resolve(
            new Map(
              members.map((member) => [
                member.pid,
                withholdToken && member.pid === 100
                  ? {
                      state: "absent" as const,
                      reason:
                        process.platform === "darwin"
                          ? ("not-in-snapshot" as const)
                          : ("not-found-in-caller-pid-namespace" as const),
                    }
                  : {
                      state: "readable" as const,
                      identity: `start-${String(member.pid)}`,
                      lifecycle: {
                        state: "observed" as const,
                        lifecycle: "non-zombie" as const,
                      },
                      relation: {
                        state: "observed" as const,
                        parentPid: member.parentPid,
                        processGroupId: member.processGroupId,
                      },
                    },
              ]),
            ),
          ),
        signalGroup: vi.fn(() => {
          rows = [
            {
              pid: 101,
              parentPid: 1,
              processGroupId: 200,
              state: "S",
              command: "electron-helper",
            },
          ];
          withholdToken = true;
        }),
      };
      const lineage: ProcessLineageObservation = {
        status: "verified",
        observedAt: "2026-10-19T00:00:00.000Z",
        lineage: {
          runId: ownership.runId,
          launcherPid: ownership.leaderPid,
          launcherParentPid: 1,
          processGroupId: ownership.processGroupId,
          descendants: [{ pid: 101, parentPid: 100, processGroupId: 100 }],
        },
      };

      const result = await cleanupElectronProcesses(ownership, lineage, {
        platform: process.platform,
        terminateTree: vi.fn(),
        processOwnershipHost: host,
      });

      expect(result.cleaned).toBe(false);
      if (result.cleaned)
        throw new Error("expected cleanup to remain unresolved");
      expect(result.reason).toContain(
        "process ownership token could not be read",
      );
      expect(evidenceOwner.candidates).toMatchObject([
        {
          pid: 101,
          identity: "start-101",
          applicability: "token-verified",
          scopeEvidence: "run-token",
          relation: { parentPid: 1, processGroupId: 200 },
        },
      ]);
    });
  },
);

it.each([
  { peerFails: false, withholdToken: true },
  { peerFails: true, withholdToken: true },
  { peerFails: false, withholdToken: false },
])(
  "retains detached lineage evidence (initial peer failure: $peerFails, withheld token: $withholdToken)",
  async ({ peerFails, withholdToken }) => {
    let detached = false;
    const launcher: ProcessTableEntry = {
      pid: 100,
      parentPid: 1,
      processGroupId: 100,
      state: "S",
      command: "electron",
    };
    const child: ProcessTableEntry = {
      pid: 101,
      parentPid: 100,
      processGroupId: 100,
      state: "S",
      command: "helper",
    };
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "lineage-run",
      leaderPid: 100,
      processGroupId: 100,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    let launcherExited = false;
    let childExited = false;
    const signalGroup = vi.fn((groupId: number) => {
      if (groupId === 100) launcherExited = true;
      if (groupId === 200) childExited = true;
    });

    const host: ProcessOwnershipHost = {
      listProcesses: async () => [
        ...(launcherExited ? [] : [launcher]),
        ...(childExited
          ? []
          : [
              detached
                ? { ...child, parentPid: 1, processGroupId: 200 }
                : child,
            ]),
        ...(!detached && peerFails ? [{ ...child, pid: 102 }] : []),
      ],
      environment: async () => ({}),
      runTokens: async (members) =>
        new Map(
          members.map(({ pid }) => [
            pid,
            (detached && withholdToken && pid === 101) ||
            (peerFails && pid === 102)
              ? {
                  state: "unavailable" as const,
                  reason: "platform_binary_environment_withheld",
                }
              : { state: "readable" as const, runId: ownership.runId },
          ]),
        ),
      processIdentities: async (members) =>
        new Map(
          members.map(({ pid }) => [
            pid,
            (launcherExited && pid === 100) ||
            (childExited && pid === 101) ||
            (detached && pid === 102)
              ? { state: "absent" as const, reason: "not-in-snapshot" as const }
              : {
                  state: "readable" as const,
                  identity: `generation-${pid}`,
                  lifecycle: {
                    state: "observed" as const,
                    lifecycle: "non-zombie" as const,
                  },
                  relation: {
                    state: "observed" as const,
                    parentPid: pid === 100 || detached ? 1 : 100,
                    processGroupId: detached && pid === 101 ? 200 : 100,
                  },
                },
          ]),
        ),
      signalGroup,
    };
    const first = await observeOwnedProcessLineage(ownership, host);
    expect(first.status).toBe(peerFails ? "unavailable" : "verified");
    expect(evidenceOwner.candidates).toContainEqual(
      expect.objectContaining({
        pid: 101,
        identity: "generation-101",
        applicability: "token-verified",
      }),
    );
    detached = true;
    const current = await observeOwnedProcessLineage(ownership, host);
    expect(current).toMatchObject({
      status: "verified",
      lineage: { descendants: [] },
    });
    const result = await cleanupElectronProcesses(ownership, current, {
      platform: "darwin",
      terminateTree: vi.fn(),
      processOwnershipHost: host,
    });
    if (withholdToken) {
      expect(result).toMatchObject({ cleaned: false });
      expect(signalGroup).not.toHaveBeenCalledWith(200, expect.anything());
      expect(evidenceOwner.candidates).toContainEqual(
        expect.objectContaining({
          pid: 101,
          identity: "generation-101",
          applicability: "token-verified",
        }),
      );
    } else {
      expect(result).toMatchObject({ cleaned: true, signaled: true });
      expect(signalGroup.mock.calls).toEqual([
        [100, "SIGKILL"],
        [200, "SIGKILL"],
      ]);
      expect(evidenceOwner.candidates).toEqual([]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "signals every verified captured group before the shared final census",
  async () => {
    let rows: readonly ProcessTableEntry[] = [
      {
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        state: "S",
        command: "electron",
      },
      {
        pid: 101,
        parentPid: 100,
        processGroupId: 100,
        state: "S",
        command: "renderer",
      },
      {
        pid: 200,
        parentPid: 101,
        processGroupId: 200,
        state: "S",
        command: "helper-group-leader",
      },
      {
        pid: 201,
        parentPid: 200,
        processGroupId: 200,
        state: "S",
        command: "helper",
      },
    ];
    const signalGroups: number[] = [];
    const ownership = {
      runId: "multi-group-run",
      leaderPid: 100,
      processGroupId: 100,
      expectedParentPid: 1,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner: new ProcessOwnershipEvidenceOwner(),
    };
    const host: ProcessOwnershipHost = {
      platform: process.platform,
      listProcesses: async () => rows,
      environment: async () => ({}),
      runTokens: async (members) =>
        new Map(
          members.map(({ pid }) => [
            pid,
            { state: "readable" as const, runId: ownership.runId },
          ]),
        ),
      processIdentities: async (members) => {
        const liveByPid = new Map(rows.map((row) => [row.pid, row]));
        return new Map(
          members.map((member) => {
            const current = liveByPid.get(member.pid);
            return [
              member.pid,
              current === undefined
                ? {
                    state: "absent" as const,
                    reason: "not-in-snapshot" as const,
                  }
                : {
                    state: "readable" as const,
                    identity: `generation-${String(member.pid)}`,
                    relation: {
                      state: "observed" as const,
                      parentPid: current.parentPid,
                      processGroupId: current.processGroupId,
                    },
                  },
            ] as const;
          }),
        );
      },
      signalGroup: (groupId) => {
        signalGroups.push(groupId);
        rows = rows.filter(({ processGroupId }) => processGroupId !== groupId);
      },
    };
    const lineage: ProcessLineageObservation = {
      status: "verified",
      observedAt: "2026-10-19T00:00:00.000Z",
      lineage: {
        runId: ownership.runId,
        launcherPid: ownership.leaderPid,
        launcherParentPid: 1,
        processGroupId: ownership.processGroupId,
        descendants: [
          { pid: 101, parentPid: 100, processGroupId: 100 },
          { pid: 200, parentPid: 101, processGroupId: 200 },
          { pid: 201, parentPid: 200, processGroupId: 200 },
        ],
      },
    };

    const result = await cleanupElectronProcesses(ownership, lineage, {
      platform: process.platform,
      terminateTree: vi.fn(),
      processOwnershipHost: host,
    });

    expect(result).toMatchObject({ cleaned: true, signaled: true });
    expect(signalGroups).toEqual([100, 200]);
    expect(rows).toEqual([]);
  },
);
