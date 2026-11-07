import { z } from "zod";
import { utcDateTimeSchema } from "./offsetDateTime.js";
import { MAX_BROWSER_DEADLINE_MS } from "./browserDeadline.js";
import { jsonObjectSchema } from "./jsonValue.js";
import {
  webRuntimeLocationSchema,
  webRuntimeScopeSchema,
  webRuntimeSourceSchema,
  webRuntimeTargetSchema,
} from "./webRuntime.js";
import { browserVersionSchema } from "./browserObservationSchemas.js";

/** Explicit instrumentation request for one finite, externally driven execution window. */
export const observeWebExecutionInputSchema = webRuntimeScopeSchema.extend({
  observation_ms: z.int().min(1).max(MAX_BROWSER_DEADLINE_MS).default(10_000),
});
export type ObserveWebExecutionInput = z.infer<
  typeof observeWebExecutionInputSchema
>;

const rangeSchema = z.object({
  start_offset: z.int().min(0),
  end_offset: z.int().min(0),
  count: z.int().min(0),
  source_bounds: z.enum(["verified", "unknown"]),
});
const functionSchema = z.object({
  name: z.string(),
  is_block_coverage: z.boolean(),
  ranges: z.array(rangeSchema),
});

/** Precise V8 ranges retain their nested structure and counts without summing them. */
export const webExecutionObservationSchema = z.object({
  browser: browserVersionSchema,
  target: webRuntimeTargetSchema,
  window: z.object({
    armed_at: utcDateTimeSchema,
    ended_at: utcDateTimeSchema,
    requested_ms: z.int().min(1),
    end_reason: z.enum([
      "window_elapsed",
      "document_changed",
      "target_terminated",
      "session_detached",
    ]),
    producer_started_seconds: z.number().min(0),
    producer_sampled_seconds: z.number().min(0).nullable(),
  }),
  coverage: z.object({
    state: z.enum(["captured", "unavailable"]),
    reason: z.string().nullable(),
    offset_units: z.literal("utf16-code-units"),
    end_offset: z.literal("exclusive"),
    scripts: z.array(
      z.object({
        script_id: z.string().min(1),
        reported_url: z.string(),
        functions: z.array(functionSchema),
      }),
    ),
    excluded_scripts: z.int().min(0),
  }),
  requests: z.array(
    z.object({
      request_id: z.string().min(1),
      url: z.string(),
      method: z.string(),
      timestamp_seconds: z.number().min(0),
      initiator_type: z.string(),
      reported_initiator: jsonObjectSchema,
      callsites: z.array(webRuntimeLocationSchema),
      async_parent_ids: z.array(
        z.object({ id: z.string(), debugger_id: z.string().nullable() }),
      ),
      causal_attribution: z.literal("unknown"),
    }),
  ),
  excluded_requests: z.int().min(0),
  script_inventory: z.object({
    main_document_scripts: z.int().min(0),
    not_reported_script_ids: z.array(z.string().min(1)),
    coverage_absence: z.literal("unknown"),
  }),
  sources: z.array(webRuntimeSourceSchema),
  instrumentation: z.object({
    resets_execution_counters: z.literal(true),
    disables_optimized_execution: z.literal(true),
    takes_one_resetting_sample: z.boolean(),
    executes_selected_code: z.literal(false),
    cleanup: z.enum(["confirmed", "unconfirmed"]),
    page_ownership: z.literal("external"),
  }),
  limitations: z.array(z.string()),
});
/** Successful operations require the cleanup owner's acknowledgement. */
export const webExecutionSchema = webExecutionObservationSchema.extend({
  instrumentation: webExecutionObservationSchema.shape.instrumentation.extend({
    cleanup: z.literal("confirmed"),
  }),
});
export type WebExecutionObservation = z.infer<
  typeof webExecutionObservationSchema
>;
export type WebExecution = z.infer<typeof webExecutionSchema>;
