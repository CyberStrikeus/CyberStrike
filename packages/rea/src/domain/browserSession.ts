import { z } from "zod";
import { utcDateTimeSchema } from "./offsetDateTime.js";

import { webRuntimeCommandTimeoutSchema } from "./browserDeadline.js";
import {
  browserAllowedOriginsSchema,
  browserObservationEndpointSchema,
} from "./browserObservation.js";
import { browserCompletenessSchema } from "./browserCompleteness.js";
import { browserVersionSchema } from "./browserObservationSchemas.js";

/** Input for a navigation-aware browser observation window. */
export const observeWebSessionInputSchema = z.strictObject({
  cdp_endpoint: browserObservationEndpointSchema,
  allowed_origins: browserAllowedOriginsSchema,
  target_id: z.string().min(1),
  observation_ms: z.int().min(1).default(10_000),
  command_timeout_ms: webRuntimeCommandTimeoutSchema,
});
export type ObserveWebSessionInput = z.infer<
  typeof observeWebSessionInputSchema
>;

const destinationScopeSchema = z.enum([
  "approved",
  "outside_policy",
  "unsupported",
]);
const timelineEventSchema = z.object({
  sequence: z.int().min(1),
  type: z.enum([
    "navigation_requested",
    "navigation_committed",
    "same_origin_reload",
    "same_document_navigation",
    "redirect",
    "load_failed",
    "lifecycle",
    "target_terminated",
    "session_detached",
    "transport_disconnected",
  ]),
  timestamp: z
    .number()
    .min(0)
    .nullable()
    .describe(
      "CDP monotonic seconds when supplied; null when the event has no valid comparable producer timestamp.",
    ),
  frame_id: z.string().nullable(),
  loader_id: z.string().nullable(),
  request_id: z.string().nullable(),
  url: z.string().nullable(),
  destination_scope: destinationScopeSchema.nullable(),
  detail: z.string().nullable(),
  redirect_response: z
    .object({
      url: z.string().nullable(),
      status: z.number().nullable(),
      scope: destinationScopeSchema.nullable(),
    })
    .optional()
    .describe(
      "Prior-hop response metadata. URL and status require an approved response origin; null scope is unknown. Omitted in historical Evidence.",
    ),
});

/** Navigation-aware session result for external user actions. */
export const webObservationSessionSchema = z.object({
  browser: browserVersionSchema,
  target: z.object({
    target_id: z.string(),
    initial_url: z.string(),
    final_url: z.string().nullable(),
  }),
  window: z.object({
    armed_at: utcDateTimeSchema,
    ended_at: utcDateTimeSchema,
    requested_ms: z.int().min(1),
    end_reason: z.enum([
      "window_elapsed",
      "target_left_scope",
      "target_terminated",
      "session_detached",
      "transport_disconnected",
    ]),
  }),
  timeline: z.array(timelineEventSchema),
  completeness: browserCompletenessSchema,
  limitations: z.array(z.string()),
});
export type WebObservationSession = z.infer<typeof webObservationSessionSchema>;
