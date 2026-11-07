import { z } from "zod";
import { reconstructionCoverageDataSchema } from "./reconstructionCoverage.js";

/** Named-boundary input for inline reconstruction coverage evaluation. */
export const reconstructionCoverageEvaluationInputSchema = z.strictObject({
  coverage: reconstructionCoverageDataSchema,
  boundary_id: z.string().min(1),
});
