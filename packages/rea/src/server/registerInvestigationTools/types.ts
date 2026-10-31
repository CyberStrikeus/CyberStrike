/** Fields used to build a residual unknown from a workflow result. */
export interface WorkflowUnknownInput {
  readonly question: string;
  readonly domain: string;
  readonly requiredAuthority: "shipped-artifact" | "controlled-replay" | null;
  readonly requiredConfidence: "observed" | "derived";
  readonly probes: readonly {
    readonly operation: string;
    readonly rationale: string;
  }[];
}
