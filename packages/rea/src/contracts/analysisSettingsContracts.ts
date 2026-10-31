import { analysisErrorProjectionSchema } from "./errorSchemas.js";
import { z } from "zod";
import {
  analysisSettingIds,
  analysisSettingIdSchema,
  analysisSettingValueSchema,
} from "../domain/analysisSettingDefinitions.js";
import { toolContractMetadata } from "./toolEffects.js";
import type { ToolContract } from "./toolContractTypes.js";

export const inspectAnalysisSettingsInputSchema = z.strictObject({
  settings: z
    .array(analysisSettingIdSchema)
    .max(analysisSettingIds.length)
    .optional(),
  operation: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
});
export const updateAnalysisSettingsInputSchema = z.strictObject({
  changes: z
    .array(
      z.union([
        ...analysisSettingIds.map((setting) =>
          z.strictObject({
            setting: z.literal(setting),
            action: z.literal("set"),
            value: analysisSettingValueSchema(setting),
          }),
        ),
        z.strictObject({
          setting: analysisSettingIdSchema,
          action: z.literal("reset"),
        }),
      ]),
    )
    .min(1)
    .max(analysisSettingIds.length),
  expected_revision: z.number().int().nonnegative().optional(),
});
const descriptor = z.strictObject({
  setting: analysisSettingIdSchema,
  value: z.number().nullable().optional(),
  launch_value: z.number().nullable().optional(),
  default_value: z.number().nullable(),
  source: z.enum(["default", "setting", "runtime", "invalid"]),
  configuration_error: analysisErrorProjectionSchema.optional(),
  unit: z.enum(["bytes", "ms", "seconds", "MiB"]),
  minimum: z.number(),
  maximum: z.number(),
  applies_at: z.enum(["next_operation", "next_worker", "next_startup"]),
  provider: z.string(),
  operations: z.array(z.string()),
  environment: z.string().optional(),
  parameter: z.string().optional(),
  agent_editable: z.literal(true),
});
export const analysisSettingsResultSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  scope: z.literal("rea-runtime"),
  active_values: z.strictObject({ status: z.literal("not_observed") }),
  settings: z.array(descriptor),
  constraints: z
    .array(
      z.strictObject({
        control: z.string(),
        authority: z.enum(["operator", "external", "fixed"]),
        value: z.number().nullable(),
        unit: z.string(),
        observation: z.enum(["known", "unknown"]),
        recovery: z.string(),
      }),
    )
    .optional(),
});
export const updateAnalysisSettingsResultSchema =
  analysisSettingsResultSchema.extend({
    changed: z.boolean(),
    changes: z.array(
      z.strictObject({
        setting: analysisSettingIdSchema,
        old_value: z.number().nullable().optional(),
        new_value: z.number().nullable().optional(),
      }),
    ),
    active_work_changed: z.literal(false),
    rea_restart_required: z.literal(false),
  });
export const ANALYSIS_SETTINGS_TOOL_CONTRACTS = [
  {
    name: "inspect_analysis_settings",
    ...toolContractMetadata("inspect_analysis_settings"),
    kind: "application",
    description:
      "Inspect REA's editable runtime admission sizes, deadlines and worker heaps, their bounds, launch values and application points. No active target is required. Filters intersect. If an error already names a setting and its bounds, update_analysis_settings can be called directly. Explicit per-call arguments override runtime defaults. Active worker values are not observed by this configuration view.",
    inputSchema: inspectAnalysisSettingsInputSchema,
    outputSchema: analysisSettingsResultSchema,
    examples: [
      {
        title: "Inspect archive header admission",
        input: { settings: ["asar.max_header_bytes"] },
      },
    ],
  },
  {
    name: "update_analysis_settings",
    ...toolContractMetadata("update_analysis_settings"),
    kind: "application",
    description:
      "When REA names an adjustable limit, atomically set or reset its runtime default, then retry once work and cleanup have settled. No inspection call is required when the error supplies the bounds. Changes apply only to new work, survive target close/open, and disappear on REA restart. Reset restores launch configuration. Does not edit files, restart providers, raise host limits, or override explicit per-call arguments.",
    inputSchema: updateAnalysisSettingsInputSchema,
    outputSchema: updateAnalysisSettingsResultSchema,
    examples: [
      {
        title: "Raise ASAR header admission for a retry",
        input: {
          changes: [
            {
              setting: "asar.max_header_bytes",
              action: "set",
              value: 33554432,
            },
          ],
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
