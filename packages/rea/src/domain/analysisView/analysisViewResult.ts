import { analysisViewCoverageSchema } from "./analysisViewCoverage.js";
import {
  javaScriptRouteInventorySourceSchema,
  javaScriptRouteInventorySchema,
} from "../javascript/javascriptRouteInventory.js";
import { nativeFunctionMatchingContextSchema } from "../native/functionMatching.js";
import {
  nativeObservationViewRequestSchema,
  nativeContextViewRequestSchema,
  nativeObservationItemsSchemas,
  nativeContextItemsSchemas,
  nativeSourceContextReferenceSchema,
  nativeObservationOperationSchema,
} from "./nativeObservationSchemas.js";
import {
  NATIVE_OBSERVATION_OPERATIONS,
  type NativeObservationOperation,
} from "../native/nativeObservation.js";
import {
  devicetreeViewRequestSchema,
  devicetreeViewItemsSchema,
  devicetreeSummarySchema,
  devicetreePageContextSchema,
} from "./devicetreeView.js";
import {
  apkSignatureViewRequestSchema,
  apkSignatureViewItemsSchema,
} from "../apkSignature/apkSignatureQuery.js";
import {
  apkSignatureSummarySchema,
  apkSignatureSourceCoverageSchema,
} from "./apkSignatureView.js";
import {
  erlangBeamViewRequestSchema,
  erlangBeamViewPageSchema,
  erlangBeamSummarySchema,
} from "./erlangBeamView.js";
import {
  pythonPycViewRequestSchema,
  pythonPycViewItemsSchema,
  pythonPycSummarySchema,
} from "./pythonPycView.js";
import {
  nativeExportsViewRequestSchema,
  nativeExportsViewItemsSchema,
  nativeExportsSummarySchema,
} from "./nativeExportsView.js";
import { byteEntropySummarySchema } from "./byteEntropyView.js";
import {
  javaScriptRoutesViewRequestSchema,
  javaScriptRoutesViewItemsSchema,
  javaScriptRoutesViewSummarySchema,
} from "./javascriptRoutesView.js";
import {
  webBundleViewRequestSchema,
  webBundleViewItemsSchema,
  webBundleSummarySchema,
} from "./webBundleView.js";
import { webBundleAnalysisSchema } from "../webBundleAnalysis.js";
import { recordedBrowserOriginSchema } from "../browserObservation.js";
import {
  sourceToBundleViewRequestSchema,
  sourceToBundleViewItemsSchema,
  sourceToBundleViewContextSchema,
} from "./sourceToBundleView.js";
import {
  gpuCodeObjectsViewRequestSchema,
  gpuCodeObjectsSummarySchema,
  gpuCodeObjectsItemsSchema,
  gpuCodeObjectsPtxPageSchema,
} from "./gpuCodeObjectsView.js";
import { gpuCodeObjectsObjectSchema } from "../gpu/gpuCodeObjects.js";
import { modelArtifactViewRequestSchema } from "../model/modelArtifactQuery.js";
import {
  modelArtifactSummarySchema,
  modelArtifactViewItemsSchema,
  modelArtifactViewContextSchema,
} from "./modelArtifactView.js";
import {
  commandSummaryContext,
  gdbCommandSummarySchema,
} from "./commandObservationView.js";
import {
  fridaSessionStatusSummarySchema,
  fridaSessionStatusViewContext,
} from "./fridaSessionStatusView.js";
import { commandObservationSchema } from "../commandObservation.js";
import {
  rustBinaryViewPageSchema,
  rustBinaryViewRequestSchema,
} from "../rust/rustBinaryQuery.js";
import {
  goBinarySummarySchema,
  goBinaryViewContextSchema,
  goBinaryViewPageSchema,
  goBinaryViewRequestSchema,
} from "./goBinaryView.js";
import {
  rustBinarySummarySchema,
  rustBinaryViewContextSchema,
} from "./rustBinaryView.js";
import {
  nativeFunctionMatchingViewRequestSchema,
  nativeFunctionMatchingViewItemsSchema,
} from "./nativeFunctionMatchingView.js";
import {
  protobufViewRequestSchema,
  protobufViewItemsSchema,
  protobufViewContextSchema,
} from "./protobufCaptureView.js";
import {
  nativeInventoryViewRequestSchema,
  nativeInventoryViewRowSchema,
  nativeInventorySummarySchema,
} from "./nativeInventoryView.js";
import { nativeViewSourceContext } from "./nativeViewContext.js";
import {
  NATIVE_INVENTORY_OPERATIONS,
  nativeInventoryOperationSchema,
} from "../native/nativeInventory.js";
import { z } from "zod";
import {
  browserScenarioSummarySchema,
  browserScenarioViewContextSchema,
  browserScenarioViewItemsSchema,
  browserScenarioViewRequestSchema,
} from "./browserScenarioViewSchemas.js";
import {
  nativeLoadImageViewRequestSchema,
  nativeLoadImageViewItemsSchema,
  nativeLoadImageSummarySchema,
} from "./nativeLoadImageView.js";
import {
  desktopViewRequestSchema,
  desktopViewItemsSchema,
  desktopSummarySchema,
} from "./desktopApplicationView.js";
import { desktopCoverageSchema } from "../desktopApplication.js";
import {
  javascriptModuleReferencesRequestSchema,
  javascriptModuleReferenceSchema,
} from "./javascriptModuleReferences.js";
import { javascriptApplicationSourceCoverageSchema } from "./javascriptApplicationCoverage.js";
import {
  javascriptFactsViewRequestSchema,
  javascriptFactRowSchema,
} from "./javascriptFactsView.js";
import { javaScriptSourceSelectionSchema } from "../javascript/javascriptSourceSelection.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { jsonObjectSchema, jsonValueSchema } from "../jsonValue.js";
import { binaryLayoutSchema } from "../native/binaryLayout.js";
import { bundleResourceRootSchema } from "../apple/bundleResourceRoot.js";
import { functionFacetAvailabilitySchema } from "../native/functionDossier.js";
import {
  artifactGraphManifestSchema,
  artifactInventoryCoverageSchema,
} from "../artifactGraph.js";
import {
  apiSurfaceFields,
  apiSurfaceViewSchema,
} from "./webNetworkApiSurfaceView.js";
import {
  evmViewRequestSchema,
  evmViewItemSchema,
  evmSummarySchema,
} from "./evmInterfaceView.js";
import {
  artifactInventoryViewRequestSchema,
  artifactInventoryItemsSchema,
  artifactInventorySummarySchema,
} from "./artifactInventoryView.js";
import {
  managedViewRequestSchema,
  managedViewItemSchema,
  managedSummarySchema,
  managedViewContextSchema,
} from "./managedArtifactView.js";
import {
  managedMembersViewRequestSchema,
  managedMembersViewPageSchema,
  managedMemberSummarySchema,
  managedMembersViewContextSchema,
} from "./managedMemberViewSchemas.js";
import {
  wasmViewRequestSchema,
  wasmViewItemSchema,
  wasmSummarySchema,
} from "./wasmArtifactView.js";
import {
  machoSummarySchema,
  machoViewContextSchema,
  machoViewRows,
  machoViewRequestSchema,
} from "./machoView.js";
import {
  interfaceBuilderSummarySchema,
  interfaceBuilderViewContextSchema,
  interfaceBuilderViewItemsSchema,
  interfaceBuilderViewRequestSchema,
} from "./interfaceBuilderView.js";
import {
  captureViewRequestSchema,
  captureViewItemsSchema,
  captureSummarySchema,
} from "./webNetworkCaptureView.js";
import {
  environmentManifestFields,
  environmentManifestViewRequestSchema,
} from "./environmentManifestView.js";
import {
  environmentStateFields,
  environmentStateViewRequestSchema,
} from "./environmentStateView.js";
import {
  environmentCoverageFields,
  environmentCoverageViewRequestSchema,
} from "./environmentCoverageView.js";
import {
  pcapViewRequestSchema,
  pcapViewPageSchema,
  pcapSummarySchema,
} from "./pcapCaptureView.js";
import {
  qlogViewRequestSchema,
  qlogViewPageSchema,
  qlogViewContextSchema,
} from "./qlogCaptureView.js";
import {
  androidPackageSummarySchema,
  androidManifestViewItemSchema,
  androidManifestViewRequestSchema,
  androidComponentsViewRequestSchema,
  androidComponentSummaryViewRequestSchema,
  androidComponentViewRowSchema,
  androidComponentViewContextSchema,
  androidComponentSummarySchema,
} from "./androidPackageView.js";
import {
  androidClassSummarySchema,
  androidMethodSummarySchema,
} from "./androidSymbolView.js";
import { androidJniSummarySchema } from "./androidJniView.js";
import {
  androidJniViewRequestSchema,
  androidJniViewItemsSchema,
} from "../android/androidJniQuery.js";
import {
  dartAotSummarySchema,
  dartAotViewRequestSchema,
  dartAotViewContextSchema,
} from "./dartAotView.js";
import {
  il2cppMetadataSummarySchema,
  il2cppMetadataViewRequestSchema,
  il2cppMetadataViewContextSchema,
  il2cppMetadataViewItemsSchema,
} from "./il2cppMetadataView.js";
import {
  facetViewSchema,
  itemViewSchema,
  nativeViewSchema,
  pageViewSchema,
  summaryViewSchema,
} from "./analysisViewShape.js";
const artifactSchema = z.strictObject({
  path: z
    .string()
    .describe(
      "Selected artifact path, or the canonical resource root when resource-only Evidence has no executable subject.",
    ),
  sha256: digestSchema.nullable(),
});

const layoutSummarySchema = z.strictObject({
  bytes: binaryLayoutSchema.shape.artifact.shape.bytes,
  format: binaryLayoutSchema.shape.format,
  architecture: binaryLayoutSchema.shape.architecture,
  image_type: binaryLayoutSchema.shape.image_type,
  entry: z.strictObject({
    reported_value: z.string().min(1),
    meaning: z.enum(["linked-virtual-address", "not-applicable", "absent"]),
    execution_status: z.literal("unknown"),
  }),
  counts: z.strictObject({
    sections: z.int().nonnegative(),
    segments: z.int().nonnegative(),
    symbols: z.int().nonnegative(),
    relocations: z.int().nonnegative(),
  }),
  limitation_count: z.int().nonnegative(),
});

const javascriptSummarySchema = z.strictObject({
  input_path: z.string().min(1),
  format: z.enum(["asar", "directory"]),
  root_artifact_sha256: digestSchema,
  source_selection: javaScriptSourceSelectionSchema.exactOptional(),
  statistics: jsonObjectSchema,
  electron: jsonObjectSchema,
  coverage: jsonObjectSchema,
  limitation_count: z.int().nonnegative(),
});

const viewResultBase = {
  parent_evidence_id: prefixedDigestSchema("ev"),
  parent_operation: z.enum([
    "inspect_python_pyc",
    "inspect_erlang_beam",
    "inspect_devicetree",
    "inspect_byte_entropy",
    "inspect_native_exports",
    "inspect_binary_layout",
    "inspect_go_binary",
    "gdb_console",
    "frida_session_status",
    "inspect_with_objdump",
    "inspect_desktop_application",
    "analyze_javascript_application",
    "analyze_web_bundle",
    "analyze_function",
    "inspect_artifact",
    "inventory_artifact",
    "inspect_wasm_artifact",
    "inspect_macho",
    "decode_interface_builder",
    "inspect_evm_interface",
    "inspect_managed_artifact",
    "inspect_managed_members",
    "inspect_web_network_capture",
    "inspect_android_package",
    "inspect_android_class",
    "inspect_android_method",
    "inspect_android_jni_bindings",
    "inspect_pcap_capture",
    "inspect_dart_aot",
    "inspect_il2cpp_metadata",
    "inspect_model_artifact",
    "inspect_gpu_code_objects",
    ...NATIVE_INVENTORY_OPERATIONS,
    ...NATIVE_OBSERVATION_OPERATIONS,
    "match_native_functions",
  ]),
  parent_digest: digestSchema,
  view_digest: digestSchema,
  artifact: artifactSchema,
  coverage: analysisViewCoverageSchema,
  limitations: z.array(z.string()),
  unknowns: z.array(z.string()),
} as const;

const summaryViewResultBase = {
  kind: z.literal("summary"),
  view: summaryViewSchema,
  ...viewResultBase,
} as const;

const nativeObservationSummaryFor = <
  Operation extends NativeObservationOperation,
>(
  operation: Operation,
) =>
  z.strictObject({
    ...summaryViewResultBase,
    ...nativeViewSourceContext,
    artifact: artifactSchema.nullable(),
    parent_operation: z.literal(operation),
    source_context: nativeSourceContextReferenceSchema,
    summary: z.strictObject({ observations: z.int().nonnegative() }),
    items: nativeObservationItemsSchemas[operation],
  });
export const nativeObservationSummaryViewResultSchemas = {
  procedure_address: nativeObservationSummaryFor("procedure_address"),
  procedure_callees: nativeObservationSummaryFor("procedure_callees"),
  procedure_callers: nativeObservationSummaryFor("procedure_callers"),
  resolve_containing_procedure: nativeObservationSummaryFor(
    "resolve_containing_procedure",
  ),
  get_call_graph: nativeObservationSummaryFor("get_call_graph"),
};
const nativeObservationSummaryViewResultSchema = z.discriminatedUnion(
  "parent_operation",
  [
    nativeObservationSummaryViewResultSchemas.procedure_address,
    nativeObservationSummaryViewResultSchemas.procedure_callees,
    nativeObservationSummaryViewResultSchemas.procedure_callers,
    nativeObservationSummaryViewResultSchemas.resolve_containing_procedure,
    nativeObservationSummaryViewResultSchemas.get_call_graph,
  ],
);
const nativeObservationPageFor = <Operation extends NativeObservationOperation>(
  operation: Operation,
) =>
  nativeObservationSummaryFor(operation)
    .omit({ kind: true, view: true })
    .extend({
      kind: z.literal("native-observation"),
      view: nativeObservationViewRequestSchema,
    });
const nativeObservationPageViewResultSchema = z.discriminatedUnion(
  "parent_operation",
  [
    nativeObservationPageFor("procedure_address"),
    nativeObservationPageFor("procedure_callees"),
    nativeObservationPageFor("procedure_callers"),
    nativeObservationPageFor("resolve_containing_procedure"),
    nativeObservationPageFor("get_call_graph"),
  ],
);
const nativeContextFor = <Facet extends keyof typeof nativeContextItemsSchemas>(
  facet: Facet,
) =>
  z.strictObject({
    ...viewResultBase,
    ...nativeViewSourceContext,
    kind: z.literal("native-context"),
    artifact: artifactSchema.nullable(),
    parent_operation: nativeObservationOperationSchema,
    source_context: nativeSourceContextReferenceSchema,
    facet: z.literal(facet),
    view: nativeContextViewRequestSchema.extend({ facet: z.literal(facet) }),
    items: nativeContextItemsSchemas[facet],
  });
const nativeContextViewResultSchema = z.discriminatedUnion("facet", [
  nativeContextFor("overview"),
  nativeContextFor("analysis-profile"),
  nativeContextFor("limitations"),
  nativeContextFor("result-limitations"),
]);

export const byteEntropySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  summary: byteEntropySummarySchema,
  parent_operation: z.literal("inspect_byte_entropy"),
});

export const nativeExportsSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_native_exports"),
  summary: nativeExportsSummarySchema,
});

export const devicetreeSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_devicetree"),
  summary: devicetreeSummarySchema,
});
export const erlangBeamSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_erlang_beam"),
  summary: erlangBeamSummarySchema,
});
export const erlangBeamTableViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("beam"),
  parent_operation: z.literal("inspect_erlang_beam"),
  view: erlangBeamViewRequestSchema,
  beam: erlangBeamSummarySchema,
  page: erlangBeamViewPageSchema,
});

export const pythonPycSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_python_pyc"),
  summary: pythonPycSummarySchema,
});

export const pythonPycCodeObjectsViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("python-pyc"),
  parent_operation: z.literal("inspect_python_pyc"),
  view: pythonPycViewRequestSchema,
  pyc: pythonPycSummarySchema,
  items: pythonPycViewItemsSchema,
});

/** Opt-in command delivery keeps output once and retains the complete parent. */
export const gdbCommandSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...commandSummaryContext,
  parent_operation: z.literal("gdb_console"),
  artifact: artifactSchema.nullable(),
  summary: gdbCommandSummarySchema,
});

export const objdumpSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...commandSummaryContext,
  parent_operation: z.literal("inspect_with_objdump"),
  artifact: artifactSchema.nullable(),
  summary: commandObservationSchema,
});

export const fridaSessionStatusSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...fridaSessionStatusViewContext,
  parent_operation: z.literal("frida_session_status"),
  artifact: artifactSchema.nullable(),
  summary: fridaSessionStatusSummarySchema,
});

/** Opt-in Go delivery retains original bytes and exposes build identity/counts. */
export const goBinarySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...goBinaryViewContextSchema.shape,
  parent_operation: z.literal("inspect_go_binary"),
  summary: goBinarySummarySchema,
});

/** Compact source identity and counts, retaining the complete embedded graph. */
export const rustBinarySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...rustBinaryViewContextSchema.shape,
  parent_operation: z.literal("inspect_rust_binary"),
  summary: rustBinarySummarySchema,
});

export const rustBinaryPageViewResultSchema = z.strictObject({
  ...viewResultBase,
  ...rustBinaryViewContextSchema.shape,
  kind: z.literal("rust"),
  parent_operation: z.literal("inspect_rust_binary"),
  view: rustBinaryViewRequestSchema,
  rust: rustBinarySummarySchema,
  page: rustBinaryViewPageSchema,
});

/** Summary `inspect_binary_layout` detail returns; no other view kind. */
export const binaryLayoutSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  summary: layoutSummarySchema,
  parent_operation: z.literal("inspect_binary_layout"),
});

/** Summary `analyze_javascript_application` detail returns; no other view kind. */
export const javascriptApplicationSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  summary: javascriptSummarySchema,
  parent_operation: z.literal("analyze_javascript_application"),
});

/** Typed reference page; full item observations remain available separately. */
export const javascriptModuleReferencesViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("javascript"),
  view: javascriptModuleReferencesRequestSchema,
  parent_operation: z.literal("analyze_javascript_application"),
  rows: z.array(javascriptModuleReferenceSchema),
  source_coverage: javascriptApplicationSourceCoverageSchema,
});

/** Paged retained observations with exact selected properties and provenance. */
const javascriptFactsViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("javascript-facts"),
  view: javascriptFactsViewRequestSchema,
  parent_operation: z.literal("analyze_javascript_application"),
  rows: z.array(javascriptFactRowSchema),
  source_coverage: javascriptApplicationSourceCoverageSchema,
});

/** Exact summary carrier for artifact inspection's optional delivery contract. */
export const artifactInventorySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.enum(["inspect_artifact", "inventory_artifact"]),
  summary: artifactInventorySummarySchema,
});

export const desktopApplicationSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_desktop_application"),
  summary: desktopSummarySchema,
});

/** Exact summary carrier for WASM inspection's optional delivery contract. */
export const wasmArtifactSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_wasm_artifact"),
  summary: wasmSummarySchema,
});

/** Exact slice identity and collection counts for Mach-O's selected delivery. */
export const machoSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_macho"),
  summary: machoSummarySchema,
});

/** Decoded documents and graph counts for Interface Builder's selected delivery. */
export const interfaceBuilderSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("decode_interface_builder"),
  resource_root: bundleResourceRootSchema.optional(),
  summary: interfaceBuilderSummarySchema,
});

/** Exact inferred-interface summary for EVM's caller-selected delivery. */
export const evmInterfaceSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_evm_interface"),
  summary: evmSummarySchema,
});

/** Exact metadata overview for the managed artifact's selected delivery. */
export const managedArtifactSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_managed_artifact"),
  summary: managedSummarySchema,
});

/** Exact member selection, coverage and counts for the selected delivery. */
export const managedMemberSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_managed_members"),
  summary: managedMemberSummarySchema,
});

/** Exact historical capture summary, with no body or member-inventory payload. */
export const webNetworkCaptureSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_web_network_capture"),
  summary: captureSummarySchema,
});

/** Compact outcomes and the focus screen from a retained browser scenario. */
export const browserScenarioSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  artifact: z.null(),
  parent_operation: z.literal("capture_browser_scenario"),
  summary: browserScenarioSummarySchema,
});

/** Exact package declarations with retained decoded manifest text. */
export const androidPackageSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_android_package"),
  summary: androidPackageSummarySchema,
});
export const androidJniSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_android_jni_bindings"),
  summary: androidJniSummarySchema,
});
export const androidJniPageViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("android-jni"),
  parent_operation: z.literal("inspect_android_jni_bindings"),
  view: androidJniViewRequestSchema,
  items: androidJniViewItemsSchema,
  source: androidJniSummarySchema.pick({
    native_inventory: true,
    library_inventory: true,
    selection: true,
  }),
});

/** Exact class facts with complete raw protocol Evidence retained separately. */
export const androidClassSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_android_class"),
  summary: androidClassSummarySchema,
});

/** Exact selected method body, source coverage and optional mapping facts. */
export const androidMethodSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_android_method"),
  summary: androidMethodSummarySchema,
});

/** Legacy manifest views keep their original shape; new facets are explicit. */
export const androidManifestViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("android"),
  facet: z.literal("manifest").optional(),
  view: androidManifestViewRequestSchema,
  item: androidManifestViewItemSchema,
  parent_operation: z.literal("inspect_android_package"),
});
export const androidComponentsViewResultSchema = z.strictObject({
  ...viewResultBase,
  ...androidComponentViewContextSchema.shape,
  kind: z.literal("android"),
  facet: z.literal("components"),
  view: androidComponentsViewRequestSchema,
  items: z.array(androidComponentViewRowSchema),
  byte_limited: z.boolean(),
  parent_operation: z.literal("inspect_android_package"),
});
export const androidComponentSummaryViewResultSchema = z.strictObject({
  ...viewResultBase,
  ...androidComponentViewContextSchema.shape,
  kind: z.literal("android"),
  facet: z.literal("component-summary"),
  view: androidComponentSummaryViewRequestSchema,
  summary: androidComponentSummarySchema,
  parent_operation: z.literal("inspect_android_package"),
});
const androidPackageViewResultSchema = z.discriminatedUnion("facet", [
  androidManifestViewResultSchema,
  androidComponentsViewResultSchema,
  androidComponentSummaryViewResultSchema,
]);

export const pcapCaptureSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_pcap_capture"),
  summary: pcapSummarySchema,
});

/** Exact snapshot and pool-coverage carrier for selected AOT delivery. */
export const dartAotSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_dart_aot"),
  summary: dartAotSummarySchema,
});

export const javaScriptRoutesViewResultSchema = z.strictObject({
  ...viewResultBase,
  artifact: artifactSchema.nullable(),
  kind: z.literal("javascript-routes"),
  parent_operation: z.enum([
    "analyze_javascript_application",
    "analyze_web_bundle",
  ]),
  view: javaScriptRoutesViewRequestSchema,
  inventory_id: javaScriptRouteInventorySchema.shape.inventory_id,
  source_manifest_sha256: digestSchema,
  source_coverage: javaScriptRouteInventorySchema.shape.coverage,
  inventory_capacity: javaScriptRouteInventorySchema.shape.capacity,
  capture_url: z.string().nullable(),
  items: javaScriptRoutesViewItemsSchema,
  sources: z.array(javaScriptRouteInventorySourceSchema),
  summary: javaScriptRoutesViewSummarySchema.nullable(),
  byte_limited: z.boolean(),
});

/** Compact web bundle findings retain endpoint observations and inference candidates. */
export const webBundleSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  artifact: artifactSchema.nullable(),
  parent_operation: z.literal("analyze_web_bundle"),
  target_url: z.string(),
  target_origin: recordedBrowserOriginSchema.nullable().optional(),
  source_unknowns: webBundleAnalysisSchema.shape.unknowns,
  summary: webBundleSummarySchema,
});

export const webBundlePageViewResultSchema = z.strictObject({
  ...viewResultBase,
  artifact: artifactSchema.nullable(),
  kind: z.literal("web-bundle"),
  parent_operation: z.literal("analyze_web_bundle"),
  target_url: z.string(),
  target_origin: recordedBrowserOriginSchema.nullable().optional(),
  source_unknowns: webBundleAnalysisSchema.shape.unknowns,
  view: webBundleViewRequestSchema,
  completeness: webBundleAnalysisSchema.shape.completeness,
  items: webBundleViewItemsSchema,
  summary: webBundleSummarySchema.nullable(),
  byte_limited: z.boolean(),
});

export const gpuCodeObjectsSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_gpu_code_objects"),
  summary: gpuCodeObjectsSummarySchema,
});
export const gpuCodeObjectsPageViewResultSchema = z.strictObject({
  kind: z.literal("gpu-code-objects"),
  view: gpuCodeObjectsViewRequestSchema,
  items: gpuCodeObjectsItemsSchema,
  ptx: gpuCodeObjectsPtxPageSchema.nullable(),
  source_coverage: gpuCodeObjectsObjectSchema.shape.coverage,
  ...viewResultBase,
  parent_operation: z.literal("inspect_gpu_code_objects"),
});

export const apkSignatureSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_apk_signature"),
  summary: apkSignatureSummarySchema,
});
export const apkSignaturePageViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("apk-signature"),
  parent_operation: z.literal("inspect_apk_signature"),
  view: apkSignatureViewRequestSchema,
  items: apkSignatureViewItemsSchema,
  source_coverage: apkSignatureSourceCoverageSchema,
});

export const modelArtifactSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_model_artifact"),
  summary: modelArtifactSummarySchema,
});

export const modelArtifactPageViewResultSchema = z.strictObject({
  kind: z.literal("model-artifact"),
  view: modelArtifactViewRequestSchema,
  items: modelArtifactViewItemsSchema,
  ...viewResultBase,
  ...modelArtifactViewContextSchema.shape,
  parent_operation: z.literal("inspect_model_artifact"),
});

/** Metadata identity and row counts for selected IL2CPP delivery. */
export const il2cppMetadataSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_il2cpp_metadata"),
  summary: il2cppMetadataSummarySchema,
});

/** Exact inventory summary with the original observation's provider and query. */
export const nativeInventorySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...nativeViewSourceContext,
  parent_operation: nativeInventoryOperationSchema,
  artifact: artifactSchema.nullable(),
  summary: nativeInventorySummarySchema,
});

/** Compact provider load observations retain the independent verification state. */
export const nativeLoadImageSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...nativeViewSourceContext,
  artifact: artifactSchema.nullable(),
  parent_operation: z.literal("inspect_native_load_image"),
  summary: nativeLoadImageSummarySchema,
});

/** Compact native matching discovery retains the complete matching report. */
export const nativeFunctionMatchingSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  artifact: z.null(),
  parent_operation: z.literal("match_native_functions"),
  summary: nativeFunctionMatchingContextSchema,
});

/** Rows observed for one facet, or null when the provider declared that facet unavailable. */
const declaredFacetCountSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .describe(
    "Observed rows; null when facet_availability declares the facet unavailable, so no rows is not evidence of none.",
  );

/** Rows of an optional dossier record, or null when the dossier omitted it. */
const recordedFacetCountSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .describe(
    "Observed rows; null when the dossier did not record the facet (the native facet view reports it not recorded), so no rows is not evidence of none.",
  );

/** Rows of one value-flow facet, or null when value flow is unavailable. */
const valueFlowFacetCountSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .describe(
    "Observed rows; null when value_flow.available is false because native_value_flow was not recorded or the provider declared it unavailable (unknowns names which), so no rows is not evidence of none.",
  );

/** Compact analyze_function dossier; the complete dossier stays retained for facet paging. */
export const nativeFunctionSummarySchema = z.strictObject({
  procedure: z.strictObject({
    name: z.string(),
    address: z.string(),
  }),
  pseudocode: z.strictObject({
    available: z
      .boolean()
      .describe(
        "Provider facet_availability for pseudocode when declared; otherwise whether decompiled text is present. The flag is authoritative over raw length.",
      ),
    code_units: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Pseudocode length in UTF-16 code units, the unit inspect_analysis_view pages pseudocode by.",
      ),
  }),
  value_flow: z.strictObject({
    available: z.boolean(),
    truncated: z
      .boolean()
      .describe(
        "True only when value-flow is available and the provider truncated it; false when value-flow is unavailable (see available).",
      ),
  }),
  facet_availability: functionFacetAvailabilitySchema
    .nullable()
    .describe(
      "The provider's declared availability per facet, or null when it declared none. Unavailable facets name their reason here and in unknowns.",
    ),
  counts: z.strictObject({
    assembly: declaredFacetCountSchema,
    basic_blocks: declaredFacetCountSchema,
    comments: declaredFacetCountSchema,
    callers: declaredFacetCountSchema,
    callees: declaredFacetCountSchema,
    incoming_references: declaredFacetCountSchema,
    outgoing_references: declaredFacetCountSchema,
    unresolved_calls: recordedFacetCountSchema,
    referenced_strings: declaredFacetCountSchema,
    referenced_names: declaredFacetCountSchema,
    swift_string_literals: recordedFacetCountSchema,
    swift_string_literal_omissions: recordedFacetCountSchema,
    value_flow_operations: valueFlowFacetCountSchema,
    value_flow_def_use: valueFlowFacetCountSchema,
    value_flow_effects: valueFlowFacetCountSchema,
    value_flow_parameters: valueFlowFacetCountSchema,
    value_flow_parameter_uses: valueFlowFacetCountSchema,
  }),
  limitation_count: z.number().int().nonnegative(),
});

/** Compact analyze_function summary that retains the complete native dossier Evidence. */
export const nativeFunctionSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("analyze_function"),
  procedure_address: z.string().nullable(),
  summary: nativeFunctionSummarySchema,
});

export const sourceToBundleSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  artifact: z.null(),
  parent_operation: z.literal("compare_source_to_bundle"),
  summary: sourceToBundleViewContextSchema,
});
export const sourceToBundlePageViewResultSchema = z.strictObject({
  ...viewResultBase,
  ...sourceToBundleViewContextSchema.shape,
  kind: z.literal("source-to-bundle"),
  artifact: z.null(),
  parent_operation: z.literal("compare_source_to_bundle"),
  view: sourceToBundleViewRequestSchema,
  items: sourceToBundleViewItemsSchema,
});

/** Bind the existing nested facet selection to its producer-owned rows. */
const machoPage = <Facet extends keyof typeof machoViewRows>(facet: Facet) =>
  z.strictObject({
    ...viewResultBase,
    ...machoViewContextSchema.shape,
    kind: z.literal("macho"),
    parent_operation: z.literal("inspect_macho"),
    view: machoViewRequestSchema.extend({ facet: z.literal(facet) }),
    item: machoViewRows[facet],
  });

// The input tag preserves kind dispatch; the output projection advertises the
// correlated pages without adding a discriminator to their public wire shape.
const machoPageViewResultSchema = z
  .object({ kind: z.literal("macho") })
  .passthrough()
  .pipe(
    z.union([
      machoPage("entrypoints"),
      machoPage("architectures"),
      machoPage("build_metadata"),
      machoPage("load_commands"),
      machoPage("dependencies"),
      machoPage("imports"),
      machoPage("exports"),
      machoPage("segments"),
      machoPage("encryption"),
      machoPage("provenance"),
    ]),
  );

/** Projected facts for one selected view of retained analysis Evidence. */
export const analysisViewResultSchema = z.discriminatedUnion("kind", [
  nativeObservationPageViewResultSchema,
  nativeContextViewResultSchema,
  javaScriptRoutesViewResultSchema,
  webBundlePageViewResultSchema,
  sourceToBundlePageViewResultSchema,
  z.strictObject({
    ...viewResultBase,
    ...nativeFunctionMatchingContextSchema.shape,
    kind: z.literal("function-matches"),
    artifact: z.null(),
    view: nativeFunctionMatchingViewRequestSchema,
    items: nativeFunctionMatchingViewItemsSchema,
    parent_operation: z.literal("match_native_functions"),
  }),
  z.strictObject({
    ...viewResultBase,
    ...apiSurfaceFields,
    kind: z.literal("api-surface"),
    parent_operation: z.literal("inspect_web_network_capture"),
    view: apiSurfaceViewSchema,
    artifact: z.strictObject({
      path: z.string(),
      sha256: digestSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...viewResultBase,
    ...environmentManifestFields,
    kind: z.literal("environment-manifest"),
    parent_operation: z.enum([
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]),
    view: environmentManifestViewRequestSchema,
  }),
  z.strictObject({
    ...viewResultBase,
    ...environmentStateFields,
    kind: z.literal("environment-state"),
    parent_operation: z.enum([
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]),
    view: environmentStateViewRequestSchema,
  }),
  z.strictObject({
    ...viewResultBase,
    ...environmentCoverageFields,
    kind: z.literal("environment-coverage"),
    parent_operation: z.enum([
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]),
    view: environmentCoverageViewRequestSchema,
  }),
  z.discriminatedUnion("parent_operation", [
    nativeObservationSummaryViewResultSchema,
    erlangBeamSummaryViewResultSchema,
    devicetreeSummaryViewResultSchema,
    pythonPycSummaryViewResultSchema,
    nativeExportsSummaryViewResultSchema,
    byteEntropySummaryViewResultSchema,
    gdbCommandSummaryViewResultSchema,
    objdumpSummaryViewResultSchema,
    fridaSessionStatusSummaryViewResultSchema,
    goBinarySummaryViewResultSchema,
    rustBinarySummaryViewResultSchema,
    binaryLayoutSummaryViewResultSchema,
    desktopApplicationSummaryViewResultSchema,
    javascriptApplicationSummaryViewResultSchema,
    artifactInventorySummaryViewResultSchema,
    wasmArtifactSummaryViewResultSchema,
    machoSummaryViewResultSchema,
    interfaceBuilderSummaryViewResultSchema,
    evmInterfaceSummaryViewResultSchema,
    managedArtifactSummaryViewResultSchema,
    managedMemberSummaryViewResultSchema,
    webNetworkCaptureSummaryViewResultSchema,
    browserScenarioSummaryViewResultSchema,
    androidPackageSummaryViewResultSchema,
    androidJniSummaryViewResultSchema,
    androidClassSummaryViewResultSchema,
    androidMethodSummaryViewResultSchema,
    pcapCaptureSummaryViewResultSchema,
    dartAotSummaryViewResultSchema,
    il2cppMetadataSummaryViewResultSchema,
    apkSignatureSummaryViewResultSchema,
    modelArtifactSummaryViewResultSchema,
    gpuCodeObjectsSummaryViewResultSchema,
    nativeInventorySummaryViewResultSchema,
    nativeLoadImageSummaryViewResultSchema,
    nativeFunctionMatchingSummaryViewResultSchema,
    nativeFunctionSummaryViewResultSchema,
    sourceToBundleSummaryViewResultSchema,
    webBundleSummaryViewResultSchema,
  ]),
  z.strictObject({
    ...viewResultBase,
    kind: z.literal("devicetree"),
    parent_operation: z.literal("inspect_devicetree"),
    view: devicetreeViewRequestSchema,
    devicetree: devicetreePageContextSchema,
    items: devicetreeViewItemsSchema,
  }),
  erlangBeamTableViewResultSchema,
  pythonPycCodeObjectsViewResultSchema,
  z.strictObject({
    ...viewResultBase,
    kind: z.literal("native-exports"),
    parent_operation: z.literal("inspect_native_exports"),
    view: nativeExportsViewRequestSchema,
    exports: nativeExportsSummarySchema,
    items: nativeExportsViewItemsSchema,
  }),
  z.strictObject({
    ...viewResultBase,
    ...nativeViewSourceContext,
    kind: z.literal("native-inventory"),
    parent_operation: nativeInventoryOperationSchema,
    artifact: artifactSchema.nullable(),
    view: nativeInventoryViewRequestSchema,
    rows: z.array(nativeInventoryViewRowSchema),
  }),
  z.strictObject({
    ...viewResultBase,
    kind: z.literal("native-load-image"),
    ...nativeViewSourceContext,
    verification_status: z.enum(["unsupported", "verified", "mismatch"]),
    parent_operation: z.literal("inspect_native_load_image"),
    artifact: artifactSchema.nullable(),
    view: nativeLoadImageViewRequestSchema,
    items: nativeLoadImageViewItemsSchema,
  }),
  z.strictObject({
    kind: z.literal("protobuf"),
    view: protobufViewRequestSchema,
    items: protobufViewItemsSchema,
    ...viewResultBase,
    ...protobufViewContextSchema.shape,
    parent_operation: z.literal("inspect_web_network_capture"),
  }),
  z.strictObject({
    kind: z.literal("capture"),
    view: captureViewRequestSchema,
    items: captureViewItemsSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_web_network_capture"),
  }),
  z.strictObject({
    kind: z.literal("browser-scenario"),
    view: browserScenarioViewRequestSchema,
    items: browserScenarioViewItemsSchema,
    ...viewResultBase,
    ...browserScenarioViewContextSchema.shape,
    artifact: z.null(),
    parent_operation: z.literal("capture_browser_scenario"),
  }),
  z.strictObject({
    kind: z.literal("qlog"),
    view: qlogViewRequestSchema,
    page: qlogViewPageSchema,
    context: qlogViewContextSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_web_network_capture"),
  }),
  z.strictObject({
    kind: z.literal("pcap"),
    view: pcapViewRequestSchema,
    page: pcapViewPageSchema,
    source_coverage: z.enum(["complete", "partial"]),
    ...viewResultBase,
    parent_operation: z.literal("inspect_pcap_capture"),
  }),
  z.strictObject({
    kind: z.literal("facet"),
    view: facetViewSchema,
    facet: jsonValueSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    ...viewResultBase,
    ...goBinaryViewContextSchema.shape,
    kind: z.literal("go"),
    parent_operation: z.literal("inspect_go_binary"),
    view: goBinaryViewRequestSchema,
    page: goBinaryViewPageSchema,
  }),
  rustBinaryPageViewResultSchema,
  z.strictObject({
    kind: z.literal("item"),
    view: itemViewSchema,
    item: jsonValueSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    kind: z.literal("page"),
    view: pageViewSchema,
    items: z.array(jsonValueSchema),
    ...viewResultBase,
  }),
  javascriptModuleReferencesViewResultSchema,
  javascriptFactsViewResultSchema,
  z.strictObject({
    kind: z.literal("native"),
    view: nativeViewSchema,
    procedure_address: z.string().nullable(),
    item: jsonValueSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    kind: z.literal("wasm"),
    view: wasmViewRequestSchema,
    item: wasmViewItemSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    kind: z.literal("desktop-application"),
    view: desktopViewRequestSchema,
    items: desktopViewItemsSchema,
    ...viewResultBase,
    source_coverage: desktopCoverageSchema,
    parent_operation: z.literal("inspect_desktop_application"),
  }),
  machoPageViewResultSchema,
  z.strictObject({
    kind: z.literal("interface-builder"),
    view: interfaceBuilderViewRequestSchema,
    items: interfaceBuilderViewItemsSchema,
    ...viewResultBase,
    resource_root: bundleResourceRootSchema.optional(),
    ...interfaceBuilderViewContextSchema.shape,
    parent_operation: z.literal("decode_interface_builder"),
  }),
  z.strictObject({
    kind: z.literal("evm"),
    view: evmViewRequestSchema,
    item: evmViewItemSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_evm_interface"),
  }),
  z.strictObject({
    kind: z.literal("managed"),
    view: managedViewRequestSchema,
    item: managedViewItemSchema,
    ...viewResultBase,
    ...managedViewContextSchema.shape,
    parent_operation: z.literal("inspect_managed_artifact"),
  }),
  z.strictObject({
    kind: z.literal("managed-members"),
    view: managedMembersViewRequestSchema,
    page: managedMembersViewPageSchema,
    ...viewResultBase,
    ...managedMembersViewContextSchema.shape,
    parent_operation: z.literal("inspect_managed_members"),
  }),
  androidPackageViewResultSchema,
  androidJniPageViewResultSchema,
  z.strictObject({
    kind: z.literal("dart-aot"),
    view: dartAotViewRequestSchema,
    items: z.array(z.string()),
    ...viewResultBase,
    ...dartAotViewContextSchema.shape,
    parent_operation: z.literal("inspect_dart_aot"),
  }),
  apkSignaturePageViewResultSchema,
  modelArtifactPageViewResultSchema,
  gpuCodeObjectsPageViewResultSchema,
  z.strictObject({
    kind: z.literal("il2cpp-metadata"),
    view: il2cppMetadataViewRequestSchema,
    items: il2cppMetadataViewItemsSchema,
    ...viewResultBase,
    ...il2cppMetadataViewContextSchema.shape,
    parent_operation: z.literal("inspect_il2cpp_metadata"),
  }),
  z.strictObject({
    kind: z.literal("inventory"),
    view: artifactInventoryViewRequestSchema,
    source_coverage: artifactInventoryCoverageSchema.exactOptional(),
    manifest: artifactGraphManifestSchema,
    inventory_evidence_ids: z.array(prefixedDigestSchema("ev")).min(1),
    source_complete: z.boolean(),
    items: artifactInventoryItemsSchema,
    ...viewResultBase,
  }),
]);

export type AnalysisViewResult = z.output<typeof analysisViewResultSchema>;

/** View payload before the content digest is attached. */
type WithoutViewDigest<T> = T extends { readonly view_digest: string }
  ? Omit<T, "view_digest">
  : never;
export type UnsignedAnalysisView = WithoutViewDigest<AnalysisViewResult>;
