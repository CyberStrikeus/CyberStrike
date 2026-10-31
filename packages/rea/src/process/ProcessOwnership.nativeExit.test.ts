import { spawn } from "node:child_process";
import { once } from "node:events";

import { expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  verifyNoTokenOwnedProcesses,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import {
  createSystemProcessOwnershipHost,
  readProcessOwnershipFacts,
  settleVanishedTokenFacts,
} from "./ProcessOwnershipObservation.js";

it.each(["zombie", "absent", "live", "unavailable"] as const)(
  "rechecks native lifetime when a token disappears during cleanup: %s",
  async (lifetimeAfterToken) => {
    const row: ProcessTableEntry = {
      pid: 100,
      parentPid: 1,
      processGroupId: 100,
      state: "S",
      command: "fixture",
    };
    let tokenRead = false;
    const identity = (): ProcessIdentityObservation => {
      if (tokenRead && lifetimeAfterToken === "absent")
        return { state: "absent", reason: "not-found-in-caller-pid-namespace" };
      if (tokenRead && lifetimeAfterToken === "unavailable")
        return { state: "unavailable", reason: "identity read denied" };
      return {
        state: "readable",
        identity: "same-generation",
        lifecycle: {
          state: "observed",
          lifecycle:
            tokenRead && lifetimeAfterToken === "zombie"
              ? "zombie"
              : "non-zombie",
        },
        relation: { state: "observed", parentPid: 1, processGroupId: 100 },
      };
    };
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [row],
      environment: async () => ({}),
      runTokens: async (members) => {
        tokenRead = true;
        return new Map(
          members.map(({ pid }) => [
            pid,
            { state: "readable" as const, runId: undefined },
          ]),
        );
      },
      processIdentities: async (members) =>
        new Map(members.map(({ pid }) => [pid, identity()])),
      signalGroup,
    };
    const result = await cleanupOwnedProcessGroup(
      { runId: "run", leaderPid: 100, processGroupId: 100 },
      host,
    );
    expect(tokenRead).toBe(true);
    if (lifetimeAfterToken === "zombie" || lifetimeAfterToken === "absent") {
      expect(result).toEqual({ cleaned: true, signaled: false });
    } else {
      expect(result).toMatchObject({
        cleaned: false,
        failures: [
          {
            pid: 100,
            reason:
              lifetimeAfterToken === "live"
                ? "run-token-mismatch"
                : "process-identity-unavailable",
          },
        ],
      });
    }
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

// A failing procfs environ read does not establish exit on its own. The
// native observer must corroborate the absence before cleanup drops a PID.
it.each(["ESRCH", "ENOENT"] as const)(
  "settles %s from /proc/PID/environ only after native absence confirmation",
  async (code) => {
    const row: ProcessTableEntry = {
      pid: 900,
      parentPid: 1,
      processGroupId: 900,
      state: "S",
      command: "short-lived-fixture",
    };
    let identityReads = 0;
    const live: ProcessIdentityObservation = {
      state: "readable",
      identity: "start:900",
      lifecycle: { state: "observed", lifecycle: "non-zombie" },
      relation: { state: "observed", parentPid: 1, processGroupId: 900 },
    };
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [row],
      environment: async () => {
        throw Object.assign(
          new Error(code + ": no such process, open '/proc/900/environ'"),
          { code },
        );
      },
      processIdentities: async (rows) =>
        new Map<number, ProcessIdentityObservation>(
          rows.map(({ pid }) => [
            pid,
            ++identityReads < 3
              ? live
              : {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                },
          ]),
        ),
      signalGroup: vi.fn(),
    };
    const [fact] = await readProcessOwnershipFacts([row], host);
    expect(identityReads).toBe(3);
    expect(fact?.token).toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining(code),
    });
    expect(fact?.state).toBe("absent");
    expect(fact?.identityAfter).toEqual({
      state: "absent",
      reason: "not-found-in-caller-pid-namespace",
    });
    expect(host.signalGroup).not.toHaveBeenCalled();
  },
);

it.each([
  {
    code: "ESRCH",
    mode: "live",
    expectedReads: 3,
    expectedState: "same-generation",
  },
  {
    code: "ESRCH",
    mode: "reused",
    expectedReads: 3,
    expectedState: "unavailable",
  },
  {
    code: "ESRCH",
    mode: "reused-zombie",
    expectedReads: 3,
    expectedState: "unavailable",
  },
  {
    code: "ESRCH",
    mode: "unknown",
    expectedReads: 3,
    expectedState: "same-generation",
  },
  {
    code: "EACCES",
    mode: "absent",
    expectedReads: 2,
    expectedState: "same-generation",
  },
] as const)(
  "does not clear unverifiable /proc environ failures: $code / $mode",
  async ({ code, mode, expectedReads, expectedState }) => {
    const row: ProcessTableEntry = {
      pid: 901,
      parentPid: 1,
      processGroupId: 901,
      state: "S",
      command: "fixture",
    };
    let identityReads = 0;
    const live: ProcessIdentityObservation = {
      state: "readable",
      identity: "start:901",
      lifecycle: { state: "observed", lifecycle: "non-zombie" },
      relation: { state: "observed", parentPid: 1, processGroupId: 901 },
    };
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [row],
      environment: async () => {
        throw Object.assign(new Error(code + ": open '/proc/901/environ'"), {
          code,
        });
      },
      processIdentities: async (rows) =>
        new Map<number, ProcessIdentityObservation>(
          rows.map(({ pid }) => {
            identityReads += 1;
            if (identityReads < 3) return [pid, live] as const;
            switch (mode) {
              case "absent":
                return [
                  pid,
                  {
                    state: "absent" as const,
                    reason: "not-found-in-caller-pid-namespace" as const,
                  },
                ] as const;
              case "reused":
                return [
                  pid,
                  { ...live, identity: "start:replacement" },
                ] as const;
              case "reused-zombie":
                return [
                  pid,
                  {
                    ...live,
                    identity: "start:zombie-replacement",
                    lifecycle: {
                      state: "observed" as const,
                      lifecycle: "zombie" as const,
                    },
                  },
                ] as const;
              case "unknown":
                return [
                  pid,
                  {
                    state: "unavailable" as const,
                    reason: "permission denied",
                  },
                ] as const;
              default:
                return [pid, live] as const;
            }
          }),
        ),
      signalGroup: vi.fn(),
    };
    const [fact] = await readProcessOwnershipFacts([row], host);
    expect(identityReads).toBe(expectedReads);
    expect(fact?.state).toBe(expectedState);
    expect(fact?.identityAfter.state).not.toBe("absent");
    expect(fact?.token.state).toBe("unavailable");
    expect(host.signalGroup).not.toHaveBeenCalled();
  },
);

const itOnLinux = process.platform === "linux" ? it : it.skip;

itOnLinux(
  "verifies a real child exit between the native identity and follow-up read",
  async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1_000)"],
      {
        stdio: "ignore",
      },
    );
    if (child.pid === undefined) throw new Error("fixture child did not start");
    const pid = child.pid;
    const row: ProcessTableEntry = {
      pid,
      parentPid: process.pid,
      processGroupId: pid,
      state: "S",
      command: process.execPath,
    };
    const systemHost = createSystemProcessOwnershipHost("linux", {});
    let nativeReads = 0;
    let exitArmed = false;
    const host: ProcessOwnershipHost = {
      ...systemHost,
      environment: async () => {
        exitArmed = true;
        throw Object.assign(
          new Error(
            "ESRCH: simulated environ-open race before native process exit",
          ),
          { code: "ESRCH" },
        );
      },
      processIdentities: async (...args) => {
        const observations = await systemHost.processIdentities!(...args);
        nativeReads += 1;
        if (exitArmed) {
          exitArmed = false;
          child.kill("SIGTERM");
          await once(child, "exit");
        }
        return observations;
      },
      signalGroup: vi.fn(),
    };
    try {
      const [fact] = await readProcessOwnershipFacts([row], host);
      expect(nativeReads).toBeGreaterThanOrEqual(3);
      expect(fact?.identityBefore).toMatchObject({
        state: "readable",
        identity: expect.stringMatching(/^linux-starttime:/u),
      });
      expect(fact?.token).toMatchObject({
        state: "unavailable",
        reason: expect.stringContaining("ESRCH"),
      });
      expect(fact?.identityAfter).toEqual({
        state: "absent",
        reason: "not-found-in-caller-pid-namespace",
      });
      expect(fact?.state).toBe("absent");
      expect(host.signalGroup).not.toHaveBeenCalled();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
  },
);

it.each([
  "absent",
  "delayed-absent",
  "live",
  "reused",
  "delayed-reused",
  "unknown",
  "reused-zombie",
] as const)(
  "resolves a Linux token-read exit race after final sweep retry: %s",
  async (lastIdentity) => {
    const row: ProcessTableEntry = {
      pid: 902,
      parentPid: 1,
      processGroupId: 902,
      state: "S",
      command: "short-lived-worker",
    };
    const live: ProcessIdentityObservation = {
      state: "readable",
      identity: "start:902",
      lifecycle: { state: "observed", lifecycle: "non-zombie" },
      relation: { state: "observed", parentPid: 1, processGroupId: 902 },
    };
    let tokenReads = 0;
    let readsAfterLastToken = 0;
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [row], // stale snapshot must never prove exit
      environment: async () => {
        tokenReads += 1;
        throw Object.assign(new Error("ESRCH: open '/proc/902/environ'"), {
          code: "ESRCH",
        });
      },
      processIdentities: async (members) =>
        new Map<number, ProcessIdentityObservation>(
          members.map(({ pid }) => {
            if (tokenReads < 4) return [pid, live] as const;
            readsAfterLastToken += 1;
            const delayed = lastIdentity.startsWith("delayed-");
            if (readsAfterLastToken < (delayed ? 5 : 3))
              return [pid, live] as const;
            switch (lastIdentity) {
              case "delayed-absent":
              case "absent":
                return [
                  pid,
                  {
                    state: "absent" as const,
                    reason: "not-found-in-caller-pid-namespace",
                  },
                ] as const;
              case "delayed-reused":
              case "reused":
                return [
                  pid,
                  { ...live, identity: "start:replacement" },
                ] as const;
              case "reused-zombie":
                return [
                  pid,
                  {
                    ...live,
                    identity: "start:zombie-replacement",
                    lifecycle: {
                      state: "observed" as const,
                      lifecycle: "zombie" as const,
                    },
                  },
                ] as const;
              case "unknown":
                return [
                  pid,
                  {
                    state: "unavailable" as const,
                    reason: "native identity permission denied",
                  },
                ] as const;
              default:
                return [pid, live] as const;
            }
          }),
        ),
      signalGroup: vi.fn(),
    };
    const result = await verifyNoTokenOwnedProcesses("run-token", host);
    expect(tokenReads).toBe(4);
    // A live process is not repeatedly scanned without a fixed upper bound.
    expect(readsAfterLastToken).toBeLessThanOrEqual(6);
    if (lastIdentity === "delayed-absent" || lastIdentity === "delayed-reused")
      expect(readsAfterLastToken).toBe(5);
    if (lastIdentity === "absent" || lastIdentity === "delayed-absent")
      expect(result).toEqual({ cleaned: true, signaled: false });
    else
      expect(result).toMatchObject({
        cleaned: false,
        failures: [
          {
            pid: 902,
            reason: lastIdentity.includes("reused")
              ? "process-identity-unavailable"
              : "environment-unreadable",
          },
        ],
      });
    expect(host.signalGroup).not.toHaveBeenCalled();
  },
);

it.each(["absent", "live", "unavailable", "reused", "reused-zombie"] as const)(
  "corroborates group token-open races without signaling %s",
  async (outcome) => {
    const row: ProcessTableEntry = {
      pid: 910,
      parentPid: 1,
      processGroupId: 910,
      state: "S",
      command: "fixture",
    };
    let tokenRead = false;
    let postTokenReads = 0;
    let absent = false;
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => (absent ? [] : [row]),
      environment: async () => ({}),
      runTokens: async (members) => {
        tokenRead = true;
        return new Map(
          members.map(({ pid }) => [
            pid,
            {
              state: "unavailable" as const,
              reason: "failure details without errno",
              code: "ESRCH",
            },
          ]),
        );
      },
      processIdentities: async (members) =>
        new Map<number, ProcessIdentityObservation>(
          members.map(({ pid }) => {
            const later = tokenRead && ++postTokenReads >= 3;
            if (later && outcome === "absent") {
              absent = true;
              return [
                pid,
                {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                },
              ];
            }
            if (later && outcome === "unavailable") {
              return [
                pid,
                { state: "unavailable" as const, reason: "identity denied" },
              ];
            }
            return [
              pid,
              {
                state: "readable" as const,
                identity:
                  later && outcome.startsWith("reused")
                    ? "replacement"
                    : "generation-910",
                lifecycle: {
                  state: "observed" as const,
                  lifecycle:
                    later && outcome === "reused-zombie"
                      ? ("zombie" as const)
                      : ("non-zombie" as const),
                },
                relation: {
                  state: "observed" as const,
                  parentPid: 1,
                  processGroupId: 910,
                },
              },
            ];
          }),
        ),
      signalGroup,
    };
    const result = await cleanupOwnedProcessGroup(
      { runId: "run", leaderPid: 910, processGroupId: 910 },
      host,
    );
    if (outcome === "absent")
      expect(result).toEqual({ cleaned: true, signaled: false });
    else
      expect(result).toMatchObject({
        cleaned: false,
        failures: [
          {
            pid: 910,
            reason: outcome.startsWith("reused")
              ? "process-identity-unavailable"
              : "environment-unreadable",
          },
        ],
      });
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

it("honors cancellation during token-open exit settlement", async () => {
  const row: ProcessTableEntry = {
    pid: 911,
    parentPid: 1,
    processGroupId: 911,
    state: "S",
    command: "fixture",
  };
  const identity: ProcessIdentityObservation = {
    state: "readable",
    identity: "generation-911",
    lifecycle: { state: "observed", lifecycle: "non-zombie" },
  };
  const controller = new AbortController();
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => [row],
    environment: async () => ({}),
    signalGroup: vi.fn(),
    processIdentities: async () => {
      controller.abort(new Error("cancelled"));
      return new Map([[row.pid, identity]]);
    },
  };
  await expect(
    settleVanishedTokenFacts(
      [
        {
          process: row,
          state: "same-generation",
          identityBefore: identity,
          identityAfter: identity,
          token: { state: "unavailable", reason: "vanished", code: "ESRCH" },
        },
      ],
      host,
      { deadline: undefined },
      controller.signal,
    ),
  ).rejects.toThrow("cancelled");
});

it("does not signal a stale group after its last member exits during revalidation", async () => {
  const row: ProcessTableEntry = {
    pid: 912,
    parentPid: 1,
    processGroupId: 912,
    state: "S",
    command: "fixture",
  };
  let tokenReads = 0;
  let laterReads = 0;
  let absent = false;
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => (absent ? [] : [row]),
    environment: async () => ({}),
    runTokens: async (members) => {
      tokenReads += 1;
      return new Map(
        members.map(({ pid }) => [
          pid,
          tokenReads === 1
            ? { state: "readable" as const, runId: "run" }
            : {
                state: "unavailable" as const,
                reason: "failure details without errno",
                code: "ESRCH",
              },
        ]),
      );
    },
    processIdentities: async (members) =>
      new Map<number, ProcessIdentityObservation>(
        members.map(({ pid }) => {
          if (tokenReads >= 2 && ++laterReads >= 3) {
            absent = true;
            return [
              pid,
              { state: "absent", reason: "not-found-in-caller-pid-namespace" },
            ];
          }
          return [
            pid,
            {
              state: "readable",
              identity: "generation-912",
              lifecycle: { state: "observed", lifecycle: "non-zombie" },
              relation: {
                state: "observed",
                parentPid: 1,
                processGroupId: 912,
              },
            },
          ];
        }),
      ),
    signalGroup,
  };
  expect(
    await cleanupOwnedProcessGroup(
      { runId: "run", leaderPid: 912, processGroupId: 912 },
      host,
    ),
  ).toEqual({ cleaned: true, signaled: false });
  expect(tokenReads).toBe(2);
  expect(signalGroup).not.toHaveBeenCalled();
});

it("revalidates a group after its observed launcher exits and a child appears", async () => {
  const launcher: ProcessTableEntry = {
    pid: 920,
    parentPid: 1,
    processGroupId: 920,
    state: "S",
    command: "launcher",
  };
  const child: ProcessTableEntry = {
    pid: 921,
    parentPid: 1,
    processGroupId: 920,
    state: "S",
    command: "child",
  };
  let exited = false;
  let signaled = false;
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => (signaled ? [] : exited ? [child] : [launcher]),
    environment: async (pid) => {
      if (pid === launcher.pid) {
        exited = true;
        throw Object.assign(new Error("opaque exit"), { code: "ESRCH" });
      }
      return { REA_PROCESS_RUN_ID: "run" };
    },
    processIdentities: async (rows) =>
      new Map(
        rows.map(({ pid }) => [
          pid,
          pid === launcher.pid && exited
            ? {
                state: "absent" as const,
                reason: "not-found-in-caller-pid-namespace" as const,
              }
            : {
                state: "readable" as const,
                identity: `generation-${pid}`,
                lifecycle: {
                  state: "observed" as const,
                  lifecycle: "non-zombie" as const,
                },
                relation: {
                  state: "observed" as const,
                  parentPid: 1,
                  processGroupId: 920,
                },
              },
        ]),
      ),
    signalGroup: vi.fn(() => {
      signaled = true;
    }),
  };
  expect(
    await cleanupOwnedProcessGroup(
      { runId: "run", leaderPid: 920, processGroupId: 920 },
      host,
    ),
  ).toEqual({ cleaned: true, signaled: true });
  expect(host.signalGroup).toHaveBeenCalledWith(920, "SIGKILL");
});

it("refreshes a group when its last member exits during revalidation and a child appears", async () => {
  const launcher: ProcessTableEntry = {
    pid: 940,
    parentPid: 1,
    processGroupId: 940,
    state: "S",
    command: "launcher",
  };
  const child: ProcessTableEntry = {
    pid: 941,
    parentPid: 940,
    processGroupId: 940,
    state: "S",
    command: "child",
  };
  let planningTokenRead = false;
  let phase: "planning" | "snapshot" | "after-snapshot" = "planning";
  let refreshFoundChild = false;
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    platform: "linux",
    listProcesses: async () => {
      if (phase === "after-snapshot") {
        refreshFoundChild = true;
        return [child];
      }
      // The snapshot under test is the table read after planning has already
      // observed the launcher token. Earlier planning reads stay on the launcher.
      if (planningTokenRead && phase === "planning") phase = "snapshot";
      return [launcher];
    },
    environment: async (pid) => {
      if (pid === launcher.pid && phase === "snapshot") {
        phase = "after-snapshot";
        throw Object.assign(new Error("opaque exit"), { code: "ESRCH" });
      }
      if (pid === launcher.pid) planningTokenRead = true;
      return { REA_PROCESS_RUN_ID: "run" };
    },
    processIdentities: async (rows) =>
      new Map<number, ProcessIdentityObservation>(
        rows.map(({ pid }) =>
          pid === launcher.pid && phase === "after-snapshot"
            ? [
                pid,
                {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                },
              ]
            : [
                pid,
                {
                  state: "readable" as const,
                  identity: `generation-${pid}`,
                  lifecycle: {
                    state: "observed" as const,
                    lifecycle: "non-zombie" as const,
                  },
                  relation: {
                    state: "observed" as const,
                    parentPid: pid === child.pid ? launcher.pid : 1,
                    processGroupId: 940,
                  },
                },
              ],
        ),
      ),
    signalGroup,
  };
  expect(
    await cleanupOwnedProcessGroup(
      { runId: "run", leaderPid: 940, processGroupId: 940 },
      host,
    ),
  ).toEqual({ cleaned: true, signaled: true });
  expect(refreshFoundChild).toBe(true);
  expect(signalGroup).toHaveBeenCalledWith(940, "SIGKILL");
});

it.each([
  { code: "ESRCH", message: "opaque failure", expected: "absent" },
  {
    code: undefined,
    message: "ESRCH: misleading text",
    expected: "same-generation",
  },
] as const)(
  "uses structured token error codes instead of message text ($message)",
  async ({ code, message, expected }) => {
    const row: ProcessTableEntry = {
      pid: 930,
      parentPid: 1,
      processGroupId: 930,
      state: "S",
      command: "fixture",
    };
    let tokenRead = false;
    let observedAfterToken = false;
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [row],
      environment: async () => {
        tokenRead = true;
        throw Object.assign(
          new Error(message),
          code === undefined ? {} : { code },
        );
      },
      processIdentities: async (rows) =>
        new Map<number, ProcessIdentityObservation>(
          rows.map(({ pid }) => {
            if (tokenRead && observedAfterToken)
              return [
                pid,
                {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                },
              ];
            if (tokenRead) observedAfterToken = true;
            return [
              pid,
              {
                state: "readable" as const,
                identity: "generation-930",
                lifecycle: {
                  state: "observed" as const,
                  lifecycle: "non-zombie" as const,
                },
                relation: {
                  state: "observed" as const,
                  parentPid: 1,
                  processGroupId: 930,
                },
              },
            ];
          }),
        ),
      signalGroup: vi.fn(),
    };
    const [fact] = await readProcessOwnershipFacts([row], host);
    expect(fact?.state).toBe(expected);
    expect(fact?.token).toMatchObject({
      state: "unavailable",
      reason: message,
      ...(code === undefined ? {} : { code }),
    });
  },
);
