import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import canonicalize from "canonicalize";

const load = (root, path) => import(pathToFileURL(join(root, path)).href);

/** Sort tool/provider names alphabetically. */
export const names = (contracts) =>
  contracts
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right));

/** Return the stable digest for a generated catalog projection. */
export const digest = (value) => {
  const encoded = canonicalize(value);
  if (encoded === undefined)
    throw new TypeError("Catalog projection is not canonical JSON");
  return createHash("sha256").update(encoded).digest("hex");
};

/** Throw when two name lists diverge. */
export const assertSameNames = (label, actual, expected) => {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((name) => !actualSet.has(name));
  const extra = [...actualSet].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && extra.length === 0) return;
  throw new Error(
    `${label} drifted (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
  );
};

const SOURCE_PATHS = {
  packageMetadata: "dist/generatedPackageMetadata.js",
  catalogIdentity: "dist/catalogIdentity.js",
  cliCommandNames: "dist/cliCommandNames.js",
  cli: "dist/cli.js",
  toolContracts: "dist/contracts/toolContracts.js",
  toolFamilies: "dist/contracts/toolFamilies.js",
  binaryDiagnosticsContracts:
    "dist/contracts/native/binaryDiagnosticsToolContracts.js",
  cutterContracts: "dist/contracts/cutterToolContracts.js",
  cutterProvider: "dist/cutter/CutterBridgeClient.js",
  reverseEngineeringContracts:
    "dist/contracts/reverseEngineeringToolContracts.js",
  gdbContracts: "dist/contracts/gdbToolContracts.js",
  gdbProvider: "dist/gdb/GdbSessionManager.js",
  rizinDebugContracts: "dist/contracts/rizinDebugToolContracts.js",
  objdumpProvider: "dist/objdump/ObjdumpCommand.js",
  rizinProvider: "dist/rizin/RizinCommand.js",
  rizinDebugProvider: "dist/rizin/RizinDebugSessionManager.js",
  fridaContracts: "dist/contracts/fridaToolContracts.js",
  fridaProvider: "dist/frida/FridaInstrumentationManager.js",
  pwntoolsProvider: "dist/native/pwntools/PwntoolsRelease.js",
  nativeContracts: "dist/contracts/native/nativeToolContracts.js",
  captureContracts: "dist/contracts/captures/captureToolContracts.js",
  captureProvider: "dist/captures/TsharkCaptureProvider.js",
  signalContracts: "dist/contracts/signals/signalToolContracts.js",
  signalProvider: "dist/signals/SigrokRecordingProvider.js",
  wasmContracts: "dist/contracts/wasm/wasmToolContracts.js",
  wasmProvider: "dist/wasm/WabtRelease.js",
  apkSignatureContracts:
    "dist/contracts/apkSignature/apkSignatureToolContracts.js",
  apkSignatureProvider: "dist/apkSignature/ApkSignatureRelease.js",
  evmContracts: "dist/contracts/evm/evmToolContracts.js",
  sqliteContracts: "dist/contracts/sqlite/sqliteToolContracts.js",
  sqliteDomain: "dist/domain/sqlite/sqliteDatabase.js",
  evmProvider: "dist/evm/EvmoleRelease.js",
  goContracts: "dist/contracts/go/goToolContracts.js",
  goProvider: "dist/go/GoBinaryProvider.js",
  gpuContracts: "dist/contracts/gpu/gpuToolContracts.js",
  gpuProvider: "dist/gpu/GpuCodeObjectsProvider.js",
  modelContracts: "dist/contracts/model/modelToolContracts.js",
  modelProvider: "dist/model/ModelArtifactProvider.js",
  il2cppContracts: "dist/contracts/il2cpp/il2cppToolContracts.js",
  il2cppProvider: "dist/il2cpp/Il2cppMetadataProvider.js",
  rustContracts: "dist/contracts/rust/rustToolContracts.js",
  rustProvider: "dist/rust/RustBinaryProvider.js",
  pythonPycContracts: "dist/contracts/python/pythonPycToolContracts.js",
  pythonPycProvider: "dist/python/PythonPycProvider.js",
  erlangContracts: "dist/contracts/erlang/beamToolContracts.js",
  erlangProvider: "dist/erlang/BeamProvider.js",
  artifactContracts: "dist/contracts/artifactToolContracts.js",
  desktopContracts: "dist/contracts/desktopApplicationToolContracts.js",
  managedContracts: "dist/contracts/managed/managedToolContracts.js",
  firmwareContracts: "dist/contracts/firmware/firmwareToolContracts.js",
  firmwareProvider: "dist/firmware/FirmwareRelease.js",
  androidContracts: "dist/contracts/android/androidToolContracts.js",
  flutterContracts: "dist/contracts/flutter/flutterToolContracts.js",
  flutterProvider: "dist/flutter/FlutterBuildProvider.js",
  androidProvider: "dist/android/JadxRelease.js",
  apktoolContracts: "dist/contracts/apktool/apktoolToolContracts.js",
  pcapContracts: "dist/contracts/pcap/pcapToolContracts.js",
  pcapProvider: "dist/pcap/PcapProvider.js",
  apktoolProvider: "dist/apktool/ApktoolProvider.js",
  jebContracts: "dist/contracts/jeb/jebToolContracts.js",
  jebProvider: "dist/jeb/JebProvider.js",
  adbContracts: "dist/contracts/adb/adbToolContracts.js",
  adbProvider: "dist/adb/AdbProvider.js",
  managedWorkflowContracts:
    "dist/contracts/managed/managedWorkflowToolContracts.js",
  browserContracts: "dist/contracts/browserToolContracts.js",
  webRuntimeContracts: "dist/contracts/webRuntimeToolContracts.js",
  webNetworkCaptureContracts:
    "dist/contracts/webNetworkCaptureToolContracts.js",
  webNetworkCaptureProvider: "dist/browser/history/CaptureRelease.js",
  browserScenarioContracts: "dist/contracts/browserScenarioToolContracts.js",
  electronContracts: "dist/contracts/javascript/electronToolContracts.js",
  electronFuseProvider: "dist/electron/ElectronFuseProvider.js",
  javascriptRuntimeObservationContracts:
    "dist/contracts/javascript/javascriptRuntimeObservationToolContracts.js",
  applicationContracts: "dist/contracts/applicationToolContracts.js",
  analysisViewContracts: "dist/contracts/analysisViewToolContracts.js",
  webScriptContracts: "dist/contracts/webScriptToolContracts.js",
  javascriptRecoveryContracts:
    "dist/contracts/javascript/javascriptRecoveryToolContracts.js",
  javascriptRecoveryProvider: "dist/javascript/recovery/WakaruRelease.js",
  supportedClients: "dist/application/SupportedClients.js",
  hopperProvider: "dist/hopper/HopperProviderCapabilities.js",
  ghidraProvider: "dist/ghidra/GhidraProviderCapabilities.js",
  idaProvider: "dist/ida/IdaProviderCapabilities.js",
  kunaProvider: "dist/kuna/KunaProviderCapabilities.js",
  nativeProvider: "dist/native/NativeMacOSProviderMetadata.js",
  artifactProviders: "dist/domain/investigationProviders.js",
  browserIdentities: "dist/browser/providerIdentities.js",
  v8InspectorProvider: "dist/inspector/providerIdentity.js",
  evidence: "dist/domain/evidence.js",
  evidenceBundle: "dist/domain/evidenceBundle.js",
  processCapture: "dist/domain/process/processCapture.js",
  analysisSnapshot: "dist/domain/analysisSnapshot.js",
  artifactGraph: "dist/domain/artifactGraph.js",
  browserObservation: "dist/domain/browserObservation.js",
  browserScenario: "dist/domain/browserScenario.js",
  browserScenarioCapture: "dist/domain/browserScenarioCapture.js",
  browserScenarioDiff: "dist/domain/browserScenarioDiff.js",
  browserSession: "dist/domain/browserSession.js",
  electronObservation: "dist/domain/javascript/electronObservation.js",
  electronActiveObservation:
    "dist/domain/javascript/electronActiveObservation.js",
  javascriptRuntimeObservation:
    "dist/domain/javascript/javascriptRuntimeObservation.js",
  webBundleAnalysis: "dist/domain/webBundleAnalysis.js",
  webCaptureDiff: "dist/domain/webCaptureDiff.js",
  managedArtifact: "dist/domain/managed/managedArtifact.js",
  managedComparison: "dist/domain/managed/managedMemberComparison.js",
  managedNativeVerification: "dist/domain/managed/managedNativeVerification.js",
  webMcpDiscovery: "dist/domain/webMcpDiscovery.js",
  webScreenshot: "dist/domain/webScreenshot.js",
  javascriptApplicationGraph:
    "dist/domain/javascript/javascriptApplicationGraph.js",
  javascriptApplicationAnalysis:
    "dist/domain/javascript/javascriptApplicationAnalysis.js",
  javascriptSemanticGraph: "dist/domain/javascript/javascriptSemanticGraph.js",
  javascriptSemanticQuery:
    "dist/domain/javascript/javascriptSemanticQuerySchemas.js",
  javascriptSemanticTrace:
    "dist/domain/javascript/javascriptSemanticTraceSchemas.js",
  javascriptFeatureTrace:
    "dist/domain/javascript/javascriptFeatureTraceSchemas.js",
  javascriptVersionComparison:
    "dist/domain/javascript/javascriptApplicationVersionComparisonSchemas.js",
  reconstructionVerification:
    "dist/domain/reconstructionVerificationSchemas.js",
  residualUnknown: "dist/domain/residualUnknown.js",
};

/** Load every compiled source module referenced by the catalog. */
export const loadSources = async (root) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(SOURCE_PATHS).map(async ([key, path]) => [
        key,
        await load(root, path),
      ]),
    ),
  );
