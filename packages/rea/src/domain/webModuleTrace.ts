import { z } from "zod";

import { jsonObjectSchema } from "./jsonValue.js";
import { digestSchema } from "./digests.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";
import {
  exportedWebScriptSchema,
  webScriptExportManifestSchema,
} from "./webScriptExport.js";

/** Inspect one captured script's native ES module relationships. */
export const webModuleTraceInputSchema = z.strictObject({
  manifest_path: absoluteLocalPathStringSchema.describe(
    "Absolute path to an export_web_scripts manifest",
  ),
  script_index: z.int().min(0).describe("Zero-based index in manifest.scripts"),
  importer_url: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Explicit HTTP(S) module URL; useful when captured inline/base context is unknown",
    ),
  import_map: z
    .strictObject({
      path: absoluteLocalPathStringSchema.describe(
        "Absolute local import-map JSON path; no fetch",
      ),
      base_url: z
        .string()
        .min(1)
        .describe("Explicit HTTP(S) base for the selected map"),
    })
    .optional(),
});
export type WebModuleTraceInput = z.output<typeof webModuleTraceInputSchema>;

/** Byte identity of one selected local artifact. */
export const webModuleFileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: digestSchema,
  bytes: z.int().min(0),
});
export type WebModuleFile = z.output<typeof webModuleFileSchema>;

const positionSchema = z.strictObject({
  offset: z.int().min(0),
  line: z.int().min(1),
  column: z.int().min(0),
});

/** Parser observations do not assert that a dependency was loaded. */
export const webModuleImportSchema = z.strictObject({
  kind: z.enum(["static-import", "re-export", "dynamic-import"]),
  specifier: z.string().nullable(),
  expression: z.string(),
  start: positionSchema,
  end: positionSchema,
});
export type WebModuleImport = z.output<typeof webModuleImportSchema>;

/** Native resolver output, including the engine's exact failure text. */
export const webModuleResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), url: z.string().min(1) }),
  z.strictObject({ state: z.literal("rejected"), message: z.string() }),
]);
export type WebModuleResolution = z.output<typeof webModuleResolutionSchema>;

/** Completed native resolution, shared by success and interrupted finalization. */
export const webModuleResolutionBatchSchema = z.strictObject({
  engine: z.strictObject({ id: z.string().min(1), version: z.string().min(1) }),
  resolutions: z.array(webModuleResolutionSchema),
  diagnostics: z.array(z.string()),
  rawResult: jsonObjectSchema,
});
export type WebModuleResolutionBatch = z.output<
  typeof webModuleResolutionBatchSchema
>;

/** Result-affecting context of one local native resolver request. */
export const webModuleResolutionRequestSchema = z.strictObject({
  importerUrl: z.string().min(1),
  importMap: z
    .strictObject({ baseUrl: z.string().min(1), value: jsonObjectSchema })
    .nullable(),
  specifiers: z.array(z.string()).readonly(),
});
export type WebModuleResolutionRequest = z.output<
  typeof webModuleResolutionRequestSchema
>;

/** A completed batch remains bound to the exact resolver request on failure. */
export const webModuleResolutionObservationSchema = z.strictObject({
  kind: z.literal("web-module-resolution"),
  request: webModuleResolutionRequestSchema,
  batch: webModuleResolutionBatchSchema,
});
export type WebModuleResolutionObservation = z.output<
  typeof webModuleResolutionObservationSchema
>;

const candidateSchema = z.strictObject({
  script_index: z.int().min(0),
  match: z.enum(["exact-reported-url", "response-url-without-fragment"]),
  script: exportedWebScriptSchema,
});

/** Complete outgoing imports with captured candidates and explicit unknowns. */
export const webModuleTraceResultSchema = z.strictObject({
  manifest: webModuleFileSchema.extend({
    reported_output_directory: z.string(),
    ...webScriptExportManifestSchema.pick({
      capture_path: true,
      capture_sha256: true,
      capture_kind: true,
      capture_completeness: true,
      source_evidence_id: true,
    }).shape,
  }),
  source: webModuleFileSchema.extend({
    script_index: z.int().min(0),
    script: exportedWebScriptSchema,
  }),
  importer: z.strictObject({
    url: z.string().min(1),
    basis: z.enum(["caller-selected", "reported-source-url"]),
  }),
  import_map: webModuleFileSchema
    .extend({ base_url: z.string().min(1) })
    .nullable(),
  parser: z.strictObject({
    state: z.enum(["parsed", "unparseable"]),
    diagnostics: z.array(z.string()),
    location_units: z.literal("UTF-16 offsets and columns; one-based lines"),
  }),
  engine: z
    .strictObject({ id: z.string().min(1), version: z.string().min(1) })
    .nullable(),
  imports: z.array(
    webModuleImportSchema.extend({
      resolution: z.union([
        webModuleResolutionSchema,
        z.strictObject({
          state: z.literal("unknown"),
          reason: z.literal("computed-specifier"),
        }),
      ]),
      captured_candidates: z.array(candidateSchema),
      execution: z.literal("unknown"),
    }),
  ),
  diagnostics: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type WebModuleTraceResult = z.output<typeof webModuleTraceResultSchema>;
