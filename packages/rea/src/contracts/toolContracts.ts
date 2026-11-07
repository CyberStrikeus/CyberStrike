import { ANALYSIS_SETTINGS_TOOL_CONTRACTS } from "./analysisSettingsContracts.js";
import { GPU_TOOL_CONTRACTS } from "./gpu/gpuToolContracts.js";
import { CAPTURE_TOOL_CONTRACTS } from "./captures/captureToolContracts.js";
import { SIGNAL_TOOL_CONTRACTS } from "./signals/signalToolContracts.js";
import { WASM_TOOL_CONTRACTS } from "./wasm/wasmToolContracts.js";
import { APK_SIGNATURE_TOOL_CONTRACTS } from "./apkSignature/apkSignatureToolContracts.js";
import { EVM_TOOL_CONTRACTS } from "./evm/evmToolContracts.js";
import { DESKTOP_APPLICATION_TOOL_CONTRACTS } from "./desktopApplicationToolContracts.js";
import { GO_TOOL_CONTRACTS } from "./go/goToolContracts.js";
import { MODEL_TOOL_CONTRACTS } from "./model/modelToolContracts.js";
import { IL2CPP_TOOL_CONTRACTS } from "./il2cpp/il2cppToolContracts.js";
import { RUST_TOOL_CONTRACTS } from "./rust/rustToolContracts.js";
import { PYTHON_PYC_TOOL_CONTRACTS } from "./python/pythonPycToolContracts.js";
import { ERLANG_BEAM_TOOL_CONTRACTS } from "./erlang/beamToolContracts.js";
import { SQLITE_TOOL_CONTRACTS } from "./sqlite/sqliteToolContracts.js";
import { ANALYSIS_VIEW_TOOL_CONTRACTS } from "./analysisViewToolContracts.js";
import { BINARY_DIAGNOSTICS_TOOL_CONTRACTS } from "./native/binaryDiagnosticsToolContracts.js";
import { NATIVE_TOOL_CONTRACTS } from "./native/nativeToolContracts.js";
import { ARTIFACT_TOOL_CONTRACTS } from "./artifactToolContracts.js";
import { MANAGED_TOOL_CONTRACTS } from "./managed/managedToolContracts.js";
import { FIRMWARE_TOOL_CONTRACTS } from "./firmware/firmwareToolContracts.js";
import { ANDROID_TOOL_CONTRACTS } from "./android/androidToolContracts.js";
import { APKTOOL_TOOL_CONTRACTS } from "./apktool/apktoolToolContracts.js";
import { PCAP_TOOL_CONTRACTS } from "./pcap/pcapToolContracts.js";
import { FLUTTER_TOOL_CONTRACTS } from "./flutter/flutterToolContracts.js";
import { JEB_TOOL_CONTRACTS } from "./jeb/jebToolContracts.js";
import { ADB_TOOL_CONTRACTS } from "./adb/adbToolContracts.js";
import { MANAGED_WORKFLOW_TOOL_CONTRACTS } from "./managed/managedWorkflowToolContracts.js";
import { BROWSER_PROVIDER_TOOL_CONTRACTS } from "./browserProviderToolContracts.js";
import { ELECTRON_TOOL_CONTRACTS } from "./javascript/electronToolContracts.js";
import { JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS } from "./javascript/javascriptRuntimeObservationToolContracts.js";
import { APPLICATION_TOOL_CONTRACTS } from "./applicationToolContracts.js";
import { WEB_SCRIPT_TOOL_CONTRACTS } from "./webScriptToolContracts.js";
import { WEB_RUNTIME_TOOL_CONTRACTS } from "./webRuntimeToolContracts.js";
import { WEB_NETWORK_CAPTURE_TOOL_CONTRACTS } from "./webNetworkCaptureToolContracts.js";
import { JAVASCRIPT_RECOVERY_TOOL_CONTRACTS } from "./javascript/javascriptRecoveryToolContracts.js";
import { OFFICIAL_TOOL_CONTRACTS } from "./officialToolContracts.js";
import { ENHANCED_TOOL_CONTRACTS } from "./enhancedToolContracts.js";
import { SESSION_TOOL_CONTRACTS } from "./sessionToolContracts.js";
import { CUTTER_TOOL_CONTRACTS } from "./cutterToolContracts.js";
import { REVERSE_ENGINEERING_TOOL_CONTRACTS } from "./reverseEngineeringToolContracts.js";
import { GDB_TOOL_CONTRACTS } from "./gdbToolContracts.js";
import { RIZIN_DEBUG_TOOL_CONTRACTS } from "./rizinDebugToolContracts.js";
import { FRIDA_TOOL_CONTRACTS } from "./fridaToolContracts.js";
import { ENVIRONMENT_TOOL_CONTRACTS } from "./environmentToolContracts.js";

/** Complete ordered public inventory used by registration and verification. */
export const TOOL_CONTRACTS = [
  ...ANALYSIS_SETTINGS_TOOL_CONTRACTS,
  ...OFFICIAL_TOOL_CONTRACTS,
  ...ENHANCED_TOOL_CONTRACTS,
  ...NATIVE_TOOL_CONTRACTS,
  ...BINARY_DIAGNOSTICS_TOOL_CONTRACTS,
  ...ANALYSIS_VIEW_TOOL_CONTRACTS,
  ...ARTIFACT_TOOL_CONTRACTS,
  ...DESKTOP_APPLICATION_TOOL_CONTRACTS,
  ...EVM_TOOL_CONTRACTS,
  ...GO_TOOL_CONTRACTS,
  ...IL2CPP_TOOL_CONTRACTS,
  ...MODEL_TOOL_CONTRACTS,
  ...GPU_TOOL_CONTRACTS,
  ...RUST_TOOL_CONTRACTS,
  ...PYTHON_PYC_TOOL_CONTRACTS,
  ...ERLANG_BEAM_TOOL_CONTRACTS,
  ...WASM_TOOL_CONTRACTS,
  ...APK_SIGNATURE_TOOL_CONTRACTS,
  ...SQLITE_TOOL_CONTRACTS,
  ...CAPTURE_TOOL_CONTRACTS,
  ...SIGNAL_TOOL_CONTRACTS,
  ...MANAGED_TOOL_CONTRACTS,
  ...ANDROID_TOOL_CONTRACTS,
  ...APKTOOL_TOOL_CONTRACTS,
  ...PCAP_TOOL_CONTRACTS,
  ...FLUTTER_TOOL_CONTRACTS,
  ...JEB_TOOL_CONTRACTS,
  ...ADB_TOOL_CONTRACTS,
  ...FIRMWARE_TOOL_CONTRACTS,
  ...MANAGED_WORKFLOW_TOOL_CONTRACTS,
  ...BROWSER_PROVIDER_TOOL_CONTRACTS,
  ...ELECTRON_TOOL_CONTRACTS,
  ...JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS,
  ...APPLICATION_TOOL_CONTRACTS,
  ...WEB_SCRIPT_TOOL_CONTRACTS,
  ...WEB_RUNTIME_TOOL_CONTRACTS,
  ...WEB_NETWORK_CAPTURE_TOOL_CONTRACTS,
  ...ENVIRONMENT_TOOL_CONTRACTS,
  ...JAVASCRIPT_RECOVERY_TOOL_CONTRACTS,
  ...SESSION_TOOL_CONTRACTS,
  ...CUTTER_TOOL_CONTRACTS,
  ...REVERSE_ENGINEERING_TOOL_CONTRACTS,
  ...GDB_TOOL_CONTRACTS,
  ...RIZIN_DEBUG_TOOL_CONTRACTS,
  ...FRIDA_TOOL_CONTRACTS,
] as const;

/** Resolve a public contract by name while retaining its exact schema types. */
export const toolContract = <
  Name extends (typeof TOOL_CONTRACTS)[number]["name"],
>(
  name: Name,
): Extract<(typeof TOOL_CONTRACTS)[number], { readonly name: Name }> => {
  const contract = TOOL_CONTRACTS.find(
    (
      candidate,
    ): candidate is Extract<
      (typeof TOOL_CONTRACTS)[number],
      { readonly name: Name }
    > => candidate.name === name,
  );
  if (contract === undefined) throw new Error(`Missing tool contract: ${name}`);
  return contract;
};
