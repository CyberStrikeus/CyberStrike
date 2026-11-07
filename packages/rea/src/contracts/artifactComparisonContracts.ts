import { z } from "zod";
import { evidenceSourceInputSchema } from "../domain/evidenceReference.js";

/** Artifact sources retain their explicit local-file selection authority. */
export const artifactComparisonInputSchema = z.strictObject({
  left: evidenceSourceInputSchema,
  right: evidenceSourceInputSchema,
});
