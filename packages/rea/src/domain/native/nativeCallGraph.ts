import { z } from "zod";
import { analysisErrorProjectionSchema } from "../../contracts/errorSchemas.js";
import { relationshipCoverageSchema } from "../relationshipCoverage.js";

/** One recorded traversal outcome; source levels and array positions retain identity. */
export const nativeCallGraphNodeSchema = z.discriminatedUnion("status", [
  z.object({
    address: z.string(),
    status: z.literal("ok"),
    calls: z.array(z.string()),
    relationship_coverage: relationshipCoverageSchema,
    limitations: z.array(z.string()).optional(),
  }),
  z.object({
    address: z.string(),
    status: z.literal("error"),
    error: analysisErrorProjectionSchema,
  }),
]);

/** Provider-independent result owned by the shared call-graph workflow. */
export const nativeCallGraphSchema = z.strictObject({
  graph: z.record(z.string(), z.array(nativeCallGraphNodeSchema)),
  limitations: z.array(z.string()),
});
export type NativeCallGraph = z.infer<typeof nativeCallGraphSchema>;
