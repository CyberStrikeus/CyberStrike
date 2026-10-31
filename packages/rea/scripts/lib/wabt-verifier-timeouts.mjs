// A single inspection can include native admission plus several WABT commands.
// The aggregate verifier covers seven complete fixtures and their failure paths.
export const WABT_OPERATION_TIMEOUT_MS = 4 * 60_000;
export const WABT_WORKFLOW_TIMEOUT_MS = 15 * 60_000;
