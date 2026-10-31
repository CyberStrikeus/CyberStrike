import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

/**
 * Per-schema budget for compact output advertisements. Output contracts are
 * larger than input contracts across the catalog, and the complete frame is
 * what a frame-capped host rejects. Measured on the complete contract catalog
 * with the default compact input profile, 4 KiB bounds the output
 * advertisement to ~276 KiB and the complete `tools/list` response to
 * ~577 KiB, leaving margin under the one-megabyte frame reported in #2512. A
 * larger budget admits substantially more full contracts; a much smaller one
 * drops first-level property guidance for nearly every tool.
 */
export const COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES = 4 * 1024;

/** Select whether tools/list carries the large output contracts. */
export const mcpOutputSchemaProfileSchema = z.enum(["full", "compact", "off"]);

export type McpOutputSchemaProfile = z.infer<
  typeof mcpOutputSchemaProfileSchema
>;

/** Resolve the compact output advertisement, preserving every other choice. */
export const compactPresentationForMcpOutputSchemaProfile = (
  profile: McpOutputSchemaProfile | undefined,
): { readonly budgetBytes: number } | undefined =>
  profile === "compact"
    ? { budgetBytes: COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES }
    : undefined;

const profileConstraint =
  'REA_MCP_OUTPUT_SCHEMA_PROFILE must be "full" (default), "compact", or "off". The compact profile advertises every output schema within a 4,096-byte budget; the off profile omits output schemas. Both keep canonical server-side validation and complete structured content.';

/** Parse the output schema advertisement selection at server composition. */
export const parseMcpOutputSchemaProfile = (
  value: string | undefined,
): Result<McpOutputSchemaProfile | undefined, ConfigurationError> => {
  if (value === undefined) return ok(undefined);
  const parsed = mcpOutputSchemaProfileSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new ConfigurationError(profileConstraint, {
          settings: [
            {
              setting: "REA_MCP_OUTPUT_SCHEMA_PROFILE",
              constraint: profileConstraint,
            },
          ],
        }),
      );
};
