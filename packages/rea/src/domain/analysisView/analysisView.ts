import { NATIVE_OBSERVATION_OPERATIONS } from "../native/nativeObservation.js";
import { projectNativeObservationView } from "./nativeObservationView.js";
import { projectDevicetreeView } from "./devicetreeView.js";
import { projectApkSignatureView } from "./apkSignatureView.js";
import { byteEntropySchema } from "../native/byteEntropy.js";
import { projectErlangBeamView } from "./erlangBeamView.js";
import { projectPythonPycView } from "./pythonPycView.js";
import { projectNativeExportsView } from "./nativeExportsView.js";
import { projectByteEntropyView } from "./byteEntropyView.js";
import {
  parseAnalysisViewResult,
  analysisViewResultInputError,
} from "./analysisViewParent.js";
import { projectJavaScriptRoutesView } from "./javascriptRoutesView.js";
import { projectWebBundleView } from "./webBundleView.js";
import { projectSourceToBundleView } from "./sourceToBundleView.js";
import { projectGpuCodeObjectsView } from "./gpuCodeObjectsView.js";
import { projectModelArtifactView } from "./modelArtifactView.js";
import { projectCommandObservationView } from "./commandObservationView.js";
import { projectFridaSessionStatusView } from "./fridaSessionStatusView.js";
import { projectGoBinaryView } from "./goBinaryView.js";
import { projectRustBinaryView } from "./rustBinaryView.js";
import { projectNativeFunctionMatchingView } from "./nativeFunctionMatchingView.js";
import { projectNativeInventoryView } from "./nativeInventoryView.js";
import { NATIVE_INVENTORY_OPERATIONS } from "../native/nativeInventory.js";
import { z } from "zod";
import { projectBrowserScenarioView } from "./browserScenarioView.js";
import { projectNativeLoadImageView } from "./nativeLoadImageView.js";
import { projectDesktopApplicationView } from "./desktopApplicationView.js";

import { AnalysisUnsupportedTargetError } from "../analysisErrorCore.js";
import {
  INSPECT_ANALYSIS_VIEW_OPERATION,
  analysisViewInputError,
} from "./analysisViewErrors.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { digestSchema } from "../digests.js";
import { err, ok, type Result } from "../result.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { safeParseOwnedBinaryLayout } from "../native/binaryLayout.js";
import { functionDossierSchema } from "../native/functionDossier.js";
import {
  parseOwnedJavaScriptApplicationAnalysisSteps,
  type JavaScriptApplicationAnalysisResult,
} from "../javascript/javascriptApplicationAnalysis.js";
import { projectBinaryLayoutView } from "./binaryLayoutView.js";
import { projectJavaScriptApplicationView } from "./javascriptApplicationView.js";
import {
  createApiSurfaceAccumulator,
  projectWebNetworkApiSurfaceView,
} from "./webNetworkApiSurfaceView.js";
import { projectNativeFunctionView } from "./nativeFunctionView.js";
import { projectEvmInterfaceView } from "./evmInterfaceView.js";
import { projectArtifactInventoryView } from "./artifactInventoryView.js";
import { projectManagedArtifactView } from "./managedArtifactView.js";
import { projectManagedMemberView } from "./managedMemberView.js";
import { projectWasmArtifactView } from "./wasmArtifactView.js";
import { projectMachoView } from "./machoView.js";
import { projectInterfaceBuilderView } from "./interfaceBuilderView.js";
import { projectWebNetworkCaptureView } from "./webNetworkCaptureView.js";
import type { WebNetworkApiSurfaceAccumulator } from "./WebNetworkApiSurfaceAccumulator.js";
import type { EnvironmentManifestAccumulator } from "./EnvironmentManifestAccumulator.js";
import type { EnvironmentStateAccumulator } from "./EnvironmentStateAccumulator.js";
import { admitAnalysisViewData } from "./analysisViewDataAdmission.js";
import {
  createEnvironmentManifestAccumulator,
  projectEnvironmentManifestView,
} from "./environmentManifestView.js";
import {
  createEnvironmentStateAccumulator,
  projectEnvironmentStateView,
} from "./environmentStateView.js";
import { projectEnvironmentCoverageView } from "./environmentCoverageView.js";
import { projectPcapCaptureView } from "./pcapCaptureView.js";
import { projectAndroidPackageView } from "./androidPackageView.js";
import { projectAndroidSymbolSummary } from "./androidSymbolView.js";
import { projectAndroidJniView } from "./androidJniView.js";
import { projectDartAotView } from "./dartAotView.js";
import { projectIl2cppMetadataView } from "./il2cppMetadataView.js";

import type { AnalysisViewParent } from "./analysisViewParent.js";
import type { GroupingViewKind } from "./analysisViewShape.js";
import {
  analysisViewRequestSchema,
  inspectAnalysisViewInputSchema,
  type AnalysisViewRequest,
  type InspectAnalysisViewInput,
} from "./analysisViewRequest.js";
import {
  nativeObservationSummaryViewResultSchemas,
  byteEntropySummaryViewResultSchema,
  nativeExportsSummaryViewResultSchema,
  devicetreeSummaryViewResultSchema,
  erlangBeamSummaryViewResultSchema,
  erlangBeamTableViewResultSchema,
  pythonPycSummaryViewResultSchema,
  pythonPycCodeObjectsViewResultSchema,
  gdbCommandSummaryViewResultSchema,
  objdumpSummaryViewResultSchema,
  fridaSessionStatusSummaryViewResultSchema,
  goBinarySummaryViewResultSchema,
  rustBinarySummaryViewResultSchema,
  rustBinaryPageViewResultSchema,
  binaryLayoutSummaryViewResultSchema,
  javascriptApplicationSummaryViewResultSchema,
  artifactInventorySummaryViewResultSchema,
  desktopApplicationSummaryViewResultSchema,
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
  androidJniPageViewResultSchema,
  androidClassSummaryViewResultSchema,
  androidMethodSummaryViewResultSchema,
  androidManifestViewResultSchema,
  androidComponentsViewResultSchema,
  androidComponentSummaryViewResultSchema,
  pcapCaptureSummaryViewResultSchema,
  dartAotSummaryViewResultSchema,
  javaScriptRoutesViewResultSchema,
  webBundleSummaryViewResultSchema,
  webBundlePageViewResultSchema,
  gpuCodeObjectsSummaryViewResultSchema,
  gpuCodeObjectsPageViewResultSchema,
  apkSignatureSummaryViewResultSchema,
  apkSignaturePageViewResultSchema,
  modelArtifactSummaryViewResultSchema,
  modelArtifactPageViewResultSchema,
  il2cppMetadataSummaryViewResultSchema,
  nativeInventorySummaryViewResultSchema,
  nativeLoadImageSummaryViewResultSchema,
  nativeFunctionMatchingSummaryViewResultSchema,
  nativeFunctionSummaryViewResultSchema,
  sourceToBundleSummaryViewResultSchema,
  sourceToBundlePageViewResultSchema,
  analysisViewResultSchema,
  type AnalysisViewResult,
  type UnsignedAnalysisView,
} from "./analysisViewResult.js";
export {
  analysisViewRequestSchema,
  inspectAnalysisViewInputSchema,
  type AnalysisViewRequest,
  type InspectAnalysisViewInput,
  type AnalysisViewParent,
};
export {
  nativeObservationSummaryViewResultSchemas,
  byteEntropySummaryViewResultSchema,
  nativeExportsSummaryViewResultSchema,
  devicetreeSummaryViewResultSchema,
  erlangBeamSummaryViewResultSchema,
  erlangBeamTableViewResultSchema,
  pythonPycSummaryViewResultSchema,
  pythonPycCodeObjectsViewResultSchema,
  gdbCommandSummaryViewResultSchema,
  objdumpSummaryViewResultSchema,
  fridaSessionStatusSummaryViewResultSchema,
  goBinarySummaryViewResultSchema,
  rustBinarySummaryViewResultSchema,
  rustBinaryPageViewResultSchema,
  binaryLayoutSummaryViewResultSchema,
  javascriptApplicationSummaryViewResultSchema,
  artifactInventorySummaryViewResultSchema,
  desktopApplicationSummaryViewResultSchema,
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
  androidJniPageViewResultSchema,
  androidClassSummaryViewResultSchema,
  androidMethodSummaryViewResultSchema,
  androidManifestViewResultSchema,
  androidComponentsViewResultSchema,
  androidComponentSummaryViewResultSchema,
  pcapCaptureSummaryViewResultSchema,
  dartAotSummaryViewResultSchema,
  javaScriptRoutesViewResultSchema,
  webBundleSummaryViewResultSchema,
  webBundlePageViewResultSchema,
  gpuCodeObjectsSummaryViewResultSchema,
  gpuCodeObjectsPageViewResultSchema,
  apkSignatureSummaryViewResultSchema,
  apkSignaturePageViewResultSchema,
  modelArtifactSummaryViewResultSchema,
  modelArtifactPageViewResultSchema,
  il2cppMetadataSummaryViewResultSchema,
  nativeInventorySummaryViewResultSchema,
  nativeLoadImageSummaryViewResultSchema,
  nativeFunctionMatchingSummaryViewResultSchema,
  nativeFunctionSummaryViewResultSchema,
  sourceToBundleSummaryViewResultSchema,
  sourceToBundlePageViewResultSchema,
  analysisViewResultSchema,
  type AnalysisViewResult,
  type UnsignedAnalysisView,
};

/** Attach the content digest that must change when projected bytes change. */
export const sealAnalysisView = (
  projection: UnsignedAnalysisView,
): AnalysisViewResult =>
  analysisViewResultSchema.parse({
    ...projection,
    view_digest: digestCanonicalValue(projection, "Analysis view"),
  });

const parentDigest = (evidenceId: string): string => evidenceId.slice(3);

const parseJavaScriptParent = (
  input: unknown,
): Result<JavaScriptApplicationAnalysisResult, AnalysisError> => {
  try {
    // The format owner authenticates imported results completely before reuse;
    // mutable or merely frozen inputs still receive canonical validation.
    const steps = parseOwnedJavaScriptApplicationAnalysisSteps(input);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return ok(step.value);
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err(analysisViewResultInputError(input, cause));
  }
};

const unsupportedParent = (
  parent: AnalysisViewParent,
): AnalysisUnsupportedTargetError =>
  new AnalysisUnsupportedTargetError(
    INSPECT_ANALYSIS_VIEW_OPERATION,
    parentArtifactPath(parent),
    `Parent Evidence operation ${JSON.stringify(parent.operation)} does not support analysis views. Use completed Evidence from a supported parent operation with a compatible view. For a summary receipt, use its normalized_result.parent_evidence_id rather than the receipt's own evidence_id.`,
  );

const parentArtifactPath = (parent: AnalysisViewParent): string => {
  if (
    typeof parent.normalizedResult === "object" &&
    parent.normalizedResult !== null &&
    "artifact" in parent.normalizedResult &&
    typeof parent.normalizedResult.artifact === "object" &&
    parent.normalizedResult.artifact !== null &&
    "path" in parent.normalizedResult.artifact &&
    typeof parent.normalizedResult.artifact.path === "string"
  )
    return parent.normalizedResult.artifact.path;
  if (
    typeof parent.normalizedResult === "object" &&
    parent.normalizedResult !== null &&
    "input_path" in parent.normalizedResult &&
    typeof parent.normalizedResult.input_path === "string"
  )
    return parent.normalizedResult.input_path;
  return parent.evidenceId;
};

/** Check a projector result against the result union before sealing it. */
const sealProjected = (
  projected: Result<UnsignedAnalysisView, AnalysisError>,
): Result<AnalysisViewResult, AnalysisError> =>
  projected.ok ? ok(sealAnalysisView(projected.value)) : projected;

/** Named source owners for views that need no extra decoder or accumulator. */
type RetainedViewProjector = (
  parent: AnalysisViewParent,
  view: AnalysisViewRequest,
) => Result<UnsignedAnalysisView, AnalysisError>;

/** Register a projector whose inferred result must be in the result union. */
const retain = (
  operation: string,
  project: RetainedViewProjector,
): readonly [string, RetainedViewProjector] => [operation, project];

const retainedViewProjectors = new Map<string, RetainedViewProjector>([
  ...NATIVE_OBSERVATION_OPERATIONS.map((operation) =>
    retain(operation, projectNativeObservationView),
  ),
  retain("inspect_erlang_beam", projectErlangBeamView),
  retain("inspect_devicetree", projectDevicetreeView),
  retain("inspect_native_exports", projectNativeExportsView),
  retain("inspect_native_load_image", projectNativeLoadImageView),
  retain("inspect_python_pyc", projectPythonPycView),
  retain("frida_session_status", projectFridaSessionStatusView),
  retain("gdb_console", projectCommandObservationView),
  retain("inspect_with_objdump", projectCommandObservationView),
  retain("inspect_go_binary", projectGoBinaryView),
  retain("inspect_rust_binary", projectRustBinaryView),
  ...NATIVE_INVENTORY_OPERATIONS.map((operation) =>
    retain(operation, projectNativeInventoryView),
  ),
  retain("inspect_desktop_application", projectDesktopApplicationView),
  retain("inspect_wasm_artifact", projectWasmArtifactView),
  retain("inspect_macho", projectMachoView),
  retain("decode_interface_builder", projectInterfaceBuilderView),
  retain("inspect_evm_interface", projectEvmInterfaceView),
  retain("inspect_managed_artifact", projectManagedArtifactView),
  retain("inspect_managed_members", projectManagedMemberView),
  retain("inspect_android_package", projectAndroidPackageView),
  retain("inspect_android_class", projectAndroidSymbolSummary),
  retain("inspect_android_method", projectAndroidSymbolSummary),
  retain("inspect_android_jni_bindings", projectAndroidJniView),
  retain("capture_browser_scenario", projectBrowserScenarioView),
  retain("inspect_dart_aot", projectDartAotView),
  retain("inspect_il2cpp_metadata", projectIl2cppMetadataView),
  retain("inspect_apk_signature", projectApkSignatureView),
  retain("inspect_model_artifact", projectModelArtifactView),
  retain("inspect_gpu_code_objects", projectGpuCodeObjectsView),
  retain("match_native_functions", projectNativeFunctionMatchingView),
  retain("compare_source_to_bundle", projectSourceToBundleView),
  retain("inspect_artifact", projectArtifactInventoryView),
  retain("inventory_artifact", projectArtifactInventoryView),
  retain("analyze_web_bundle", projectWebBundleView),
]);

/** Budgets retained across source admission and the selected grouping projection. */
export interface AnalysisViewAccumulators {
  readonly apiSurface?: WebNetworkApiSurfaceAccumulator | undefined;
  readonly manifest?: EnvironmentManifestAccumulator | undefined;
  readonly state?: EnvironmentStateAccumulator | undefined;
}

/** Prepare one view's source admission and projection under the same owned budget. */
export const prepareAnalysisViewProjection = (
  view: AnalysisViewRequest,
): {
  admitInlineEvidence(value: unknown): Result<void, AnalysisError>;
  project(
    parent: AnalysisViewParent,
  ): Result<AnalysisViewResult, AnalysisError>;
} => {
  const accumulators: AnalysisViewAccumulators = {
    apiSurface:
      view.kind === "api-surface"
        ? createApiSurfaceAccumulator(view)
        : undefined,
    manifest:
      view.kind === "environment-manifest"
        ? createEnvironmentManifestAccumulator(view)
        : undefined,
    state:
      view.kind === "environment-state" || view.kind === "environment-coverage"
        ? createEnvironmentStateAccumulator(view)
        : undefined,
  };
  const accumulator =
    accumulators.apiSurface ?? accumulators.manifest ?? accumulators.state;
  return {
    admitInlineEvidence: (value) =>
      accumulator === undefined
        ? admitAnalysisViewData(value, true)
        : accumulator.admitInlineEvidence(value),
    project: (parent) => projectAnalysisView(parent, view, accumulators),
  };
};

type GroupingViewRequest = Extract<
  AnalysisViewRequest,
  { kind: GroupingViewKind }
>;

const isGroupingView = (
  view: AnalysisViewRequest,
): view is GroupingViewRequest =>
  view.kind === "api-surface" ||
  view.kind === "environment-manifest" ||
  view.kind === "environment-state" ||
  view.kind === "environment-coverage";

/** Views that group a capture's records, each under the budget its caller created. */
const projectGroupingView = (
  parent: AnalysisViewParent,
  view: GroupingViewRequest,
  accumulators: AnalysisViewAccumulators,
) => {
  if (view.kind === "api-surface")
    return projectWebNetworkApiSurfaceView(
      parent,
      view,
      accumulators.apiSurface,
    );
  if (view.kind === "environment-manifest")
    return projectEnvironmentManifestView(parent, view, accumulators.manifest);
  if (view.kind === "environment-coverage")
    return projectEnvironmentCoverageView(parent, view, accumulators.state);
  return projectEnvironmentStateView(parent, view, accumulators.state);
};

/** Project one selected view from authenticated parent analysis Evidence. */
export const projectAnalysisView = (
  parent: AnalysisViewParent,
  view: AnalysisViewRequest,
  accumulators: AnalysisViewAccumulators = {},
): Result<AnalysisViewResult, AnalysisError> => {
  const digest = parentDigest(parent.evidenceId);
  if (!digestSchema.safeParse(digest).success)
    return err(
      analysisViewInputError([
        {
          path: ["source"],
          reason: "invalid_format",
          message: "Parent Evidence ID is not a digest-backed identifier.",
        },
      ]),
    );
  if (view.kind === "javascript-routes") {
    const projected = projectJavaScriptRoutesView(parent, view);
    return sealProjected(projected);
  }
  if (view.kind === "web-bundle") {
    const projected = projectWebBundleView(parent, view);
    return sealProjected(projected);
  }
  if (isGroupingView(view)) {
    const grouped = projectGroupingView(parent, view, accumulators);
    return sealProjected(grouped);
  }
  if (parent.operation === "inspect_web_network_capture") {
    const projected = projectWebNetworkCaptureView(parent, view);
    return sealProjected(projected);
  }
  if (parent.operation === "inspect_pcap_capture") {
    const projected = projectPcapCaptureView(parent, view);
    return sealProjected(projected);
  }
  if (parent.operation === "inspect_byte_entropy") {
    const report = parseAnalysisViewResult(byteEntropySchema, parent);
    if (!report.ok) return report;
    const projected = projectByteEntropyView(parent, report.value, view);
    return sealProjected(projected);
  }
  if (parent.operation === "inspect_binary_layout") {
    const layout = parseAnalysisViewResult(
      { safeParse: safeParseOwnedBinaryLayout },
      parent,
    );
    if (!layout.ok) return layout;
    const projected = projectBinaryLayoutView(parent, layout.value, view);
    return sealProjected(projected);
  }
  if (parent.operation === "analyze_javascript_application") {
    const analysis = parseJavaScriptParent(parent.normalizedResult);
    if (!analysis.ok) return analysis;
    const projected = projectJavaScriptApplicationView(
      parent,
      analysis.value,
      view,
    );
    return sealProjected(projected);
  }
  if (parent.operation === "analyze_function") {
    const native = parseAnalysisViewResult(functionDossierSchema, parent);
    if (!native.ok) return native;
    const projected = projectNativeFunctionView(parent, native.value, view);
    return sealProjected(projected);
  }
  const project = retainedViewProjectors.get(parent.operation);
  if (project !== undefined) {
    const projected = project(parent, view);
    return sealProjected(projected);
  }
  return err(unsupportedParent(parent));
};
