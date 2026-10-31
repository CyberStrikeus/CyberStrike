import { z } from "zod";
import { browserNetworkContentSelectionValuesSchema } from "./browserNetworkEvidence.js";
import { browserScenarioCaptureLimitsValuesSchema } from "./browserScenarioCaptureLimits.js";

import {
  browserScenarioCompletenessSchema,
  browserScenarioEventFamilySchema,
  browserScenarioEventOmissionsSchema,
  browserScenarioEventSchema,
  browserScenarioStepSchema,
} from "./browserScenarioCaptureValues.js";

/** Retained observations also admit legacy omission of event-family selection. */
export const retainedBrowserScenarioCaptureSchema = z
  .strictObject({
    browser: z.strictObject({
      mode: z.enum(["launch", "connect"]),
      process_ownership: z.enum(["provider-owned", "external"]),
      cleanup: z.enum(["terminated-owned-process", "disconnected-external"]),
      product: z.string().min(1),
      version: z.string().min(1),
    }),
    scenario: z.strictObject({
      start_origin: z.string().min(1),
      action_count: z.int().min(1),
      secret_references: z.array(z.string().min(1)),
      network_content: browserNetworkContentSelectionValuesSchema,
      event_families: z.array(browserScenarioEventFamilySchema).optional(),
      limits: browserScenarioCaptureLimitsValuesSchema,
    }),
    duration_ms: z.int().min(0),
    steps: z.array(browserScenarioStepSchema).min(1),
    events: z.strictObject({
      retained: z.int().min(0),
      dropped: z.int().min(0),
      items: z.array(browserScenarioEventSchema),
      omissions: browserScenarioEventOmissionsSchema,
    }),
    completeness: browserScenarioCompletenessSchema,
    limitations: z.array(z.string().min(1)),
  })
  .superRefine((capture, context) => {
    const bySequence = new Map(
      capture.events.items.map((event) => [event.sequence, event]),
    );
    if (bySequence.size !== capture.events.items.length)
      context.addIssue({
        code: "custom",
        path: ["events", "items"],
        message: "Event sequence numbers must be unique",
      });
    for (const [index, event] of capture.events.items.entries()) {
      if (event.kind !== "network-content") continue;
      const source = bySequence.get(event.source_event_sequence);
      if (
        source?.kind !== event.phase ||
        source.transaction_id !== event.transaction_id ||
        source.sequence >= event.sequence
      )
        context.addIssue({
          code: "custom",
          path: ["events", "items", index, "source_event_sequence"],
          message:
            "Network content must reference an earlier matching transaction phase",
        });
    }
    if (capture.events.retained !== capture.events.items.length)
      context.addIssue({
        code: "custom",
        path: ["events", "retained"],
        message: "Retained event count must equal items length",
      });
    if (
      capture.events.omissions.by_kind.reduce(
        (count, omission) => count + omission.count,
        0,
      ) !== capture.events.dropped
    )
      context.addIssue({
        code: "custom",
        path: ["events", "omissions", "by_kind"],
        message: "Per-kind omission counts must equal the dropped event count",
      });
    if (capture.steps.length !== capture.scenario.action_count + 1)
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Capture must include initial state and one entry per action",
      });
    const expectedIndices = capture.steps.map((_, index) => index);
    if (
      capture.steps.some(
        ({ step_index: index }, offset) => index !== expectedIndices[offset],
      )
    )
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Step indices must be contiguous from zero",
      });
    if (
      capture.events.items.some(
        ({ step_index: index }) => index >= capture.steps.length,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["events", "items"],
        message: "Event references an unknown step index",
      });
  });

export type RetainedBrowserScenarioCapture = z.infer<
  typeof retainedBrowserScenarioCaptureSchema
>;

/** Current producers must record the caller's event-family selection. */
export const browserScenarioCaptureSchema =
  retainedBrowserScenarioCaptureSchema.safeExtend({
    scenario: retainedBrowserScenarioCaptureSchema.shape.scenario.extend({
      event_families: z.array(browserScenarioEventFamilySchema),
    }),
  });
export type BrowserScenarioCapture = z.infer<
  typeof browserScenarioCaptureSchema
>;

/** Capture fields shared by complete results and retained partial observations. */
export type BrowserScenarioCaptureData = Omit<
  BrowserScenarioCapture,
  "browser" | "steps" | "completeness" | "events"
> & {
  readonly browser: Omit<BrowserScenarioCapture["browser"], "cleanup"> & {
    readonly cleanup:
      | BrowserScenarioCapture["browser"]["cleanup"]
      | "incomplete";
  };
  readonly steps: readonly BrowserScenarioCapture["steps"][number][];
  readonly events: Omit<BrowserScenarioCapture["events"], "items"> & {
    readonly items: readonly BrowserScenarioCapture["events"]["items"][number][];
  };
};

/** Browser scenario data retained when an operation fails before a complete result. */
export interface BrowserScenarioPartialObservation {
  readonly kind: "browser-scenario-observation";
  readonly capture: BrowserScenarioCaptureData;
}
