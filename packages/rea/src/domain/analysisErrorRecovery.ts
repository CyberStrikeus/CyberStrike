import { z } from "zod";

/**
 * Small, bounded next-step metadata for agent-facing analysis failures.
 *
 * The prose recovery remains in `remediation.action`; these fields give a
 * caller a stable way to choose the next inspection without embedding a tool
 * catalog or caller arguments in every error.
 */
export type AnalysisErrorRecovery =
  | {
      readonly kind: "inspect_input_contract";
      readonly operation: string;
    }
  | {
      readonly kind: "inspect_timeout_state";
      readonly operation: string;
      readonly timeout_ms: number;
    };

export const analysisErrorRecoverySchema: z.ZodType<AnalysisErrorRecovery> =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("inspect_input_contract"),
        operation: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("inspect_timeout_state"),
        operation: z.string().min(1),
        timeout_ms: z.number().int().positive(),
      })
      .strict(),
  ]);
