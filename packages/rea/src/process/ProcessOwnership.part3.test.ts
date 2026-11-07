import { describe, expect, it, vi } from "vitest";
import type {
  ProcessOwnershipHost,
  ProcessTableEntry,
} from "./ProcessOwnership.js";
import { observeOwnedProcessLineage } from "./ProcessOwnershipObservation.js";
import { verifiedLineage } from "./ProcessOwnership.fixture.js";
const ownership = {
  runId: "run-token",
  leaderPid: 100,
  processGroupId: 100,
};
const row = (
  pid: number,
  parentPid: number,
  processGroupId = pid,
  command = `pid-${String(pid)}`,
): ProcessTableEntry => ({
  pid,
  parentPid,
  processGroupId,
  state: "S",
  command,
});
const environmentForExited = (...pids: number[]) =>
  vi.fn((pid: number) =>
    pids.includes(pid)
      ? Promise.reject(new Error("process exited during environment read"))
      : Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
  );
const environmentForReplacementReads = (
  runIdAtRead: (read: number) => string | undefined,
) => {
  let reads = 0;
  const environment = vi.fn((pid: number) => {
    if (pid === 101 || pid === 103)
      return Promise.reject(
        new Error("process exited during environment read"),
      );
    if (pid !== 102)
      return Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" });
    reads += 1;
    const runId = runIdAtRead(reads);
    return Promise.resolve(runId ? { REA_PROCESS_RUN_ID: runId } : {});
  });
  return { environment, reads: () => reads };
};
const observeLineage = (
  listProcesses: ProcessOwnershipHost["listProcesses"],
  environment: ProcessOwnershipHost["environment"],
  processOwnership = ownership,
) =>
  observeOwnedProcessLineage(processOwnership, {
    listProcesses,
    environment,
    signalGroup: vi.fn(),
  });
describe("owned process-group cleanup discovery", () => {
  it("walks the PPID tree across process-group boundaries", async () => {
    const environment = vi.fn((pid: number) =>
      Promise.resolve({
        REA_PROCESS_RUN_ID: pid === 103 ? "unrelated-run" : "run-token",
      }),
    );
    const adapter: ProcessOwnershipHost = {
      listProcesses: () =>
        Promise.resolve([
          {
            pid: 103,
            parentPid: 999,
            processGroupId: 100,
            state: "S",
            command: "unrelated-same-group",
          },
          {
            pid: 102,
            parentPid: 101,
            processGroupId: 102,
            state: "S",
            command: "grandchild-session",
          },
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
            command: "child-group",
          },
        ]),
      environment,
      signalGroup: vi.fn(),
    };
    await expect(
      observeOwnedProcessLineage(ownership, adapter),
    ).resolves.toEqual(
      verifiedLineage([
        { pid: 101, parentPid: 100, processGroupId: 101 },
        { pid: 102, parentPid: 101, processGroupId: 102 },
      ]),
    );
  });
  it("omits a descendant that exits while lineage is validated", async () => {
    const launcher = {
      pid: 100,
      parentPid: 1,
      processGroupId: 100,
      state: "S",
      command: "root",
    };
    const child = {
      pid: 101,
      parentPid: 100,
      processGroupId: 101,
      state: "S",
      command: "child",
    };
    const processes = [launcher, child];
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce(processes)
      .mockResolvedValueOnce([launcher]);
    const host: ProcessOwnershipHost = {
      listProcesses,
      environment: environmentForExited(101),
      signalGroup: vi.fn(),
    };

    await expect(observeOwnedProcessLineage(ownership, host)).resolves.toEqual({
      status: "verified",
      observedAt: expect.any(String),
      lineage: {
        runId: "run-token",
        launcherPid: 100,
        launcherParentPid: 1,
        processGroupId: 100,
        descendants: [],
      },
    });
  });
});

describe("identityless lineage refresh keeps replacement rows", () => {
  it("does not publish an empty lineage when exit refresh reveals a token-owned replacement", async () => {
    const launcher = row(100, 1, 100, "root");
    const child = row(101, 100, 100, "child");
    const replacement = row(102, 1, 102, "reparented-grandchild");
    const environment = environmentForExited(101);
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([launcher, child])
      .mockResolvedValue([launcher, replacement]);
    await expect(
      observeLineage(listProcesses, environment),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason:
        "process lineage refresh contained owned PID(s) outside the observed descendants: 102",
    });
    expect(environment).toHaveBeenCalledWith(102);
  });

  it("publishes a descendant that appears in the exit refresh and still belongs to the launcher", async () => {
    const launcher = row(100, 1, 100, "root");
    const child = row(101, 100, 100, "child");
    const grandchild = row(102, 100, 102, "grandchild");
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([launcher, child])
      .mockResolvedValue([launcher, grandchild]);
    await expect(
      observeLineage(listProcesses, environmentForExited(101)),
    ).resolves.toMatchObject({
      status: "verified",
      lineage: {
        descendants: [{ pid: 102, parentPid: 100, processGroupId: 102 }],
      },
    });
  });
});

describe("identityless lineage refresh ignores the prior process table", () => {
  it("does not token-read a pre-existing row when a descendant exits", async () => {
    const environment = vi.fn((pid: number) =>
      pid === 101
        ? Promise.reject(new Error("process exited during environment read"))
        : pid === 50
          ? Promise.reject(new Error("unreadable pre-existing process"))
          : Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    );
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), row(101, 100, 100), row(50, 1)])
      .mockResolvedValue([row(100, 1, 100), row(50, 1)]);
    await expect(
      observeLineage(listProcesses, environment),
    ).resolves.toMatchObject({
      status: "verified",
      lineage: { descendants: [] },
    });
    expect(environment.mock.calls.map(([pid]) => pid)).not.toContain(50);
  });

  it("re-reads a refresh row after it moves under the launcher", async () => {
    const { environment, reads } = environmentForReplacementReads((read) =>
      read === 1 ? undefined : "run-token",
    );
    const outside = row(102, 1, 102);
    const joined = row(102, 100, 102);
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), row(101, 100), row(103, 100)])
      .mockResolvedValueOnce([row(100, 1, 100), row(103, 100), outside])
      .mockResolvedValue([row(100, 1, 100), joined]);
    await expect(
      observeLineage(listProcesses, environment),
    ).resolves.toMatchObject({
      status: "verified",
      lineage: {
        descendants: [{ pid: 102, parentPid: 100, processGroupId: 102 }],
      },
    });
    expect(reads()).toBe(2);
  });
});

describe("identityless lineage refresh follows tree membership", () => {
  it("token-checks an initial outsider after it joins the launcher", async () => {
    const environment = environmentForExited(101);
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), row(101, 100), row(102, 1)])
      .mockResolvedValue([row(100, 1, 100), row(102, 100)]);
    await expect(
      observeLineage(listProcesses, environment),
    ).resolves.toMatchObject({
      status: "verified",
      lineage: {
        descendants: [{ pid: 102, parentPid: 100, processGroupId: 102 }],
      },
    });
    expect(environment).toHaveBeenCalledWith(102);
  });

  it("keeps a tokenless cached row unverified after its ancestor joins the launcher", async () => {
    let outsiderReads = 0;
    const environment = vi.fn((pid: number) => {
      if (pid === 101 || pid === 103)
        return Promise.reject(
          new Error("process exited during environment read"),
        );
      if (pid !== 102)
        return Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" });
      outsiderReads += 1;
      return Promise.resolve({});
    });
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([
        row(100, 1, 100),
        row(101, 100),
        row(103, 100),
        row(50, 1),
      ])
      .mockResolvedValueOnce([
        row(100, 1, 100),
        row(103, 100),
        row(50, 1),
        row(102, 50),
      ])
      .mockResolvedValue([row(100, 1, 100), row(50, 100), row(102, 50)]);
    await expect(
      observeOwnedProcessLineage(ownership, {
        listProcesses,
        environment,
        signalGroup: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason:
        "REA_PROCESS_RUN_ID was absent from the readable environment for PID 102; process lineage ownership remains unverified",
    });
    expect(outsiderReads).toBe(2);
    expect(environment.mock.calls.filter(([pid]) => pid === 50)).toHaveLength(
      1,
    );
  });

  it("re-reads a cached descendant and keeps its missing token unverified", async () => {
    const { environment, reads } = environmentForReplacementReads((read) =>
      read === 1 ? "run-token" : undefined,
    );
    const descendant = row(102, 100, 102);
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), row(101, 100), row(103, 100)])
      .mockResolvedValueOnce([row(100, 1, 100), row(103, 100), descendant])
      .mockResolvedValue([row(100, 1, 100), descendant]);
    await expect(
      observeOwnedProcessLineage(ownership, {
        listProcesses,
        environment,
        signalGroup: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason:
        "REA_PROCESS_RUN_ID was absent from the readable environment for PID 102; process lineage ownership remains unverified",
    });
    expect(reads()).toBe(2);
  });
});

describe("identityless lineage refresh drops exited descendants", () => {
  it("omits a validated descendant that is gone from the latest refresh", async () => {
    const environment = vi.fn((pid: number) =>
      pid === 101 || pid === 103
        ? Promise.reject(new Error("process exited during environment read"))
        : Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    );
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([
        row(100, 1, 100),
        row(102, 100),
        row(101, 100),
        row(103, 100),
      ])
      .mockResolvedValueOnce([row(100, 1, 100), row(102, 100), row(103, 100)])
      .mockResolvedValue([row(100, 1, 100)]);
    const result = await observeLineage(listProcesses, environment);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.lineage.descendants).toEqual([]);
  });
});

describe("identityless lineage refresh rechecks the launcher relation", () => {
  it.each([
    [
      "process group",
      row(100, 1, 999, "root"),
      { ...ownership, expectedCommand: "root" },
      "owned launcher process-group identity did not match",
    ],
    [
      "command",
      row(100, 1, 100, "replacement"),
      { ...ownership, expectedCommand: "root" },
      "owned launcher command identity did not match (observed=replacement; expected=root)",
    ],
    [
      "parent",
      row(100, 7, 100, "root"),
      { ...ownership, expectedParentPid: 1, expectedCommand: "root" },
      "owned launcher parent identity did not match",
    ],
  ] as const)(
    "rejects a same-token launcher whose %s changed",
    async (_identity, currentLauncher, processOwnership, reason) => {
      const listProcesses = vi
        .fn<ProcessOwnershipHost["listProcesses"]>()
        .mockResolvedValueOnce([
          row(100, 1, 100, "root"),
          row(102, 100),
          row(101, 100),
        ])
        .mockResolvedValue([currentLauncher, row(102, 100)]);
      await expect(
        observeLineage(
          listProcesses,
          environmentForExited(101),
          processOwnership,
        ),
      ).resolves.toMatchObject({ status: "unavailable", reason });
    },
  );
});

describe("identityless lineage refresh rechecks the launcher", () => {
  it("does not publish lineage when the launcher PID is gone on a later refresh", async () => {
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), row(102, 100), row(101, 100)])
      .mockResolvedValue([row(102, 100)]);
    await expect(
      observeOwnedProcessLineage(ownership, {
        listProcesses,
        environment: environmentForExited(101),
        signalGroup: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "owned launcher exited during lineage validation",
    });
  });

  it("keeps a refreshed launcher with a missing ownership token unverified", async () => {
    let launcherReads = 0;
    const environment = vi.fn((pid: number) => {
      if (pid === 101)
        return Promise.reject(
          new Error("process exited during environment read"),
        );
      if (pid !== 100)
        return Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" });
      launcherReads += 1;
      return Promise.resolve(
        launcherReads === 1 ? { REA_PROCESS_RUN_ID: "run-token" } : {},
      );
    });
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), row(102, 100), row(101, 100)])
      .mockResolvedValue([row(100, 1, 100), row(102, 100)]);
    await expect(
      observeOwnedProcessLineage(ownership, {
        listProcesses,
        environment,
        signalGroup: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason:
        "REA_PROCESS_RUN_ID was absent from the readable environment for PID 100; process lineage ownership remains unverified",
    });
    expect(launcherReads).toBe(2);
  });
});

describe("identityless lineage refresh rechecks an initial descendant", () => {
  it("keeps a descendant with a missing token unverified after an earlier match", async () => {
    let reads = 0;
    const environment = vi.fn((pid: number) => {
      if (pid === 101)
        return Promise.reject(
          new Error("process exited during environment read"),
        );
      if (pid !== 102)
        return Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" });
      reads += 1;
      return Promise.resolve(
        reads === 1 ? { REA_PROCESS_RUN_ID: "run-token" } : {},
      );
    });
    const descendant = row(102, 100, 102);
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([row(100, 1, 100), descendant, row(101, 100)])
      .mockResolvedValue([row(100, 1, 100), descendant]);
    await expect(
      observeOwnedProcessLineage(ownership, {
        listProcesses,
        environment,
        signalGroup: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason:
        "REA_PROCESS_RUN_ID was absent from the readable environment for PID 102; process lineage ownership remains unverified",
    });
    expect(reads).toBe(2);
  });
});

describe("identityless lineage refresh publishes one row per PID", () => {
  it("keeps a single row when a descendant returns to its original group", async () => {
    const environment = vi.fn((pid: number) =>
      pid === 101 || pid === 104
        ? Promise.reject(new Error("process exited during environment read"))
        : Promise.resolve({ REA_PROCESS_RUN_ID: "run-token" }),
    );
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([
        row(100, 1, 100),
        row(101, 100),
        row(102, 100, 100),
        row(104, 100),
      ])
      .mockResolvedValueOnce([
        row(100, 1, 100),
        row(102, 100, 102),
        row(104, 100),
      ])
      .mockResolvedValue([row(100, 1, 100), row(102, 100, 100)]);
    const result = await observeOwnedProcessLineage(ownership, {
      listProcesses,
      environment,
      signalGroup: vi.fn(),
    });
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.lineage.descendants).toEqual([
      { pid: 102, parentPid: 100, processGroupId: 100 },
    ]);
  });
});

describe("owned process-group cleanup discovery", () => {
  it("does not publish lineage when the launcher exits during validation", async () => {
    const launcher = {
      pid: 100,
      parentPid: 1,
      processGroupId: 100,
      state: "S",
      command: "root",
    };
    const listProcesses = vi
      .fn<ProcessOwnershipHost["listProcesses"]>()
      .mockResolvedValueOnce([launcher])
      .mockResolvedValueOnce([]);
    const host: ProcessOwnershipHost = {
      listProcesses,
      environment: () => Promise.reject(new Error("launcher exited")),
      signalGroup: vi.fn(),
    };

    await expect(
      observeOwnedProcessLineage(ownership, host),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "owned launcher exited during lineage validation",
    });
  });
});
