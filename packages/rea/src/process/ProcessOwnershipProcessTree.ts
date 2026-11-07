import type { ProcessTableEntry } from "./ProcessOwnership.js";

/** Exclude process-table entries that the operating system has already reaped. */
export const liveProcesses = (
  members: readonly ProcessTableEntry[],
): readonly ProcessTableEntry[] =>
  members.filter(({ state }) => !state.startsWith("Z"));

/** Return every live-table descendant of the selected roots in breadth-first order. */
export const descendantsOf = (
  rootPids: readonly number[],
  processes: readonly ProcessTableEntry[],
): ProcessTableEntry[] => {
  const childrenByParent = new Map<number, ProcessTableEntry[]>();
  for (const process of processes) {
    const siblings = childrenByParent.get(process.parentPid) ?? [];
    siblings.push(process);
    childrenByParent.set(process.parentPid, siblings);
  }
  const descendants: ProcessTableEntry[] = [];
  const pending = rootPids.flatMap((pid) => childrenByParent.get(pid) ?? []);
  const visited = new Set<number>(rootPids);
  for (const process of pending) {
    if (visited.has(process.pid)) continue;
    visited.add(process.pid);
    descendants.push(process);
    pending.push(...(childrenByParent.get(process.pid) ?? []));
  }
  return descendants;
};

/** Select the PTY root group and groups led by an observed captured process. */
export const selectCapturedProcessGroupIds = (
  rootPid: number,
  samples: readonly {
    readonly pid: number;
    readonly process_group_id: number | null;
  }[],
): readonly number[] => {
  const processGroupIds = new Set<number>([rootPid]);
  for (const sample of samples) {
    // A sampled member may transiently inherit an unrelated group. POSIX group
    // leaders have pid === pgid, so only that observation establishes that the
    // group leader itself belonged to the captured tree. Token checks below
    // remain the final authority immediately before observation or signaling.
    if (sample.pid === sample.process_group_id) processGroupIds.add(sample.pid);
  }
  return [...processGroupIds];
};
