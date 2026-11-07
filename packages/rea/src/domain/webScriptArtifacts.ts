import { z } from "zod";
import { digestSchema } from "./digests.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";
import { webScriptExportManifestSchema } from "./webScriptExport.js";

/** Select one source from an existing captured-script export. */
export const selectedWebScriptInputSchema = z.strictObject({
  manifest_path: absoluteLocalPathStringSchema.describe(
    "Absolute export_web_scripts manifest path",
  ),
  script_index: z.int().min(0).describe("Zero-based index in manifest.scripts"),
});
export type SelectedWebScriptInput = z.output<
  typeof selectedWebScriptInputSchema
>;

/** Exact identity of one local file, independently read as bytes. */
export const webArtifactFileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: digestSchema,
  bytes: z.int().min(0),
});

/** Artifact-port report shared by capture-derived analyses. */
export const selectedWebScriptArtifactsSchema = z.strictObject({
  manifest: webScriptExportManifestSchema,
  manifestFile: webArtifactFileSchema,
  sourceFile: webArtifactFileSchema,
  source: z.string(),
});
export type SelectedWebScriptArtifacts = z.output<
  typeof selectedWebScriptArtifactsSchema
>;

/** Preserve original capture authority and completeness alongside the actual manifest identity. */
export const capturedWebManifestIdentitySchema = webArtifactFileSchema.extend({
  reported_output_directory: z.string(),
  ...webScriptExportManifestSchema.pick({
    capture_path: true,
    capture_sha256: true,
    capture_kind: true,
    capture_completeness: true,
    source_evidence_id: true,
  }).shape,
});
