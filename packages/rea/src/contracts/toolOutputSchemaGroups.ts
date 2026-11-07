import {
  nativeAddressListSchema,
  nativeObservationSourceSchemas,
  containingProcedureResolutionSchema,
} from "../domain/native/nativeObservation.js";
import {
  nativeObservationSummaryViewResultSchemas,
  byteEntropySummaryViewResultSchema,
  nativeFunctionMatchingSummaryViewResultSchema,
  nativeFunctionSummaryViewResultSchema,
  nativeInventorySummaryViewResultSchema,
  nativeLoadImageSummaryViewResultSchema,
  artifactInventorySummaryViewResultSchema,
  interfaceBuilderSummaryViewResultSchema,
  machoSummaryViewResultSchema,
  managedArtifactSummaryViewResultSchema,
  managedMemberSummaryViewResultSchema,
} from "../domain/analysisView/analysisView.js";
import { literalFeatureMatchSchema } from "../domain/native/literalFeatureMatch.js";
import { byteEntropySchema } from "../domain/native/byteEntropy.js";
import { nativeFunctionMatchingSchema } from "../domain/native/functionMatching.js";
import { nativeByteReadSchema } from "../domain/native/nativeByteRead.js";
import { analysisDetailOutputSchemaOf } from "./analysisDetail.js";
import {
  functionDossierSchema,
  functionInstructionWindowSchema,
} from "../domain/native/functionDossier.js";
import {
  analysisBookmarkSchema,
  nativeInventoryRowsSchemas,
} from "../domain/native/nativeInventory.js";
import {
  referenceEdgeSchema,
  unresolvedCallSchema,
} from "../domain/native/nativeReference.js";
import { procedureIdentitySchema } from "../domain/native/procedureInfo.js";
import { z } from "zod";
import { jsonRecordSchema } from "../domain/jsonRecord.js";
import { byteSearchResultSchema } from "../domain/native/bytePattern.js";
import { evidenceBundleSummarySchema } from "../domain/evidenceRecordSummary.js";
import { liveBinaryTargetSummaryVariants } from "../domain/liveBinaryTargetSummary.js";
import { nativeFunctionAnnotationsSchema } from "../domain/native/nativeFunctionAnnotations.js";
import { nativeLoadImageSchema } from "../domain/native/nativeLoadImage.js";
import { nativeUiResultSchema } from "../domain/native/nativeUiObservation.js";
import { nativeValueTraceSchema } from "../domain/native/nativeValueTrace.js";
import { bundleResourceRootSchema } from "../domain/apple/bundleResourceRoot.js";
import { nativeDataTypeSchema } from "../domain/native/nativeDataType.js";
import { nativeCallObservationResultSchema } from "../domain/native/nativeCallObservation.js";
import {
  nativeInstructionSchema,
  nativeCallTargetsSchema,
} from "../domain/native/nativeInstruction.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { residualUnknownSchema } from "../domain/residualUnknown.js";
import { evidenceBundleSchema } from "../domain/evidenceBundle.js";

import { processCaptureComparisonSchema } from "../domain/process/processComparison.js";
import { nativeApiInspectionResultSchema } from "../domain/native/nativeApiBoundary.js";
import {
  demangleSwiftSchema,
  inspectMachoSchema,
  inspectPlistSchema,
  inspectSignatureSchema,
  listArchitecturesSchema,
} from "../domain/native/nativeInspection.js";
import { artifactExtractionResultSchema } from "../domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../domain/artifactInspection.js";
import { interfaceBuilderAnalysisSchema } from "../domain/apple/interfaceBuilderGraph.js";
import { dylibResolutionResultSchema } from "../domain/apple/dylibResolution.js";
import { keyedArchiveResultSchema } from "../domain/apple/keyedArchive.js";
import { appleAssetCatalogResultSchema } from "../domain/apple/appleAssetCatalog.js";
import {
  managedArtifactInspectionSchema,
  managedMemberInspectionSchema,
  managedNativeBoundaryInspectionSchema,
} from "../domain/managed/managedArtifact.js";
import { managedMemberComparisonResultSchema } from "../domain/managed/managedMemberComparison.js";
import { managedNativeVerificationResultSchema } from "../domain/managed/managedNativeVerificationSchemas.js";
import { managedReconstructionImportResultSchema } from "../domain/managed/managedReconstruction.js";
import { managedApplicationGraphResultSchema } from "../domain/managed/managedApplicationGraph.js";
import { artifactComparisonResultSchema } from "../domain/artifactComparison.js";
import { functionComparisonResultSchema } from "../domain/functionComparisonSchemas.js";
import { bundleComparisonResultSchema } from "../domain/bundleComparison.js";
import { changedBehaviorResultSchema } from "../domain/changedBehavior.js";
import { callPathResultSchema } from "../domain/callPathSchemas.js";
import { staticRuntimeCorrelationResultSchema } from "../domain/staticRuntimeCorrelation.js";
import { reconstructionVerificationResultSchema } from "../domain/reconstructionVerificationSchemas.js";
import { decompileDirectoryManifestSchema } from "./decompileDirectory.js";
import { analysisErrorProjectionSchema } from "./errorSchemas.js";
import { relationshipCoverageSchema } from "../domain/relationshipCoverage.js";
import { nativeDispatchMetadataResultSchema } from "../domain/native/objcSwiftMetadata.js";
import { nativeInvestigationTraceSchema } from "../domain/native/nativeInvestigationGraph.js";
import {
  addressedEntry,
  functionDossierOutput,
  lifecycleResultOf,
  nullableText,
  procedureInfoOutput,
  objcClassDiscoveryOutput,
  evidenceResultOf,
  segmentOutput,
  sessionProviderFacts,
  sessionStatusDetailShapes,
  symbolDiscoveryOutput,
} from "./toolOutputSchemaPrimitives.js";

import { processCaptureSchema } from "../domain/process/processCapture.js";
import { electronFuseReportSchema } from "../domain/electron/electronFuses.js";
const contextFacetSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), value: jsonValueSchema }),
  z.object({
    state: z.literal("unavailable"),
    reason: z.string(),
    remediation: z.string(),
  }),
]);
const bookmarkFacetSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    value: z.array(analysisBookmarkSchema),
  }),
  z.object({
    state: z.literal("unavailable"),
    reason: z.string(),
    remediation: z.string(),
  }),
]);

/** Exact structured-content schemas shared by direct analysis providers. */
export const officialOutputSchemas = {
  search_bytes: evidenceResultOf(byteSearchResultSchema),
  annotate_native_function: evidenceResultOf(nativeFunctionAnnotationsSchema),
  inspect_native_load_image: analysisDetailOutputSchemaOf(
    nativeLoadImageSchema,
    nativeLoadImageSummaryViewResultSchema,
  ),
  inspect_native_data_type: evidenceResultOf(nativeDataTypeSchema),
  inspect_native_instruction: evidenceResultOf(nativeInstructionSchema),
  resolve_native_call_targets: evidenceResultOf(nativeCallTargetsSchema),
  address_name: evidenceResultOf(nullableText),
  comment: evidenceResultOf(nullableText),
  current_address: evidenceResultOf(z.string()),
  current_procedure: evidenceResultOf(z.string()),
  current_document: evidenceResultOf(z.string()),
  goto_address: evidenceResultOf(z.string()),
  inline_comment: evidenceResultOf(nullableText),
  list_bookmarks: evidenceResultOf(z.array(analysisBookmarkSchema)),
  list_documents: evidenceResultOf(z.array(z.string())),
  list_names: analysisDetailOutputSchemaOf(
    nativeInventoryRowsSchemas.names,
    nativeInventorySummaryViewResultSchema.extend({
      parent_operation: z.literal("list_names"),
    }),
  ),
  list_procedures: analysisDetailOutputSchemaOf(
    nativeInventoryRowsSchemas.names,
    nativeInventorySummaryViewResultSchema.extend({
      parent_operation: z.literal("list_procedures"),
    }),
  ),
  list_segments: segmentOutput,
  list_strings: analysisDetailOutputSchemaOf(
    nativeInventoryRowsSchemas.strings,
    nativeInventorySummaryViewResultSchema.extend({
      parent_operation: z.literal("list_strings"),
    }),
  ),
  next_address: evidenceResultOf(z.string()),
  prev_address: evidenceResultOf(z.string()),
  procedure_address: analysisDetailOutputSchemaOf(
    nativeObservationSourceSchemas.procedure_address,
    nativeObservationSummaryViewResultSchemas.procedure_address,
  ),
  procedure_assembly: evidenceResultOf(z.string()),
  procedure_callees: analysisDetailOutputSchemaOf(
    nativeObservationSourceSchemas.procedure_callees,
    nativeObservationSummaryViewResultSchemas.procedure_callees,
  ),
  procedure_callers: analysisDetailOutputSchemaOf(
    nativeObservationSourceSchemas.procedure_callers,
    nativeObservationSummaryViewResultSchemas.procedure_callers,
  ),
  procedure_info: procedureInfoOutput,
  read_function_instructions: evidenceResultOf(functionInstructionWindowSchema),
  read_bytes: evidenceResultOf(nativeByteReadSchema),
  address_to_file_offset: evidenceResultOf(
    z.object({
      address: z.string(),
      file_offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
      provider_file_offset: z
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .exactOptional()
        .describe(
          "Original coordinate returned by the provider's mapping API.",
        ),
      image_base_file_offset: z
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .exactOptional()
        .describe(
          "File offset of the loaded image within its source container; zero for a thin executable.",
        ),
      source_path: z
        .string()
        .exactOptional()
        .describe(
          "Observed original executable path used to verify the file mapping.",
        ),
    }),
  ),
  procedure_references: evidenceResultOf(
    z.object({
      procedure: procedureIdentitySchema,
      direction: z.enum(["incoming", "outgoing"]),
      reference_kinds_available: z.boolean(),
      unresolved_calls: z.array(unresolvedCallSchema),
      references: z.array(referenceEdgeSchema),
    }),
  ),
  procedure_pseudo_code: evidenceResultOf(nullableText),
  resolve_containing_procedure: analysisDetailOutputSchemaOf(
    nativeObservationSourceSchemas.resolve_containing_procedure,
    nativeObservationSummaryViewResultSchemas.resolve_containing_procedure,
  ),
  search_procedures: analysisDetailOutputSchemaOf(
    nativeInventoryRowsSchemas.names,
    nativeInventorySummaryViewResultSchema.extend({
      parent_operation: z.literal("search_procedures"),
    }),
  ),

  search_strings: analysisDetailOutputSchemaOf(
    nativeInventoryRowsSchemas.strings,
    nativeInventorySummaryViewResultSchema.extend({
      parent_operation: z.literal("search_strings"),
    }),
  ),
  set_address_name: evidenceResultOf(z.boolean()),
  set_addresses_names: evidenceResultOf(jsonRecordSchema(z.boolean())),
  set_bookmark: evidenceResultOf(z.boolean()),
  set_comment: evidenceResultOf(z.boolean()),
  set_inline_comment: evidenceResultOf(z.boolean()),
  unset_bookmark: evidenceResultOf(z.boolean()),
  xrefs: evidenceResultOf(nativeAddressListSchema),
} as const satisfies Readonly<Record<string, z.ZodObject>>;

const literalTraceOutput = evidenceResultOf(
  z.object({
    query: z.string(),
    search_mode: z.literal("literal"),
    matches: z.array(literalFeatureMatchSchema),
    references: z.array(
      z.object({
        target_address: z.string(),
        source_address: z.string(),
        containing_procedure: containingProcedureResolutionSchema,
      }),
    ),
    truncated: z.boolean(),
    residual_unknowns: z.array(z.string()),
  }),
);

const callPathTraceOutput = evidenceResultOf(
  z.object({
    start: z.string(),
    goal: z.string().nullable(),
    direction: z.enum(["forward", "backward"]),
    goal_status: z.enum(["not_requested", "reached", "not_reached", "unknown"]),
    nodes: z.array(
      z.object({
        address: z.string(),
        depth: z.int().min(0),
      }),
    ),
    edges: z.array(
      z.object({
        source_address: z.string(),
        target_address: z.string(),
        discovery_depth: z.int().min(1),
      }),
    ),
    traversal_path: z.array(z.string()),
    failures: z.array(
      z.object({
        address: z.string(),
        error: analysisErrorProjectionSchema,
      }),
    ),
    relationship_coverage: z.record(z.string(), relationshipCoverageSchema),
    traversal: z.object({
      nodes_visited: z.int().min(1),
    }),
    truncated: z.boolean(),
    residual_unknowns: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
);

/** Identity facts attached to one requested batch selector. */
const batchProcedureIdentity = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("resolved"),
    address: z.string().min(1).describe("Observed canonical procedure entry."),
    name: z
      .string()
      .nullable()
      .describe("Provider's entry label, or null when unavailable."),
    name_error: analysisErrorProjectionSchema.optional(),
  }),
  z.object({
    status: z.literal("unknown"),
    error: analysisErrorProjectionSchema,
  }),
]);

/** Exact structured-content schemas for composed analysis workflows. */
export const enhancedOutputSchemas = {
  inspect_native_dispatch_metadata: evidenceResultOf(
    nativeDispatchMetadataResultSchema,
  ),
  trace_native_values: evidenceResultOf(nativeValueTraceSchema),
  trace_native_ui_action: evidenceResultOf(nativeInvestigationTraceSchema),
  get_objc_classes: objcClassDiscoveryOutput,
  get_objc_protocols: symbolDiscoveryOutput("protocols"),
  decompile_all: evidenceResultOf(decompileDirectoryManifestSchema),
  batch_decompile: evidenceResultOf(
    z.object({
      items: z.array(
        z.discriminatedUnion("status", [
          z.object({
            address: z
              .string()
              .describe("Original caller-selected symbol or address."),
            procedure: batchProcedureIdentity,
            status: z.literal("ok"),
            pseudocode: z.string().min(1),
          }),
          z.object({
            address: z
              .string()
              .describe("Original caller-selected symbol or address."),
            procedure: batchProcedureIdentity,
            status: z.literal("error"),
            error: analysisErrorProjectionSchema,
            limitations: z
              .array(z.string())
              .optional()
              .describe(
                "Caveats of this item's own provider observation when it supplied no pseudocode, including any reason the provider reported.",
              ),
          }),
        ]),
      ),
      total: z.int().min(0),
      succeeded: z.int().min(0),
      failed: z.int().min(0),
    }),
  ),
  get_call_graph: analysisDetailOutputSchemaOf(
    nativeObservationSourceSchemas.get_call_graph,
    nativeObservationSummaryViewResultSchemas.get_call_graph,
  ),
  analyze_swift_types: evidenceResultOf(
    z.object({
      total: z.int().min(0),
      categories: z.record(
        z.string(),
        z.object({
          count: z.int().min(0),
          items: z.array(
            addressedEntry.extend({
              mangled_names: z.array(z.string()),
            }),
          ),
        }),
      ),
      unclassified: z.array(
        addressedEntry.extend({
          mangled_names: z.array(z.string()),
          reason: z.enum(["category_not_decoded", "conflicting_categories"]),
        }),
      ),
      limitations: z.array(z.string()),
      symbol_inventory_error: analysisErrorProjectionSchema.exactOptional(),
    }),
  ),
  find_xrefs_to_name: evidenceResultOf(
    z.discriminatedUnion("status", [
      z.object({
        status: z.literal("resolved"),
        name: z.string(),
        address: z.string(),
        xrefs: nativeAddressListSchema,
      }),
      z.object({
        status: z.literal("unresolved"),
        name: z.string(),
        reason: z.literal("name_not_found"),
      }),
    ]),
  ),
  binary_overview: evidenceResultOf(
    z.object({
      document: z.string(),
      image_base: z.string().min(1).optional(),
      segments: z
        .array(
          z.object({
            name: z.string(),
            start: z.string(),
            end: z.string(),
            length: z.number().min(0).nullable(),
            image_base: z.string().exactOptional(),
            address_space: z.string().exactOptional(),
          }),
        )
        .optional(),
      segment_count: z.int().min(0).optional(),
      procedure_count: z.int().min(0),
      string_count: z.int().min(0),
    }),
  ),
  analyze_function: analysisDetailOutputSchemaOf(
    functionDossierSchema,
    nativeFunctionSummaryViewResultSchema,
  ),
  inspect_native_api: evidenceResultOf(nativeApiInspectionResultSchema),
  trace_feature: literalTraceOutput,
  trace_call_path: callPathTraceOutput,
} as const satisfies Readonly<Record<string, z.ZodObject>>;

/** Complete entropy Evidence or its retained summary, shared by the named contract. */
export const byteEntropyOutputSchema = analysisDetailOutputSchemaOf(
  byteEntropySchema,
  byteEntropySummaryViewResultSchema,
);

/** Exact Evidence schemas for provider-neutral native inspection. */
export const nativeOutputSchemas = {
  inspect_byte_entropy: byteEntropyOutputSchema,
  observe_native_ui: evidenceResultOf(nativeUiResultSchema),
  capture_native_ui_scenario: evidenceResultOf(nativeUiResultSchema),
  observe_native_calls: evidenceResultOf(nativeCallObservationResultSchema),
  inspect_macho: evidenceResultOf(
    z.union([inspectMachoSchema, machoSummaryViewResultSchema]),
  ),
  inspect_signature: evidenceResultOf(inspectSignatureSchema),
  inspect_plist: evidenceResultOf(inspectPlistSchema),
  list_architectures: evidenceResultOf(listArchitecturesSchema),
  demangle_swift: evidenceResultOf(demangleSwiftSchema),
} as const satisfies Readonly<Record<string, z.ZodObject>>;

/** Exact Evidence schemas for provider-neutral artifact graph operations. */
export const artifactOutputSchemas = {
  inspect_artifact: evidenceResultOf(
    z.union([
      artifactInspectionResultSchema,
      artifactInventorySummaryViewResultSchema,
    ]),
  ),
  extract_artifact: evidenceResultOf(artifactExtractionResultSchema),
  decode_interface_builder: evidenceResultOf(
    z.union([
      interfaceBuilderAnalysisSchema,
      interfaceBuilderSummaryViewResultSchema,
    ]),
  ),
  inspect_keyed_archive: evidenceResultOf(keyedArchiveResultSchema),
  inspect_asset_catalog: evidenceResultOf(appleAssetCatalogResultSchema),
  trace_dylib_resolution: evidenceResultOf(dylibResolutionResultSchema),
} as const satisfies Readonly<Record<string, z.ZodObject>>;

/** Exact Evidence schema for execution-free managed static analysis. */
export const managedOutputSchemas = {
  inspect_managed_artifact: evidenceResultOf(
    z.union([
      managedArtifactInspectionSchema,
      managedArtifactSummaryViewResultSchema,
    ]),
  ),
  inspect_managed_members: evidenceResultOf(
    z.union([
      managedMemberInspectionSchema,
      managedMemberSummaryViewResultSchema,
    ]),
  ),
  inspect_managed_native_boundaries: evidenceResultOf(
    managedNativeBoundaryInspectionSchema,
  ),
} as const satisfies Readonly<Record<string, z.ZodObject>>;

/** Exact Evidence schema for provider-neutral managed workflows. */
export const managedWorkflowOutputSchemas = {
  compare_managed_members: evidenceResultOf(
    managedMemberComparisonResultSchema,
  ),
  verify_managed_native_boundaries: evidenceResultOf(
    managedNativeVerificationResultSchema,
  ),
  import_managed_reconstruction: evidenceResultOf(
    managedReconstructionImportResultSchema,
  ),
  project_managed_application_graph: evidenceResultOf(
    managedApplicationGraphResultSchema,
  ),
} as const satisfies Readonly<Record<string, z.ZodObject>>;

/** Exact structured-content schemas for target lifecycle operations. */
export const sessionOutputSchemas = {
  open_binary: lifecycleResultOf(
    z.discriminatedUnion("format", [...liveBinaryTargetSummaryVariants]),
  ),
  open_bundle_resources: lifecycleResultOf(bundleResourceRootSchema),
  close_binary: lifecycleResultOf(
    z.union([
      z.null(),
      z.object({
        path: z.string(),
        bytes: z.int().min(0),
        primitive_entries: z
          .int()
          .min(0)
          .describe("Retained eligible primitive query bindings."),
        workflow_entries: z
          .int()
          .min(0)
          .describe("Retained eligible composed workflow bindings."),
        evidence_records: z
          .int()
          .min(0)
          .describe(
            "All retained Evidence records, including observations without replay bindings.",
          ),
      }),
    ]),
  ),
  // Every session kind crossed with every detail level, so `detail` fixes
  // which candidate, tool-group and omission fields the result carries.
  binary_session: lifecycleResultOf(
    z.union(
      sessionStatusDetailShapes.flatMap((detail) => [
        sessionProviderFacts.extend({ open: z.literal(false), ...detail }),
        sessionProviderFacts.extend({
          open: z.literal(true),
          session_kind: z.literal("bundle_resources"),
          resource_root: bundleResourceRootSchema,
          ...detail,
        }),
        ...liveBinaryTargetSummaryVariants.map((variant) =>
          sessionProviderFacts.extend({
            open: z.literal(true),
            ...variant.shape,
            ...detail,
          }),
        ),
      ]),
    ),
  ),
  export_evidence_bundle: lifecycleResultOf(
    z.object({
      path: z.string(),
      bytes: z.int().min(0),
      records: z.int().min(0),
      unknowns: z.int().min(0),
    }),
  ),
  get_evidence_bundle: lifecycleResultOf(
    z.union([evidenceBundleSchema, evidenceBundleSummarySchema]),
  ),
  get_navigation_context: lifecycleResultOf(
    z.object({
      document: z.string(),
      address: z.string(),
      procedure: z.union([z.string(), z.null()]),
    }),
  ),
  inspect_address_context: lifecycleResultOf(
    z.object({
      address: z.string(),
      document: z.string().nullable(),
      name: contextFacetSchema,
      procedure: contextFacetSchema,
      comment: contextFacetSchema,
      inline_comment: contextFacetSchema,
      bookmarks: bookmarkFacetSchema,
    }),
  ),
  import_evidence_bundle: lifecycleResultOf(
    z.object({
      imported: z.int().min(0),
      unknowns_added: z.int().min(0),
      total: z.int().min(0),
    }),
  ),
  capture_process_scenario: evidenceResultOf(processCaptureSchema),
  compare_process_captures: evidenceResultOf(processCaptureComparisonSchema),
  compare_artifacts: evidenceResultOf(artifactComparisonResultSchema),
  compare_functions: evidenceResultOf(functionComparisonResultSchema),
  match_native_functions: evidenceResultOf(
    z.union([
      nativeFunctionMatchingSchema,
      nativeFunctionMatchingSummaryViewResultSchema,
    ]),
  ),
  compare_bundles: evidenceResultOf(bundleComparisonResultSchema),
  find_changed_behavior: evidenceResultOf(changedBehaviorResultSchema),
  build_call_path: evidenceResultOf(callPathResultSchema),
  correlate_static_and_runtime: evidenceResultOf(
    staticRuntimeCorrelationResultSchema,
  ),
  verify_reconstruction: evidenceResultOf(
    reconstructionVerificationResultSchema,
  ),
  list_unknowns: lifecycleResultOf(
    z.object({
      items: z.array(residualUnknownSchema),
      total: z.int().min(0),
      offset: z.int().min(0),
      next_offset: z.int().min(0).nullable(),
    }),
  ),
  record_unknown: lifecycleResultOf(residualUnknownSchema),
  update_unknown: lifecycleResultOf(residualUnknownSchema),
  verify_unknown_resolution: lifecycleResultOf(
    z.object({
      valid: z.boolean(),
      truthVerified: z.boolean(),
      unknown: residualUnknownSchema,
    }),
  ),
} as const satisfies Readonly<Record<string, z.ZodObject>>;

/** Exact Evidence schema for read-only Electron fuse inspection. */
export const electronFuseOutputSchemas = {
  inspect_electron_fuses: evidenceResultOf(electronFuseReportSchema),
};
