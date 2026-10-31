import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { parseProcessEnvironment } from "./ProcessOwnershipObservation.js";
import { selectCapturedProcessGroupIds } from "./ProcessOwnershipProcessTree.js";
import { matchesOwnedProcessCommand } from "./ProcessCommandIdentity.js";
import { createOwnership, host } from "./ProcessOwnership.fixture.js";

let ownership = createOwnership();
beforeEach(() => {
  ownership = createOwnership();
});

const identitiesWithRelations = (
  processes: readonly ProcessTableEntry[],
): ReadonlyMap<number, ProcessIdentityObservation> =>
  new Map(
    processes.map((entry) => [
      entry.pid,
      {
        state: "readable" as const,
        identity: `start-${String(entry.pid)}`,
        relation: {
          state: "observed" as const,
          parentPid: entry.parentPid,
          processGroupId: entry.processGroupId,
        },
      },
    ]),
  );
describe("owned process-group cleanup discovery", () => {
  it("excludes sampled groups whose leader was outside the captured tree", () => {
    expect(
      selectCapturedProcessGroupIds(100, [
        { pid: 100, process_group_id: 42 },
        { pid: 100, process_group_id: 100 },
        { pid: 101, process_group_id: 42 },
        { pid: 102, process_group_id: 102 },
        { pid: 103, process_group_id: 102 },
      ]),
    ).toEqual([100, 102]);
  });
  it("preserves only named source entries in the Linux environment", () => {
    const environment = parseProcessEnvironment(
      "=ignored\0REA_PROCESS_RUN_ID=earlier\0EMPTY=\0REA_PROCESS_RUN_ID=owned\0constructor=source\0__proto__=retained\0VALUE=a=b\0",
    );
    expect(environment).toEqual({
      REA_PROCESS_RUN_ID: "owned",
      EMPTY: "",
      constructor: "source",
      ["__proto__"]: "retained",
      VALUE: "a=b",
    });
    expect(environment["toString"]).toBeUndefined();
  });
  it("matches macOS executable names after process-table normalization", () => {
    expect(
      matchesOwnedProcessCommand(
        "node /tmp/fake-launcher.mjs",
        "/opt/node/bin/node",
        "darwin",
      ),
    ).toBe(true);
    expect(
      matchesOwnedProcessCommand("(node)", "/opt/node/bin/node", "darwin"),
    ).toBe(true);
    expect(
      matchesOwnedProcessCommand(
        "node /tmp/fake-launcher.mjs",
        "/opt/python/bin/python3",
        "darwin",
      ),
    ).toBe(false);
    expect(
      matchesOwnedProcessCommand(
        "node /tmp/fake-launcher.mjs",
        "/opt/node/bin/node",
        "linux",
      ),
    ).toBe(false);
    expect(
      matchesOwnedProcessCommand("(node)", "/opt/node/bin/node", "linux"),
    ).toBe(false);
  });
  it("signals only a group whose every member carries the run token", async () => {
    const { adapter, signalGroup } = host({
      100: { REA_PROCESS_RUN_ID: "run-token" },
      101: { REA_PROCESS_RUN_ID: "run-token" },
    });
    expect(await cleanupOwnedProcessGroup(ownership, adapter)).toEqual({
      cleaned: true,
      signaled: true,
    });
    expect(signalGroup).toHaveBeenCalledWith(100, "SIGKILL");
  });
  it("does not signal a group when a member only inherits its matching token", async () => {
    const inherited: Record<string, string> = Object.create({
      REA_PROCESS_RUN_ID: ownership.runId,
    });
    const { adapter, signalGroup } = host({
      100: { REA_PROCESS_RUN_ID: ownership.runId },
      101: inherited,
    });
    expect(await cleanupOwnedProcessGroup(ownership, adapter)).toMatchObject({
      cleaned: false,
    });
    expect(signalGroup).not.toHaveBeenCalled();
  });
});

describe("opaque process neighbors during cleanup", () => {
  it.each([
    "platform_binary_environment_withheld",
    "restricted_process_environment_withheld",
  ])(
    "cleans verified run-owned groups and records an unrelated %s neighbor",
    async (diagnostic) => {
      const processes = [
        { pid: 100, parentPid: 1, processGroupId: 100, command: "capture" },
        {
          pid: 200,
          parentPid: 1,
          processGroupId: 200,
          command: "detached-child",
        },
        {
          pid: 900,
          parentPid: 1,
          processGroupId: 900,
          command: "/usr/bin/opaque-neighbor",
        },
      ].map((process) => ({ ...process, state: "S" }));
      const signalGroup = vi.fn((processGroupId: number) => {
        for (let index = processes.length - 1; index >= 0; index -= 1)
          if (processes[index]?.processGroupId === processGroupId)
            processes.splice(index, 1);
      });
      const adapter: ProcessOwnershipHost = {
        platform: "darwin",
        listProcesses: () => Promise.resolve(processes),
        environment: (pid) =>
          Promise.resolve({
            REA_PROCESS_RUN_ID: pid === 900 ? "unowned" : "run-token",
          }),
        processIdentities: (entries) =>
          Promise.resolve(
            new Map(
              entries.map((entry) => {
                const current = processes.find(({ pid }) => pid === entry.pid);
                return [
                  entry.pid,
                  current === undefined
                    ? {
                        state: "absent" as const,
                        reason: "not-in-snapshot" as const,
                      }
                    : identitiesWithRelations([current]).get(entry.pid)!,
                ];
              }),
            ),
          ),
        runTokens: (members) =>
          Promise.resolve(
            new Map(
              members.map(({ pid }) => [
                pid,
                pid === 900
                  ? {
                      state: "unavailable" as const,
                      reason: diagnostic,
                    }
                  : { state: "readable" as const, runId: "run-token" },
              ]),
            ),
          ),
        signalGroup,
      };

      const result = await cleanupOwnedProcessGroup(
        {
          ...ownership,
          sweepTokenOwnedProcesses: true,
          captureBaseline: [],
        },
        adapter,
      );

      expect(result).toMatchObject({
        cleaned: true,
        signaled: true,
        unverified: [{ pid: 900, diagnostic }],
      });
      expect(signalGroup.mock.calls).toEqual([
        [100, "SIGKILL"],
        [200, "SIGKILL"],
      ]);
      expect(signalGroup).not.toHaveBeenCalledWith(900, "SIGKILL");
    },
  );

  it("fails closed for an unrelated candidate with an ordinary unavailable environment", async () => {
    const diagnostic = "environment_unavailable";
    const processes = [
      { pid: 100, parentPid: 1, processGroupId: 100, command: "capture" },
      {
        pid: 900,
        parentPid: 1,
        processGroupId: 900,
        command: "opaque-neighbor",
      },
    ].map((process) => ({ ...process, state: "S" }));
    const signalGroup = vi.fn();
    const identities = identitiesWithRelations(processes);
    const adapter: ProcessOwnershipHost = {
      platform: "darwin",
      listProcesses: () => Promise.resolve(processes),
      environment: (pid) =>
        Promise.resolve({
          REA_PROCESS_RUN_ID: pid === 900 ? "unowned" : "run-token",
        }),
      processIdentities: () => Promise.resolve(identities),
      runTokens: (members) =>
        Promise.resolve(
          new Map(
            members.map(({ pid }) => [
              pid,
              pid === 900
                ? {
                    state: "unavailable" as const,
                    reason: diagnostic,
                  }
                : { state: "readable" as const, runId: "run-token" },
            ]),
          ),
        ),
      signalGroup,
    };

    const result = await cleanupOwnedProcessGroup(
      {
        ...ownership,
        sweepTokenOwnedProcesses: true,
        captureBaseline: [],
      },
      adapter,
    );

    expect(result).toMatchObject({
      cleaned: false,
      reason: expect.stringContaining(`${diagnostic}=1`),
    });
    if (result.cleaned)
      throw new Error("Expected unknown ownership to fail closed");
    expect(result.reason).toContain(`live candidates 900=${diagnostic}`);
    expect(result.reason).not.toContain("unowned");
    expect(result.reason).not.toContain("run-token");
    expect(signalGroup.mock.calls).toEqual([[100, "SIGKILL"]]);
    expect(signalGroup).not.toHaveBeenCalledWith(900, "SIGKILL");
  });
});

describe("related sweep candidates during cleanup", () => {
  it("counts each unreadable live member once", async () => {
    const processes = [
      {
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        state: "S",
        command: "capture",
      },
      {
        pid: 101,
        parentPid: 100,
        processGroupId: 100,
        state: "S",
        command: "child-a",
      },
      {
        pid: 102,
        parentPid: 100,
        processGroupId: 100,
        state: "S",
        command: "child-b",
      },
    ];
    const signalGroup = vi.fn();
    const adapter: ProcessOwnershipHost = {
      listProcesses: async () => processes,
      environment: async () => ({}),
      runTokens: async (members) =>
        new Map(
          members.map(({ pid }) => [
            pid,
            pid === 100
              ? { state: "readable" as const, runId: ownership.runId }
              : {
                  state: "unavailable" as const,
                  reason: "environment_unavailable",
                },
          ]),
        ),
      signalGroup,
    };
    const result = await cleanupOwnedProcessGroup(
      { ...ownership, sweepTokenOwnedProcesses: true, captureBaseline: [] },
      adapter,
    );
    if (result.cleaned) throw new Error("expected cleanup failure");
    expect(signalGroup).not.toHaveBeenCalled();
    expect(result.failures?.map(({ pid }) => pid).sort()).toEqual([101, 102]);
    expect(result.reason).toContain("2 live process(es)");
  });

  it("upgrades unreadable evidence when later group validation finds a foreign token", async () => {
    const processes = [
      {
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        state: "S",
        command: "capture",
      },
      {
        pid: 200,
        parentPid: 100,
        processGroupId: 200,
        state: "S",
        command: "detached-child",
      },
    ];
    const signalGroup = vi.fn();
    let childReads = 0;
    const adapter: ProcessOwnershipHost = {
      listProcesses: async () => processes,
      processIdentities: async (members) => identitiesWithRelations(members),
      environment: async () => ({}),
      runTokens: async (members) =>
        new Map(
          members.map(({ pid }) => [
            pid,
            pid === 100
              ? { state: "readable" as const, runId: ownership.runId }
              : ++childReads <= 4
                ? {
                    state: "unavailable" as const,
                    reason: "environment_unavailable",
                  }
                : { state: "readable" as const, runId: "foreign-token" },
          ]),
        ),
      signalGroup,
    };
    const result = await cleanupOwnedProcessGroup(
      { ...ownership, sweepTokenOwnedProcesses: true, captureBaseline: [] },
      adapter,
    );
    expect(result).toMatchObject({
      cleaned: false,
      reason: "process ownership token mismatch for PID(s): 200",
      failures: [{ pid: 200, reason: "run-token-mismatch" }],
    });
    expect(signalGroup).not.toHaveBeenCalledWith(200, "SIGKILL");
  });
});

describe("withheld process evidence during cleanup", () => {
  it.each(["revalidation", "signal-error"] as const)(
    "retains withheld-process evidence after %s failure",
    async (mode) => {
      const processes = [
        {
          pid: 100,
          parentPid: 1,
          processGroupId: 100,
          state: "S",
          command: "fixture",
        },
        {
          pid: 900,
          parentPid: 1,
          processGroupId: 900,
          state: "S",
          command: "opaque",
        },
      ];
      let rootReads = 0;
      const signalGroup = vi.fn(() => {
        if (mode === "signal-error")
          throw Object.assign(new Error("signal denied"), { code: "EACCES" });
      });
      const adapter: ProcessOwnershipHost = {
        listProcesses: async () => processes,
        environment: async () => ({}),
        runTokens: async (members) =>
          new Map(
            members.map(({ pid }) => [
              pid,
              pid === 900
                ? {
                    state: "unavailable" as const,
                    reason: "platform_binary_environment_withheld",
                  }
                : {
                    state: "readable" as const,
                    runId:
                      mode === "revalidation" && ++rootReads > 2
                        ? "other-run"
                        : "run-token",
                  },
            ]),
          ),
        signalGroup,
      };

      const result = await cleanupOwnedProcessGroup(
        { ...ownership, sweepTokenOwnedProcesses: true, captureBaseline: [] },
        adapter,
      );

      expect(result.unverified).toEqual([
        { pid: 900, diagnostic: "platform_binary_environment_withheld" },
      ]);
      if (result.cleaned) throw new Error("expected cleanup failure");
      if (mode === "revalidation")
        expect(result.reason).toBe(
          "process ownership token mismatch for PID(s): 100",
        );
      else
        expect(result.reason).toBe(
          "owned process group signal failed: signal denied",
        );
    },
  );

  it.each([
    "environment_unavailable",
    "platform_binary_environment_withheld",
    "restricted_process_environment_withheld",
  ])("fails closed for a related candidate with %s", async (diagnostic) => {
    const processes = [
      {
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        state: "S",
        command: "capture",
      },
      {
        pid: 101,
        parentPid: 100,
        processGroupId: 100,
        state: "S",
        uid:
          diagnostic === "restricted_process_environment_withheld"
            ? (process.getuid?.() ?? 0)
            : process.getuid?.() === 0
              ? 1
              : 0,
        command: "ready-hang",
      },
    ];
    const signalGroup = vi.fn();
    const identities = identitiesWithRelations(processes);
    const adapter: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processes),
      environment: (pid) =>
        pid === 100
          ? Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" })
          : Promise.reject(new Error("EACCES: permission denied")),
      processIdentities: () => Promise.resolve(identities),
      runTokens: (members) =>
        Promise.resolve(
          new Map(
            members.map(({ pid }) => [
              pid,
              pid === 100
                ? { state: "readable" as const, runId: "run-token" }
                : {
                    state: "unavailable" as const,
                    reason: diagnostic,
                  },
            ]),
          ),
        ),
      signalGroup,
    };

    const result = await cleanupOwnedProcessGroup(
      {
        ...ownership,
        sweepTokenOwnedProcesses: true,
        captureBaseline: [],
      },
      adapter,
    );

    expect(result).toMatchObject({
      cleaned: false,
      reason: expect.stringContaining(
        "process ownership token could not be read",
      ),
    });
    expect(signalGroup).not.toHaveBeenCalled();
  });
});

describe("sampled detached process groups during cleanup", () => {
  it("signals only token-authenticated sampled groups and reports an unowned sample", async () => {
    const processes = [
      {
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        state: "S",
        command: "capture",
      },
      {
        pid: 200,
        parentPid: 1,
        processGroupId: 200,
        state: "S",
        command: "sanitized-detached-child",
      },
    ];
    const signalGroup = vi.fn();
    const identities = identitiesWithRelations(processes);
    const adapter: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processes),
      environment: (pid) =>
        Promise.resolve(pid === 100 ? { REA_PROCESS_RUN_ID: "run-token" } : {}),
      processIdentities: () => Promise.resolve(identities),
      runTokens: (members) =>
        Promise.resolve(
          new Map(
            members.map(({ pid }) => [
              pid,
              {
                state: "readable" as const,
                runId: pid === 100 ? "run-token" : undefined,
              },
            ]),
          ),
        ),
      signalGroup,
    };

    const result = await cleanupOwnedProcessGroup(
      {
        ...ownership,
        sweepTokenOwnedProcesses: true,
        sampledProcessGroupIds: [200],
      },
      adapter,
    );

    expect(result).toMatchObject({
      cleaned: false,
      reason: "process ownership token mismatch for PID(s): 200",
      failures: [{ pid: 200, reason: "run-token-mismatch" }],
    });
    expect(signalGroup).toHaveBeenCalledTimes(1);
    expect(signalGroup).toHaveBeenCalledWith(100, "SIGKILL");
    expect(signalGroup).not.toHaveBeenCalledWith(200, "SIGKILL");
  });

  it("reports a live sampled group after the launcher has exited without signaling it", async () => {
    const process = {
      pid: 200,
      parentPid: 1,
      processGroupId: 200,
      state: "S",
      command: "sanitized-detached-child",
    };
    const signalGroup = vi.fn();
    const adapter: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve([process]),
      environment: () => Promise.resolve({}),
      runTokens: () =>
        Promise.resolve(
          new Map([[200, { state: "readable" as const, runId: undefined }]]),
        ),
      signalGroup,
    };

    const result = await cleanupOwnedProcessGroup(
      {
        ...ownership,
        sweepTokenOwnedProcesses: true,
        sampledProcessGroupIds: [200],
      },
      adapter,
    );

    expect(result).toMatchObject({
      cleaned: false,
      reason: "process ownership token mismatch for PID(s): 200",
      failures: [{ pid: 200, reason: "run-token-mismatch" }],
    });
    expect(signalGroup).not.toHaveBeenCalled();
  });
});

describe("rooted process-group cleanup", () => {
  it("validates and signals rooted descendant groups once, root first", async () => {
    const processes = [
      { pid: 100, parentPid: 1, processGroupId: 100 },
      { pid: 110, parentPid: 100, processGroupId: 100 },
      { pid: 101, parentPid: 100, processGroupId: 101 },
      { pid: 102, parentPid: 101, processGroupId: 102 },
      { pid: 103, parentPid: 102, processGroupId: 102 },
    ].map((process) => ({
      ...process,
      state: "S",
      command: "fixture",
    }));
    const signalGroup = vi.fn();
    const adapter: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processes),
      environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
      signalGroup,
    };
    await expect(cleanupOwnedProcessGroup(ownership, adapter)).resolves.toEqual(
      { cleaned: true, signaled: true },
    );
    expect(signalGroup.mock.calls).toEqual([
      [100, "SIGKILL"],
      [101, "SIGKILL"],
      [102, "SIGKILL"],
    ]);
  });
  it("leaves an unrelated Hopper process group outside the rooted tree untouched", async () => {
    const processes = [
      { pid: 100, parentPid: 1, processGroupId: 100, command: "rea-hopper" },
      { pid: 101, parentPid: 100, processGroupId: 101, command: "owned-child" },
      {
        pid: 900,
        parentPid: 1,
        processGroupId: 900,
        command:
          "/Applications/Hopper Disassembler.app/Contents/MacOS/Hopper Disassembler",
      },
    ].map((process) => ({ ...process, state: "S" }));
    const environment = vi.fn((pid: number) =>
      Promise.resolve({
        REA_PROCESS_RUN_ID: pid === 900 ? "unrelated-run" : "run-token",
      }),
    );
    const signalGroup = vi.fn();
    const adapter: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processes),
      environment,
      signalGroup,
    };
    await expect(cleanupOwnedProcessGroup(ownership, adapter)).resolves.toEqual(
      { cleaned: true, signaled: true },
    );
    expect(signalGroup.mock.calls).toEqual([
      [100, "SIGKILL"],
      [101, "SIGKILL"],
    ]);
    expect(environment.mock.calls.some(([pid]) => pid === 900)).toBe(false);
  });
});
