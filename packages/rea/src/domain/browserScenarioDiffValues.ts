import { z } from "zod";

import { retainedBrowserScenarioCaptureSchema } from "./browserScenarioCapture.js";

/** Scenario artifact families compared after step alignment. */
export const browserScenarioArtifactKindSchema = z.enum([
  "action_state",
  "screenshot",
  "dom",
  "accessibility",
  "url",
  "history",
  "storage",
  "events",
]);
/** Scenario artifact family. */
export type BrowserScenarioArtifactKind = z.infer<
  typeof browserScenarioArtifactKindSchema
>;

const normalizableArtifactKindSchema = z.enum([
  "action_state",
  "dom",
  "accessibility",
  "url",
  "history",
  "storage",
  "events",
]);

const normalizationRuleSchema = z.strictObject({
  rule_id: z
    .string()
    .trim()
    .min(1)
    .describe("Stable rule identity; rules execute in rule_id order."),
  artifacts: z
    .array(normalizableArtifactKindSchema)
    .min(1)
    .describe("Artifact families whose durable string fields use this rule."),
  match: z
    .string()
    .min(1)
    .describe(
      "Exact public literal to replace; regular expressions are not used.",
    ),
  replacement: z
    .string()
    .describe("Recorded replacement text used in normalized comparison."),
});

const normalizationInputSchema = z
  .strictObject({
    rules: z.array(normalizationRuleSchema).default([]),
  })
  .superRefine((normalization, context) => {
    const ruleIds = new Set<string>();
    for (const [index, rule] of normalization.rules.entries()) {
      if (ruleIds.has(rule.rule_id))
        context.addIssue({
          code: "custom",
          path: ["rules", index, "rule_id"],
          message: "Normalization rule IDs must be unique",
        });
      ruleIds.add(rule.rule_id);
      if (new Set(rule.artifacts).size !== rule.artifacts.length)
        context.addIssue({
          code: "custom",
          path: ["rules", index, "artifacts"],
          message: "Normalization rule artifact kinds must be unique",
        });
    }
  });

/** Input for step-aligned comparison of two browser scenario captures. */
export const compareBrowserScenariosInputSchema = z.strictObject({
  before_scenario: retainedBrowserScenarioCaptureSchema
    .describe(
      "Earlier complete normalized_result from capture_browser_scenario.",
    )
    .meta({ "x-rea-complete-observation": true }),
  after_scenario: retainedBrowserScenarioCaptureSchema
    .describe("Later complete normalized_result from capture_browser_scenario.")
    .meta({ "x-rea-complete-observation": true }),
  normalization: normalizationInputSchema
    .default({ rules: [] })
    .describe("Exact-literal rules committed in the comparison result."),
});
/** Parsed browser scenario comparison input. */
export type CompareBrowserScenariosInput = z.infer<
  typeof compareBrowserScenariosInputSchema
>;

const evidenceStateSchema = z.enum([
  "captured",
  "not_requested",
  "missing",
  "truncated",
]);

const artifactDiffSchema = z.strictObject({
  artifact: browserScenarioArtifactKindSchema,
  status: z.enum(["changed", "unknown"]),
  before_state: evidenceStateSchema,
  after_state: evidenceStateSchema,
  before_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  after_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  reason: z.string().min(1).nullable(),
});
const alignmentFailureSchema = z.strictObject({
  code: z.enum([
    "duplicate_before_step_id",
    "duplicate_after_step_id",
    "missing_before_step",
    "missing_after_step",
    "action_mismatch",
    "capture_context_mismatch",
  ]),
  step_id: z.string().min(1).nullable(),
  reason: z.string().min(1),
});
export const BROWSER_SCENARIO_BUILT_IN_NORMALIZATION_RULES = [
  "ignore_step_elapsed_ms",
  "ignore_event_sequence",
  "ignore_event_step_index",
  "compare_screenshot_content_digest",
  "compare_normalized_text_content",
  "compare_storage_entries_as_unordered_collection",
  "ignore_capture_local_network_transaction_ids",
  "ignore_network_request_timing",
  "attribute_network_transactions_to_request_step",
  "compare_network_transactions_as_unordered_collection",
  "preserve_redirect_transaction_ancestry",
] as const;
const builtInNormalizationSchema = z.enum(
  BROWSER_SCENARIO_BUILT_IN_NORMALIZATION_RULES,
);

/** Step alignment, recorded normalization, and inline artifact differences. */
export const browserScenarioDiffSchema = z.strictObject({
  comparison_kind: z.literal("browser_scenario"),
  overall_status: z.enum(["changed", "unchanged", "unknown"]),
  normalization: z.strictObject({
    built_in_rules: z
      .array(builtInNormalizationSchema)
      .length(BROWSER_SCENARIO_BUILT_IN_NORMALIZATION_RULES.length),
    rules: z.array(normalizationRuleSchema),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  alignment: z.strictObject({
    status: z.enum(["aligned", "partial", "failed"]),
    aligned_steps: z.int().min(0),
    before_only: z.array(z.string().min(1)),
    after_only: z.array(z.string().min(1)),
    failures: z.array(alignmentFailureSchema),
  }),
  steps: z.array(
    z.strictObject({
      step_id: z.string().min(1),
      before_step_index: z.int().min(0),
      after_step_index: z.int().min(0),
      before_action: z.string().min(1),
      after_action: z.string().min(1),
      status: z.enum(["changed", "unchanged", "unknown"]),
      artifact_diffs: z.array(artifactDiffSchema),
    }),
  ),
  artifact_diffs: z.strictObject({
    total: z.int().min(0),
  }),
  limitations: z.array(z.string().min(1)),
});
/** Browser scenario comparison result. */
export type BrowserScenarioDiff = z.infer<typeof browserScenarioDiffSchema>;
/** Reportable changed or unknown scenario artifact. */
export type BrowserScenarioArtifactDiff =
  BrowserScenarioDiff["steps"][number]["artifact_diffs"][number];
/** One explicit reason scenario step alignment was not exact. */
export type BrowserScenarioAlignmentFailure =
  BrowserScenarioDiff["alignment"]["failures"][number];
/** Comparable capture state. */
export type BrowserScenarioEvidenceState =
  BrowserScenarioArtifactDiff["before_state"];
/** Scenario normalization policy after boundary parsing. */
export type BrowserScenarioNormalization =
  CompareBrowserScenariosInput["normalization"];
/** One exact literal scenario normalization rule. */
export type BrowserScenarioNormalizationRule =
  BrowserScenarioNormalization["rules"][number];
