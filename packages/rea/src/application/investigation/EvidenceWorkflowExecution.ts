import type { Evidence } from "../../domain/evidence.js";

/** Completed workflow observation and the authenticated sources it consumed. */
export interface EvidenceWorkflowExecution {
  readonly evidence: Evidence;
  readonly sources: readonly Evidence[];
}
