import type { AnalysisProviderSelector } from "./domain/providerSelection.js";
import {
  mcpPhaseBudgetRecovery,
  type McpPhaseBudget,
} from "./config/mcpStartupBudgets.js";

/**
 * Client startup guidance, operation headroom, and doctor output retention.
 * REA startup phase deadlines belong to config/mcpStartupBudgets; consumers
 * resolve them from the selected environment with resolveMcpStartupBudgets.
 */
export const MCP_STARTUP_POLICY = {
  codexStartupTimeoutSeconds: 30,
  kimiStartupTimeoutMs: 30_000,
  toolOperationHeadroomMs: 120_000,
  doctorStderrBytes: 64 * 1024,
} as const;

/** Doctor startup recovery. The Codex figure is client guidance REA does not enforce. */
export const mcpDoctorDeadlineRecovery = (budget: McpPhaseBudget): string =>
  `${mcpPhaseBudgetRecovery(budget)} Codex startup_timeout_sec of ${String(MCP_STARTUP_POLICY.codexStartupTimeoutSeconds)} seconds is client guidance; REA does not enforce that figure as this deadline.`;

/** Parsed startup and upstream request budgets affecting a client's tool deadline. */
export interface McpToolTimeoutInputs {
  readonly analysisProvider: AnalysisProviderSelector;
  readonly ghidraStartupTimeoutMs: number;
  /** One configured Ghidra decompile allowance; bulk cardinality is unknown here. */
  readonly ghidraDecompileTimeoutMs?: number;
  readonly hopperStartupTimeoutMs: number;
  readonly jebMcpTimeoutMs?: number;
  readonly providerRequestTimeoutMs?: number;
}

/** Allow for known startup phases and caller-selected upstream request budgets. */
export const mcpProviderDeadlineAllowanceMs = (
  inputs: McpToolTimeoutInputs,
): number => {
  const selectedProvider = inputs.analysisProvider;
  // A bounded decompile can run right after a cold import in the same call.
  const ghidraAllowance =
    inputs.ghidraStartupTimeoutMs + (inputs.ghidraDecompileTimeoutMs ?? 0);
  const selectedTimeout =
    selectedProvider === "ghidra"
      ? ghidraAllowance
      : selectedProvider === "hopper"
        ? inputs.hopperStartupTimeoutMs
        : Math.max(ghidraAllowance, inputs.hopperStartupTimeoutMs);
  return Math.max(
    selectedTimeout,
    inputs.jebMcpTimeoutMs ?? 0,
    inputs.providerRequestTimeoutMs ?? 0,
  );
};

/** Add headroom to the single-request estimate; this is not a bulk-workflow bound. */
export const recommendedMcpToolTimeoutMs = (
  inputs: McpToolTimeoutInputs,
): number =>
  mcpProviderDeadlineAllowanceMs(inputs) +
  MCP_STARTUP_POLICY.toolOperationHeadroomMs;

/** Round up so Codex's whole-second deadline still covers the millisecond budget. */
export const recommendedMcpToolTimeoutSeconds = (
  inputs: McpToolTimeoutInputs,
): number => Math.ceil(recommendedMcpToolTimeoutMs(inputs) / 1000);
