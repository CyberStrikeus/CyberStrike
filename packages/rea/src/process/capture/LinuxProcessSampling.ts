import { readFile, readdir } from "node:fs/promises";
import { parseLinuxProcessStat } from "../LinuxProcessStat.js";
import {
  mergeSamplingDiagnostics,
  readProcSamplingSource,
  samplingFailure,
  samplingObservation,
  samplingInterrupted,
  type SamplingObservation,
} from "./ProcessSamplingObservation.js";

export const PROC_READ_CONCURRENCY = 64;

export interface SampledProcessRow {
  readonly pid: number;
  readonly parent_pid: number;
  readonly process_group_id: number | null;
  readonly session_id: number | null;
  readonly command: string;
  readonly startTime: string | undefined;
}

export interface SampledProcessNode extends SampledProcessRow {
  readonly children: readonly number[] | undefined;
}

export const readLinuxProcessStat = async (
  pid: number,
  signal: AbortSignal,
): Promise<SamplingObservation<SampledProcessRow | undefined>> => {
  const path = `/proc/${String(pid)}/stat`;
  const read = await readProcSamplingSource(path, signal, () =>
    readFile(path, { encoding: "utf8", signal }),
  );
  if (read.value === undefined)
    return samplingObservation(undefined, read.diagnostics);
  const parsed = parseLinuxProcessStat(read.value);
  if (parsed === undefined || parsed.pid !== pid)
    return samplingObservation(
      undefined,
      read.diagnostics,
      samplingFailure(`${path}: malformed process identity`),
    );
  // A valid stat record can outlive its group/session relation during teardown.
  // It cannot supply an attributable sample, but is not a parser failure.
  if (parsed.processGroupId <= 0 || parsed.sessionId <= 0)
    return samplingObservation(undefined, read.diagnostics);
  return samplingObservation(
    {
      pid: parsed.pid,
      parent_pid: parsed.parentPid,
      process_group_id: parsed.processGroupId,
      session_id: parsed.sessionId,
      command: "",
      startTime: parsed.startTime,
    },
    read.diagnostics,
  );
};

/** Procfs operations remain injectable below error classification and composition. */
export interface LinuxChildrenHost {
  taskIds(pid: number, signal: AbortSignal): Promise<readonly number[]>;
  children(pid: number, taskId: number, signal: AbortSignal): Promise<string>;
}

const systemLinuxChildrenHost: LinuxChildrenHost = {
  async taskIds(pid) {
    const entries = await readdir(`/proc/${String(pid)}/task`);
    return entries
      .filter((entry) => /^\d+$/u.test(entry))
      .map(Number)
      .filter((taskId) => Number.isSafeInteger(taskId) && taskId > 0)
      .sort((left, right) => left - right);
  },
  children(pid, taskId, signal) {
    return readFile(`/proc/${String(pid)}/task/${String(taskId)}/children`, {
      encoding: "utf8",
      signal,
    });
  },
};

/** Keep the child union and diagnostics from independently readable process threads. */
export const readLinuxChildren = async (
  pid: number,
  signal: AbortSignal,
  host: LinuxChildrenHost = systemLinuxChildrenHost,
): Promise<SamplingObservation<readonly number[] | undefined>> => {
  const tasks = await readProcSamplingSource(
    `/proc/${String(pid)}/task`,
    signal,
    () => host.taskIds(pid, signal),
  );
  if (tasks.value === undefined)
    return samplingObservation(undefined, tasks.diagnostics);
  if (tasks.value.length === 0)
    return samplingObservation([], tasks.diagnostics);
  const children = new Set<number>();
  let diagnostics = tasks.diagnostics;
  let successfulReads = 0;
  let offset = 0;
  for (
    ;
    offset < tasks.value.length && !signal.aborted;
    offset += PROC_READ_CONCURRENCY
  ) {
    const texts = await Promise.all(
      tasks.value
        .slice(offset, offset + PROC_READ_CONCURRENCY)
        .map((taskId) =>
          readProcSamplingSource(
            `/proc/${String(pid)}/task/${String(taskId)}/children`,
            signal,
            () => host.children(pid, taskId, signal),
          ),
        ),
    );
    for (const text of texts) {
      diagnostics = mergeSamplingDiagnostics(diagnostics, text.diagnostics);
      if (text.value === undefined) continue;
      successfulReads += 1;
      for (const value of text.value.trim().split(/\s+/u)) {
        if (!/^\d+$/u.test(value)) continue;
        const child = Number(value);
        if (Number.isSafeInteger(child) && child > 0) children.add(child);
      }
    }
  }
  if (offset < tasks.value.length && signal.aborted)
    diagnostics = mergeSamplingDiagnostics(diagnostics, samplingInterrupted());
  return samplingObservation(
    successfulReads === 0 ? undefined : [...children].sort((a, b) => a - b),
    diagnostics,
  );
};

/** Identity brackets own attribution for both procfs and ps-discovered candidates. */
const inspectStableLinuxProcess = async <T>(
  pid: number,
  expectedParent: number | undefined,
  signal: AbortSignal,
  identities: ReadonlyMap<number, string>,
  readDetails: () => Promise<SamplingObservation<T>>,
): Promise<
  SamplingObservation<
    { readonly row: SampledProcessRow; readonly details: T } | undefined
  >
> => {
  const before = await readLinuxProcessStat(pid, signal);
  if (before.value === undefined || before.value.startTime === undefined)
    return samplingObservation(undefined, before.diagnostics);
  const existing = identities.get(pid);
  if (
    (existing !== undefined && existing !== before.value.startTime) ||
    (expectedParent !== undefined && before.value.parent_pid !== expectedParent)
  )
    return samplingObservation(undefined, before.diagnostics);
  const details = await readDetails();
  const after = await readLinuxProcessStat(pid, signal);
  const diagnostics = mergeSamplingDiagnostics(
    before.diagnostics,
    details.diagnostics,
    after.diagnostics,
  );
  if (
    after.value === undefined ||
    before.value.startTime !== after.value.startTime ||
    before.value.parent_pid !== after.value.parent_pid ||
    (expectedParent !== undefined && after.value.parent_pid !== expectedParent)
  )
    return samplingObservation(undefined, diagnostics);
  return samplingObservation(
    { row: before.value, details: details.value },
    diagnostics,
  );
};

const readLinuxCommand = async (
  pid: number,
  signal: AbortSignal,
): Promise<SamplingObservation<string>> => {
  const path = `/proc/${String(pid)}/cmdline`;
  const command = await readProcSamplingSource(path, signal, () =>
    readFile(path, { signal }),
  );
  return samplingObservation(
    command.value?.toString().replaceAll("\0", " ").trim() ?? "",
    command.diagnostics,
  );
};

/** Inspect a ps-discovered PID without trusting ps for Linux identity or command. */
export const inspectLinuxProcessMetadata = async (
  pid: number,
  expectedParent: number,
  signal: AbortSignal,
  identities: ReadonlyMap<number, string>,
): Promise<SamplingObservation<SampledProcessRow | undefined>> => {
  const observed = await inspectStableLinuxProcess(
    pid,
    expectedParent,
    signal,
    identities,
    () => readLinuxCommand(pid, signal),
  );
  return samplingObservation(
    observed.value === undefined
      ? undefined
      : {
          ...observed.value.row,
          command: observed.value.details,
        },
    observed.diagnostics,
  );
};

/** Failed optional reads qualify a stable row instead of erasing it or its peers. */
export const inspectLinuxProcess = async (
  pid: number,
  expectedParent: number | undefined,
  signal: AbortSignal,
  identities: ReadonlyMap<number, string>,
): Promise<SamplingObservation<SampledProcessNode | undefined>> => {
  const observed = await inspectStableLinuxProcess(
    pid,
    expectedParent,
    signal,
    identities,
    async () => {
      const [command, children] = await Promise.all([
        readLinuxCommand(pid, signal),
        readLinuxChildren(pid, signal),
      ]);
      return samplingObservation(
        { command: command.value, children: children.value },
        command.diagnostics,
        children.diagnostics,
      );
    },
  );
  return samplingObservation(
    observed.value === undefined
      ? undefined
      : {
          ...observed.value.row,
          ...observed.value.details,
        },
    observed.diagnostics,
  );
};
