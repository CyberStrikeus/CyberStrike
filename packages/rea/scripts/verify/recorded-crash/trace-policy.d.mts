export interface SyscallTrace {
  readonly pid: number;
  readonly text: string;
}
export const historicalPidTraceContract: {
  readonly checked_paths: readonly string[];
  readonly pid_syscalls: readonly string[];
  readonly unverified: readonly string[];
};
export function assertHistoricalPidAccess(input: {
  readonly trace: SyscallTrace;
  readonly historicalPid: number;
  readonly ownershipThreads: ReadonlySet<number>;
  readonly liveCollision: boolean;
  readonly psInventory: boolean;
}): readonly string[];
