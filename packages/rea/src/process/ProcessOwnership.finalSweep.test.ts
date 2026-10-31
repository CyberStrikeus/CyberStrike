import { afterEach, expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  verifyNoTokenOwnedProcesses,
  type ProcessOwnershipHost,
  type ProcessRunTokenObservation,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

const initialRows: readonly ProcessTableEntry[] = [
  {
    pid: 100,
    parentPid: 1,
    processGroupId: 100,
    state: "S",
    command: "capture-root",
  },
  {
    pid: 101,
    parentPid: 100,
    processGroupId: 100,
    state: "S",
    command: "capture-child",
  },
];

const makeHost = (onSignal: (groupId: number) => void) => {
  let liveRows = initialRows;
  const signalGroups: number[] = [];
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => liveRows,
    environment: async () => ({}),
    runTokens: async (entries) =>
      new Map(
        entries.map(({ pid }) => [
          pid,
          {
            state: "readable" as const,
            runId: "sweep-run",
          },
        ]),
      ),
    processIdentities: async (entries) => {
      const liveByPid = new Map(liveRows.map((row) => [row.pid, row]));
      return new Map(
        entries.map((entry) => {
          const current = liveByPid.get(entry.pid);
          return [
            entry.pid,
            current === undefined
              ? {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                }
              : {
                  state: "readable" as const,
                  identity: `start-${String(entry.pid)}`,
                  lifecycle: {
                    state: "observed" as const,
                    lifecycle: "non-zombie" as const,
                  },
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
      onSignal(groupId);
    },
  };
  return {
    host,
    signalGroups,
    replaceRows: (rows: readonly ProcessTableEntry[]) => {
      liveRows = rows;
    },
    rows: () => liveRows,
  };
};

const ownership = () => ({
  runId: "sweep-run",
  leaderPid: 100,
  processGroupId: 100,
  sweepTokenOwnedProcesses: true as const,
  evidenceOwner: new ProcessOwnershipEvidenceOwner(),
});

afterEach(() => vi.useRealTimers());

it("waits for native absence after one signal and does not signal again", async () => {
  vi.useFakeTimers();
  const fixture = makeHost(() => {
    setTimeout(() => fixture.replaceRows([]), 50);
  });

  const resultPromise = cleanupOwnedProcessGroup(ownership(), fixture.host);
  await vi.runAllTimersAsync();
  const result = await resultPromise;

  expect(result).toEqual({ cleaned: true, signaled: true });
  expect(fixture.signalGroups).toEqual([100]);
});

it("finishes the public cleanup sweep when the application timer is unavailable", async () => {
  const unrelated: ProcessTableEntry = {
    pid: 200,
    parentPid: 1,
    processGroupId: 200,
    state: "S",
    command: "transient-token-process",
  };
  let signaled = false;
  let postSignalSnapshots = 0;
  let unrelatedTokenReads = 0;
  const fixture = makeHost(() => {
    signaled = true;
    fixture.replaceRows([unrelated]);
  });
  fixture.replaceRows([...initialRows, unrelated]);
  const host: ProcessOwnershipHost = {
    ...fixture.host,
    listProcesses: async () => {
      if (!signaled) return fixture.rows();
      postSignalSnapshots += 1;
      if (postSignalSnapshots === 1) return fixture.rows();
      fixture.replaceRows([]);
      return [];
    },
    runTokens: async (entries) =>
      new Map<number, ProcessRunTokenObservation>(
        entries.map(({ pid }) => {
          if (pid !== unrelated.pid)
            return [pid, { state: "readable", runId: "sweep-run" }] as const;
          if (!signaled)
            return [pid, { state: "readable", runId: undefined }] as const;
          unrelatedTokenReads += 1;
          return [pid, { state: "readable", runId: "sweep-run" }] as const;
        }),
      ),
  };
  const applicationTimer = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(() => {
      throw new Error("application timer is unavailable");
    });

  try {
    await expect(cleanupOwnedProcessGroup(ownership(), host)).resolves.toEqual({
      cleaned: true,
      signaled: true,
    });
    expect(unrelatedTokenReads).toBeGreaterThan(0);
    expect(postSignalSnapshots).toBe(2);
    expect(fixture.signalGroups).toEqual([100]);
    expect(applicationTimer).not.toHaveBeenCalled();
  } finally {
    applicationTimer.mockRestore();
  }
});

it.each([
  "EACCES: fixture permission denied",
  "ambiguous_environment_boundary",
])(
  "keeps an unreadable live group member fail-closed when the application timer is unavailable: %s",
  async (diagnostic) => {
    const fixture = makeHost(() => undefined);
    let unreadableReads = 0;
    const host: ProcessOwnershipHost = {
      ...fixture.host,
      runTokens: async (entries) =>
        new Map<number, ProcessRunTokenObservation>(
          entries.map(({ pid }) => {
            if (pid === 101) {
              unreadableReads += 1;
              return [
                pid,
                {
                  state: "unavailable",
                  reason: diagnostic,
                },
              ] as const;
            }
            return [pid, { state: "readable", runId: "sweep-run" }] as const;
          }),
        ),
    };
    const applicationTimer = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(() => {
        throw new Error("application timer is unavailable");
      });

    try {
      await expect(
        cleanupOwnedProcessGroup(ownership(), host),
      ).resolves.toMatchObject({
        cleaned: false,
        reason: expect.stringContaining(
          "process ownership token could not be read",
        ),
      });
      expect(unreadableReads).toBeGreaterThan(1);
      expect(fixture.signalGroups).toEqual([]);
      expect(applicationTimer).not.toHaveBeenCalled();
    } finally {
      applicationTimer.mockRestore();
    }
  },
);

it("retries an ambiguous owned member before signaling its group", async () => {
  const fixture = makeHost(() => fixture.replaceRows([]));
  let memberReads = 0;
  const host: ProcessOwnershipHost = {
    ...fixture.host,
    runTokens: async (entries) =>
      new Map<number, ProcessRunTokenObservation>(
        entries.map(({ pid }) => {
          if (pid === 101 && memberReads++ === 0)
            return [
              pid,
              {
                state: "unavailable",
                reason: "ambiguous_environment_boundary",
              },
            ] as const;
          return [pid, { state: "readable", runId: "sweep-run" }] as const;
        }),
      ),
  };
  await expect(cleanupOwnedProcessGroup(ownership(), host)).resolves.toEqual({
    cleaned: true,
    signaled: true,
  });
  expect(memberReads).toBeGreaterThan(1);
  expect(fixture.signalGroups).toEqual([100]);
});

it("preserves a moved same-generation helper as unresolved through the final deadline", async () => {
  const child = initialRows[1];
  if (child === undefined) throw new Error("fixture child is missing");
  let moved = false;
  const fixture = makeHost(() => {
    moved = true;
    fixture.replaceRows([
      {
        ...child,
        parentPid: 1,
        processGroupId: 777,
      },
    ]);
  });
  const host: ProcessOwnershipHost = {
    ...fixture.host,
    runTokens: async (entries) =>
      new Map(
        entries.map(({ pid }) => [
          pid,
          {
            state: "readable" as const,
            runId: pid === 101 && moved ? "foreign-token" : "sweep-run",
          },
        ]),
      ),
  };

  const resultPromise = cleanupOwnedProcessGroup(ownership(), host);
  const result = await resultPromise;

  expect(result).toMatchObject({
    cleaned: false,
    reason: "process ownership token mismatch for PID(s): 101",
  });
  expect(fixture.rows()).toMatchObject([
    { pid: 101, parentPid: 1, processGroupId: 777 },
  ]);
  expect(fixture.signalGroups).toEqual([100]);
});

it("retries a moved token-owned helper group without signaling a released peer again", async () => {
  let rows: readonly ProcessTableEntry[] = [
    {
      pid: 100,
      parentPid: 1,
      processGroupId: 100,
      state: "S",
      command: "capture-root",
    },
    {
      pid: 200,
      parentPid: 100,
      processGroupId: 200,
      state: "S",
      command: "helper-group-leader",
    },
    {
      pid: 201,
      parentPid: 200,
      processGroupId: 200,
      state: "S",
      command: "moving-helper",
    },
    {
      pid: 202,
      parentPid: 200,
      processGroupId: 200,
      state: "S",
      command: "released-peer",
    },
  ];
  const signalGroups: number[] = [];
  const owner = ownership();
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => rows,
    environment: async () => ({}),
    runTokens: async (entries) =>
      new Map(
        entries.map(({ pid }) => [
          pid,
          { state: "readable" as const, runId: owner.runId },
        ]),
      ),
    processIdentities: async (entries) => {
      const liveByPid = new Map(rows.map((row) => [row.pid, row]));
      return new Map(
        entries.map((entry) => {
          const current = liveByPid.get(entry.pid);
          return [
            entry.pid,
            current === undefined
              ? {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                }
              : {
                  state: "readable" as const,
                  identity: `start-${String(entry.pid)}`,
                  lifecycle: {
                    state: "observed" as const,
                    lifecycle: "non-zombie" as const,
                  },
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
      if (groupId === 100) {
        rows = rows
          .filter(({ pid }) => pid !== 100)
          .map((row) =>
            row.pid === 201
              ? { ...row, parentPid: 1, processGroupId: 300 }
              : row,
          );
      } else {
        rows = rows.filter(({ processGroupId }) => processGroupId !== groupId);
      }
    },
  };

  const first = await cleanupOwnedProcessGroup(owner, host);
  expect(first).toMatchObject({ cleaned: false });
  expect(signalGroups).toEqual([100, 200]);
  expect(rows).toContainEqual(
    expect.objectContaining({ pid: 201, parentPid: 1, processGroupId: 300 }),
  );

  const retry = await cleanupOwnedProcessGroup(owner, host);
  expect(retry).toEqual({ cleaned: true, signaled: true });
  expect(signalGroups).toEqual([100, 200, 300]);
  expect(owner.evidenceOwner.candidates).toEqual([]);
});

it("settles transient token reads without borrowing the application timer", async () => {
  const fixture = makeHost(() => undefined);
  let reads = 0;
  const host: ProcessOwnershipHost = {
    ...fixture.host,
    runTokens: async (entries) => {
      reads += 1;
      return new Map(
        entries.map(({ pid }) => [
          pid,
          reads === 1
            ? {
                state: "unavailable" as const,
                reason: "environment_errno_EACCES",
              }
            : { state: "readable" as const, runId: undefined },
        ]),
      );
    },
  };
  const applicationTimer = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(() => {
      throw new Error(
        "application timer must not mediate native ownership retries",
      );
    });
  try {
    await expect(
      verifyNoTokenOwnedProcesses("sweep-run", host),
    ).resolves.toEqual({ cleaned: true, signaled: false });
    expect(reads).toBe(2);
    expect(applicationTimer).not.toHaveBeenCalled();
  } finally {
    applicationTimer.mockRestore();
  }
});
