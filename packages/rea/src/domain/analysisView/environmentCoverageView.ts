import { z } from "zod";
import { ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { templateRulesSchema } from "./environmentManifestView.js";
import type { StateView } from "./environmentStateRules.js";
import {
  createEnvironmentStateAccumulator,
  environmentStateFields,
  projectEnvironmentStateView,
} from "./environmentStateView.js";
import type {
  StateWritePlan,
  WriteEffect,
  WriteReason,
} from "./environmentStateWriteRules.js";

export const environmentCoverageViewRequestSchema = z.strictObject({
  kind: z.literal("environment-coverage"),
  template_rules: templateRulesSchema.describe(
    "Opt-in template rules as for environment-manifest, each listed at most once. Use the rules of the manifest the environment serves so tool names match.",
  ),
});

/** What to record next for each reason a write tool is withheld; advice only, it never changes what is served. */
export const WITHHELD_WRITE_HINTS = {
  "no-state-target":
    "The write could not be linked to a modelled state target. Check its path template and the recorded collection or item views; if the relevant reads are missing, record them. Some route forms may not be supported as mutation targets.",
  "no-call":
    "No recorded call of this tool was modelled, for example because every call failed. Record a successful call.",
  "body-unusable":
    "The retained request or response cannot be modelled. Record a successful call with a complete supported request and reproducible response.",
  "no-observation":
    "Nothing showed the entity or document this write changed. Read a created entity back by id right after the write; for an update or delete the state must already hold the entity, so read it before the write or record the create that made it.",
  "unexplained-change":
    "The write changed fields it did not send, in a way no rule explains. A second, different call of the same tool can show the pattern.",
  contradicted:
    "A later read disagreed with the modelled effect. Check the read at contradicted_by.",
  "side-effect":
    "The write changed something besides its own entity, which the environment does not model.",
  unconfirmed:
    "No later read showed the effect. Read the entity and its list after the write.",
  "incomplete-entities":
    "The write is confirmed, but the views that show its entity cannot render it in full. Read the written entity through every view that lists it.",
  "unknown-clock":
    "The write's learned rules generate timestamps, but the capture establishes no global served clock start. Record usable start times and completed durations for every request.",
} as const satisfies Record<WriteReason, string>;

const writeReasons = Object.keys(WITHHELD_WRITE_HINTS) as [
  WriteReason,
  ...WriteReason[],
];
const effectSchema = z.enum(["create", "update", "delete", "document", "none"]);
const ordinalSchema = z.number().int().nonnegative();

/** Which tools an environment answers from its state, which replay their recordings, and why each write is withheld. */
export const environmentCoverageSchema = z.strictObject({
  reads: z.strictObject({
    state: z
      .number()
      .int()
      .nonnegative()
      .describe("Read tools answered from the state."),
    recorded: z
      .number()
      .int()
      .nonnegative()
      .describe("Read tools that replay their recordings."),
    recorded_reasons: z
      .record(z.string(), z.number().int().positive())
      .describe(
        "Replayed read tools per reason, as the environment-state view names the reasons.",
      ),
  }),
  writes: z.strictObject({
    served: z.array(z.strictObject({ tool: z.string(), effect: effectSchema })),
    withheld: z.array(
      z.strictObject({
        tool: z.string(),
        effect: effectSchema,
        reason: z.enum(writeReasons),
        hint: z
          .string()
          .describe(
            "What to record next; advice that never changes what is served.",
          ),
        exemplar_ordinal: ordinalSchema
          .nullable()
          .describe(
            "The first successful recorded call the plan was built from.",
          ),
        contradicted_by: ordinalSchema
          .nullable()
          .describe("The read that disagreed with the modelled effect."),
      }),
    ),
  }),
});

export type EnvironmentCoverage = z.infer<typeof environmentCoverageSchema>;

export const environmentCoverageFields = {
  origin: environmentStateFields.origin,
  name: environmentStateFields.name,
  ...environmentCoverageSchema.shape,
  unknowns: environmentStateFields.unknowns,
};

/** Summarize a state's read views and write plans as served, replayed and withheld tools. */
export const summarizeEnvironmentCoverage = (state: {
  readonly views: Iterable<StateView>;
  readonly writes: Iterable<StateWritePlan>;
}): EnvironmentCoverage => {
  let answered = 0;
  let recorded = 0;
  const reasons: Record<string, number> = {};
  for (const view of state.views)
    if (view.shape === "recorded") {
      recorded++;
      reasons[view.reason] = (reasons[view.reason] ?? 0) + 1;
    } else answered++;
  const served: { tool: string; effect: WriteEffect }[] = [];
  const withheld: EnvironmentCoverage["writes"]["withheld"] = [];
  for (const plan of state.writes)
    if (plan.served || plan.reason === null)
      served.push({ tool: plan.tool, effect: plan.effect });
    else
      withheld.push({
        tool: plan.tool,
        effect: plan.effect,
        reason: plan.reason,
        hint: WITHHELD_WRITE_HINTS[plan.reason],
        exemplar_ordinal: plan.exemplar_ordinal,
        contradicted_by: plan.contradicted_by,
      });
  return {
    reads: {
      state: answered,
      recorded,
      recorded_reasons: Object.fromEntries(
        Object.entries(reasons).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      ),
    },
    writes: { served, withheld },
  };
};

/** Project the state an environment would serve and summarize which tools it answers from that state. */
export const projectEnvironmentCoverageView = (
  parent: AnalysisViewParent,
  view: z.output<typeof environmentCoverageViewRequestSchema>,
  accumulator = createEnvironmentStateAccumulator(view),
) => {
  const projected = projectEnvironmentStateView(
    parent,
    { kind: "environment-state" as const, template_rules: view.template_rules },
    accumulator,
  );
  if (!projected.ok) return projected;
  const state = projected.value;
  return ok({
    kind: "environment-coverage" as const,
    view,
    parent_evidence_id: state.parent_evidence_id,
    parent_operation: state.parent_operation,
    parent_digest: state.parent_digest,
    artifact: state.artifact,
    coverage: state.coverage,
    limitations: [
      ...state.limitations,
      "Coverage summarizes the environment-state view an environment derives at startup; it does not run the environment. An environment whose served catalog exceeds the discovery budget, or whose state exceeds what data/add loads, serves replay instead, which this view does not check. Hints are advice about what to record next.",
      ...(state.timeline === "record-order"
        ? [
            "Not every record carries a start time, so the state learns no clock: a write whose response changes a timestamp the server sets, such as a modification time, is withheld as unexplained-change however often it is recorded.",
          ]
        : []),
    ],
    unknowns: state.unknowns,
    origin: state.origin,
    name: state.name,
    ...summarizeEnvironmentCoverage(state),
  });
};
