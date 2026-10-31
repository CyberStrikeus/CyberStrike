import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

// Moonshot's function-calling API rejects requests while any single tool
// parameters schema exceeds its literal serialized size cap. Community
// measurements bound the cap between ~13.7 KB (accepted) and ~15 KB
// (rejected); 13 KiB leaves margin under the lower bound. See
// https://github.com/morluto/rea/issues/1484 for the measured evidence.
export const COMPACT_INPUT_SCHEMA_BUDGET_BYTES = 13 * 1024;

export const mcpInputSchemaProfileSchema = z.enum(["full", "compact"]);

/** Resolve the selected advertisement at the configuration boundary. */
export const resolveMcpInputSchemaProfile = (
  profile: McpInputSchemaProfile | undefined,
): McpInputSchemaProfile => profile ?? "compact";

/** Select the default compact advertisement, preserving an explicit full choice. */
export const compactPresentationForMcpInputSchemaProfile = (
  profile: "full" | "compact" | undefined,
): { readonly budgetBytes: number } | undefined =>
  resolveMcpInputSchemaProfile(profile) === "full"
    ? undefined
    : { budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES };

const profileConstraint =
  'REA_MCP_INPUT_SCHEMA_PROFILE must be "compact" (default) or "full". The compact profile advertises bounded input schemas with fewer nested annotations; full preserves complete advertised input guidance.';

export type McpInputSchemaProfile = z.infer<typeof mcpInputSchemaProfileSchema>;

/** Parse the advertised input schema presentation selection. */
export const parseMcpInputSchemaProfile = (
  value: string | undefined,
): Result<McpInputSchemaProfile | undefined, ConfigurationError> => {
  if (value === undefined) return ok(undefined);
  const parsed = mcpInputSchemaProfileSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new ConfigurationError(profileConstraint, {
          settings: [
            {
              setting: "REA_MCP_INPUT_SCHEMA_PROFILE",
              constraint: profileConstraint,
            },
          ],
        }),
      );
};
