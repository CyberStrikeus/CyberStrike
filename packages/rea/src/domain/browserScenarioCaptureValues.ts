import { createHash } from "node:crypto";

import { z } from "zod";
import { utcDateTimeSchema } from "./offsetDateTime.js";

import { emptyArraySchema } from "./emptyArraySchema.js";
import {
  browserNetworkBodySchema,
  browserNetworkHeadersSchema,
} from "./browserNetworkEvidence.js";
import { sanitizedBrowserUrlSchema } from "./browserObservation.js";
import { webScreenshotArtifactSchema } from "./webScreenshot.js";
import { digestSchema } from "./../domain/digests.js";

const textArtifactSchema = z
  .strictObject({
    sha256: digestSchema,
    bytes: z.int().min(0),
    text: z.string(),
  })
  .superRefine((artifact, context) => {
    const bytes = Buffer.from(artifact.text);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.bytes || sha256 !== artifact.sha256)
      context.addIssue({
        code: "custom",
        message: "Text artifact digest or size mismatch",
      });
  });

export const captureStateSchema = <Schema extends z.ZodType>(value: Schema) =>
  z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("captured"), value }),
    z.strictObject({
      state: z.literal("not_requested"),
    }),
    z.strictObject({
      state: z.literal("missing"),
      reason: z.string().min(1),
    }),
    z.strictObject({
      state: z.literal("truncated"),
      observed: z.int().min(0),
      retained: z.int().min(0),
      reason: z.string().min(1),
    }),
  ]);

const historySchema = z.strictObject({
  length: z.int().min(0),
  current_url: sanitizedBrowserUrlSchema,
  navigation_entries: z.array(
    z.strictObject({
      type: z.enum([
        "navigate",
        "reload",
        "back_forward",
        "prerender",
        "unknown",
      ]),
      name: sanitizedBrowserUrlSchema,
    }),
  ),
});

const hashedStorageValueShape = {
  value_state: z.literal("hashed"),
  value_sha256: digestSchema,
};
const redactedStorageValueShape = {
  value_state: z.literal("redacted-secret"),
  value_sha256: z.null(),
};
const storageValueFingerprintSchema = z.discriminatedUnion("value_state", [
  z.strictObject(hashedStorageValueShape),
  z.strictObject(redactedStorageValueShape),
]);
export type BrowserStorageValueFingerprint = z.infer<
  typeof storageValueFingerprintSchema
>;

const storageValueSchema = z.discriminatedUnion("value_state", [
  z.strictObject({
    name: z.string(),
    ...hashedStorageValueShape,
  }),
  z.strictObject({
    name: z.string(),
    ...redactedStorageValueShape,
  }),
]);

const cookieShape = {
  name: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  http_only: z.boolean(),
  same_site: z.enum(["Strict", "Lax", "None"]),
};

/** UTF-8 for well-formed strings; raw 0xff + UTF-16LE otherwise. */
export const BROWSER_STORAGE_FINGERPRINT_VERSION = 2;

const storageSnapshotSchema = z.strictObject({
  // Absence retains the legacy, lossy UTF-8 interpretation.
  fingerprint_version: z
    .literal(BROWSER_STORAGE_FINGERPRINT_VERSION)
    .optional(),
  cookies: z.array(
    z.discriminatedUnion("value_state", [
      z.strictObject({ ...cookieShape, ...hashedStorageValueShape }),
      z.strictObject({ ...cookieShape, ...redactedStorageValueShape }),
    ]),
  ),
  local_storage: z.array(storageValueSchema),
  session_storage: z.array(storageValueSchema),
});

export const browserStepArtifactsSchema = z.strictObject({
  screenshot: captureStateSchema(webScreenshotArtifactSchema),
  dom: captureStateSchema(textArtifactSchema),
  accessibility: captureStateSchema(textArtifactSchema),
  url: captureStateSchema(sanitizedBrowserUrlSchema),
  history: captureStateSchema(historySchema),
  storage: captureStateSchema(storageSnapshotSchema),
});
export type BrowserStepArtifacts = z.infer<typeof browserStepArtifactsSchema>;

/** Event families a scenario can select for capture. */
export const browserScenarioEventFamilySchema = z.enum([
  "console",
  "page-errors",
  "network",
  "websockets",
  "frames",
  "workers",
  "popups",
  "downloads",
]);
export type BrowserScenarioEventFamily = z.infer<
  typeof browserScenarioEventFamilySchema
>;

const eventBase = {
  sequence: z.int().min(1),
  step_index: z.int().min(0),
};

const eventUrl = sanitizedBrowserUrlSchema.nullable();
/** The browser's wall-clock request start, reported once the request ends. */
const browserStartSchema = utcDateTimeSchema
  .optional()
  .describe(
    "Wall-clock time the browser started the request, as it reported at completion; absent when it reported none.",
  );
/** Browser-reported time from the request start to the end of its response, when the browser reports one. */
const elapsedMsSchema = z
  .number()
  .nonnegative()
  .optional()
  .describe(
    "Milliseconds from the request start to the end of its response, as the browser timed it; absent when it reported none.",
  );
const networkEventShape = {
  ...eventBase,
  transaction_id: z.string().min(1),
  redirected_from_transaction_id: z.string().min(1).nullable(),
  /** Distinguishes a captured root from an unobserved predecessor for null links. */
  redirected_from_transaction_state: z.enum(["root", "unknown"]).optional(),
  method: z.string().min(1),
  url: sanitizedBrowserUrlSchema,
  resource_type: z.string().min(1),
  header_names: z.array(z.string()),
};
const webSocketFrameShape = {
  ...eventBase,
  kind: z.enum(["websocket-frame-sent", "websocket-frame-received"]),
  url: sanitizedBrowserUrlSchema,
  payload_bytes: z.int().min(0),
  truncated: z.boolean(),
};

export const browserScenarioEventSchema = z
  .union([
    z.strictObject({
      ...eventBase,
      kind: z.literal("console"),
      level: z.string().min(1),
      text: z.string(),
      url: eventUrl,
    }),
    z.strictObject({
      ...eventBase,
      kind: z.literal("page-error"),
      message: z.string(),
      stack: z.string().nullable(),
    }),
    z.strictObject({
      ...networkEventShape,
      kind: z.literal("request"),
      status: z.null(),
      failure: z.null(),
      observed_at: utcDateTimeSchema
        .optional()
        .describe(
          "Wall-clock time the provider observed the request start; absent in captures made before it was recorded.",
        ),
    }),
    z.strictObject({
      ...networkEventShape,
      kind: z.literal("response"),
      status: z.int().min(100).max(599),
      failure: z.null(),
    }),
    z.strictObject({
      ...networkEventShape,
      kind: z.literal("request-failed"),
      status: z.null(),
      failure: z.string().min(1),
      started_at: browserStartSchema,
      elapsed_ms: elapsedMsSchema,
    }),
    z.strictObject({
      ...networkEventShape,
      kind: z.literal("request-finished"),
      status: z.null(),
      failure: z.null(),
      started_at: browserStartSchema,
      elapsed_ms: elapsedMsSchema,
    }),
    z.strictObject({
      ...networkEventShape,
      kind: z.literal("request-unfinished"),
      status: z.null(),
      failure: z.null(),
      reason: z.enum(["capture-ended", "cancelled"]),
    }),
    z.strictObject({
      ...eventBase,
      kind: z.literal("network-content"),
      transaction_id: z.string().min(1),
      source_event_sequence: z.int().min(1),
      phase: z.enum(["request", "response"]),
      headers: browserNetworkHeadersSchema,
      body: browserNetworkBodySchema,
    }),
    z.strictObject({
      ...eventBase,
      kind: z.enum(["websocket-opened", "websocket-closed"]),
      url: sanitizedBrowserUrlSchema,
    }),
    z.strictObject({
      ...webSocketFrameShape,
      payload_type: z.literal("text"),
      payload_text: z.string(),
    }),
    z.strictObject({
      ...webSocketFrameShape,
      payload_type: z.literal("binary"),
      payload_text: z.null(),
    }),
    z.strictObject({
      ...eventBase,
      kind: z.enum([
        "frame-attached",
        "frame-detached",
        "frame-navigated",
        "worker-created",
        "worker-closed",
        "popup-opened",
        "popup-closed",
      ]),
      url: eventUrl,
      name: z.string().nullable(),
    }),
    z.strictObject({
      ...eventBase,
      kind: z.literal("download-cancelled"),
      suggested_filename: z.string(),
      url: sanitizedBrowserUrlSchema,
    }),
  ])
  .superRefine((event, context) => {
    if (
      "redirected_from_transaction_id" in event &&
      event.redirected_from_transaction_id !== null &&
      event.redirected_from_transaction_state !== undefined
    )
      context.addIssue({
        code: "custom",
        message:
          "Redirect state is valid only when the predecessor transaction ID is null",
        path: ["redirected_from_transaction_state"],
      });
  });
export type BrowserScenarioEvent = z.infer<typeof browserScenarioEventSchema>;

const completenessSectionSchema = z.enum([
  "action",
  "screenshot",
  "dom",
  "accessibility",
  "url",
  "history",
  "storage",
  "events",
  "frames",
  "workers",
  "popups",
  "websockets",
]);

export const browserScenarioEventKindSchema = z.enum([
  "console",
  "page-error",
  "request",
  "response",
  "request-failed",
  "request-finished",
  "request-unfinished",
  "network-content",
  "websocket-opened",
  "websocket-closed",
  "websocket-frame-sent",
  "websocket-frame-received",
  "frame-attached",
  "frame-detached",
  "frame-navigated",
  "worker-created",
  "worker-closed",
  "popup-opened",
  "popup-closed",
  "download-cancelled",
]);
export const browserScenarioEventBudgetReasonSchema = z.enum([
  "max-events",
  "max-event-allocation-bytes",
  "max-total-event-allocation-bytes",
  "max-network-transactions",
  "max-network-metadata-allocation-bytes",
  "max-listener-owners",
]);
export const browserScenarioEventOmissionsSchema = z.strictObject({
  by_kind: z.array(
    z.strictObject({
      kind: browserScenarioEventKindSchema,
      count: z.int().positive(),
      reasons: z.array(browserScenarioEventBudgetReasonSchema).min(1),
    }),
  ),
  network_transactions: z.array(
    z.strictObject({
      transaction_id: z.string().min(1),
      omitted_kinds: z.array(browserScenarioEventKindSchema).min(1),
      reasons: z.array(browserScenarioEventBudgetReasonSchema).min(1),
    }),
  ),
  network_transaction_range: z
    .strictObject({
      first_transaction_id: z.string().min(1),
      last_transaction_id: z.string().min(1),
      count: z.int().positive(),
      reason: z.literal("max-network-transactions"),
    })
    .nullable(),
});
export type BrowserScenarioEventOmissions = z.infer<
  typeof browserScenarioEventOmissionsSchema
>;
export type BrowserScenarioEventBudgetReason = z.infer<
  typeof browserScenarioEventBudgetReasonSchema
>;
export type BrowserScenarioEventAdmission =
  | { readonly status: "retained"; readonly sequence: number }
  | {
      readonly status: "omitted";
      readonly sequence: number;
      readonly reason: BrowserScenarioEventBudgetReason;
    };
export type BrowserScenarioCompletenessSection = z.infer<
  typeof completenessSectionSchema
>;

export const browserScenarioCompletenessSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("complete"),
      equality_eligible: z.literal(true),
      missing_sections: emptyArraySchema,
      truncated_sections: emptyArraySchema,
    }),
    z.strictObject({
      status: z.literal("incomplete"),
      equality_eligible: z.literal(false),
      missing_sections: z.array(completenessSectionSchema).min(1),
      truncated_sections: emptyArraySchema,
    }),
    z.strictObject({
      status: z.literal("truncated"),
      equality_eligible: z.literal(false),
      missing_sections: z.array(completenessSectionSchema),
      truncated_sections: z.array(completenessSectionSchema).min(1),
    }),
  ],
);
export type BrowserScenarioCompleteness = z.infer<
  typeof browserScenarioCompletenessSchema
>;

/** Classify canonical browser-scenario completeness from section accounting. */
export const classifyBrowserScenarioCompleteness = (
  missing: Iterable<BrowserScenarioCompletenessSection>,
  truncated: Iterable<BrowserScenarioCompletenessSection>,
): BrowserScenarioCompleteness => {
  const missingSections = [...new Set(missing)].sort();
  const truncatedSections = [...new Set(truncated)].sort();
  if (truncatedSections.length > 0)
    return browserScenarioCompletenessSchema.parse({
      status: "truncated",
      equality_eligible: false,
      missing_sections: missingSections,
      truncated_sections: truncatedSections,
    });
  if (missingSections.length > 0)
    return browserScenarioCompletenessSchema.parse({
      status: "incomplete",
      equality_eligible: false,
      missing_sections: missingSections,
      truncated_sections: [],
    });
  return {
    status: "complete",
    equality_eligible: true,
    missing_sections: [],
    truncated_sections: [],
  };
};

const browserScenarioStepShape = {
  step_index: z.int().min(0),
  step_id: z.string().min(1),
  action: z.string().min(1),
  elapsed_ms: z.int().min(0),
  before_url: sanitizedBrowserUrlSchema,
  after_url: sanitizedBrowserUrlSchema,
  event_sequence_start: z.int().min(1),
  event_sequence_end: z.int().min(0),
  artifacts: browserStepArtifactsSchema,
  completeness: browserScenarioCompletenessSchema,
};
export const browserScenarioStepSchema = z.union([
  z.strictObject({
    ...browserScenarioStepShape,
    status: z.literal("completed"),
    error: z.null(),
  }),
  z.strictObject({
    ...browserScenarioStepShape,
    status: z.enum(["failed", "cancelled"]),
    error: z.string(),
  }),
]);
export type BrowserScenarioStep = z.infer<typeof browserScenarioStepSchema>;
type StepOutcome<Step> = Step extends BrowserScenarioStep
  ? Pick<Step, "status" | "error">
  : never;
export type BrowserScenarioStepOutcome = StepOutcome<BrowserScenarioStep>;
