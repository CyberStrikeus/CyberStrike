import { ANALYSIS_SETTINGS_TOOL_CONTRACTS } from "./analysisSettingsContracts.js";
import { ENVIRONMENT_TOOL_CONTRACTS } from "./environmentToolContracts.js";
import { CAPTURE_TOOL_CONTRACTS } from "./captures/captureToolContracts.js";
import { SIGNAL_TOOL_CONTRACTS } from "./signals/signalToolContracts.js";
import { WASM_TOOL_CONTRACTS } from "./wasm/wasmToolContracts.js";
import { EVM_TOOL_CONTRACTS } from "./evm/evmToolContracts.js";
import { GO_TOOL_CONTRACTS } from "./go/goToolContracts.js";
import { GPU_TOOL_CONTRACTS } from "./gpu/gpuToolContracts.js";
import { RUST_TOOL_CONTRACTS } from "./rust/rustToolContracts.js";
import { SQLITE_TOOL_CONTRACTS } from "./sqlite/sqliteToolContracts.js";
import { ANALYSIS_VIEW_TOOL_CONTRACTS } from "./analysisViewToolContracts.js";
import { BINARY_DIAGNOSTICS_TOOL_CONTRACTS } from "./native/binaryDiagnosticsToolContracts.js";
import { NATIVE_TOOL_CONTRACTS } from "./native/nativeToolContracts.js";
import { CUTTER_TOOL_CONTRACTS } from "./cutterToolContracts.js";
import { REVERSE_ENGINEERING_TOOL_CONTRACTS } from "./reverseEngineeringToolContracts.js";
import { GDB_TOOL_CONTRACTS } from "./gdbToolContracts.js";
import { RIZIN_DEBUG_TOOL_CONTRACTS } from "./rizinDebugToolContracts.js";
import { ARTIFACT_TOOL_CONTRACTS } from "./artifactToolContracts.js";
import { APK_SIGNATURE_TOOL_CONTRACTS } from "./apkSignature/apkSignatureToolContracts.js";
import { ERLANG_BEAM_TOOL_CONTRACTS } from "./erlang/beamToolContracts.js";
import { PYTHON_PYC_TOOL_CONTRACTS } from "./python/pythonPycToolContracts.js";
import { DESKTOP_APPLICATION_TOOL_CONTRACTS } from "./desktopApplicationToolContracts.js";
import { IL2CPP_TOOL_CONTRACTS } from "./il2cpp/il2cppToolContracts.js";
import { MODEL_TOOL_CONTRACTS } from "./model/modelToolContracts.js";
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
import { FRIDA_TOOL_CONTRACTS } from "./fridaToolContracts.js";
import { TOOL_CONTRACTS } from "./toolContracts.js";
import type { ToolFamilyId } from "./toolFamilyIds.js";

/** One selectable family: a stable selection id and its complete contract set. */
export interface ToolFamilyDefinition {
  readonly id: ToolFamilyId;
  readonly surface: string;
  readonly contracts: readonly (typeof TOOL_CONTRACTS)[number][];
}

/**
 * Complete ordered tool-family inventory. Every contract in `TOOL_CONTRACTS`
 * belongs to exactly one family; runtime advertising scopes and the product
 * catalog both derive from this single grouping.
 */
export const TOOL_FAMILY_DEFINITIONS = [
  {
    id: "direct",
    surface: "official-proxy",
    contracts: OFFICIAL_TOOL_CONTRACTS,
  },
  { id: "enhanced", surface: "enhanced", contracts: ENHANCED_TOOL_CONTRACTS },
  {
    id: "native",
    surface: "native-provider",
    contracts: [
      ...NATIVE_TOOL_CONTRACTS,
      ...BINARY_DIAGNOSTICS_TOOL_CONTRACTS,
      ...CUTTER_TOOL_CONTRACTS,
      ...REVERSE_ENGINEERING_TOOL_CONTRACTS,
      ...GDB_TOOL_CONTRACTS,
      ...RIZIN_DEBUG_TOOL_CONTRACTS,
    ],
  },
  {
    id: "artifact",
    surface: "artifact-provider",
    contracts: [
      ...ARTIFACT_TOOL_CONTRACTS,
      ...DESKTOP_APPLICATION_TOOL_CONTRACTS,
      ...EVM_TOOL_CONTRACTS,
      ...GO_TOOL_CONTRACTS,
      ...GPU_TOOL_CONTRACTS,
      ...IL2CPP_TOOL_CONTRACTS,
      ...MODEL_TOOL_CONTRACTS,
      ...RUST_TOOL_CONTRACTS,
      ...PYTHON_PYC_TOOL_CONTRACTS,
      ...ERLANG_BEAM_TOOL_CONTRACTS,
      ...WASM_TOOL_CONTRACTS,
      ...APK_SIGNATURE_TOOL_CONTRACTS,
      ...SQLITE_TOOL_CONTRACTS,
      ...CAPTURE_TOOL_CONTRACTS,
      ...SIGNAL_TOOL_CONTRACTS,
    ],
  },
  {
    id: "managed",
    surface: "managed",
    contracts: [...MANAGED_TOOL_CONTRACTS, ...MANAGED_WORKFLOW_TOOL_CONTRACTS],
  },
  {
    id: "firmware",
    surface: "firmware-provider",
    contracts: FIRMWARE_TOOL_CONTRACTS,
  },
  {
    id: "android",
    surface: "android-provider",
    contracts: ANDROID_TOOL_CONTRACTS,
  },
  { id: "pcap", surface: "pcap-provider", contracts: PCAP_TOOL_CONTRACTS },
  {
    id: "flutter",
    surface: "flutter-provider",
    contracts: FLUTTER_TOOL_CONTRACTS,
  },
  {
    id: "frida",
    surface: "instrumentation-provider",
    contracts: FRIDA_TOOL_CONTRACTS,
  },
  {
    id: "apktool",
    surface: "apktool-provider",
    contracts: APKTOOL_TOOL_CONTRACTS,
  },
  { id: "jeb", surface: "jeb-provider", contracts: JEB_TOOL_CONTRACTS },
  { id: "adb", surface: "adb-provider", contracts: ADB_TOOL_CONTRACTS },
  {
    id: "browser",
    surface: "browser-provider",
    contracts: [
      ...BROWSER_PROVIDER_TOOL_CONTRACTS,
      ...WEB_RUNTIME_TOOL_CONTRACTS,
      ...WEB_NETWORK_CAPTURE_TOOL_CONTRACTS,
    ],
  },
  {
    id: "electron",
    surface: "electron-provider",
    contracts: ELECTRON_TOOL_CONTRACTS,
  },
  {
    id: "javascript-runtime",
    surface: "runtime-provider",
    contracts: JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS,
  },
  {
    id: "application",
    surface: "application-workflow",
    contracts: [
      ...APPLICATION_TOOL_CONTRACTS,
      ...ANALYSIS_SETTINGS_TOOL_CONTRACTS,
      ...ENVIRONMENT_TOOL_CONTRACTS,
      ...ANALYSIS_VIEW_TOOL_CONTRACTS,
      ...WEB_SCRIPT_TOOL_CONTRACTS,
      ...JAVASCRIPT_RECOVERY_TOOL_CONTRACTS,
    ],
  },
  { id: "session", surface: "session", contracts: SESSION_TOOL_CONTRACTS },
] as const satisfies readonly ToolFamilyDefinition[];

const familyByTool = new Map<string, ToolFamilyId>();
for (const { id, contracts } of TOOL_FAMILY_DEFINITIONS)
  for (const contract of contracts) familyByTool.set(contract.name, id);

/** The family that owns a public tool name; undefined when none does. */
export const toolFamilyId = (name: string): ToolFamilyId | undefined =>
  familyByTool.get(name);

/**
 * Contracts in the selected families, in canonical catalog order.
 * An absent selection means the complete catalog, matching unscoped servers.
 */
export const contractsForToolFamilies = (
  selection: ReadonlySet<string> | undefined,
): readonly (typeof TOOL_CONTRACTS)[number][] =>
  selection === undefined
    ? TOOL_CONTRACTS
    : TOOL_CONTRACTS.filter(({ name }) => {
        const family = toolFamilyId(name);
        return family !== undefined && selection.has(family);
      });
