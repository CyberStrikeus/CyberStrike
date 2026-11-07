import { z } from "zod";
import { webArtifactFileSchema } from "./webScriptArtifacts.js";

/** Independently completed reads; these facts never claim a completed analysis. */
export const webArtifactAcquisitionSchema = z.strictObject({
  kind: z.literal("web-artifact-acquisition"),
  analysis: z.literal("not-performed"),
  files: z.array(
    z.strictObject({
      role: z.enum(["manifest", "source", "source-map", "import-map"]),
      file: webArtifactFileSchema,
      // Source verification establishes declared digest/length, not text decoding.
      admission: z.enum(["read", "manifest-validated", "source-verified"]),
    }),
  ),
});
export type WebArtifactAcquisition = z.infer<
  typeof webArtifactAcquisitionSchema
>;
