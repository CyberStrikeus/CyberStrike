import { z } from "zod";
import { digestSchema } from "../digests.js";
import { browserScenarioNetworkSummarySchema } from "./browserScenarioNetworkView.js";
import { sanitizedBrowserUrlSchema } from "../browserObservation.js";
import { retainedBrowserScenarioCaptureSchema } from "../browserScenarioCapture.js";
import {
  browserScenarioCompletenessSchema,
  browserScenarioEventKindSchema,
  browserScenarioEventSchema,
  browserStepArtifactsSchema,
} from "../browserScenarioCaptureValues.js";

export const ARTIFACT_SECTIONS = browserStepArtifactsSchema.keyof().options;
const artifactSectionSchema = browserStepArtifactsSchema.keyof();
export type ArtifactSection = z.infer<typeof artifactSectionSchema>;

const countSchema = z.number().int().nonnegative();
/** Section names by recorded state; not_requested sections are omitted. */
export const stepSectionsSchema = z.strictObject({
  captured: z.array(artifactSectionSchema),
  missing: z.array(artifactSectionSchema),
  truncated: z.array(artifactSectionSchema),
});

export const summaryStepSchema = z.strictObject({
  step_index: countSchema,
  step_id: z.string().min(1),
  action: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  error: z.string().nullable(),
  elapsed_ms: countSchema,
  before_url: sanitizedBrowserUrlSchema
    .exactOptional()
    .describe(
      "Present only when it differs from the previous step's after_url (always for step 0).",
    ),
  after_url: sanitizedBrowserUrlSchema,
  events: z.strictObject({
    sequence_start: z.number().int().min(1),
    sequence_end: countSchema,
  }),
  sections: stepSectionsSchema,
  completeness: z.enum(["complete", "incomplete", "truncated"]),
});

export const focusAccessibilitySchema = z.strictObject({
  focus_step_index: countSchema,
  focus: z.enum(["first-unsuccessful-step", "last-step"]),
  /** The step whose tree is returned: the focus step, or the nearest earlier step that captured one. */
  step_index: countSchema.nullable(),
  accessibility: browserStepArtifactsSchema.shape.accessibility,
});

/** Compact capture overview; complete records stay in the retained parent. */
export const browserScenarioSummarySchema = z.strictObject({
  browser: retainedBrowserScenarioCaptureSchema.shape.browser,
  scenario: retainedBrowserScenarioCaptureSchema.shape.scenario,
  duration_ms: countSchema,
  completeness: browserScenarioCompletenessSchema,
  steps: z.array(summaryStepSchema),
  final_accessibility: focusAccessibilitySchema,
  events: z.strictObject({
    retained: countSchema,
    dropped: countSchema,
    by_kind: z.array(
      z.strictObject({
        kind: browserScenarioEventKindSchema,
        count: countSchema,
      }),
    ),
    omissions: z.strictObject({
      by_kind:
        retainedBrowserScenarioCaptureSchema.shape.events.shape.omissions.shape
          .by_kind,
      network_transactions: countSchema,
      network_transaction_range:
        retainedBrowserScenarioCaptureSchema.shape.events.shape.omissions.shape
          .network_transaction_range,
    }),
  }),
  network: browserScenarioNetworkSummarySchema,
  limitation_count: countSchema.describe(
    "Number of parent Evidence limitations returned with this summary, including inherited provenance caveats.",
  ),
});

const pageShape = {
  kind: z.literal("browser-scenario"),
  offset: countSchema.default(0),
  limit: z.int().positive().default(64),
};
const stepSelection = {
  step_indices: z
    .array(countSchema)
    .optional()
    .describe(
      "Exact recorded step indices; omitted selects all, [] selects none.",
    ),
};
const transactionSelection = {
  transaction_ids: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Exact recorded transaction IDs; omitted selects all, [] selects none.",
    ),
};

/** Collection-specific fields are validated rather than silently ignored. */
export const browserScenarioViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...pageShape,
      ...stepSelection,
      collection: z.literal("steps"),
      artifacts: z
        .array(artifactSectionSchema)
        .default([])
        .describe(
          "Return only selected artifact payloads; omitted_artifacts names the other recorded sections.",
        ),
    }),
    z.strictObject({
      ...pageShape,
      ...stepSelection,
      ...transactionSelection,
      collection: z.literal("events"),
      event_kinds: z
        .array(browserScenarioEventKindSchema)
        .optional()
        .describe("Omitted selects all event kinds; [] selects none."),
    }),
    z.strictObject({
      ...pageShape,
      ...stepSelection,
      ...transactionSelection,
      collection: z.literal("transactions"),
      event_kinds: z
        .array(browserScenarioEventKindSchema)
        .default([
          "request",
          "response",
          "request-finished",
          "request-failed",
          "request-unfinished",
        ])
        .describe(
          "Metadata events by default; select network-content explicitly for bodies and header values. [] returns identity and source indices only.",
        ),
    }),
    z.strictObject({
      ...pageShape,
      collection: z.literal("text"),
      step_index: countSchema,
      artifact: z.enum(["accessibility", "dom"]),
      limit: z
        .int()
        .positive()
        .default(2048)
        .describe("Caller-selected UTF-16 code units, matching offset."),
    }),
  ],
);
export type BrowserScenarioViewRequest = z.output<
  typeof browserScenarioViewRequestSchema
>;

/** One exact step whose unselected captured sections are named rather than returned. */
export const stepRowSchema = z.strictObject({
  step_index: countSchema,
  step_id: z.string().min(1),
  action: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  error: z.string().nullable(),
  elapsed_ms: countSchema,
  before_url: sanitizedBrowserUrlSchema,
  after_url: sanitizedBrowserUrlSchema,
  event_sequence_start: z.number().int().min(1),
  event_sequence_end: countSchema,
  completeness: browserScenarioCompletenessSchema,
  artifacts: browserStepArtifactsSchema.partial(),
  omitted_artifacts: z.array(
    z.strictObject({
      section: artifactSectionSchema,
      state: z.enum(["captured", "missing", "truncated"]),
    }),
  ),
});
const eventRowSchema = z.strictObject({
  item_index: countSchema,
  event: browserScenarioEventSchema,
});

export const browserScenarioViewItemsSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      collection: z.literal("steps"),
      rows: z.array(stepRowSchema),
    }),
    z.strictObject({
      collection: z.literal("events"),
      rows: z.array(eventRowSchema),
    }),
    z.strictObject({
      collection: z.literal("transactions"),
      rows: z.array(
        z.strictObject({
          transaction_id: z.string().min(1),
          source_item_indices: z.array(countSchema),
          events: z.array(eventRowSchema),
          omitted_events: z.array(
            z.strictObject({
              item_index: countSchema,
              kind: browserScenarioEventKindSchema,
            }),
          ),
        }),
      ),
    }),
    z.strictObject({
      collection: z.literal("text"),
      step_index: countSchema,
      artifact: z.enum(["accessibility", "dom"]),
      state: z.enum(["captured", "missing", "truncated", "not_requested"]),
      reason: z.string().nullable(),
      sha256: digestSchema.nullable(),
      bytes: countSchema.nullable(),
      observed: countSchema.nullable(),
      retained: countSchema.nullable(),
      text: z.string().nullable(),
    }),
  ],
);

/** Capture-wide facts every page repeats so exhaustion is not read as completeness. */
export const browserScenarioViewContextSchema = z.strictObject({
  source_completeness: browserScenarioCompletenessSchema,
  source_events: z.strictObject({
    retained: countSchema,
    dropped: countSchema,
  }),
  source_network_omissions: z.strictObject({
    transactions: countSchema,
    transaction_range:
      retainedBrowserScenarioCaptureSchema.shape.events.shape.omissions.shape
        .network_transaction_range,
  }),
});
