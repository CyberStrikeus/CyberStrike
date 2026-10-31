/** Preserve an unexpected JSON result while describing the failed plan check. */
export function setupPlanFailureMessage(options: {
  readonly planned: unknown;
  readonly plannedExecution: { readonly status: number | null };
  readonly plannedClaudeConfig: string;
  readonly plannedCodexConfig: string;
  readonly plannedCursorConfig: string;
}): string;
