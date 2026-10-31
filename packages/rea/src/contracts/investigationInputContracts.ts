import { z } from "zod";

import { callPathInputSchema } from "../domain/callPathSchemas.js";
import { evidenceInputSchema } from "../domain/evidenceReference.js";
import { staticRuntimeCorrelationInputSchema } from "../domain/staticRuntimeCorrelation.js";

/** Transport sources resolve to complete records before the pure algorithms run. */
export const callPathRequestSchema = callPathInputSchema.extend({
  functions: z.array(evidenceInputSchema).min(1),
});

export const staticRuntimeCorrelationRequestSchema =
  staticRuntimeCorrelationInputSchema.extend({
    static_comparisons: z.array(evidenceInputSchema).min(1),
    runtime_comparisons: z.array(evidenceInputSchema).min(1),
  });
