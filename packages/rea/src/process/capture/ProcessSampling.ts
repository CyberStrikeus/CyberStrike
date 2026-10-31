import type { ProcessSamplingCoverage } from "../../domain/process/processCaptureCoverage.js";
import type {
  ProcessSample,
  RecordProcessCaptureEvent,
} from "../../domain/process/processCapture.js";
import { execFileOutput } from "../ExecFileOutput.js";
import { readProcessRunId } from "../ProcessOwnership.js";
import { monotonicProcessCaptureClock } from "./ProcessCaptureClock.js";
import {
  inspectLinuxProcess,
  inspectLinuxProcessMetadata,
  PROC_READ_CONCURRENCY,
  readLinuxProcessStat,
  type SampledProcessRow as ProcessRow,
} from "./LinuxProcessSampling.js";
import {
  isSamplingAbort,
  mergeSamplingDiagnostics,
  readProcSamplingSource,
  readSamplingSource,
  samplingObservation,
  samplingInterrupted,
  samplingReadObservation,
  type SamplingObservation,
} from "./ProcessSamplingObservation.js";

interface SampleProcessContext {
  readonly rootPid: number;
  readonly elapsedMs: number;
  readonly limit: number;
  readonly identities: Map<number, string>;
  readonly signal: AbortSignal;
}

type ProcessIdentitySnapshot = Pick<
  ProcessRow,
  "pid" | "parent_pid" | "process_group_id" | "session_id" | "startTime"
>;

/** Prove that forkpty completed session setup and installed the run token. */
export const isInitializedPtyRoot = (options: {
  readonly rootPid: number;
  readonly expectedRunId: string;
  readonly before: ProcessIdentitySnapshot;
  readonly observedRunId: string | undefined;
  readonly after: ProcessIdentitySnapshot;
}): boolean => {
  const sessionIdentityMatches =
    (options.before.session_id === options.rootPid &&
      options.after.session_id === options.rootPid) ||
    (options.before.session_id === null && options.after.session_id === null);
  return (
    options.before.pid === options.rootPid &&
    options.before.process_group_id === options.rootPid &&
    sessionIdentityMatches &&
    options.after.pid === options.rootPid &&
    options.after.parent_pid === options.before.parent_pid &&
    options.after.process_group_id === options.rootPid &&
    options.after.startTime === options.before.startTime &&
    options.observedRunId === options.expectedRunId
  );
};

const sampleLinux = async (
  context: SampleProcessContext,
): Promise<SamplingObservation<readonly ProcessRow[]>> => {
  const { rootPid, limit, signal, identities } = context;
  if (limit <= 0) return samplingObservation([]);
  const root = await inspectLinuxProcess(
    rootPid,
    undefined,
    signal,
    identities,
  );
  if (root.value === undefined)
    return samplingObservation([], root.diagnostics);
  // Preserve the existing ps fallback when procfs cannot enumerate the root.
  if (root.value.children === undefined && !signal.aborted) {
    const fallback = await sampleLinuxFallback(context, root.value);
    return samplingObservation(
      fallback.value,
      root.diagnostics,
      fallback.diagnostics,
    );
  }
  const rows: ProcessRow[] = [root.value];
  let diagnostics = root.diagnostics;
  const visited = new Set<number>([rootPid]);
  let level = (root.value.children ?? []).map((pid) => ({
    pid,
    expectedParent: rootPid,
  }));
  for (const { pid } of level) visited.add(pid);
  while (level.length > 0 && rows.length < limit && !signal.aborted) {
    const batchSize = Math.min(
      level.length,
      PROC_READ_CONCURRENCY,
      limit - rows.length,
    );
    const batch = level.slice(0, batchSize);
    level = level.slice(batchSize);
    const observations = await Promise.all(
      batch.map(({ pid, expectedParent }) =>
        inspectLinuxProcess(pid, expectedParent, signal, identities),
      ),
    );
    for (const observation of observations) {
      diagnostics = mergeSamplingDiagnostics(
        diagnostics,
        observation.diagnostics,
      );
      const node = observation.value;
      if (node === undefined) continue;
      rows.push(node);
      for (const child of node.children ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        level.push({ pid: child, expectedParent: node.pid });
      }
    }
  }
  if (level.length > 0 && signal.aborted)
    diagnostics = mergeSamplingDiagnostics(diagnostics, samplingInterrupted());
  return samplingObservation(rows, diagnostics);
};

const readPsRowsRaw = async (
  signal: AbortSignal,
): Promise<readonly ProcessRow[]> => {
  const { stdout } = await execFileOutput(
    "ps",
    ["-axo", "pid=,ppid=,pgid=,sess=,command="],
    { signal, stopSignal: "SIGTERM" },
  );
  return stdout
    .split("\n")
    .map((line) => /\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)/u.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      parent_pid: Number(match[2]),
      process_group_id: Number(match[3]),
      session_id: Number(match[4]) || null,
      command: match[5] ?? "",
      startTime: undefined,
    }))
    .filter(
      (row) =>
        Number.isSafeInteger(row.pid) &&
        row.pid > 0 &&
        Number.isSafeInteger(row.parent_pid) &&
        row.parent_pid >= 0,
    )
    .sort((left, right) => left.pid - right.pid);
};

const readPsRows = async (
  signal: AbortSignal,
): Promise<SamplingObservation<readonly ProcessRow[] | undefined>> =>
  samplingReadObservation(
    await readSamplingSource("process table (ps)", signal, () =>
      readPsRowsRaw(signal),
    ),
  );

/** ps supplies candidate edges only; Linux identity and command remain procfs-owned. */
const sampleLinuxFallback = async (
  context: SampleProcessContext,
  root: ProcessRow,
): Promise<SamplingObservation<readonly ProcessRow[]>> => {
  const observed = await readPsRows(context.signal);
  if (observed.value === undefined)
    return samplingObservation([root], observed.diagnostics);
  const childrenByParent = new Map<number, number[]>();
  for (const row of observed.value) {
    const children = childrenByParent.get(row.parent_pid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.parent_pid, children);
  }
  const rows: ProcessRow[] = [root];
  let diagnostics = observed.diagnostics;
  const visited = new Set<number>([root.pid]);
  let level = (childrenByParent.get(root.pid) ?? []).map((pid) => ({
    pid,
    expectedParent: root.pid,
  }));
  while (
    level.length > 0 &&
    rows.length < context.limit &&
    !context.signal.aborted
  ) {
    const batch = level.splice(
      0,
      Math.min(PROC_READ_CONCURRENCY, context.limit - rows.length),
    );
    const candidates = batch.filter(({ pid }) => !visited.has(pid));
    for (const { pid } of candidates) visited.add(pid);
    const observations = await Promise.all(
      candidates.map(({ pid, expectedParent }) =>
        inspectLinuxProcessMetadata(
          pid,
          expectedParent,
          context.signal,
          context.identities,
        ),
      ),
    );
    for (const observation of observations) {
      diagnostics = mergeSamplingDiagnostics(
        diagnostics,
        observation.diagnostics,
      );
      if (observation.value === undefined) continue;
      rows.push(observation.value);
      for (const child of childrenByParent.get(observation.value.pid) ?? [])
        level.push({ pid: child, expectedParent: observation.value.pid });
    }
  }
  if (level.length > 0 && context.signal.aborted)
    diagnostics = mergeSamplingDiagnostics(diagnostics, samplingInterrupted());
  const after = await readLinuxProcessStat(root.pid, context.signal);
  diagnostics = mergeSamplingDiagnostics(diagnostics, after.diagnostics);
  return samplingObservation(
    after.value !== undefined &&
      after.value.startTime === root.startTime &&
      after.value.parent_pid === root.parent_pid
      ? rows
      : [root],
    diagnostics,
  );
};

const readRootIdentity = async (
  rootPid: number,
  signal: AbortSignal,
): Promise<SamplingObservation<ProcessRow | undefined>> => {
  if (process.platform === "linux")
    return readLinuxProcessStat(rootPid, signal);
  const rows = await readPsRows(signal);
  return samplingObservation(
    rows.value?.find(({ pid }) => pid === rootPid),
    rows.diagnostics,
  );
};

const inspectInitializedPtyRoot = async (
  rootPid: number,
  runId: string,
  signal: AbortSignal,
): Promise<
  SamplingObservation<{ readonly startTime: string | undefined } | undefined>
> => {
  const before = await readRootIdentity(rootPid, signal);
  if (
    before.value === undefined ||
    before.value.process_group_id !== rootPid ||
    (before.value.session_id !== rootPid && before.value.session_id !== null)
  )
    return samplingObservation(undefined, before.diagnostics);
  const observedRunId =
    process.platform === "linux"
      ? await readProcSamplingSource(
          `/proc/${String(rootPid)}/environ`,
          signal,
          () => readProcessRunId(rootPid, undefined, signal),
        )
      : samplingReadObservation(
          await readSamplingSource(
            `run token for PID ${String(rootPid)}`,
            signal,
            () => readProcessRunId(rootPid, undefined, signal),
          ),
        );
  const after = await readRootIdentity(rootPid, signal);
  const diagnostics = mergeSamplingDiagnostics(
    before.diagnostics,
    observedRunId.diagnostics,
    after.diagnostics,
  );
  if (
    after.value === undefined ||
    !isInitializedPtyRoot({
      rootPid,
      expectedRunId: runId,
      before: before.value,
      observedRunId: observedRunId.value,
      after: after.value,
    })
  )
    return samplingObservation(undefined, diagnostics);
  return samplingObservation({ startTime: after.value.startTime }, diagnostics);
};

const samplePs = async (
  context: SampleProcessContext,
): Promise<SamplingObservation<readonly ProcessRow[]>> => {
  const { rootPid, limit, signal } = context;
  if (limit <= 0) return samplingObservation([]);

  const observed = await readPsRows(signal);
  const rows = observed.value ?? [];
  const rowByPid = new Map(rows.map((row) => [row.pid, row]));
  const childrenByParent = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = childrenByParent.get(row.parent_pid) ?? [];
    siblings.push(row);
    childrenByParent.set(row.parent_pid, siblings);
  }

  const result: ProcessRow[] = [];
  const visited = new Set<number>();
  const queue: number[] = [rootPid];
  let index = 0;

  while (index < queue.length && result.length < limit) {
    const pid = queue[index];
    if (pid === undefined) break;
    index += 1;
    if (visited.has(pid)) continue;
    visited.add(pid);

    const row = rowByPid.get(pid);
    if (row !== undefined) result.push(row);
    if (result.length >= limit) break;

    for (const child of childrenByParent.get(pid) ?? []) {
      if (!visited.has(child.pid)) queue.push(child.pid);
    }
  }

  return samplingObservation(result, observed.diagnostics);
};

const sampleProcesses = async (
  context: SampleProcessContext,
): Promise<SamplingObservation<readonly ProcessSample[]>> => {
  if (process.platform === "win32" || context.limit <= 0)
    return samplingObservation([]);

  const rows =
    process.platform === "linux"
      ? await sampleLinux(context)
      : await samplePs(context);

  const { elapsedMs, identities } = context;
  const samples: ProcessSample[] = [];
  for (const row of rows.value) {
    if (row.startTime !== undefined) {
      const existing = identities.get(row.pid);
      if (existing !== undefined && existing !== row.startTime) continue;
      identities.set(row.pid, row.startTime);
    }
    samples.push({
      at_ms: elapsedMs,
      pid: row.pid,
      parent_pid: row.parent_pid,
      command: row.command,
      process_group_id: row.process_group_id,
      session_id: row.session_id,
    });
  }
  return samplingObservation(samples, rows.diagnostics);
};

/** Start bounded process-tree sampling and expose an awaited stop. */
export const startProcessSampler = (options: {
  readonly rootPid: number;
  readonly runId: string;
  readonly started: number;
  readonly limit: number;
  readonly samples: ProcessSample[];
  readonly recordEvent?: RecordProcessCaptureEvent;
}): (() => Promise<{
  readonly partial: boolean;
  readonly coverage: ProcessSamplingCoverage;
}>) => {
  const { rootPid, runId, started, limit, samples } = options;
  const identities = new Map<number, string>();
  const lastObservations = new Map<number, string>();
  let pending: Promise<void> | undefined;
  let stopped = false;
  let abortCurrent: (() => void) | undefined;
  let limitReached = false;
  let samplingFailures = 0;
  let samplingWasInterrupted = false;
  let firstSamplingFailure: string | null = null;
  let rootInitialized = false;

  const sample = (): void => {
    if (stopped || pending !== undefined) return;

    const controller = new AbortController();
    abortCurrent = () => controller.abort();
    pending = (async () => {
      let diagnostics = mergeSamplingDiagnostics();
      if (!rootInitialized) {
        const identity = await inspectInitializedPtyRoot(
          rootPid,
          runId,
          controller.signal,
        );
        diagnostics = identity.diagnostics;
        if (identity.value === undefined)
          return samplingObservation([], diagnostics);
        if (identity.value.startTime !== undefined)
          identities.set(rootPid, identity.value.startTime);
        rootInitialized = true;
      }
      const observation = await sampleProcesses({
        rootPid,
        elapsedMs: monotonicProcessCaptureClock() - started,
        limit: limit + 1,
        identities,
        signal: controller.signal,
      });
      return samplingObservation(
        observation.value,
        diagnostics,
        observation.diagnostics,
      );
    })()
      .then((observation) => {
        samplingFailures += observation.diagnostics.count;
        samplingWasInterrupted ||= observation.diagnostics.interrupted;
        firstSamplingFailure ??= observation.diagnostics.first;
        for (const value of observation.value) {
          const observation = JSON.stringify({
            parent_pid: value.parent_pid,
            command: value.command,
            process_group_id: value.process_group_id,
            session_id: value.session_id,
          });
          if (lastObservations.get(value.pid) === observation) continue;
          if (samples.length >= limit) {
            limitReached = true;
            continue;
          }
          lastObservations.set(value.pid, observation);
          const index = samples.length;
          samples.push(value);
          options.recordEvent?.("process_samples", index);
        }
      })
      .catch((cause: unknown) => {
        if (isSamplingAbort(cause, controller.signal)) {
          samplingWasInterrupted = true;
        } else {
          samplingFailures += 1;
          firstSamplingFailure ??=
            cause instanceof Error
              ? `${cause.name}: ${cause.message}`
              : typeof cause === "string"
                ? cause
                : `Unexpected sampling rejection (${typeof cause})`;
        }
      })
      .then(() => {
        abortCurrent = undefined;
        pending = undefined;
      });
  };

  const timer = setInterval(sample, 50);
  sample();

  return async () => {
    stopped = true;
    clearInterval(timer);
    abortCurrent?.();
    await pending;
    const failureCount = samplingFailures + (samplingWasInterrupted ? 1 : 0);
    const interrupted =
      "Sampler shutdown interrupted an unfinished process observation; unexamined processes remain unknown";
    const firstFailure = samplingWasInterrupted
      ? firstSamplingFailure === null
        ? interrupted
        : `${firstSamplingFailure}; ${interrupted}`
      : firstSamplingFailure;
    const partial = limitReached || failureCount > 0;
    return {
      partial,
      coverage: {
        sample_limit: limit,
        sampling_partial: partial,
        retained_samples: samples.length,
        sample_limit_reached: limitReached,
        sampling_failures: failureCount,
        first_sampling_failure: firstFailure,
        coverage: "sampled",
      },
    };
  };
};
