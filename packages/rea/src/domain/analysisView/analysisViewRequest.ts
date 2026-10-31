import {
  nativeObservationViewRequestSchema,
  nativeContextViewRequestSchema,
} from "./nativeObservationSchemas.js";
import { devicetreeViewRequestSchema } from "./devicetreeView.js";
import { apkSignatureViewRequestSchema } from "../apkSignature/apkSignatureQuery.js";
import { erlangBeamViewRequestSchema } from "./erlangBeamView.js";
import { pythonPycViewRequestSchema } from "./pythonPycView.js";
import { nativeExportsViewRequestSchema } from "./nativeExportsView.js";
import { javaScriptRoutesViewRequestSchema } from "./javascriptRoutesView.js";
import { webBundleViewRequestSchema } from "./webBundleView.js";
import { sourceToBundleViewRequestSchema } from "./sourceToBundleView.js";
import { gpuCodeObjectsViewRequestSchema } from "./gpuCodeObjectsView.js";
import { modelArtifactViewRequestSchema } from "../model/modelArtifactQuery.js";
import { rustBinaryViewRequestSchema } from "../rust/rustBinaryQuery.js";
import { goBinaryViewRequestSchema } from "./goBinaryView.js";
import { nativeFunctionMatchingViewRequestSchema } from "./nativeFunctionMatchingView.js";
import { protobufViewRequestSchema } from "./protobufCaptureView.js";
import { nativeInventoryViewRequestSchema } from "./nativeInventoryView.js";

import {
  evidenceFileReferenceSchema,
  retainedEvidenceReferenceSchema,
} from "../evidenceReference.js";
import { z } from "zod";
import { browserScenarioViewRequestSchema } from "./browserScenarioViewSchemas.js";
import { nativeLoadImageViewRequestSchema } from "./nativeLoadImageView.js";
import { desktopViewRequestSchema } from "./desktopApplicationView.js";
import { javascriptModuleReferencesRequestSchema } from "./javascriptModuleReferences.js";
import { javascriptFactsViewRequestSchema } from "./javascriptFactsView.js";
import { evidenceSchema } from "../evidence.js";
import { apiSurfaceViewSchema } from "./webNetworkApiSurfaceView.js";
import { evmViewRequestSchema } from "./evmInterfaceView.js";
import { artifactInventoryViewRequestSchema } from "./artifactInventoryView.js";
import { managedViewRequestSchema } from "./managedArtifactView.js";
import { managedMembersViewRequestSchema } from "./managedMemberViewSchemas.js";
import { wasmViewRequestSchema } from "./wasmArtifactView.js";
import { machoViewRequestSchema } from "./machoView.js";
import { interfaceBuilderViewRequestSchema } from "./interfaceBuilderView.js";
import { captureViewRequestSchema } from "./webNetworkCaptureView.js";
import { environmentManifestViewRequestSchema } from "./environmentManifestView.js";
import { environmentStateViewRequestSchema } from "./environmentStateView.js";
import { environmentCoverageViewRequestSchema } from "./environmentCoverageView.js";
import { pcapViewRequestSchema } from "./pcapCaptureView.js";
import { qlogViewRequestSchema } from "./qlogCaptureView.js";
import { androidViewRequestSchema } from "./androidPackageView.js";
import { androidJniViewRequestSchema } from "../android/androidJniQuery.js";
import { dartAotViewRequestSchema } from "./dartAotView.js";
import { il2cppMetadataViewRequestSchema } from "./il2cppMetadataView.js";
import {
  facetViewSchema,
  itemViewSchema,
  nativeViewSchema,
  pageViewSchema,
  summaryViewSchema,
} from "./analysisViewShape.js";
/** Caller-selected projection of already completed analysis Evidence. */
export const analysisViewRequestSchema = z.discriminatedUnion("kind", [
  nativeObservationViewRequestSchema,
  nativeContextViewRequestSchema,
  devicetreeViewRequestSchema,
  erlangBeamViewRequestSchema,
  pythonPycViewRequestSchema,
  nativeExportsViewRequestSchema,
  javaScriptRoutesViewRequestSchema,
  webBundleViewRequestSchema,
  nativeFunctionMatchingViewRequestSchema,
  sourceToBundleViewRequestSchema,
  summaryViewSchema,
  goBinaryViewRequestSchema,
  rustBinaryViewRequestSchema,
  desktopViewRequestSchema,
  facetViewSchema,
  itemViewSchema,
  pageViewSchema,
  javascriptModuleReferencesRequestSchema,
  javascriptFactsViewRequestSchema,
  nativeViewSchema,
  nativeInventoryViewRequestSchema,
  nativeLoadImageViewRequestSchema,
  artifactInventoryViewRequestSchema,
  wasmViewRequestSchema,
  machoViewRequestSchema,
  interfaceBuilderViewRequestSchema,
  evmViewRequestSchema,
  managedViewRequestSchema,
  managedMembersViewRequestSchema,
  androidViewRequestSchema,
  androidJniViewRequestSchema,
  apiSurfaceViewSchema,
  environmentManifestViewRequestSchema,
  environmentStateViewRequestSchema,
  environmentCoverageViewRequestSchema,
  captureViewRequestSchema,
  browserScenarioViewRequestSchema,
  protobufViewRequestSchema,
  qlogViewRequestSchema,
  pcapViewRequestSchema,
  dartAotViewRequestSchema,
  il2cppMetadataViewRequestSchema,
  apkSignatureViewRequestSchema,
  modelArtifactViewRequestSchema,
  gpuCodeObjectsViewRequestSchema,
]);

// The application owns admission and authenticated Evidence parsing. SDK and
// CLI envelope parsing must borrow this unknown value rather than clone it
// before admission. Advertise the owning Evidence contract in both dialects.
const inlineEvidenceInputSchema = z.unknown().nonoptional();
inlineEvidenceInputSchema._zod.processJSONSchema =
  evidenceSchema._zod.processJSONSchema;

/** Unauthenticated inline input, an exact same-session retained reference, or one local Evidence file. */
export const analysisViewSourceSchema = z.discriminatedUnion("kind", [
  retainedEvidenceReferenceSchema,
  z.strictObject({
    kind: z.literal("inline"),
    evidence: inlineEvidenceInputSchema,
  }),
  evidenceFileReferenceSchema,
]);

/** Public inspect_analysis_view input. */
export const inspectAnalysisViewInputSchema = z.strictObject({
  source: analysisViewSourceSchema,
  view: analysisViewRequestSchema,
});

export type AnalysisViewRequest = z.output<typeof analysisViewRequestSchema>;
export type InspectAnalysisViewInput = z.output<
  typeof inspectAnalysisViewInputSchema
>;
