import { z } from "zod";
import {
  nativeCallEventSchema,
  nativeCapturedOutputSchema,
  nativeCallObservationResultSchema,
} from "./nativeCallObservation.js";

const completed = nativeCallObservationResultSchema.shape;

/** Native facts retained on failure, including completed facts before finalization. */
export const nativeCallPartialObservationSchema = z.strictObject({
  kind: z.literal("native-call-observation"),
  target: completed.target.omit({ launch_identity: true }).extend({
    launch_identity: completed.target.shape.launch_identity.optional(),
  }),
  process: completed.process.partial().extend({
    pid: z.int().positive().nullable(),
    stdout: nativeCapturedOutputSchema.nullable(),
    stderr: nativeCapturedOutputSchema.nullable(),
    other_stops: z.array(z.string()),
  }),
  debugger: completed.debugger
    .partial()
    .extend({ version: z.string().nullable() }),
  breakpoints: completed.breakpoints.optional(),
  events: z.array(nativeCallEventSchema),
  coverage: completed.coverage
    .omit({ status: true })
    .partial()
    .extend({
      status: z.literal("partial"),
      reason: z.enum([
        "cancelled",
        "timeout",
        "tracer-failure",
        "capture-failure",
        "cleanup-failure",
      ]),
    }),
  limitations: z.array(z.string()),
});

export type NativeCallPartialObservation = z.infer<
  typeof nativeCallPartialObservationSchema
>;
