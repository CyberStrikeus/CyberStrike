import { z } from "zod";

/** Delivery selection is separate from the provider's live session lookup. */
export const fridaSessionStatusInputSchema = z.strictObject({
  session_id: z.string().uuid(),
  detail: z.enum(["complete", "summary"]).optional(),
});

/** Session identity and state shared by start, status and one-shot observations. */
export const fridaSessionObservationSchema = z.strictObject({
  session_id: z.string().uuid(),
  device_id: z.string(),
  state: z.enum(["paused", "running", "detached"]),
  target: z.string(),
  pid: z.number().int().nonnegative(),
  mode: z.enum(["attach", "spawn"]),
});

/** Canonical captured facts; message payload meanings remain caller-defined. */
export const fridaSessionStatusSchema = fridaSessionObservationSchema.extend({
  scripts: z.array(
    z.strictObject({ script_id: z.string().uuid(), name: z.string() }),
  ),
  // Evidence validates JSON payloads; status views validate only this envelope.
  messages: z.array(z.unknown()),
  messages_truncated: z.boolean(),
});
