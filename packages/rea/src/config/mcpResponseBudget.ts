import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

// This override supports clients with larger frames. Keep the configuration
// parser independent of the SDK's eager server imports; conformance verifies
// this floor against the pinned SDK's actual default receive-buffer size.
export const MINIMUM_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Facts for a completed or failed MCP result that exceeded the stdio receive
 * budget. The effective value is the configured receive buffer, including the
 * envelope reservation. REA's reserved string limit is separate from, and
 * lower than, Node's single-string ceiling. This setting raises neither.
 */
export const stdioResponseBudgetRecovery = (
  effectiveResponseBytes: number,
  reservedStringCodeUnits: number,
  nodeStringCeilingCodeUnits: number,
): string =>
  `The effective REA_MCP_MAX_RESPONSE_BYTES value is ${String(effectiveResponseBytes)} bytes (floor ${String(MINIMUM_RESPONSE_BYTES)} bytes, 10 MiB). A change requires restarting the REA process and a matching client receive buffer. It does not raise REA's reserved single-string limit of ${String(reservedStringCodeUnits)} UTF-16 code units or Node's single-string ceiling of ${String(nodeStringCeilingCodeUnits)} UTF-16 code units. This release has no runtime override for either limit.`;

/**
 * Facts for a result that exceeded REA's reserved string limit.
 * `reservedStringCodeUnits` is that REA limit. `nodeStringCeilingCodeUnits`
 * is Node's own ceiling and is not the same number.
 */
export const nodeStringCeilingRecovery = (
  reservedStringCodeUnits: number,
  nodeStringCeilingCodeUnits: number,
): string =>
  `REA's reserved single-string limit is ${String(reservedStringCodeUnits)} UTF-16 code units, below Node's single-string ceiling of ${String(nodeStringCeilingCodeUnits)} UTF-16 code units. This release has no runtime override for either limit, and REA_MCP_MAX_RESPONSE_BYTES does not raise them.`;

/** Optional stdio response budget, including room for the protocol envelope. */
export const mcpResponseBudgetSchema = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.int().safe().min(MINIMUM_RESPONSE_BYTES));

const budgetConstraint = `REA_MCP_MAX_RESPONSE_BYTES must be a decimal safe integer at least ${String(MINIMUM_RESPONSE_BYTES)} bytes, the default stdio receive-buffer size.`;

/** Parse only the MCP-specific budget without loading unrelated provider settings. */
export const parseMcpResponseBudget = (
  value: string | undefined,
): Result<number | undefined, ConfigurationError> => {
  if (value === undefined) return ok(undefined);
  const parsed = mcpResponseBudgetSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new ConfigurationError(budgetConstraint, {
          settings: [
            {
              setting: "REA_MCP_MAX_RESPONSE_BYTES",
              constraint: budgetConstraint,
            },
          ],
        }),
      );
};
