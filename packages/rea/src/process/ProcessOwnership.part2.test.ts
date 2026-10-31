import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  verifyNoTokenOwnedProcesses,
  type ProcessOwnershipHost,
} from "./ProcessOwnership.js";
import { observeOwnedProcessLineage } from "./ProcessOwnershipObservation.js";
import {
  createOwnership,
  host,
  verifiedLineage,
} from "./ProcessOwnership.fixture.js";

let ownership = createOwnership();
beforeEach(() => {
  ownership = createOwnership();
});
describe("owned process-group cleanup discovery", () => {
  it("signals token-owned groups that were reparented outside the launcher tree", async () => {
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
        command: "detached-helper",
      },
      {
        pid: 901,
        parentPid: 900,
        processGroupId: 900,
        state: "S",
        command: "detached-worker",
      },
    ];
    const signalGroup = vi.fn((processGroupId: number) => {
      for (let index = processes.length - 1; index >= 0; index -= 1)
        if (processes[index]?.processGroupId === processGroupId)
          processes.splice(index, 1);
    });
    const adapter: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processes),
      environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
      signalGroup,
    };

    await expect(
      cleanupOwnedProcessGroup(
        { ...ownership, sweepTokenOwnedProcesses: true },
        adapter,
      ),
    ).resolves.toEqual({ cleaned: true, signaled: true });
    expect(signalGroup.mock.calls.map(([groupId]) => groupId)).toEqual([
      100, 900,
    ]);
  });

  it("fails closed when a token-owned process remains after cleanup", async () => {
    const adapter: ProcessOwnershipHost = {
      listProcesses: () =>
        Promise.resolve([
          {
            pid: 900,
            parentPid: 1,
            processGroupId: 900,
            state: "S",
            command: "detached-helper",
          },
        ]),
      environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
      signalGroup: vi.fn(),
    };

    await expect(
      verifyNoTokenOwnedProcesses("run-token", adapter),
    ).resolves.toEqual({
      cleaned: false,
      reason: "token-owned process remained after cleanup",
    });
  });
});

describe("owned process-group cleanup discovery", () => {
  it("fails before signaling when any descendant-group member is unowned", async () => {
    const signalGroup = vi.fn();
    const adapter: ProcessOwnershipHost = {
      listProcesses: () =>
        Promise.resolve([
          {
            pid: 100,
            parentPid: 1,
            processGroupId: 100,
            state: "S",
            command: "fixture",
          },
          {
            pid: 101,
            parentPid: 100,
            processGroupId: 101,
            state: "S",
            command: "child-session",
          },
          {
            pid: 104,
            parentPid: 101,
            processGroupId: 101,
            state: "S",
            command: "child-helper",
          },
        ]),
      environment: (pid) =>
        Promise.resolve({
          REA_PROCESS_RUN_ID: pid === 104 ? "other-run" : "run-token",
        }),
      signalGroup,
    };
    await expect(cleanupOwnedProcessGroup(ownership, adapter)).resolves.toEqual(
      {
        cleaned: false,
        reason: "process ownership token mismatch for PID(s): 104",
        failures: [{ pid: 104, reason: "run-token-mismatch" }],
      },
    );
    expect(signalGroup).not.toHaveBeenCalled();
  });
  it("fails before signaling when a descendant group leader is not rooted", async () => {
    const signalGroup = vi.fn();
    const adapter: ProcessOwnershipHost = {
      listProcesses: () =>
        Promise.resolve([
          {
            pid: 100,
            parentPid: 1,
            processGroupId: 100,
            state: "S",
            command: "fixture",
          },
          {
            pid: 105,
            parentPid: 100,
            processGroupId: 101,
            state: "S",
            command: "descendant",
          },
          {
            pid: 101,
            parentPid: 999,
            processGroupId: 101,
            state: "S",
            command: "unrelated-group-leader",
          },
        ]),
      environment: () => Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
      signalGroup,
    };
    await expect(cleanupOwnedProcessGroup(ownership, adapter)).resolves.toEqual(
      {
        cleaned: false,
        reason:
          "descendant process-group leader identity could not be verified",
      },
    );
    expect(signalGroup).not.toHaveBeenCalled();
  });
  it("records sorted launcher and descendant lineage after token checks", async () => {
    const { adapter } = host({
      102: { REA_PROCESS_RUN_ID: "run-token" },
      100: { REA_PROCESS_RUN_ID: "run-token" },
      101: { REA_PROCESS_RUN_ID: "run-token" },
    });
    await expect(
      observeOwnedProcessLineage(ownership, adapter),
    ).resolves.toEqual(
      verifiedLineage([
        { pid: 101, parentPid: 100, processGroupId: 100 },
        { pid: 102, parentPid: 100, processGroupId: 100 },
      ]),
    );
  });
});

describe("process environment permission diagnostics", () => {
  it.each(["EACCES", "EPERM"])(
    "preserves %s while refusing to signal an unverifiable live process",
    async (code) => {
      const signalGroup = vi.fn();
      const diagnostic = `${code}: permission denied, open '/proc/900/environ'`;
      const adapter: ProcessOwnershipHost = {
        listProcesses: () =>
          Promise.resolve([
            {
              pid: 900,
              parentPid: 1,
              processGroupId: 900,
              state: "S",
              command: "unverifiable-process",
            },
          ]),
        environment: () => Promise.reject(new Error(diagnostic)),
        signalGroup,
      };
      await expect(
        cleanupOwnedProcessGroup(
          { ...ownership, sweepTokenOwnedProcesses: true },
          adapter,
        ),
      ).resolves.toMatchObject({
        cleaned: false,
        reason: `process ownership token could not be read for 1 live process(es): environment_errno_${code}=1; live candidates 900=environment_errno_${code}`,
        failures: [{ pid: 900, reason: "environment-unreadable", diagnostic }],
      });
      expect(signalGroup).not.toHaveBeenCalled();
    },
  );

  it.skipIf(typeof process.getuid !== "function")(
    "records a foreign-uid unreadable candidate as unverified without signaling",
    async () => {
      const foreignUid = process.getuid?.() === 0 ? 1 : 0;
      const signalGroup = vi.fn();
      const adapter: ProcessOwnershipHost = {
        listProcesses: () =>
          Promise.resolve([
            {
              pid: 900,
              parentPid: 1,
              processGroupId: 900,
              uid: foreignUid,
              state: "S",
              command: "unverifiable-process",
            },
          ]),
        environment: () => Promise.reject(new Error("EINVAL: sysctl failed")),
        signalGroup,
      };
      await expect(
        cleanupOwnedProcessGroup(
          { ...ownership, sweepTokenOwnedProcesses: true },
          adapter,
        ),
      ).resolves.toMatchObject({
        cleaned: true,
        signaled: false,
        unverified: [{ pid: 900, diagnostic: "EINVAL: sysctl failed" }],
      });
      expect(signalGroup).not.toHaveBeenCalled();
    },
  );
});
