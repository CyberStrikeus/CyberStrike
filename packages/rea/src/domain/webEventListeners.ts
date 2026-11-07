import { z } from "zod";
import { utcDateTimeSchema } from "./offsetDateTime.js";
import {
  webRuntimeLocationSchema,
  webRuntimeScopeSchema,
  webRuntimeSourceSchema,
  webRuntimeTargetSchema,
} from "./webRuntime.js";
import { browserVersionSchema } from "./browserObservationSchemas.js";

/** Inspect listeners registered directly on the first main-document CSS match. */
export const inspectWebEventListenersInputSchema = webRuntimeScopeSchema.extend(
  {
    selector: z.string().min(1),
  },
);
export type InspectWebEventListenersInput = z.infer<
  typeof inspectWebEventListenersInputSchema
>;

/** A listener declaration and its source location do not establish that it ran. */
export const webEventListenersObservationSchema = z.object({
  browser: browserVersionSchema,
  target: webRuntimeTargetSchema,
  inspected_at: utcDateTimeSchema,
  selected_node: z.object({
    selector: z.string(),
    match: z.enum(["found", "not_found"]),
    backend_node_id: z.int().min(1).nullable(),
  }),
  listeners: z.array(
    z.object({
      type: z.string(),
      use_capture: z.boolean(),
      passive: z.boolean(),
      once: z.boolean(),
      location: webRuntimeLocationSchema,
      execution: z.literal("unknown"),
    }),
  ),
  sources: z.array(webRuntimeSourceSchema),
  cleanup: z.enum(["confirmed", "unconfirmed"]),
  limitations: z.array(z.string()),
});
/** Successful operations require the cleanup owner's acknowledgement. */
export const webEventListenersSchema =
  webEventListenersObservationSchema.extend({
    cleanup: z.literal("confirmed"),
  });
export type WebEventListenersObservation = z.infer<
  typeof webEventListenersObservationSchema
>;
export type WebEventListeners = z.infer<typeof webEventListenersSchema>;
