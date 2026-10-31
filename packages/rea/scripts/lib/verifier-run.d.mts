export interface VerifierRunStart {
  readonly run_id: string;
  readonly verifier_pid: number;
  readonly parent_pid: number;
}

export interface VerifierRunDescendant {
  readonly pid: number;
  readonly parent_pid: number;
  readonly process_group_id: number;
}

export type VerifierProcessLineage =
  | {
      readonly status: "verified";
      readonly observed_at: string;
      readonly launcher_pid: number;
      readonly launcher_parent_pid: number;
      readonly process_group_id: number;
      readonly descendants: readonly VerifierRunDescendant[];
    }
  | {
      readonly status: "unavailable";
      readonly observed_at: string;
      readonly launcher_pid: number;
      readonly launcher_parent_pid: number;
      readonly process_group_id: number | null;
      readonly reason: string;
    };

export interface VerifierRun extends VerifierRunStart {
  readonly process_lineage: VerifierProcessLineage;
}

/** Allocate one process-local identity and propagate it to child processes. */
export function createVerifierRun(): VerifierRunStart;

/** Complete a verifier report with token-verified point-in-time lineage. */
export function completeVerifierRun(
  run: VerifierRunStart,
): Promise<VerifierRun>;

/** Require positive process-lineage evidence before claiming cleanup complete. */
export function assertVerifierCleanupComplete(
  processLineage: VerifierProcessLineage,
): void;
