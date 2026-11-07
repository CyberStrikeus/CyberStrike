import { z } from "zod";
import { evidenceInputSchema } from "../domain/evidenceReference.js";
import { processTraceSpecificationSchema } from "../domain/process/processTraceSpecification.js";

/** Exact observation sources and the caller's process-comparison policy. */
export const processComparisonInputSchema = z.strictObject({
  left: evidenceInputSchema,
  right: evidenceInputSchema,
  trace_spec: processTraceSpecificationSchema.optional(),
  max_capture_age_ms: z.int().nonnegative().optional(),
});
