import { describe, expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  verifyNoTokenOwnedProcesses,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { createSystemProcessOwnershipHost } from "./ProcessOwnershipObservation.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

const itOnLinux = process.platform === "linux" ? it : it.skip;

const observedIdentity = (entry: ProcessTableEntry, identity: string) => ({
  state: "readable" as const,
  identity,
  relation: {
    state: "observed" as const,
    parentPid: entry.parentPid,
    processGroupId: entry.processGroupId,
  },
});

it("keeps an unresolved earlier generation unknown when a later unrelated process has a foreign marker", async () => {
  const row: ProcessTableEntry = {
    pid: 920,
    parentPid: 1,
    processGroupId: 920,
    state: "S",
    command: "unrelated",
  };
  let readable = false;
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [row],
    environment: async () => ({ REA_PROCESS_RUN_ID: "foreign" }),
    processIdentities: async (entries) =>
      new Map(
        entries.map((entry) => [
          entry.pid,
          readable
            ? observedIdentity(entry, "later-generation")
            : { state: "unavailable" as const, reason: "identity unavailable" },
        ]),
      ),
    signalGroup,
  };
  const relation = { leaderPid: 100, processGroupId: 100, evidenceOwner };
  await expect(
    verifyNoTokenOwnedProcesses("run-token", host, [], relation),
  ).resolves.toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "process-identity-unavailable" }],
  });
  readable = true;
  await expect(
    verifyNoTokenOwnedProcesses("run-token", host, [], relation),
  ).resolves.toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "process-identity-unavailable" }],
  });
  expect(evidenceOwner.candidates).toMatchObject([
    { pid: row.pid, identity: undefined, applicability: "identity-unresolved" },
  ]);
  expect(signalGroup).not.toHaveBeenCalled();
});

it.each([undefined, "run-token"])(
  "validates a current generation with token %s when its baseline identity was unknown",
  async (runId) => {
    const row: ProcessTableEntry = {
      pid: 909,
      parentPid: 1,
      processGroupId: 909,
      state: "S",
      command: "foreign-process",
    };
    const environment = vi.fn(() =>
      Promise.resolve(runId === undefined ? {} : { REA_PROCESS_RUN_ID: runId }),
    );
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve([row]),
      environment,
      processIdentities: (entries) =>
        Promise.resolve(
          new Map(
            entries.map((entry) => [
              entry.pid,
              observedIdentity(entry, "current-start"),
            ]),
          ),
        ),
      signalGroup,
    };

    await expect(
      verifyNoTokenOwnedProcesses("run-token", host, [
        { pid: row.pid, identity: null },
      ]),
    ).resolves.toEqual(
      runId === undefined
        ? { cleaned: true, signaled: false }
        : {
            cleaned: false,
            reason: "token-owned process remained after cleanup",
          },
    );
    expect(environment).toHaveBeenCalledWith(row.pid);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

describe("Linux process start identities", () => {
  itOnLinux("reads Linux process start identities from proc stat", async () => {
    const host = createSystemProcessOwnershipHost("linux", {});
    expect(host.processIdentities).toBeDefined();
    expect(host.captureBaseline).toBeDefined();
    const observedProcess = {
      pid: process.pid,
      parentPid: process.ppid,
      processGroupId: process.pid,
      state: "S",
      command: process.execPath,
    } satisfies ProcessTableEntry;
    const identities = await host.processIdentities?.(
      [observedProcess],
      undefined,
      new Set([observedProcess.pid]),
    );
    expect(identities?.get(observedProcess.pid)).toMatchObject({
      state: "readable",
      identity: expect.stringMatching(/^linux-starttime:\d+$/u),
      lifecycle: { state: "observed", lifecycle: "non-zombie" },
      relation: {
        state: "observed",
        parentPid: process.ppid,
        processGroupId: expect.any(Number),
      },
    });
    expect(identities?.get(observedProcess.pid)).toHaveProperty(
      "effectiveUid",
      process.geteuid!(),
    );
    const baseline = await host.captureBaseline?.();
    expect(baseline).toContainEqual({
      pid: observedProcess.pid,
      identity: expect.stringMatching(/^linux-starttime:\d+$/u),
    });
  });
});

it("validates and cleans an exact-token owner without a capture baseline", async () => {
  const process: ProcessTableEntry = {
    pid: 904,
    parentPid: 1,
    processGroupId: 904,
    state: "S",
    command: "generic-darwin-owner",
  };
  let live = true;
  const signalGroup = vi.fn(() => {
    live = false;
  });
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve(live ? [process] : []),
    environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    runTokens: (entries) =>
      Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            { state: "readable", runId: "run-token" } as const,
          ]),
        ),
      ),
    processIdentities: (entries) =>
      Promise.resolve(
        new Map(
          entries.map((entry) => [
            entry.pid,
            live
              ? observedIdentity(entry, "owner-start")
              : {
                  state: "absent" as const,
                  reason: "not-in-snapshot" as const,
                },
          ]),
        ),
      ),
    signalGroup,
  };

  await expect(
    cleanupOwnedProcessGroup(
      {
        runId: "run-token",
        leaderPid: process.pid,
        processGroupId: process.processGroupId,
        sweepTokenOwnedProcesses: true,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      },
      host,
    ),
  ).resolves.toEqual({ cleaned: true, signaled: true });
  expect(signalGroup).toHaveBeenCalledWith(process.processGroupId, "SIGKILL");
});

it
  .skipIf(typeof process.getuid !== "function")
  .each(["EINVAL", "EACCES: permission denied"])(
  "uses a same-generation native UID instead of the process-table UID for unreadable tokens: %s",
  async (diagnostic) => {
    const callerUid = process.getuid!();
    const foreignUid = callerUid === 0 ? 1 : 0;
    const verify = async (rowUid: number, effectiveUid: number) => {
      const row: ProcessTableEntry = {
        pid: 906,
        parentPid: 1,
        processGroupId: 906,
        uid: rowUid,
        state: "S",
        command: "unrelated-process",
      };
      const host: ProcessOwnershipHost = {
        platform: "darwin",
        signalGroup: vi.fn(),
        listProcesses: () => Promise.resolve([row]),
        environment: () => Promise.resolve({}),
        runTokens: () =>
          Promise.resolve(
            new Map([
              [906, { state: "unavailable", reason: diagnostic } as const],
            ]),
          ),
        processIdentities: (entries) =>
          Promise.resolve(
            new Map(
              entries.map((entry) => [
                entry.pid,
                {
                  ...observedIdentity(entry, "reused-current-generation"),
                  effectiveUid,
                },
              ]),
            ),
          ),
      };
      return verifyNoTokenOwnedProcesses("run-token", host, undefined, {
        leaderPid: 100,
        processGroupId: 100,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      });
    };

    await expect(verify(foreignUid, callerUid)).resolves.toMatchObject({
      cleaned: false,
      failures: [{ pid: 906, reason: "environment-unreadable" }],
    });
    await expect(verify(callerUid, foreignUid)).resolves.toMatchObject({
      cleaned: true,
      unverified: [{ pid: 906, diagnostic }],
    });
  },
);

it
  .skipIf(typeof process.getuid !== "function")
  .each(["credentials", "non-dumpable"] as const)(
  "records an unrelated same-UID Linux process whose environment is withheld for %s",
  async (restriction) => {
    const diagnostic = "EACCES: permission denied, open '/proc/908/environ'";
    const verify = async (
      processGroupId: number,
      environmentRestriction: typeof restriction | undefined,
    ) => {
      const row: ProcessTableEntry = {
        pid: 908,
        parentPid: 1,
        processGroupId,
        uid: process.getuid!(),
        state: "S",
        command: "unrelated-process",
      };
      const host: ProcessOwnershipHost = {
        platform: "linux",
        signalGroup: vi.fn(),
        listProcesses: () => Promise.resolve([row]),
        environment: () => Promise.resolve({}),
        runTokens: () =>
          Promise.resolve(
            new Map([
              [908, { state: "unavailable", reason: diagnostic } as const],
            ]),
          ),
        processIdentities: (entries) =>
          Promise.resolve(
            new Map(
              entries.map((entry) => [
                entry.pid,
                {
                  ...observedIdentity(entry, "current-generation"),
                  effectiveUid: process.getuid!(),
                  ...(environmentRestriction === undefined
                    ? {}
                    : { environmentRestriction }),
                },
              ]),
            ),
          ),
      };
      return verifyNoTokenOwnedProcesses("run-token", host, undefined, {
        leaderPid: 100,
        processGroupId: 100,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      });
    };

    await expect(verify(908, restriction)).resolves.toMatchObject({
      cleaned: true,
      unverified: [{ pid: 908, diagnostic }],
    });
    // EACCES alone and a withheld member of the owned group stay fail-closed.
    for (const [processGroupId, environmentRestriction] of [
      [908, undefined],
      [100, restriction],
    ] as const)
      await expect(
        verify(processGroupId, environmentRestriction),
      ).resolves.toMatchObject({
        cleaned: false,
        failures: [{ pid: 908, reason: "environment-unreadable" }],
      });
  },
);

it.each(["omitted", "throws"] as const)(
  "keeps a matching token unresolved when the first native identity is %s",
  async (firstRead) => {
    const row: ProcessTableEntry = {
      pid: 907,
      parentPid: 1,
      processGroupId: 907,
      state: "S",
      command: "identity-read-failure-candidate",
    };
    let identityReads = 0;
    const host: ProcessOwnershipHost = {
      platform: "linux",
      signalGroup: vi.fn(),
      listProcesses: () => Promise.resolve([row]),
      environment: () => Promise.resolve({}),
      runTokens: () =>
        Promise.resolve(
          new Map([[row.pid, { state: "readable", runId: "run-token" }]]),
        ),
      processIdentities: (entries) => {
        identityReads += 1;
        if (identityReads === 1) {
          if (firstRead === "throws")
            return Promise.reject(new Error("native identity read denied"));
          return Promise.resolve(new Map());
        }
        return Promise.resolve(
          new Map(
            entries.map((entry) => [
              entry.pid,
              observedIdentity(entry, "current-generation"),
            ]),
          ),
        );
      },
    };

    await expect(
      verifyNoTokenOwnedProcesses("run-token", host, undefined, {
        leaderPid: 100,
        processGroupId: 100,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      }),
    ).resolves.toMatchObject({
      cleaned: false,
      reason: "process identity could not be revalidated",
      failures: [{ pid: row.pid, reason: "process-identity-unavailable" }],
    });
    expect(identityReads).toBe(2);
  },
);

it("keeps a matching-token replacement through omission and retries cleanup only with fresh identity proof", async () => {
  const row: ProcessTableEntry = {
    pid: 913,
    parentPid: 1,
    processGroupId: 913,
    state: "S",
    command: "replacement-owner",
  };
  let listed = true;
  let replaced = false;
  let identityUnavailable = false;
  let live = true;
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const signalGroup = vi.fn(() => {
    live = false;
  });
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => (listed && live ? [row] : []),
    environment: async () => ({}),
    processIdentities: async (entries) =>
      new Map(
        entries.map((entry) => [
          entry.pid,
          !live
            ? { state: "absent" as const, reason: "not-in-snapshot" as const }
            : identityUnavailable
              ? { state: "unavailable" as const, reason: "native read denied" }
              : observedIdentity(entry, replaced ? "new-owner" : "old-owner"),
        ]),
      ),
    runTokens: async (entries) => {
      // The token belongs to the replacement, but the surrounding identity
      // reads straddle reuse and therefore cannot yet grant signal authority.
      replaced = true;
      return new Map(
        entries.map(({ pid }) => [
          pid,
          { state: "readable" as const, runId: "run-token" },
        ]),
      );
    },
    signalGroup,
  };
  const ownership = {
    runId: "run-token",
    leaderPid: 100,
    processGroupId: 100,
    sweepTokenOwnedProcesses: true,
    evidenceOwner,
  };

  await expect(
    verifyNoTokenOwnedProcesses("run-token", host, undefined, ownership),
  ).resolves.toMatchObject({ cleaned: false });
  listed = false;
  identityUnavailable = true;
  await expect(
    cleanupOwnedProcessGroup(ownership, host),
  ).resolves.toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "process-identity-unavailable" }],
  });
  expect(signalGroup).not.toHaveBeenCalled();
  expect(live).toBe(true);
  expect(evidenceOwner.candidates).toMatchObject([
    { pid: row.pid, identity: undefined, applicability: "identity-unresolved" },
  ]);

  identityUnavailable = false;
  await expect(
    verifyNoTokenOwnedProcesses("run-token", host, undefined, ownership),
  ).resolves.toMatchObject({
    cleaned: false,
    reason: "token-owned process remained after cleanup",
  });
  expect(signalGroup).not.toHaveBeenCalled();
  listed = true;
  await expect(
    cleanupOwnedProcessGroup(ownership, host),
  ).resolves.toMatchObject({
    cleaned: true,
    signaled: true,
  });
  expect(signalGroup).toHaveBeenCalledExactlyOnceWith(
    row.processGroupId,
    "SIGKILL",
  );
  expect(live).toBe(false);
  expect(evidenceOwner.candidates).toEqual([]);
});

it("retains a scoped unknown generation when a later table omits its PID", async () => {
  const row: ProcessTableEntry = {
    pid: 101,
    parentPid: 100,
    processGroupId: 100,
    state: "S",
    command: "identity-unavailable-related-process",
  };
  const tables = [[row], []] as const;
  let tableRead = 0;
  let identityReads = 0;
  let nativeAbsence = false;
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const host: ProcessOwnershipHost = {
    platform: "linux",
    signalGroup: vi.fn(),
    listProcesses: () => Promise.resolve(tables[tableRead++] ?? []),
    environment: () => Promise.resolve({}),
    runTokens: (entries) =>
      Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            { state: "unavailable" as const, reason: "EPERM: denied" },
          ]),
        ),
      ),
    processIdentities: (entries) => {
      identityReads += 1;
      return Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            nativeAbsence
              ? {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                }
              : {
                  state: "unavailable" as const,
                  reason: "native identity read denied",
                },
          ]),
        ),
      );
    },
  };
  const relation = {
    leaderPid: 100,
    processGroupId: 100,
    evidenceOwner,
  };

  const first = await verifyNoTokenOwnedProcesses(
    "run-token",
    host,
    undefined,
    relation,
  );
  expect(first).toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "process-identity-unavailable" }],
  });
  expect(evidenceOwner.candidates).toMatchObject([
    {
      pid: row.pid,
      identity: undefined,
      applicability: "identity-unresolved",
      scopeEvidence: "native-identity-unresolved",
    },
  ]);

  const readsAfterFirstSnapshot = identityReads;
  const second = await verifyNoTokenOwnedProcesses(
    "run-token",
    host,
    undefined,
    relation,
  );

  expect(second).toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "process-identity-unavailable" }],
  });
  expect(identityReads).toBeGreaterThan(readsAfterFirstSnapshot);
  expect(evidenceOwner.candidates).toMatchObject([
    {
      pid: row.pid,
      identity: undefined,
      applicability: "identity-unresolved",
    },
  ]);
  expect(evidenceOwner.coverage).toMatchObject({
    listedRows: 0,
    retainedOnlyPids: 1,
    retainedUnresolved: 1,
  });

  nativeAbsence = true;
  await expect(
    verifyNoTokenOwnedProcesses("run-token", host, undefined, relation),
  ).resolves.toMatchObject({ cleaned: true });
  expect(evidenceOwner.candidates).toEqual([]);
});

it("requires a scoped current relation before exempting a withheld token", async () => {
  const row: ProcessTableEntry = {
    pid: 908,
    parentPid: 1,
    processGroupId: 908,
    state: "S",
    command: "opaque-unrelated-process",
  };
  const verify = async (scoped: boolean, nativeRelation: boolean) => {
    const host: ProcessOwnershipHost = {
      platform: "darwin",
      signalGroup: vi.fn(),
      listProcesses: () => Promise.resolve([row]),
      environment: () => Promise.resolve({}),
      runTokens: () =>
        Promise.resolve(
          new Map([
            [
              row.pid,
              {
                state: "unavailable",
                reason: "platform_binary_environment_withheld",
              } as const,
            ],
          ]),
        ),
      processIdentities: (entries) =>
        Promise.resolve(
          new Map(
            entries.map((entry) => [
              entry.pid,
              nativeRelation
                ? observedIdentity(entry, "opaque-generation")
                : {
                    state: "readable" as const,
                    identity: "opaque-generation",
                  },
            ]),
          ),
        ),
    };
    return verifyNoTokenOwnedProcesses(
      "run-token",
      host,
      undefined,
      scoped
        ? {
            leaderPid: 100,
            processGroupId: 100,
            evidenceOwner: new ProcessOwnershipEvidenceOwner(),
          }
        : undefined,
    );
  };

  await expect(verify(true, false)).resolves.toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "environment-unreadable" }],
  });
  await expect(verify(false, false)).resolves.toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "environment-unreadable" }],
  });
  await expect(verify(false, true)).resolves.toMatchObject({
    cleaned: false,
    failures: [{ pid: row.pid, reason: "environment-unreadable" }],
  });
  await expect(verify(true, true)).resolves.toMatchObject({
    cleaned: true,
    unverified: [
      { pid: row.pid, diagnostic: "platform_binary_environment_withheld" },
    ],
  });
});

it("retains related scope when a same-generation process reparents during its first token read", async () => {
  const row: ProcessTableEntry = {
    pid: 909,
    parentPid: 100,
    processGroupId: 100,
    state: "S",
    command: "reparented-withheld-process",
  };
  let identityReads = 0;
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const host: ProcessOwnershipHost = {
    platform: "darwin",
    signalGroup: vi.fn(),
    listProcesses: () => Promise.resolve([row]),
    environment: () => Promise.resolve({}),
    runTokens: (entries) =>
      Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            {
              state: "unavailable" as const,
              reason: "platform_binary_environment_withheld",
            },
          ]),
        ),
      ),
    processIdentities: (entries) => {
      identityReads += 1;
      const reparented = identityReads > 1;
      return Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            {
              state: "readable" as const,
              identity: "generation-909",
              relation: {
                state: "observed" as const,
                parentPid: reparented ? 1 : 100,
                processGroupId: reparented ? 777 : 100,
              },
            },
          ]),
        ),
      );
    },
  };

  await expect(
    verifyNoTokenOwnedProcesses("run-token", host, undefined, {
      leaderPid: 100,
      processGroupId: 100,
      evidenceOwner,
    }),
  ).resolves.toMatchObject({
    cleaned: false,
    failures: [
      {
        pid: row.pid,
        reason: "environment-unreadable",
        diagnostic: "platform_binary_environment_withheld",
      },
    ],
  });
  expect(evidenceOwner.candidates).toMatchObject([
    {
      pid: row.pid,
      identity: "generation-909",
      applicability: "related-ownership-unresolved",
      scopeEvidence: "previously-related-generation",
      relation: { parentPid: 1, processGroupId: 777 },
    },
  ]);
});

it.each([undefined, "foreign-token"] as const)(
  "does not treat a readable %s token as exonerating a related generation that moved during its first read",
  async (observedRunId) => {
    const row: ProcessTableEntry = {
      pid: 909,
      parentPid: 100,
      processGroupId: 100,
      state: "S",
      command: "reparented-cleared-token-process",
    };
    let identityReads = 0;
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      platform: "darwin",
      signalGroup,
      listProcesses: () => Promise.resolve([row]),
      environment: () => Promise.resolve({}),
      runTokens: (entries) =>
        Promise.resolve(
          new Map(
            entries.map(({ pid }) => [
              pid,
              { state: "readable" as const, runId: observedRunId },
            ]),
          ),
        ),
      processIdentities: (entries) => {
        identityReads += 1;
        const reparented = identityReads > 1;
        return Promise.resolve(
          new Map(
            entries.map(({ pid }) => [
              pid,
              {
                state: "readable" as const,
                identity: "generation-909",
                relation: {
                  state: "observed" as const,
                  parentPid: reparented ? 1 : 100,
                  processGroupId: reparented ? 777 : 100,
                },
              },
            ]),
          ),
        );
      },
    };

    await expect(
      verifyNoTokenOwnedProcesses("run-token", host, undefined, {
        leaderPid: 100,
        processGroupId: 100,
        evidenceOwner,
      }),
    ).resolves.toMatchObject({
      cleaned: false,
      failures: [{ pid: row.pid, reason: "run-token-mismatch" }],
    });
    expect(identityReads).toBe(2);
    expect(signalGroup).not.toHaveBeenCalled();
    expect(evidenceOwner.candidates).toMatchObject([
      {
        pid: row.pid,
        identity: "generation-909",
        applicability: "related-ownership-unresolved",
        scopeEvidence: "captured-process-group-id",
        relation: { parentPid: 1, processGroupId: 777 },
      },
    ]);
  },
);

it.skipIf(typeof process.getuid !== "function")(
  "cleans verified owners and records unrelated opaque candidates as unverified",
  async () => {
    const owned: ProcessTableEntry = {
      pid: 905,
      parentPid: 1,
      processGroupId: 905,
      state: "S",
      command: "owned-detached-child",
    };
    const opaque: ProcessTableEntry = {
      pid: 906,
      parentPid: 1,
      processGroupId: 906,
      state: "S",
      command: "/usr/bin/unrelated-process",
    };
    const malformed: ProcessTableEntry = {
      ...opaque,
      pid: 907,
      processGroupId: 907,
      uid: process.getuid?.() === 0 ? 1 : 0,
      command: "/usr/bin/malformed-procargs-process",
    };
    const sysctlDenied: ProcessTableEntry = {
      ...opaque,
      pid: 908,
      processGroupId: 908,
      uid: process.getuid?.() === 0 ? 1 : 0,
      command: "/usr/bin/sysctl-denied-process",
    };
    const processes = [owned, opaque, malformed, sysctlDenied];
    const signalGroup = vi.fn((processGroupId: number) => {
      for (let index = processes.length - 1; index >= 0; index -= 1)
        if (processes[index]?.processGroupId === processGroupId)
          processes.splice(index, 1);
    });
    const host: ProcessOwnershipHost = {
      platform: "darwin",
      listProcesses: () => Promise.resolve(processes),
      environment: (pid) =>
        pid === owned.pid
          ? Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" })
          : Promise.reject(new Error("permission denied")),
      runTokens: (entries) =>
        Promise.resolve(
          new Map(
            entries.map(({ pid }) => [
              pid,
              pid === owned.pid
                ? { state: "readable", runId: "run-token" as const }
                : {
                    state: "unavailable",
                    reason:
                      pid === malformed.pid
                        ? ("malformed_procargs" as const)
                        : pid === sysctlDenied.pid
                          ? ("sysctl_failed_1" as const)
                          : ("platform_binary_environment_withheld" as const),
                  },
            ]),
          ),
        ),
      signalGroup,
    };

    await expect(
      cleanupOwnedProcessGroup(
        {
          runId: "run-token",
          leaderPid: 100,
          processGroupId: 100,
          sweepTokenOwnedProcesses: true,
          evidenceOwner: new ProcessOwnershipEvidenceOwner(),
        },
        host,
      ),
    ).resolves.toMatchObject({
      cleaned: true,
      signaled: true,
      unverified: [
        { pid: 906, diagnostic: "platform_binary_environment_withheld" },
        { pid: 907, diagnostic: "malformed_procargs" },
        { pid: 908, diagnostic: "sysctl_failed_1" },
      ],
    });
    expect(signalGroup).toHaveBeenCalledWith(owned.processGroupId, "SIGKILL");
    expect(signalGroup).not.toHaveBeenCalledWith(
      opaque.processGroupId,
      "SIGKILL",
    );
    expect(signalGroup).not.toHaveBeenCalledWith(
      malformed.processGroupId,
      "SIGKILL",
    );
    expect(signalGroup).not.toHaveBeenCalledWith(
      sysctlDenied.processGroupId,
      "SIGKILL",
    );
  },
);

describe("capture-local process identity baselines", () => {
  it("checks reused and unknown PIDs while skipping unchanged identities", async () => {
    const tokenReads: number[][] = [];
    const processes: readonly ProcessTableEntry[] = [
      {
        pid: 899,
        parentPid: 1,
        processGroupId: 899,
        state: "S",
        command: "stable",
      },
      {
        pid: 900,
        parentPid: 1,
        processGroupId: 900,
        state: "S",
        command: "reused",
      },
      {
        pid: 902,
        parentPid: 1,
        processGroupId: 902,
        state: "S",
        command: "unknown",
      },
    ];
    const host: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processes),
      environment: () => Promise.resolve({}),
      processIdentities: (entries) =>
        Promise.resolve(
          new Map(
            entries.map((entry) => [
              entry.pid,
              entry.pid === 902
                ? { state: "unavailable", reason: "fixture" }
                : observedIdentity(
                    entry,
                    entry.pid === 899 ? "stable-start" : "reused-start",
                  ),
            ]),
          ),
        ),
      runTokens: (entries) => {
        tokenReads.push(entries.map(({ pid }) => pid));
        return Promise.resolve(
          new Map(
            entries.map(({ pid }) => [
              pid,
              {
                state: "readable",
                runId: pid === 900 ? "run-token" : undefined,
              },
            ]),
          ),
        );
      },
      signalGroup: vi.fn(),
    };

    await expect(
      verifyNoTokenOwnedProcesses("run-token", host, [
        { pid: 899, identity: "stable-start" },
        { pid: 900, identity: "old-start" },
        { pid: 902, identity: null },
      ]),
    ).resolves.toEqual({
      cleaned: false,
      reason: "process identity could not be revalidated",
      failures: [
        {
          pid: 902,
          reason: "process-identity-unavailable",
          diagnostic:
            "process identity was unavailable during token validation",
        },
      ],
    });
    expect(tokenReads).toEqual([[900, 902]]);
  });

  it("revalidates fallback environment owners before signaling after PID reuse", async () => {
    let identityReads = 0;
    const process: ProcessTableEntry = {
      pid: 910,
      parentPid: 1,
      processGroupId: 910,
      state: "S",
      command: "fallback-environment-owner",
    };
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve([process]),
      environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
      processIdentities: (entries) => {
        identityReads += 1;
        const identity = identityReads < 3 ? "owned-start" : "reused-start";
        return Promise.resolve(
          new Map(
            entries.map((entry) => [
              entry.pid,
              observedIdentity(entry, identity),
            ]),
          ),
        );
      },
      signalGroup,
    };

    await expect(
      cleanupOwnedProcessGroup(
        {
          runId: "run-token",
          leaderPid: 100,
          processGroupId: 100,
          sweepTokenOwnedProcesses: true,
          evidenceOwner: new ProcessOwnershipEvidenceOwner(),
          captureBaseline: [{ pid: process.pid, identity: "old-start" }],
        },
        host,
      ),
    ).resolves.toMatchObject({
      cleaned: false,
      reason: "process identity could not be revalidated",
    });
    expect(signalGroup).not.toHaveBeenCalled();
    expect(identityReads).toBeGreaterThanOrEqual(3);
  });
});

it("retains initially related scope when bounded token retries later move out of scope", async () => {
  const process: ProcessTableEntry = {
    pid: 921,
    parentPid: 919,
    processGroupId: 919,
    state: "S",
    command: "retry-reparented-candidate",
  };
  const tokenReads: number[][] = [];
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  let tokenAttempt = 0;
  let identityRead = 0;
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve([process]),
    environment: () => Promise.resolve({}),
    processIdentities: (entries) => {
      identityRead += 1;
      const moved = identityRead > 2;
      return Promise.resolve(
        new Map(
          entries.map((entry) => {
            return [
              entry.pid,
              {
                state: "readable" as const,
                identity: "generation-921",
                relation: {
                  state: "observed" as const,
                  parentPid: moved ? 1 : 919,
                  processGroupId: moved ? 930 : 919,
                },
              },
            ];
          }),
        ),
      );
    },
    runTokens: (entries) => {
      tokenAttempt += 1;
      tokenReads.push(entries.map(({ pid }) => pid));
      return Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            {
              state: "unavailable" as const,
              reason:
                tokenAttempt === 1
                  ? "permission denied"
                  : "platform_binary_environment_withheld",
            },
          ]),
        ),
      );
    },
    signalGroup: vi.fn(),
  };

  const result = await verifyNoTokenOwnedProcesses(
    "run-token",
    host,
    undefined,
    {
      leaderPid: 919,
      processGroupId: 919,
      sampledProcessGroupIds: [919],
      evidenceOwner,
    },
  );

  expect(result).toMatchObject({
    cleaned: false,
    failures: [{ pid: 921, reason: "environment-unreadable" }],
  });
  expect(tokenReads).toEqual([[921], [921], [921], [921]]);
  expect(evidenceOwner.candidates).toMatchObject([
    {
      pid: 921,
      applicability: "related-ownership-unresolved",
      scopeEvidence: "previously-related-generation",
      relation: { state: "observed", parentPid: 1, processGroupId: 930 },
    },
  ]);
});

it("rechecks retained related generations when a later table omits them", async () => {
  const process: ProcessTableEntry = {
    pid: 920,
    parentPid: 919,
    processGroupId: 919,
    state: "S",
    command: "retained-related-candidate",
  };
  const tables = [[process], []] as const;
  let tableRead = 0;
  const tokenReads: number[][] = [];
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve(tables[tableRead++] ?? []),
    environment: () => Promise.resolve({}),
    processIdentities: (entries) => {
      const processGroupId = tableRead < 2 ? 919 : 930;
      return Promise.resolve(
        new Map(
          entries.map((entry) => [
            entry.pid,
            {
              state: "readable" as const,
              identity: "generation-920",
              relation: {
                state: "observed" as const,
                parentPid: tableRead < 2 ? 919 : 1,
                processGroupId,
              },
            },
          ]),
        ),
      );
    },
    runTokens: (entries) => {
      tokenReads.push(entries.map(({ pid }) => pid));
      return Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            { state: "unavailable" as const, reason: "permission denied" },
          ]),
        ),
      );
    },
    signalGroup: vi.fn(),
  };
  const relation = {
    leaderPid: 919,
    processGroupId: 919,
    sampledProcessGroupIds: [919],
    evidenceOwner,
  };

  const first = await verifyNoTokenOwnedProcesses(
    "run-token",
    host,
    undefined,
    relation,
  );
  expect(tokenReads).toEqual([[920], [920], [920], [920]]);
  expect(evidenceOwner.candidates).toMatchObject([
    { pid: 920, applicability: "related-ownership-unresolved" },
  ]);
  const second = await verifyNoTokenOwnedProcesses(
    "run-token",
    host,
    undefined,
    relation,
  );

  expect(first).toMatchObject({ cleaned: false, failures: [{ pid: 920 }] });
  expect(second).toMatchObject({ cleaned: false, failures: [{ pid: 920 }] });
  expect(tokenReads).toEqual([
    [920],
    [920],
    [920],
    [920],
    [920],
    [920],
    [920],
    [920],
  ]);
  expect(evidenceOwner.candidates).toMatchObject([
    {
      pid: 920,
      identity: "generation-920",
      applicability: "related-ownership-unresolved",
      relation: { parentPid: 1, processGroupId: 930 },
    },
  ]);
  expect(evidenceOwner.coverage).toMatchObject({
    snapshotCount: 2,
    listedRows: 0,
    retainedOnlyPids: 1,
    processTableCoverage: "unreported-by-host",
  });
});

it("revalidates identity after the final environment token read", async () => {
  let environmentReads = 0;
  let reusedDuringFinalRead = false;
  const process: ProcessTableEntry = {
    pid: 912,
    parentPid: 1,
    processGroupId: 912,
    state: "S",
    command: "reused-during-final-token-read",
  };
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve([process]),
    environment: () => {
      environmentReads += 1;
      if (environmentReads === 3) reusedDuringFinalRead = true;
      return Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" });
    },
    processIdentities: (entries) => {
      const identity = reusedDuringFinalRead ? "reused-start" : "owned-start";
      return Promise.resolve(
        new Map(
          entries.map((entry) => [
            entry.pid,
            observedIdentity(entry, identity),
          ]),
        ),
      );
    },
    signalGroup,
  };

  await expect(
    cleanupOwnedProcessGroup(
      {
        runId: "run-token",
        leaderPid: 100,
        processGroupId: 100,
        sweepTokenOwnedProcesses: true,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
        captureBaseline: [{ pid: process.pid, identity: "old-start" }],
      },
      host,
    ),
  ).resolves.toMatchObject({
    cleaned: false,
    reason: "process identity could not be revalidated",
  });
  expect(signalGroup).not.toHaveBeenCalled();
  expect(reusedDuringFinalRead).toBe(true);
});

it("fails closed when candidate PIDs change identity during token reading", async () => {
  let identityReads = 0;
  const process: ProcessTableEntry = {
    pid: 911,
    parentPid: 1,
    processGroupId: 911,
    state: "S",
    command: "reused-during-token-read",
  };
  const processes = [process, { ...process, pid: 912, processGroupId: 912 }];
  const listProcesses = vi.fn(async () => processes);
  const host: ProcessOwnershipHost = {
    listProcesses,
    environment: () => Promise.resolve({}),
    processIdentities: (entries) => {
      identityReads += 1;
      const identity = identityReads === 1 ? "new-start" : "reused-start";
      return Promise.resolve(
        new Map(
          entries.map((entry) => [
            entry.pid,
            observedIdentity(entry, identity),
          ]),
        ),
      );
    },
    runTokens: (entries) =>
      Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            { state: "readable", runId: undefined } as const,
          ]),
        ),
      ),
    signalGroup: vi.fn(),
  };

  await expect(
    verifyNoTokenOwnedProcesses(
      "run-token",
      host,
      processes.map(({ pid }) => ({ pid, identity: "old-start" })),
    ),
  ).resolves.toEqual({
    cleaned: false,
    reason: "process identity could not be revalidated",
    failures: processes.map(({ pid }) => ({
      pid,
      reason: "process-identity-unavailable",
      diagnostic: "process identity changed during token validation",
    })),
  });
  // Retry the exact candidate generations with native identity reads; do not
  // rescan the full process table, which would add unrelated transient rows.
  expect(listProcesses).toHaveBeenCalledTimes(1);
});

it("uses the launcher's native relation instead of stale process-table fields", async () => {
  const row = {
    pid: 100,
    parentPid: 999,
    processGroupId: 999,
    state: "S",
    command: "/owned/hopper",
  } satisfies ProcessTableEntry;
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve([row]),
    environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    runTokens: (members) =>
      Promise.resolve(
        new Map(
          members.map(({ pid }) => [
            pid,
            { state: "readable" as const, runId: "run-token" },
          ]),
        ),
      ),
    processIdentities: (members) =>
      Promise.resolve(
        new Map(
          members.map((member) => [
            member.pid,
            observedIdentity(
              { ...member, parentPid: 1, processGroupId: 100 },
              "start-100",
            ),
          ]),
        ),
      ),
    signalGroup,
  };
  const result = await cleanupOwnedProcessGroup(
    {
      runId: "run-token",
      leaderPid: 100,
      processGroupId: 100,
      expectedParentPid: 1,
      expectedCommand: "/owned/hopper",
    },
    host,
  );
  expect(result).toMatchObject({ cleaned: true, signaled: true });
  expect(signalGroup).toHaveBeenCalledWith(100, "SIGKILL");
});

it("does not settle a live launcher from stale table ancestry when native relation mismatches", async () => {
  const row = {
    pid: 100,
    parentPid: 1,
    processGroupId: 100,
    state: "S",
    command: "/owned/hopper",
  } satisfies ProcessTableEntry;
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve([row]),
    environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    processIdentities: () =>
      Promise.resolve(
        new Map([
          [
            100,
            {
              ...observedIdentity(row, "start-100"),
              relation: {
                state: "observed" as const,
                parentPid: 2,
                processGroupId: 200,
              },
            },
          ],
        ]),
      ),
    signalGroup,
  };
  await expect(
    cleanupOwnedProcessGroup(
      {
        runId: "run-token",
        leaderPid: 100,
        processGroupId: 100,
        expectedParentPid: 1,
        expectedCommand: "/owned/hopper",
      },
      host,
    ),
  ).resolves.toMatchObject({
    cleaned: false,
    reason: "owned launcher process-group identity did not match",
  });
  expect(signalGroup).not.toHaveBeenCalled();
});

it("refuses to signal when PID identity changes after token validation", async () => {
  const signalGroup = vi.fn();
  let identityReads = 0;
  const process: ProcessTableEntry = {
    pid: 903,
    parentPid: 1,
    processGroupId: 903,
    state: "S",
    command: "reused-before-signal",
  };
  const host: ProcessOwnershipHost = {
    listProcesses: () => Promise.resolve([process]),
    environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    processIdentities: (entries) => {
      identityReads += 1;
      const identity = identityReads < 3 ? "owned-start" : "reused-start";
      return Promise.resolve(
        new Map(
          entries.map((entry) => [
            entry.pid,
            observedIdentity(entry, identity),
          ]),
        ),
      );
    },
    runTokens: (entries) =>
      Promise.resolve(
        new Map(
          entries.map(({ pid }) => [
            pid,
            { state: "readable", runId: "run-token" } as const,
          ]),
        ),
      ),
    signalGroup,
  };

  await expect(
    cleanupOwnedProcessGroup(
      {
        runId: "run-token",
        leaderPid: 100,
        processGroupId: 100,
        sweepTokenOwnedProcesses: true,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
        captureBaseline: [{ pid: process.pid, identity: "old-start" }],
      },
      host,
    ),
  ).resolves.toMatchObject({
    cleaned: false,
    reason: "process identity could not be revalidated",
  });
  expect(signalGroup).not.toHaveBeenCalled();
  expect(identityReads).toBeGreaterThanOrEqual(3);
});
