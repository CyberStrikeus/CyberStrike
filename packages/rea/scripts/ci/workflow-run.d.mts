export interface WorkflowPath {
  readonly file: string;
  readonly ref: string | null;
}
export interface NormalizedWorkflowRun {
  readonly workflowPath: WorkflowPath | null;
}
export function normalizeWorkflowRun<T extends Record<string, unknown>>(
  value: T,
): Omit<T, "workflowPath"> & NormalizedWorkflowRun;
