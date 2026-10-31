import { z } from "zod";
import { nativeDispatchMetadataInputSchema } from "../domain/native/objcSwiftMetadata.js";
import { nativeProcedureInputSchema } from "../domain/native/nativeProcedureInput.js";
import { decompileDirectoryInputSchema } from "./decompileDirectory.js";
import { nativeValueTraceInputSchema } from "../domain/native/nativeValueTrace.js";
import { nativeInvestigationTraceLimitsSchema } from "../domain/native/nativeInvestigationGraph.js";
const traceLiteralInputSchema = z.strictObject({
  query: z.string().min(1),
  case_sensitive: z.boolean().default(false),
});

export const DEFAULT_CALL_RELATIONSHIP_DIRECTION = "forward";
const callRelationshipDirectionSchema = z
  .enum(["forward", "backward"])
  .default(DEFAULT_CALL_RELATIONSHIP_DIRECTION);
export type CallRelationshipDirection = z.output<
  typeof callRelationshipDirectionSchema
>;

/** Input schemas shared by MCP registration and enhanced application dispatch. */
export const enhancedInputSchemas = {
  trace_native_values: nativeValueTraceInputSchema,
  inspect_native_dispatch_metadata: nativeDispatchMetadataInputSchema,
  get_objc_classes: z.strictObject({ pattern: z.string().default("") }),
  get_objc_protocols: z.strictObject({}),
  batch_decompile: z.strictObject({
    addresses: z
      .array(z.string().describe("A provider-normalized procedure address"))
      .default([]),
  }),
  decompile_all: decompileDirectoryInputSchema,
  get_call_graph: z.strictObject({
    address: z
      .string()
      .describe(
        "A procedure symbol or address to resolve to its canonical entry",
      ),
    direction: callRelationshipDirectionSchema,
  }),
  analyze_swift_types: z.strictObject({
    category: z
      .enum(["classes", "structs", "enums", "protocols", "extensions", "other"])
      .optional()
      .describe(
        "Limit categorized results to one Swift category; unresolved category observations remain in unclassified.",
      ),
    pattern: z
      .string()
      .optional()
      .describe(
        "Case-sensitive literal filter applied to provider procedure names and their supporting Swift manglings.",
      ),
  }),
  find_xrefs_to_name: z.strictObject({ name: z.string() }),
  binary_overview: z.strictObject({}),
  // Provider input excludes delivery detail, which belongs to the MCP tool contract.
  analyze_function: nativeProcedureInputSchema,
  inspect_native_api: nativeProcedureInputSchema,
  trace_feature: traceLiteralInputSchema,
  trace_call_path: z.strictObject({
    start: z.string().describe("A starting procedure symbol or address"),
    goal: z
      .string()
      .describe("An optional destination procedure symbol or address")
      .optional(),
    direction: callRelationshipDirectionSchema,
  }),
  trace_native_ui_action: nativeInvestigationTraceLimitsSchema.extend({
    action: z
      .string()
      .min(1)
      .describe(
        "A unique compiled UI action selector, interface object ID, native symbol or exact function address",
      ),
  }),
} as const;

export type EnhancedToolName = keyof typeof enhancedInputSchemas;
