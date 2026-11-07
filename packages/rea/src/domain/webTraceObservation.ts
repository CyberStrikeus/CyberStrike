import { z } from "zod";
import { webArtifactFileSchema } from "./webScriptArtifacts.js";
import { webModuleResolutionObservationSchema } from "./webModuleTrace.js";
import { webSourceMapReportSchema } from "./webSourceLocation.js";

/** Admitted identities survive an incomplete trace without claiming analysis success. */
export const webTraceObservationSchema = z.strictObject({
  kind: z.literal("web-trace-observation"),
  analysis: z.literal("incomplete"),
  manifest: webArtifactFileSchema,
  source: webArtifactFileSchema,
  source_map: webArtifactFileSchema.optional(),
  import_map: webArtifactFileSchema.optional(),
  // Producer request provenance is independent of the selected trace request.
  resolver_observation: webModuleResolutionObservationSchema.optional(),
  source_map_observation: z
    .strictObject({
      association: z.enum(["selected", "independent"]),
      report: webSourceMapReportSchema,
    })
    .optional(),
});
export type WebTraceObservation = z.output<typeof webTraceObservationSchema>;
