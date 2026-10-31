import { expect, it } from "vitest";
import { assertHistoricalPidAccess } from "../../../scripts/verify/recorded-crash/trace-policy.mjs";

const stat = 'openat(AT_FDCWD, "/proc/900/stat", O_RDONLY|O_CLOEXEC) = 22';

const check = (pid: number, text: string, liveCollision = true) =>
  assertHistoricalPidAccess({
    trace: { pid, text },
    historicalPid: 900,
    ownershipThreads: new Set([100, 101]),
    liveCollision,
    psInventory: false,
  });

it("allows stat reads only in the supplied ownership thread set", () => {
  expect(check(100, stat)).toEqual([stat]);
  expect(check(101, stat)).toEqual([stat]);
  expect(() => check(102, stat)).toThrow("non-inventory lookup");
});

it("permits the native descriptor metadata query used by Node's readFile", () => {
  const metadata =
    'statx(20</proc/900/stat>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {}) = 0';
  expect(check(101, metadata)).toEqual([metadata]);
  expect(() => check(101, metadata, false)).toThrow("non-inventory lookup");
  expect(() => check(101, metadata.replace("/stat>", "/mem>"))).toThrow(
    "non-inventory lookup",
  );
});

it("permits procps UID metadata without granting a PID directory handle", () => {
  const metadata =
    'newfstatat(AT_FDCWD</tmp>, "/proc/900", {st_mode=S_IFDIR|0555}, 0) = 0';
  const input = {
    trace: { pid: 102, text: metadata },
    historicalPid: 900,
    ownershipThreads: new Set<number>(),
    liveCollision: true,
    psInventory: true,
  };
  expect(assertHistoricalPidAccess(input)).toEqual([metadata]);
  expect(() =>
    assertHistoricalPidAccess({ ...input, liveCollision: false }),
  ).toThrow("non-inventory lookup");
  expect(() =>
    assertHistoricalPidAccess({ ...input, psInventory: false }),
  ).toThrow("non-inventory lookup");
  expect(() =>
    assertHistoricalPidAccess({
      ...input,
      trace: {
        pid: 102,
        text: 'openat(AT_FDCWD, "/proc/900", O_RDONLY|O_DIRECTORY) = 5</proc/900>',
      },
    }),
  ).toThrow("non-inventory lookup");
});

it.each(["mem", "maps", "environ", "exe", "root"])(
  "rejects Node access to the live historical PID's %s",
  (name) => {
    expect(() => check(101, stat.replace("/stat", `/${name}`))).toThrow(
      "non-inventory lookup",
    );
  },
);

it("rejects an unlisted historical PID lookup even from an observed inventory thread", () => {
  expect(() => check(101, stat, false)).toThrow("non-inventory lookup");
});

it.each([
  'openat(AT_FDCWD, "/proc/900", O_RDONLY|O_DIRECTORY|O_CLOEXEC) = 5</proc/900>',
  'openat(5</proc/900>, "mem", O_RDONLY|O_CLOEXEC) = 6</proc/900/mem>',
  'openat(5</proc/900>, "stat", O_RDONLY|O_CLOEXEC) = -1 EACCES (Permission denied)',
  'openat(5</proc>, "900/mem", O_RDONLY) = -1 ENOENT (No such file or directory)',
  'openat(5</proc>, "self/../900/mem", O_RDONLY) = -1 ENOENT (No such file or directory)',
  'openat(AT_FDCWD, "/proc/./900", O_RDONLY|O_DIRECTORY) = -1 ENOENT (No such file or directory)',
  'openat(AT_FDCWD, "/proc/self/../900/mem", O_RDONLY) = -1 ENOENT (No such file or directory)',
  "kill(900, 0) = 0",
  "kill(-900, SIGSTOP) = 0",
  "kill(-1, SIGSTOP) = 0",
  "tkill(900, SIGSTOP) = 0",
  "tgkill(900, 901, SIGSTOP) = 0",
  "tgkill(901, 900, SIGSTOP) = 0",
  "rt_sigqueueinfo(900, SIGUSR1, {}) = 0",
  "rt_tgsigqueueinfo(901, 900, SIGUSR1, {}) = 0",
  "pidfd_open(900, 0) = 7<pid:900>",
  "pidfd_send_signal(7<pid:900>, SIGSTOP, NULL, 0) = 0",
  "pidfd_send_signal(7, SIGSTOP, NULL, 0) = 0",
])("rejects historical PID directory/handle/control access: %s", (line) => {
  for (const live of [true, false])
    expect(() => check(101, line, live)).toThrow("non-inventory lookup");
});

it("keeps descriptor reuse and distinct PIDs separate and refuses ps writes", () => {
  expect(check(101, 'openat(5</tmp>, "mem", O_RDONLY) = 6</tmp/mem>')).toEqual(
    [],
  );
  expect(check(101, stat.replaceAll("900", "9000"))).toEqual([]);
  expect(() =>
    assertHistoricalPidAccess({
      trace: { pid: 102, text: stat.replace("O_RDONLY", "O_WRONLY") },
      historicalPid: 900,
      ownershipThreads: new Set(),
      liveCollision: true,
      psInventory: true,
    }),
  ).toThrow("non-inventory lookup");
});

it.each([
  'readlinkat(5</proc>, "900/exe", 0x1, 4096) = -1 EACCES (Permission denied)',
  'newfstatat(5</proc>, "900/mem", 0x1, 0) = -1 EACCES (Permission denied)',
  'statx(5</proc>, "900/mem", 0, STATX_ALL, 0x1) = -1 EACCES (Permission denied)',
  'openat(5</tmp>, "../proc/900/mem", O_RDONLY) = -1 EACCES (Permission denied)',
])("checks failed relative pathname operations beyond openat: %s", (line) => {
  for (const live of [true, false])
    expect(() => check(101, line, live)).toThrow("non-inventory lookup");
});

it.each([
  "getpriority(PRIO_PROCESS, 900) = 20",
  "setpriority(PRIO_PROCESS, 900, 0) = 0",
  "getpriority(PRIO_PGRP, 900) = 20",
  "setpriority(PRIO_PGRP, 900, 0) = 0",
  "getpriority(0x3 /* unknown PRIO selector */, 900) = -1 EINVAL (Invalid argument)",
])("rejects historical PID priority access: %s", (line) => {
  for (const live of [true, false])
    expect(() => check(101, line, live)).toThrow("non-inventory lookup");
});

it("keeps native priority UID selectors and distinct PIDs separate", () => {
  expect(check(101, "getpriority(PRIO_USER, 900) = 20")).toEqual([]);
  expect(check(101, "getpriority(PRIO_PROCESS, 9000) = 20")).toEqual([]);
});

it.each([
  String.raw`openat(AT_FDCWD</fixture>, "/fixture/\345\267\245\345\205\267", O_RDONLY) = -1 ENOENT (No such file or directory)`,
  String.raw`openat(5</fixture>, "\345\267\245\345\205\267", O_RDONLY) = -1 ENOENT (No such file or directory)`,
])("preserves unrelated C-quoted pathname components: %s", (line) => {
  expect(check(101, line)).toEqual([]);
});

it.each([
  "getpgid(900) = 900",
  "getsid(900) = 900",
  "get_robust_list(900, [0x1], [24]) = 0",
  "migrate_pages(900, 64, [1], [1]) = 0",
  "move_pages(900, 0, NULL, NULL, NULL, 0) = 0",
  "setpgid(0, 900) = 0",
  "kcmp(901, 900, KCMP_FILE, 0, 0) = 0",
  "wait4(900, NULL, WNOHANG, NULL) = -1 ECHILD (No child processes)",
  "wait4(-900, NULL, WNOHANG, NULL) = -1 ECHILD (No child processes)",
  "waitid(P_PID, 900, NULL, WNOHANG, NULL) = -1 ECHILD (No child processes)",
  "waitid(P_PGID, 900, NULL, WNOHANG, NULL) = -1 ECHILD (No child processes)",
  "waitid(P_PIDFD, 7<pid:900>, NULL, WNOHANG, NULL) = -1 ECHILD (No child processes)",
  "capget({version=_LINUX_CAPABILITY_VERSION_3, pid=900}, NULL) = 0",
  "capset({version=_LINUX_CAPABILITY_VERSION_3, pid=900}, NULL) = 0",
  "process_madvise(7<pid:900>, [], 0, MADV_NORMAL, 0) = -1 EPERM (Operation not permitted)",
  "process_mrelease(7<pid:900>, 0) = -1 EPERM (Operation not permitted)",
])(
  "rejects resolved PID resource, scheduler and metadata targets: %s",
  (line) => {
    for (const live of [true, false])
      expect(() => check(101, line, live)).toThrow("non-inventory lookup");
  },
);

it.each([
  "prlimit64(0, RLIMIT_NOFILE, NULL, {rlim_cur=1024, rlim_max=4096}) = 0",
  "sched_getaffinity(0, 8, [0]) = 8",
  "sched_setscheduler(901, 900, {sched_priority=0}) = -1 EINVAL (Invalid argument)",
  "sched_get_priority_max(900) = -1 EINVAL (Invalid argument)",
  "getpgid(901) = 900",
  "wait4(-1, NULL, WNOHANG, NULL) = 0",
  "waitid(P_ALL, 900, NULL, WNOHANG, NULL) = 0",
  "capget({version=_LINUX_CAPABILITY_VERSION_3, pid=0}, NULL) = 0",
  "kcmp(901, 902, KCMP_FILE, 900, 0) = 0",
])(
  "keeps self, UID, policy and output values distinct from PID targets: %s",
  (line) => {
    expect(check(101, line)).toEqual([]);
  },
);

it.each([
  "sched_getaffinity(unknown, 8, [0]) = -1 EFAULT (Bad address)",
  "capget(NULL, NULL) = -1 EFAULT (Bad address)",
  "waitid(P_PIDFD, 7, NULL, WNOHANG, NULL) = -1 EBADF (Bad file descriptor)",
  "ioprio_get(0x4 /* unknown selector */, 900) = -1 EINVAL (Invalid argument)",
])("retains unresolved target facts: %s", (line) => {
  for (const live of [true, false])
    expect(() => check(101, line, live)).toThrow("Unresolved process target");
});

it.each([
  "prlimit64(900, RLIMIT_NOFILE, NULL, {rlim_cur=1024, rlim_max=1024}) = 0",
  "prlimit64(900, RLIMIT_NOFILE, {rlim_cur=1024, rlim_max=1024}, NULL) = 0",
  "sched_setaffinity(900, 128, [0 1]) = 0",
  "sched_getaffinity(900, 128, [0 1]) = 8",
  "sched_setscheduler(900, SCHED_OTHER, {sched_priority=0}) = 0",
  "sched_getscheduler(900) = SCHED_OTHER",
  "sched_setparam(900, {sched_priority=0}) = 0",
  "sched_getparam(900, {sched_priority=0}) = 0",
  "sched_setattr(900, {size=56, sched_policy=SCHED_OTHER}, 0) = 0",
  "sched_getattr(900, {size=56, sched_policy=SCHED_OTHER}, 56, 0) = 0",
  "sched_rr_get_interval(900, {tv_sec=0, tv_nsec=0}) = 0",
])("rejects historical PID resource and scheduler access: %s", (line) => {
  for (const live of [true, false]) {
    expect(() => check(101, line, live)).toThrow("non-inventory lookup");
    expect(() =>
      check(101, line.replace(/ = .*/u, " = -1 ESRCH (No such process)"), live),
    ).toThrow("non-inventory lookup");
  }
  expect(check(101, line.replace("(900", "(9000"))).toEqual([]);
  expect(check(101, line.replace("(900", "(0"))).toEqual([]);
});

it.each([
  "ioprio_get(IOPRIO_WHO_PROCESS, 900) = IOPRIO_PRIO_VALUE(IOPRIO_CLASS_NONE, 0)",
  "ioprio_set(IOPRIO_WHO_PROCESS, 900, IOPRIO_PRIO_VALUE(IOPRIO_CLASS_NONE, 0)) = 0",
  "ioprio_get(IOPRIO_WHO_PGRP, 900) = 0",
  "ioprio_set(IOPRIO_WHO_PGRP, 900, 0) = -1 ESRCH (No such process)",
  "ioprio_get(PRIO_USER, 900) = -1 EINVAL (Invalid argument)",
  "getpriority(IOPRIO_WHO_USER, 900) = -1 EINVAL (Invalid argument)",
])("rejects historical PID I/O priority access: %s", (line) => {
  for (const live of [true, false])
    expect(() => check(101, line, live)).toThrow("non-inventory lookup");
});

it("keeps I/O priority UID selectors and distinct PID/self selectors separate", () => {
  expect(check(101, "ioprio_get(IOPRIO_WHO_USER, 900) = 0")).toEqual([]);
  expect(check(101, "ioprio_get(IOPRIO_WHO_PROCESS, 9000) = 0")).toEqual([]);
  expect(check(101, "ioprio_get(IOPRIO_WHO_PROCESS, 0) = 0")).toEqual([]);
});
