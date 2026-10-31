import { expect, it } from "vitest";

import { collectOwnershipTraceFacts } from "../../../scripts/verify/recorded-crash/trace-ownership.mjs";
import { assertHistoricalPidAccess } from "../../../scripts/verify/recorded-crash/trace-policy.mjs";

const node = "/fixture/node";
const nodeExec = 'execve("/fixture/node", ["node", "rea.mjs"], 0x7fff) = 0';
const psExec =
  'execve("/usr/bin/ps", ["ps", "-axo", "pid=,ppid=,pgid=,uid=,stat=,command="], 0x7fff) = 0';
const parent = (...events: readonly string[]) => ({
  pid: 1200,
  text: [nodeExec, ...events].join("\n"),
});
const check = (
  traces: readonly { readonly pid: number; readonly text: string }[],
) => {
  const facts = collectOwnershipTraceFacts({
    traces,
    nodeExecutable: node,
    psExecutables: new Set(["/usr/bin/ps"]),
  });
  return traces.flatMap((trace) =>
    assertHistoricalPidAccess({
      trace,
      historicalPid: 4008,
      ownershipThreads: facts.ownershipThreads,
      liveCollision: true,
      psInventory: facts.psProcesses.has(trace.pid),
    }),
  );
};

it("correlates the ps child trace with its parent identity read", () => {
  expect(
    check([
      parent(
        "vfork() = 1201",
        "clone3({flags=CLONE_VM|CLONE_SIGHAND|CLONE_THREAD}, 88) = 1202",
        'openat(AT_FDCWD, "/proc/4008/stat", O_RDONLY|O_CLOEXEC) = 21',
      ),
      {
        pid: 1202,
        text: [
          'openat(AT_FDCWD, "/proc/4008/stat", O_RDONLY|O_CLOEXEC) = 21',
          'openat(AT_FDCWD, "/proc/4008/status", O_RDONLY|O_CLOEXEC) = 22',
        ].join("\n"),
      },
      {
        pid: 1201,
        text: [
          psExec,
          'openat(AT_FDCWD, "/proc/4008/status", O_RDONLY) = 3',
          'openat(AT_FDCWD, "/proc/4008/cmdline", O_RDONLY) = 4',
        ].join("\n"),
      },
    ]),
  ).toHaveLength(5);
});

it("joins unfinished and resumed CLONE_THREAD records", () => {
  expect(
    check([
      parent(
        "vfork() = 1201",
        "clone3({flags=CLONE_VM|CLONE_SIGHAND|CLONE_THREAD, child_tid=0x3 <unfinished ...>",
        "<... clone3 resumed>) = 1202",
      ),
      { pid: 1202, text: 'openat(AT_FDCWD, "/proc/4008/stat", O_RDONLY) = 3' },
      { pid: 1201, text: psExec },
    ]),
  ).toHaveLength(1);
});

it("rejects provider-style reads outside the ps child and identity-only caller", () => {
  expect(() =>
    check([
      parent(
        "vfork() = 1201",
        'openat(AT_FDCWD, "/proc/4008/cmdline", O_RDONLY) = 21',
      ),
      { pid: 1201, text: psExec },
    ]),
  ).toThrow("non-inventory lookup");
});

it("does not trust a ps command with different arguments or failed exec", () => {
  for (const text of [
    'execve("/usr/bin/ps", ["ps", "-ef"], 0x7fff) = 0',
    psExec.replace(" = 0", " = -1 EACCES"),
  ])
    expect(() =>
      check([
        parent(
          "vfork() = 1201",
          'openat(AT_FDCWD, "/proc/4008/stat", O_RDONLY) = 3',
        ),
        { pid: 1201, text },
      ]),
    ).toThrow("non-inventory lookup");
});

it("allows only known procfs fields inside the exact ps child", () => {
  expect(() =>
    check([
      parent("vfork() = 1201"),
      {
        pid: 1201,
        text: `${psExec}\nopenat(AT_FDCWD, "/proc/4008/exe", O_RDONLY) = 3`,
      },
    ]),
  ).toThrow("non-inventory lookup");
});

it("does not grant the ownership process thread permit to a forked child", () => {
  for (const field of ["stat", "status"])
    expect(() =>
      check([
        parent("vfork() = 1201", "clone3({flags=SIGCHLD}, 88) = 1203"),
        { pid: 1201, text: psExec },
        {
          pid: 1203,
          text: `openat(AT_FDCWD, "/proc/4008/${field}", O_RDONLY) = 3`,
        },
      ]),
    ).toThrow("non-inventory lookup");
});

it("requires an observed Node execution as well as the inventory ps child", () => {
  expect(() =>
    check([
      {
        pid: 1200,
        text: 'vfork() = 1201\nopenat(AT_FDCWD, "/proc/4008/stat", O_RDONLY) = 3',
      },
      { pid: 1201, text: psExec },
    ]),
  ).toThrow("non-inventory lookup");
});

it("refuses identity reads in an exec-replaced ownership thread", () => {
  expect(() =>
    check([
      parent(
        "vfork() = 1201",
        "clone3({flags=CLONE_VM|CLONE_THREAD}, 88) = 1202",
      ),
      { pid: 1201, text: psExec },
      {
        pid: 1202,
        text: 'execve("/fixture/gdb", ["gdb"], 0x7fff) = 0\nopenat(AT_FDCWD, "/proc/4008/stat", O_RDONLY) = 3',
      },
    ]),
  ).toThrow("non-inventory lookup");
});

it("does not join unrelated groups through child-side clone returns", () => {
  expect(() =>
    check([
      parent("vfork() = 1201", "clone3({flags=CLONE_VM|CLONE_THREAD}, 88) = 0"),
      { pid: 1201, text: psExec },
      {
        pid: 1300,
        text: [
          nodeExec,
          "clone3({flags=CLONE_VM|CLONE_THREAD}, 88) = 0",
          'openat(AT_FDCWD, "/proc/4008/stat", O_RDONLY) = 3',
        ].join("\n"),
      },
    ]),
  ).toThrow("non-inventory lookup");
});
