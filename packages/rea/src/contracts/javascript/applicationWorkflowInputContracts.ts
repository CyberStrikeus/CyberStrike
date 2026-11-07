import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../../domain/localPath.js";
import { sourceToBundleViewRequestSchema } from "../../domain/analysisView/sourceToBundleView.js";
import { z } from "zod";

import { evidenceInputSchema } from "../../domain/evidenceReference.js";
import { compareJavaScriptExportShapesInputSchema } from "../../domain/javascript/javascriptExportShapeComparisonSchemas.js";
import { traceApplicationFeatureInputSchema } from "../../domain/javascript/javascriptFeatureTraceSchemas.js";
import { traceJavaScriptSemanticsInputSchema } from "../../domain/javascript/javascriptSemanticTraceSchemas.js";
import { compareSourceToBundleInputSchema } from "../../domain/javascript/sourceToBundleComparisonSchemas.js";
import { reconcileJavaScriptRuntimeInputSchema } from "../../domain/javascript/javascriptRuntimeReconciliationSchemas.js";

const traceApplicationFeatureFacts = {
  native_observations: z.array(evidenceInputSchema).default([]),
  seed: traceApplicationFeatureInputSchema.shape.seed,
  semantic_page: traceApplicationFeatureInputSchema.shape.semantic_page,
  direction: traceApplicationFeatureInputSchema.shape.direction,
} as const;

/** Application trace request accepting inline or same-session application Evidence. */
export const traceApplicationFeatureRequestSchema = z.strictObject({
  ...traceApplicationFeatureFacts,
  application: evidenceInputSchema,
});

/** Semantic trace request accepting inline or same-session application Evidence. */
export const traceJavaScriptSemanticsRequestSchema =
  traceJavaScriptSemanticsInputSchema.extend({
    application: evidenceInputSchema,
  });

const compareApplicationVersionsFacts = {
  left_native_observations: z.array(evidenceInputSchema).default([]),
  right_native_observations: z.array(evidenceInputSchema).default([]),
} as const;

/** Application comparison request accepting inline or same-session application Evidence. */
export const compareApplicationVersionsRequestSchema = z.strictObject({
  ...compareApplicationVersionsFacts,
  left: evidenceInputSchema,
  right: evidenceInputSchema,
});

const referenceFile = z.strictObject({
  kind: z.literal("file"),
  path: localPathStringSchema,
});
const sourceToBundleSelection = {
  view: z
    .union([
      z.strictObject({ kind: z.literal("summary") }),
      sourceToBundleViewRequestSchema,
    ])
    .optional(),
};
/** Historical graph JSON is a transport alternative to the inline graph, authenticated by the same graph parser. */
export const compareSourceToBundleCliInputSchema = z.strictObject({
  reference: z.union([
    compareSourceToBundleInputSchema.shape.reference,
    referenceFile,
  ]),
  application: evidenceInputSchema,
});
/** The MCP host accepts absolute local paths; omitted view preserves the full report. */
export const compareSourceToBundleRequestSchema = z.strictObject({
  reference: z.union([
    compareSourceToBundleInputSchema.shape.reference,
    referenceFile.extend({ path: absoluteLocalPathStringSchema }),
  ]),
  application: evidenceInputSchema,
  ...sourceToBundleSelection,
});

const compareJavaScriptExportShapesFacts = {
  left_module_path:
    compareJavaScriptExportShapesInputSchema.shape.left_module_path,
  left_export_name:
    compareJavaScriptExportShapesInputSchema.shape.left_export_name,
  right_module_path:
    compareJavaScriptExportShapesInputSchema.shape.right_module_path,
  right_export_name:
    compareJavaScriptExportShapesInputSchema.shape.right_export_name,
} as const;

/** Export-shape request accepting inline or same-session application Evidence. */
export const compareJavaScriptExportShapesRequestSchema = z.strictObject({
  ...compareJavaScriptExportShapesFacts,
  left: evidenceInputSchema,
  right: evidenceInputSchema,
});

/** Static layers and passive observations share the same logical Evidence inputs. */
export const reconcileJavaScriptRuntimeRequestSchema = z.strictObject({
  static_layers: z
    .array(
      reconcileJavaScriptRuntimeInputSchema.shape.static_layers.element.extend({
        analysis: evidenceInputSchema,
      }),
    )
    .min(1),
  runtime_observations: z.array(evidenceInputSchema).min(1),
});
