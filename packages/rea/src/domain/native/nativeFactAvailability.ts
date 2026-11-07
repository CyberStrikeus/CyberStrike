import { z } from "zod";

/** An explicitly unavailable provider fact preserves its reported reason. */
export const unavailableNativeFactSchema = z
  .object({ available: z.literal(false), reason: z.string() })
  .strict();
