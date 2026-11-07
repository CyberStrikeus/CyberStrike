export interface TestSelectionPlan {
  readonly version: 1;
  readonly mode: "full" | "candidate";
  readonly owners: readonly string[];
  readonly changedTests: readonly string[];
  readonly changedPaths: readonly string[];
  readonly reason: string;
}
export function planTestSelection(
  files: readonly string[],
  event: string,
  tier: string,
): TestSelectionPlan;
export function compareTestSelection(
  plan: unknown,
  inventory: readonly string[],
  results: readonly {
    readonly name: string;
    readonly durationMs: number;
    readonly state?: string;
  }[],
): {
  readonly version: 1;
  readonly observational: true;
  readonly plan: TestSelectionPlan;
  readonly selected: readonly string[];
  readonly omitted: readonly string[];
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
  readonly duplicateFiles: number;
  readonly unobserved: readonly string[];
  readonly missedFailures: readonly string[];
  readonly complete: boolean;
  readonly omittedDurationMs: number;
};
