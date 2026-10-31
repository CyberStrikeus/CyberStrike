import { performance } from "node:perf_hooks";

import { expect, it, vi } from "vitest";

const filesystem = vi.hoisted(() => ({
  readFile: vi.fn(),
  // Host procfs ownership must never leak into fixture PIDs.
  stat: vi.fn(async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: filesystem.readFile, stat: filesystem.stat };
});

import {
  createSystemProcessOwnershipHost,
  readProcessOwnershipFacts,
} from "./ProcessOwnershipObservation.js";
import type {
  ProcessOwnershipHost,
  ProcessTableEntry,
} from "./ProcessOwnership.js";

const entry: ProcessTableEntry = {
  pid: 42,
  parentPid: 1,
  processGroupId: 42,
  state: "S",
  command: "fixture",
};

const filesystemError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code });

const procStat = (
  startTime: number,
  parentPid = 1,
  processGroupId = 42,
  pid = 42,
  flags = 0,
) => {
  const fields = [
    "S",
    String(parentPid),
    String(processGroupId),
    "42",
    "0",
    "0",
    String(flags),
  ];
  while (fields.length < 19) fields.push("0");
  fields.push(String(startTime));
  return `${String(pid)} (fixture) ${fields.join(" ")}`;
};

/**
 * Select REA's caller credentials for the simulated Linux host. Windows has no
 * `process.geteuid`/`getegid`, so define them for the call and restore the
 * original properties (or their absence) afterwards.
 */
const withCaller = async <T>(
  uid: number,
  gid: number,
  run: () => Promise<T>,
): Promise<T> => {
  const names = ["geteuid", "getegid"] as const;
  const originals = names.map((name) =>
    Object.getOwnPropertyDescriptor(process, name),
  );
  names.forEach((name, index) =>
    Object.defineProperty(process, name, {
      configurable: true,
      writable: true,
      value: () => (index === 0 ? uid : gid),
    }),
  );
  try {
    return await run();
  } finally {
    names.forEach((name, index) => {
      const original = originals[index];
      if (original === undefined) Reflect.deleteProperty(process, name);
      else Object.defineProperty(process, name, original);
    });
  }
};

it("binds Linux credentials to the same native process generation", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  filesystem.readFile
    .mockResolvedValueOnce(procStat(100, 10, 42))
    .mockResolvedValueOnce("Name:\tfixture\nUid:\t1000\t1001\t1002\t1003\n")
    .mockResolvedValueOnce(procStat(100, 11, 43));
  filesystem.stat.mockResolvedValueOnce({ uid: 1001 } as never);

  await expect(
    withCaller(1001, 20, async () =>
      host.processIdentities?.([entry], undefined, new Set([entry.pid])),
    ),
  ).resolves.toEqual(
    new Map([
      [
        42,
        {
          state: "readable",
          identity: "linux-starttime:100",
          effectiveUid: 1001,
          // Kernel ptrace checks also compare the real and saved UIDs.
          environmentRestriction: "credentials",
          lifecycle: { state: "observed", lifecycle: "non-zombie" },
          relation: {
            state: "observed",
            parentPid: 11,
            processGroupId: 43,
          },
        },
      ],
    ]),
  );
  expect(filesystem.readFile.mock.calls.map(([path]) => path)).toEqual([
    "/proc/42/stat",
    "/proc/42/status",
    "/proc/42/stat",
  ]);
  expect(filesystem.stat).toHaveBeenLastCalledWith("/proc/42/environ");
});

it.each([
  [
    "a non-dumpable process",
    0,
    "Gid:\t1000\t1000\t1000\t1000\n",
    "non-dumpable",
  ],
  ["a setgid process", 1000, "Gid:\t1000\t5\t5\t5\n", "credentials"],
  ["an inspectable process", 1000, "Gid:\t1000\t1000\t1000\t1000\n", undefined],
] as const)(
  "reports the Linux environment restriction for %s",
  async (_name, procfsOwnerUid, gidRow, expected) => {
    const host = createSystemProcessOwnershipHost("linux", {});
    filesystem.readFile
      .mockResolvedValueOnce(procStat(100))
      .mockResolvedValueOnce(`Uid:\t1000\t1000\t1000\t1000\n${gidRow}`)
      .mockResolvedValueOnce(procStat(100));
    filesystem.stat.mockResolvedValueOnce({ uid: procfsOwnerUid } as never);

    const identity = (
      await withCaller(1000, 1000, async () =>
        host.processIdentities?.([entry], undefined, new Set([entry.pid])),
      )
    )?.get(entry.pid);

    expect(identity).toMatchObject({ state: "readable", effectiveUid: 1000 });
    if (expected === undefined)
      expect(identity).not.toHaveProperty("environmentRestriction");
    else expect(identity).toHaveProperty("environmentRestriction", expected);
  },
);

it("keeps native identity when status UID is unavailable", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  filesystem.readFile
    .mockResolvedValueOnce(procStat(100))
    .mockRejectedValueOnce(filesystemError("EACCES"));

  await expect(
    host.processIdentities?.([entry], undefined, new Set([entry.pid])),
  ).resolves.toEqual(
    new Map([
      [
        42,
        {
          state: "readable",
          identity: "linux-starttime:100",
          lifecycle: { state: "observed", lifecycle: "non-zombie" },
          relation: {
            state: "observed",
            parentPid: 1,
            processGroupId: 42,
          },
        },
      ],
    ]),
  );
  expect(filesystem.readFile).toHaveBeenCalledTimes(2);
});

it("does not attach a UID when the process generation changes around status", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  filesystem.readFile
    .mockResolvedValueOnce(procStat(100))
    .mockResolvedValueOnce("Uid:\t1000\t1001\t1002\t1003\n")
    .mockResolvedValueOnce(procStat(101));

  await expect(
    host.processIdentities?.([entry], undefined, new Set([entry.pid])),
  ).resolves.toEqual(
    new Map([
      [
        42,
        {
          state: "unavailable",
          reason: "process_identity_changed_during_uid_observation",
        },
      ],
    ]),
  );
});

it("reads Linux effective UID only for token-unavailable rows", async () => {
  const rows = [entry, { ...entry, pid: 43, processGroupId: 43 }];
  const statReads = new Map<number, number>();
  const uidStatusPids: number[] = [];
  filesystem.readFile.mockImplementation(async (path) => {
    const match = /^\/proc\/(\d+)\/(stat|status)$/u.exec(String(path));
    if (match === null) throw new Error(`unexpected path: ${String(path)}`);
    const pid = Number(match[1]);
    if (match[2] === "status") {
      uidStatusPids.push(pid);
      return "Uid:\t1000\t1001\t1002\t1003\n";
    }
    const reads = (statReads.get(pid) ?? 0) + 1;
    statReads.set(pid, reads);
    return procStat(100, 1, pid, pid);
  });
  const systemHost = createSystemProcessOwnershipHost("linux", {});
  const host: ProcessOwnershipHost = {
    ...systemHost,
    runTokens: async () =>
      new Map([
        [entry.pid, { state: "unavailable", reason: "EACCES" }],
        [43, { state: "readable", runId: undefined }],
      ]),
  };

  const facts = await readProcessOwnershipFacts(rows, host);

  expect(uidStatusPids).toEqual([entry.pid]);
  expect(facts.map(({ identityAfter }) => identityAfter)).toMatchObject([
    { state: "readable", effectiveUid: 1001 },
    { state: "readable" },
  ]);
  expect(facts[1]?.identityAfter).not.toHaveProperty("effectiveUid");
  expect(statReads).toEqual(
    new Map([
      [entry.pid, 3],
      [43, 2],
    ]),
  );
});

it("keeps the Linux environment restriction while an exiting candidate settles", async () => {
  let identityReads = 0;
  filesystem.readFile.mockImplementation(async (path) => {
    if (String(path) === "/proc/42/status")
      return "Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n";
    if (String(path) !== "/proc/42/stat")
      throw new Error(`unexpected path: ${String(path)}`);
    identityReads += 1;
    // PF_EXITING is set after the first identity read.
    return procStat(100, 1, 42, 42, identityReads === 1 ? 0 : 4);
  });
  filesystem.stat.mockResolvedValue({ uid: 0 } as never);
  const systemHost = createSystemProcessOwnershipHost("linux", {});
  const host: ProcessOwnershipHost = {
    ...systemHost,
    runTokens: async () =>
      new Map([[entry.pid, { state: "unavailable", reason: "EACCES" }]]),
  };

  try {
    const [fact] = await withCaller(1000, 1000, async () =>
      readProcessOwnershipFacts([entry], host, undefined, {
        exitSettlement: { deadline: performance.now() + 30 },
      }),
    );

    expect(fact?.beforeExitSettlement).toBeDefined();
    expect(fact?.identityAfter).toMatchObject({
      state: "readable",
      lifecycle: { state: "observed", lifecycle: "exiting" },
      environmentRestriction: "non-dumpable",
    });
    expect(identityReads).toBeGreaterThan(3);
  } finally {
    filesystem.stat.mockReset();
    filesystem.stat.mockRejectedValue(filesystemError("ENOENT"));
  }
});

it("reports absence only when /proc lookup and signal-zero both report ESRCH", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  const signalProbe = vi.spyOn(process, "kill").mockImplementation(() => {
    throw filesystemError("ESRCH");
  });
  try {
    for (const code of ["ENOENT", "ESRCH"]) {
      filesystem.readFile.mockRejectedValueOnce(filesystemError(code));
      await expect(host.processIdentities?.([entry])).resolves.toEqual(
        new Map([
          [
            42,
            {
              state: "absent",
              reason: "not-found-in-caller-pid-namespace",
            },
          ],
        ]),
      );
    }
    expect(signalProbe).toHaveBeenCalledTimes(2);
    expect(signalProbe).toHaveBeenNthCalledWith(1, 42, 0);
  } finally {
    signalProbe.mockRestore();
  }
});

it("keeps hidden or permission-denied live PIDs unavailable", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  const signalProbe = vi.spyOn(process, "kill");
  try {
    filesystem.readFile.mockRejectedValueOnce(filesystemError("ENOENT"));
    signalProbe.mockReturnValueOnce(true);
    await expect(host.processIdentities?.([entry])).resolves.toEqual(
      new Map([
        [
          42,
          {
            state: "unavailable",
            reason: "proc_stat_missing_but_process_signal_probe_succeeded",
          },
        ],
      ]),
    );

    filesystem.readFile.mockRejectedValueOnce(filesystemError("ENOENT"));
    signalProbe.mockImplementationOnce(() => {
      throw filesystemError("EPERM");
    });
    const denied = await host.processIdentities?.([entry]);
    const deniedIdentity = denied?.get(42);
    expect(deniedIdentity).toMatchObject({ state: "unavailable" });
    expect(
      deniedIdentity?.state === "unavailable" ? deniedIdentity.reason : "",
    ).toContain("EPERM");
  } finally {
    signalProbe.mockRestore();
  }
});

it("preserves native identity with unavailable teardown relations", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  filesystem.readFile.mockResolvedValueOnce(procStat(987654, 0, -1, 42, 4));
  const identities = await host.processIdentities?.([entry]);
  expect(identities?.get(42)).toMatchObject({
    state: "readable",
    identity: "linux-starttime:987654",
    lifecycle: { state: "observed", lifecycle: "exiting" },
    relation: {
      state: "unavailable",
      reason: "proc_stat_relation_unavailable",
    },
  });
});

it("keeps permission, parser, and unexpected failures unavailable", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  const signalProbe = vi.spyOn(process, "kill");
  try {
    for (const code of ["EACCES", "EPERM", "EIO"]) {
      filesystem.readFile.mockRejectedValueOnce(filesystemError(code));
      const result = await host.processIdentities?.([entry]);
      expect(result?.get(42)?.state).toBe("unavailable");
    }

    filesystem.readFile.mockResolvedValueOnce("42 (fixture) S malformed");
    await expect(host.processIdentities?.([entry])).resolves.toEqual(
      new Map([[42, { state: "unavailable", reason: "malformed_proc_stat" }]]),
    );
    expect(signalProbe).not.toHaveBeenCalled();
  } finally {
    signalProbe.mockRestore();
  }
});

it("rejects invalid PIDs before procfs lookup or signal probing", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  const signalProbe = vi.spyOn(process, "kill");
  filesystem.readFile.mockClear();
  try {
    await expect(
      host.processIdentities?.([{ ...entry, pid: 0 }]),
    ).resolves.toEqual(
      new Map([[0, { state: "unavailable", reason: "invalid_process_id" }]]),
    );
    expect(filesystem.readFile).not.toHaveBeenCalled();
    expect(signalProbe).not.toHaveBeenCalled();
  } finally {
    signalProbe.mockRestore();
  }
});

it("preserves cancellation before and after the signal-zero probe", async () => {
  const host = createSystemProcessOwnershipHost("linux", {});
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  filesystem.readFile.mockRejectedValueOnce(
    Object.assign(new Error("aborted"), { name: "AbortError" }),
  );
  await expect(
    host.processIdentities?.([entry], controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });

  const afterProbe = new AbortController();
  const probeAbort = vi.spyOn(process, "kill").mockImplementation(() => {
    afterProbe.abort(reason);
    throw filesystemError("ESRCH");
  });
  try {
    filesystem.readFile.mockRejectedValueOnce(filesystemError("ENOENT"));
    await expect(
      host.processIdentities?.([entry], afterProbe.signal),
    ).rejects.toBe(reason);
  } finally {
    probeAbort.mockRestore();
  }
});
