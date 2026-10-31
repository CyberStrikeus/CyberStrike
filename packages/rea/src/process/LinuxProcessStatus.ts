/** Real, effective, saved and filesystem IDs from one Linux status row. */
export type LinuxProcessIds = readonly [number, number, number, number];

/** Parse the single `Uid:` or `Gid:` row of one Linux `/proc/<pid>/status` record. */
export const parseLinuxProcessIds = (
  value: string,
  row: "Uid" | "Gid",
): LinuxProcessIds | undefined => {
  let ids: LinuxProcessIds | undefined;
  for (const line of value.split("\n")) {
    if (!line.startsWith(`${row}:`)) continue;
    if (ids !== undefined) return undefined;
    const match =
      /^[UG]id:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$/u.exec(line);
    if (match === null) return undefined;
    const [real, effective, saved, filesystem] = match.slice(1).map(Number);
    if (
      real === undefined ||
      effective === undefined ||
      saved === undefined ||
      filesystem === undefined ||
      [real, effective, saved, filesystem].some(
        (id) => !Number.isSafeInteger(id) || id < 0,
      )
    )
      return undefined;
    ids = [real, effective, saved, filesystem];
  }
  return ids;
};

/**
 * Why Linux withholds `/proc/<pid>/environ` from a caller without
 * CAP_SYS_PTRACE (PTRACE_MODE_READ_FSCREDS): the target's real, effective or
 * saved UID/GID differs from the caller's, or the target is non-dumpable, which
 * procfs reports as root ownership of `/proc/<pid>/environ`.
 */
export type LinuxEnvironmentRestriction = "credentials" | "non-dumpable";

/** Derive the kernel's environment restriction from one generation's procfs facts. */
export const linuxEnvironmentRestriction = (facts: {
  readonly uids: LinuxProcessIds;
  readonly gids: LinuxProcessIds | undefined;
  readonly procfsOwnerUid: number | undefined;
  readonly callerUid: number | undefined;
  readonly callerGid: number | undefined;
}): LinuxEnvironmentRestriction | undefined => {
  const { uids, gids, procfsOwnerUid, callerUid, callerGid } = facts;
  if (
    (callerUid !== undefined &&
      uids.slice(0, 3).some((uid) => uid !== callerUid)) ||
    (callerGid !== undefined &&
      gids !== undefined &&
      gids.slice(0, 3).some((gid) => gid !== callerGid))
  )
    return "credentials";
  return procfsOwnerUid !== undefined && procfsOwnerUid !== uids[1]
    ? "non-dumpable"
    : undefined;
};
