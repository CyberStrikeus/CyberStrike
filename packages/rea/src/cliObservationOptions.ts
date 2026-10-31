import { javascriptRouteDeliveryOptions } from "./cli/javascriptRouteDelivery.js";
import { z } from "incur";
import { webRuntimeCommandTimeoutSchema } from "./domain/browserDeadline.js";
import { javaScriptAnalysisResourceControlsSchema } from "./domain/javascript/javascriptAnalysisResourceControls.js";
import { javaScriptSourcePathsSchema } from "./domain/javascript/javascriptSourceSelection.js";

/** Accept an agent-selected browser observation duration without an artificial ceiling. */
export const observationDuration = (fallback: number, minimum = 0) => {
  const duration = z.number().int().min(minimum);
  // Keep argv text until its presence is checked. Incur eagerly converts a
  // ZodNumber field with Number(), which turns empty/blank selections into 0.
  const selected = z
    .union([
      duration,
      z
        .string()
        .regex(/\S/u, "Expected a nonempty observation duration")
        .pipe(z.coerce.number<string>())
        .pipe(duration),
    ])
    .default(fallback)
    .describe("Observation duration in milliseconds");
  // Incur advertises Zod's output view for CLI inputs. Publish this field's
  // input view so the lexical guard survives the SDK conversion as well.
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(selected, {
    io: "input",
  });
  return selected.meta(inputSchema);
};

/** Shared passive browser origin options. */
export const browserScopeOptions = {
  allowedOrigins: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional exact-origin filter"),
  commandTimeoutMs: webRuntimeCommandTimeoutSchema,
};

/** Keep an omitted command deadline absent so Evidence records the caller selection only. */
export const selectedCommandTimeout = (
  commandTimeoutMs: number | undefined,
): { readonly command_timeout_ms?: number } =>
  commandTimeoutMs === undefined
    ? {}
    : { command_timeout_ms: commandTimeoutMs };

export const browserPageInspectionOptions = z.object({
  ...browserScopeOptions,
  observationMs: observationDuration(500),
  includeAccessibilityText: z
    .boolean()
    .default(false)
    .describe("Include accessibility text"),
  includeConsoleText: z
    .boolean()
    .default(false)
    .describe("Include console message text"),
  includeJsonBodyShapes: z
    .boolean()
    .default(false)
    .describe("Include structural shapes of JSON response bodies"),
  includeWebsocketShapes: z
    .boolean()
    .default(false)
    .describe("Include structural shapes of WebSocket payloads"),
  includeScriptSources: z
    .boolean()
    .default(false)
    .describe("Include JavaScript source text"),
  includeStorageKeys: z
    .boolean()
    .default(false)
    .describe("Include storage key names without values"),
  includeStorageFingerprints: z
    .boolean()
    .default(false)
    .describe("Include content-derived storage fingerprints"),
});

export const electronPageInspectionOptions = z.object({
  observationMs: observationDuration(100),
  includeScriptSources: z
    .boolean()
    .default(false)
    .describe("Include JavaScript source text"),
  commandTimeoutMs: webRuntimeCommandTimeoutSchema,
});

export const javascriptApplicationOptions = z.object({
  ...javascriptRouteDeliveryOptions,
  maxSemanticNodes:
    javaScriptAnalysisResourceControlsSchema.shape.max_semantic_nodes,
  maxSemanticNodesPerFile:
    javaScriptAnalysisResourceControlsSchema.shape.max_semantic_nodes_per_file,
  maxSemanticUnknowns:
    javaScriptAnalysisResourceControlsSchema.shape.max_semantic_unknowns,
  maxSemanticUnknownsPerFile:
    javaScriptAnalysisResourceControlsSchema.shape
      .max_semantic_unknowns_per_file,
  sourcePath: javaScriptSourcePathsSchema
    .optional()
    .describe(
      "Exact inventoried file path relative to the application root; repeat to select several. No implicit dependencies.",
    ),
  sourcePathsJson: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Inline JSON array or JSON file path of exact inventoried file paths relative to the application root, selected after any --source-path values. Use a file for selections that exceed the host command-line limit.",
    ),
  maxHeapMb: javaScriptAnalysisResourceControlsSchema.shape.max_heap_mb,
  analysisTimeoutMs:
    javaScriptAnalysisResourceControlsSchema.shape.analysis_timeout_ms,
  artifactFormat: z
    .enum(["auto", "asar", "directory"])
    .default("auto")
    .describe("Application artifact format"),
  integrityPolicy: z
    .enum(["fail", "record-and-continue"])
    .default("fail")
    .describe("Behavior when declared application integrity does not match"),
});
