import type { ProcessLifecycle } from "./ProcessLifecycle.js";

/** Native process facts parsed from one Linux `/proc/<pid>/stat` record. */
export interface LinuxProcessStat {
  readonly pid: number;
  readonly startTime: string;
  readonly lifecycle: ProcessLifecycle | undefined;
  readonly parentPid: number;
  readonly processGroupId: number;
  readonly sessionId: number;
}

/**
 * Parse the changing command field by its final `)`, then validate the native
 * identity and relation fields. Zero is valid for the native group/session
 * facts; -1 for group/session means lock_task_sighand could not supply them
 * during teardown. Preserve these sentinels separately from the start identity.
 */
export const parseLinuxProcessStat = (
  value: string,
): LinuxProcessStat | undefined => {
  const commandStart = value.indexOf("(");
  const commandEnd = value.lastIndexOf(")");
  if (commandStart <= 0 || commandEnd <= commandStart) return undefined;

  const pidText = value.slice(0, commandStart).trim();
  if (!/^\d+$/u.test(pidText)) return undefined;
  const pid = Number(pidText);
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;

  const fields = value
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
  const state = fields[0];
  const parentPidText = fields[1];
  const processGroupIdText = fields[2];
  const sessionIdText = fields[3];
  const startTime = fields[19];
  if (
    state === undefined ||
    !/^[A-Za-z]$/u.test(state) ||
    parentPidText === undefined ||
    !/^\d+$/u.test(parentPidText) ||
    processGroupIdText === undefined ||
    !/^(?:-1|\d+)$/u.test(processGroupIdText) ||
    sessionIdText === undefined ||
    !/^(?:-1|\d+)$/u.test(sessionIdText) ||
    startTime === undefined ||
    !/^\d+$/u.test(startTime)
  )
    return undefined;

  const parentPid = Number(parentPidText);
  const processGroupId = Number(processGroupIdText);
  const sessionId = Number(sessionIdText);
  if (
    !Number.isSafeInteger(parentPid) ||
    !Number.isSafeInteger(processGroupId) ||
    !Number.isSafeInteger(sessionId)
  )
    return undefined;

  // Field 9 is task flags. PF_EXITING can precede state Z and procfs token
  // access can already fail during that interval. Neither proves terminal exit.
  const flagsText = fields[6];
  const flags =
    flagsText !== undefined && /^\d+$/u.test(flagsText)
      ? Number(flagsText)
      : Number.NaN;
  const lifecycle: ProcessLifecycle | undefined =
    state === "Z"
      ? "zombie"
      : state === "X" || state === "x"
        ? "dead"
        : !Number.isSafeInteger(flags)
          ? undefined
          : (flags & 0x00000004) !== 0
            ? "exiting"
            : "non-zombie";

  return {
    pid,
    startTime,
    lifecycle,
    parentPid,
    processGroupId,
    sessionId,
  };
};
