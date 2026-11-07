import assert from "node:assert/strict";
import { posix } from "node:path";

// This owner supplies both tracer selection and target interpretation. Kinds
// describe syscall argument semantics, never catalog positions or output PIDs.
const pidTargetKinds = new Map([
  ...[
    "prlimit64",
    "sched_getaffinity",
    "sched_setaffinity",
    "sched_getparam",
    "sched_setparam",
    "sched_getscheduler",
    "sched_setscheduler",
    "sched_getattr",
    "sched_setattr",
    "sched_rr_get_interval",
    "getpgid",
    "getsid",
    "get_robust_list",
    "migrate_pages",
    "move_pages",
    "pidfd_open",
    "tkill",
    "rt_sigqueueinfo",
  ].map((name) => [name, "pid"]),
  ...["tgkill", "rt_tgsigqueueinfo", "setpgid", "kcmp"].map((name) => [
    name,
    "pair",
  ]),
  ...["getpriority", "setpriority"].map((name) => [name, "priority"]),
  ...["ioprio_get", "ioprio_set"].map((name) => [name, "ioprio"]),
  ...[
    "pidfd_send_signal",
    "pidfd_getfd",
    "process_madvise",
    "process_mrelease",
  ].map((name) => [name, "pidfd"]),
  ...["capget", "capset"].map((name) => [name, "capability"]),
  ["kill", "signal-group"],
  ["wait4", "pid-group"],
  ["waitid", "wait-selector"],
]);

export const historicalPidTraceContract = Object.freeze({
  checked_paths: Object.freeze(["absolute-proc-paths", "decoded-fd-paths"]),
  pid_syscalls: Object.freeze([...pidTargetKinds.keys()]),
  unverified: Object.freeze([
    "legacy-cwd-relative-paths",
    "symlink-path-aliases",
    "same-node-thread-stat-status-purpose",
    "other-pid-directed-syscalls",
  ]),
});

const readPid = (value) => {
  const match = /^(-?\d+)(?=[),]|$)/u.exec(value ?? "");
  const pid = match === null ? NaN : Number(match[1]);
  return Number.isSafeInteger(pid) ? pid : null;
};
const readPidfd = (value) => {
  const match = /^\d+<pid:(\d+)>$/u.exec(value ?? "");
  return match === null ? null : readPid(match[1]);
};

const historicalPidTarget = (line, pid) => {
  const call = /^(\w+)\((.*)$/u.exec(line);
  const kind = call === null ? undefined : pidTargetKinds.get(call[1]);
  if (kind === undefined) return "unselected";
  const args = call[2].split(", ", 3);
  const match = (...targets) =>
    targets.includes(pid)
      ? "historical"
      : targets.includes(null)
        ? "unresolved"
        : "other";
  switch (kind) {
    case "pid":
      return match(readPid(args[0]));
    case "pair":
      return match(readPid(args[0]), readPid(args[1]));
    case "pidfd":
      return match(readPidfd(args[0]));
    case "pid-group":
    case "signal-group": {
      const target = readPid(args[0]);
      if (target === null) return "unresolved";
      return target === pid ||
        target === -pid ||
        (kind === "signal-group" && target === -1)
        ? "historical"
        : "other";
    }
    case "priority":
    case "ioprio": {
      const prefix = kind === "priority" ? "PRIO_" : "IOPRIO_WHO_";
      if (args[0] === `${prefix}USER`) return "other";
      if (![`${prefix}PROCESS`, `${prefix}PGRP`].includes(args[0]))
        return "unresolved";
      return match(readPid(args[1]));
    }
    case "wait-selector":
      if (args[0] === "P_ALL") return "other";
      if (args[0] === "P_PIDFD") return match(readPidfd(args[1]));
      if (!["P_PID", "P_PGID"].includes(args[0])) return "unresolved";
      return match(readPid(args[1]));
    case "capability": {
      const header = /^\{[^}]*\bpid=(-?\d+)(?=[,}])/u.exec(call[2]);
      return match(header === null ? null : readPid(header[1]));
    }
    default:
      return "unresolved";
  }
};

const readsMetadata = (line, root, names) => {
  const path = `${root}/(?:${names.join("|")})`;
  return (
    new RegExp(
      `^openat\\([^,]+, "${path}", O_RDONLY(?:\\|O_CLOEXEC)?\\)`,
      "u",
    ).test(line) ||
    new RegExp(
      `^statx\\(\\d+<${path}>, "", [^,]*\\bAT_EMPTY_PATH\\b`,
      "u",
    ).test(line) ||
    new RegExp(`^fstat(?:64)?\\(\\d+<${path}>,`, "u").test(line)
  );
};

/** Check resolved PID references; cwd-relative legacy paths remain unqualified. */
export function assertHistoricalPidAccess({
  trace,
  historicalPid,
  ownershipThreads,
  liveCollision,
  psInventory,
}) {
  const root = `/proc/${historicalPid}`;
  const pathReference = new RegExp(`${root}(?=[/">]|$)`, "u");
  const referencesHistoricalPath = (line) => {
    if (pathReference.test(line)) return true;
    // strace prints the ASCII /proc, PID and dot segments literally. Keep the
    // original line as evidence while recognizing lexical path aliases too.
    for (const quoted of line.matchAll(/"((?:[^"\\]|\\.)*)"/gu))
      if (
        quoted[1].startsWith("/proc/") &&
        pathReference.test(posix.normalize(quoted[1]))
      )
        return true;
    // -yy owns the current dirfd identity, including descriptor reuse. Resolve
    // each FD/path argument pair, not just openat: failed readlinkat, statx and
    // newfstatat attempts have no returned descriptor to reveal their target.
    for (const relative of line.matchAll(
      /(?:\(|, )(?:-?\d+|AT_FDCWD)<(\/[^>]*)>, ("(?:[^"\\]|\\.)*")/gu,
    )) {
      // strace prints ASCII separators, dot segments, /proc and decimal PIDs
      // literally. Other C-escaped bytes remain opaque path components; JSON
      // decoding would incorrectly reject valid non-ASCII caller paths.
      const pathname = relative[2].slice(1, -1);
      const path = posix.resolve(relative[1], pathname);
      if (path === root || path.startsWith(`${root}/`)) return true;
    }
    return false;
  };
  const accesses = [];
  for (const line of trace.text.split("\n")) {
    const target = historicalPidTarget(line, historicalPid);
    if (
      target !== "historical" &&
      target !== "unresolved" &&
      !referencesHistoricalPath(line)
    )
      continue;
    const ownershipMetadata =
      ownershipThreads.has(trace.pid) &&
      readsMetadata(line, root, ["stat", "status"]);
    const psMetadata =
      psInventory &&
      (readsMetadata(line, root, [
        "stat",
        "status",
        "cmdline",
        "wchan",
        "environ",
      ]) ||
        // procps reads the PID directory's UID without opening a directory FD.
        new RegExp(
          `^newfstatat\\([^,]+, "${root}", .*?, (?:0|AT_SYMLINK_NOFOLLOW)\\)`,
          "u",
        ).test(line));
    assert.ok(
      liveCollision &&
        target !== "historical" &&
        target !== "unresolved" &&
        (ownershipMetadata || psMetadata),
      `${target === "unresolved" ? "Unresolved process target in" : "Historical PID caused a"} non-inventory lookup in trace ${trace.pid}: ${line}`,
    );
    accesses.push(line);
  }
  return accesses;
}
