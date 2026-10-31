import { z } from "zod";

import {
  isToolFamilyId,
  TOOL_FAMILY_IDS,
  type ToolFamilyId,
} from "../contracts/toolFamilyIds.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

// Agents pay context for every advertised tool schema. Scoping a registration
// to the families a workflow needs keeps the unneeded schemas out of the
// session entirely; out-of-scope tools stay registered but disabled.
export const toolFamiliesConstraint = `REA_MCP_TOOL_FAMILIES must be a non-empty comma-separated subset of the tool family ids: ${TOOL_FAMILY_IDS.join(", ")}.`;

// The enum drives the output type so the parsed result retains the published
// family ids; the non-empty guard preserves the constraint message.
const toolFamilyIdSchema = z.enum(TOOL_FAMILY_IDS);

export const mcpToolFamiliesSchema = z
  .string()
  .transform((value) => [
    ...new Set(
      value
        .split(",")
        .map((family) => family.trim())
        .filter((family) => family !== ""),
    ),
  ])
  .refine(
    (families) => families.length > 0 && families.every(isToolFamilyId),
    toolFamiliesConstraint,
  )
  .transform((families): ToolFamilyId[] =>
    families.map((family) => toolFamilyIdSchema.parse(family)),
  );

export type McpToolFamilies = z.infer<typeof mcpToolFamiliesSchema>;

/** Parse the advertised tool-family scope without loading the server. */
export const parseMcpToolFamilies = (
  value: string | undefined,
): Result<McpToolFamilies | undefined, ConfigurationError> => {
  if (value === undefined) return ok(undefined);
  const parsed = mcpToolFamiliesSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new ConfigurationError(toolFamiliesConstraint, {
          settings: [
            {
              setting: "REA_MCP_TOOL_FAMILIES",
              constraint: toolFamiliesConstraint,
            },
          ],
        }),
      );
};
