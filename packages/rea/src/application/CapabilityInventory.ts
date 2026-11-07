import { PCAP_CAPTURE_UNSUPPORTED_HOST_REASON } from "../domain/pcap/pcapAnalysis.js";
import { DEFAULT_CALL_RELATIONSHIP_DIRECTION } from "../contracts/enhancedInputs.js";
import { FIRMWARE_TOOL_REQUIREMENTS } from "../contracts/firmware/firmwareToolRequirements.js";
import { CALL_RELATIONSHIP_TRAVERSALS } from "./CallRelationshipTraversal.js";
import { NATIVE_DISPATCH_METADATA_SOURCES } from "./native/NativeDispatchMetadataInspection.js";
import { NATIVE_UI_ACTION_OPERATIONS } from "./native/NativeUiActionTrace.js";
import { NATIVE_CALL_ROUTE_SOURCES } from "./native/NativeCallRoutes.js";
import { z } from "zod";
import type { BinarySessionDetail } from "../contracts/sessionStatusContract.js";
import { sqliteDatabaseCapability } from "./sqlite/SqliteDatabaseCapability.js";
import type {
  OptionalProviderLoadFailures,
  OptionalProviderLoadFailure,
} from "./OptionalObservationProviders.js";

import {
  expandProviderCapabilities,
  providerCapabilitySet,
  toolAvailabilityInventory,
  toolAvailabilitySummaryInventory,
  TOOL_ANNOTATION_NAMES,
  TOOL_EFFECT_NAMES,
  type ProviderCapability,
  type ToolAvailabilityInventory,
  type ToolAvailabilitySummaryInventory,
  type ToolAvailability,
  type ToolAvailabilityMode,
  type ToolUnavailabilityReason,
} from "../contracts/toolOutputSchemaPrimitives.js";
import {
  annotationsFromEffects,
  type ToolEffects,
} from "../contracts/toolEffects.js";
import type { ToolKind } from "../contracts/toolContractTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { isMachOFormat } from "../domain/binaryTargetTypes.js";
import type {
  AnalysisOperation,
  ProviderAvailability,
} from "./AnalysisProvider.js";
import type { JebAnalysisAvailability } from "./jeb/JebAnalysisPort.js";
import { FRIDA_TOOL_CONTRACTS } from "../contracts/fridaToolContracts.js";
import { TOOL_CONTRACTS } from "../contracts/toolContracts.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { isBundleResourceOperation } from "./binary/BundleResourceSession.js";

const FRIDA_OPERATION_NAMES: ReadonlySet<string> = new Set(
  FRIDA_TOOL_CONTRACTS.map(({ name }) => name),
);

const statusSchema = z.object({
  open: z.boolean(),
  session_kind: z.literal("bundle_resources").optional(),
  kind: z.enum(["executable", "database", "archive", "artifact"]).optional(),
  format: z.string().optional(),
  capabilities: z
    .array(providerCapabilitySet)
    .transform(expandProviderCapabilities),
});

type ToolAvailabilityReason = "available" | ToolUnavailabilityReason;

type ProviderDescriptor = ProviderCapability;

/** Optional integrations whose verified hosts exclude some platforms. */
export const HOST_RESTRICTED_FEATURES = [
  "packetCapture",
  "pcapCapture",
  "signalRecording",
  "evmInterface",
  "binaryLayout",
  "recordedCrash",
  "firmwareInspection",
  "firmwareExtraction",
  "javascriptRecovery",
  "persistentDebugger",
] as const;
export type HostRestrictedFeature = (typeof HOST_RESTRICTED_FEATURES)[number];

export type AvailabilityPolicy = {
  /** Integrations this host cannot run, whatever their configuration. */
  readonly hostUnsupported?: Readonly<
    Partial<Record<HostRestrictedFeature, boolean>>
  >;
  readonly packetCaptureEnabled?: boolean;
  readonly signalRecordingEnabled?: boolean;
  readonly wasmArtifactEnabled?: boolean;
  readonly evmInterfaceEnabled?: boolean;
  /** Fresh owner observation of the selected required EVM limiter. */
  readonly evmLimiterAvailability?: ProviderAvailability;
  readonly processCaptureEnabled: boolean;
  readonly optionalProviderLoadFailures?: OptionalProviderLoadFailures;
  readonly binaryLayoutEnabled?: boolean;
  readonly recordedCrashEnabled?: boolean;
  readonly firmwareInspectionEnabled?: boolean;
  readonly firmwareExtractionEnabled?: boolean;
  readonly androidAnalysisAvailability?: ProviderAvailability;
  readonly adbAnalysisAvailability?: ProviderAvailability;
  readonly apktoolAnalysisAvailability?: ProviderAvailability;
  readonly jebAnalysisAvailability?: JebAnalysisAvailability;
  readonly javascriptRecoveryEnabled?: boolean;
  readonly webModuleResolutionEnabled?: boolean;
  readonly browserObservationEnabled?: boolean;
  readonly browserScenarioEnabled?: boolean;
  readonly electronObservationEnabled?: boolean;
  readonly electronAutomationEnabled?: boolean;
  readonly v8InspectorObservationEnabled?: boolean;
};

type AvailabilityFacts = {
  readonly defaultModeAvailable?: boolean;
  readonly modes?: readonly ToolAvailabilityMode[];
};
type Availability = AvailabilityFacts &
  (
    | { readonly reason: "available"; readonly remediation: null }
    | {
        readonly reason: ToolUnavailabilityReason;
        readonly remediation: string | null;
      }
  );
type AvailabilityModeResult =
  | (Extract<ToolAvailabilityMode, { available: true }> & {
      readonly reason: "available";
    })
  | (Extract<ToolAvailabilityMode, { available: false }> & {
      readonly reason: ToolUnavailabilityReason;
    });
type AvailabilityContext = {
  readonly name: string;
  readonly kind: ToolKind;
  readonly targetOpen: boolean;
  readonly resourceSession: boolean;
  readonly requiresActiveTarget: boolean;
  readonly targetKind:
    | "executable"
    | "database"
    | "archive"
    | "artifact"
    | undefined;
  readonly targetFormat: string | undefined;
  readonly descriptors: ReadonlyMap<string, ProviderDescriptor>;
  readonly policy: AvailabilityPolicy;
};

type EnhancedContractName = Extract<
  (typeof TOOL_CONTRACTS)[number],
  { readonly kind: "enhanced" }
>["name"];
type CompositionRequirements = readonly (
  | AnalysisOperation
  | readonly AnalysisOperation[]
)[];
type AvailabilityMode = {
  readonly name: string;
  readonly requirements: CompositionRequirements;
};
type ModeComposition = {
  readonly defaultMode?: string;
  readonly modes: readonly AvailabilityMode[];
};
type ProviderComposition = CompositionRequirements | ModeComposition;

const CALL_RELATIONSHIP_COMPOSITION: ModeComposition = {
  defaultMode: DEFAULT_CALL_RELATIONSHIP_DIRECTION,
  modes: Object.entries(CALL_RELATIONSHIP_TRAVERSALS).map(
    ([name, traversal]) => ({
      name,
      requirements: ["procedure_address", traversal.operation],
    }),
  ),
};

const NATIVE_UI_ACTION_COMPOSITION: ModeComposition = {
  modes: [
    {
      name: "authored_ui_dispatch",
      requirements: [
        NATIVE_UI_ACTION_OPERATIONS.interfaceBuilder,
        Object.values(NATIVE_DISPATCH_METADATA_SOURCES),
      ],
    },
    {
      name: "native_seed_call_trace",
      requirements: [
        Object.values(NATIVE_DISPATCH_METADATA_SOURCES),
        NATIVE_UI_ACTION_OPERATIONS.nativeSeed,
        Object.values(NATIVE_CALL_ROUTE_SOURCES),
      ],
    },
  ],
};

// Complete coverage is checked against canonical enhanced contracts, rather than
// allowing a newly registered workflow to silently look like a missing provider.
const ENHANCED_REQUIREMENTS: ReadonlyMap<string, ProviderComposition> = new Map(
  Object.entries({
    trace_native_values: ["analyze_function", "resolve_native_call_targets"],
    trace_native_ui_action: NATIVE_UI_ACTION_COMPOSITION,
    inspect_native_dispatch_metadata: [
      Object.values(NATIVE_DISPATCH_METADATA_SOURCES),
    ],
    get_objc_classes: ["list_names"],
    get_objc_protocols: ["list_names"],
    batch_decompile: ["procedure_pseudo_code"],
    decompile_all: ["list_procedures", "procedure_pseudo_code"],
    get_call_graph: CALL_RELATIONSHIP_COMPOSITION,
    trace_call_path: CALL_RELATIONSHIP_COMPOSITION,
    analyze_swift_types: ["list_procedures"],
    find_xrefs_to_name: ["list_names", "xrefs"],
    binary_overview: [
      ["current_document", "list_documents"],
      "list_procedures",
      "list_strings",
    ],
    analyze_function: ["analyze_function"],
    inspect_native_api: ["analyze_function"],
    trace_feature: [
      "search_strings",
      "search_procedures",
      "xrefs",
      "resolve_containing_procedure",
    ],
  } satisfies Readonly<Record<EnhancedContractName, ProviderComposition>>),
);

/** Native contracts defined only for an active Mach-O executable. */
const MACHO_TARGET_OPERATIONS: ReadonlySet<string> = new Set([
  "inspect_signature",
  "inspect_macho",
  "list_architectures",
  "observe_native_calls",
  "observe_native_ui",
  "capture_native_ui_scenario",
]);

const NAVIGATION_CONTEXT_MODES = [
  {
    name: "current_selection",
    requirements: [
      "current_document",
      "current_address",
      "resolve_containing_procedure",
    ],
  },
  {
    name: "explicit_document",
    requirements: ["current_address", "resolve_containing_procedure"],
  },
] as const;

/** Build stable per-operation availability for discovery and tool visibility. */
export const buildCapabilityInventory = (
  sessionStatus: JsonValue,
  policy: AvailabilityPolicy,
): readonly ToolAvailability[] => {
  const status = statusSchema.parse(sessionStatus);
  const descriptors = new Map<string, ProviderDescriptor>(
    status.capabilities.map((descriptor) => [descriptor.operation, descriptor]),
  );
  return TOOL_CONTRACTS.map((contract): ToolAvailability => {
    const availability = availabilityFor({
      name: contract.name,
      kind: contract.kind,
      targetOpen: status.open,
      resourceSession: status.session_kind === "bundle_resources",
      requiresActiveTarget:
        "requiresActiveTarget" in contract &&
        contract.requiresActiveTarget === true,
      targetKind: status.kind,
      targetFormat: status.format,
      descriptors,
      policy,
    });
    const effects = composedEffects(
      contract.name,
      contract.effects,
      status.capabilities,
    );
    const annotations = annotationsFromEffects(effects);
    const facts = {
      name: contract.name,
      surface: contract.kind,
      ...(availability.defaultModeAvailable === undefined
        ? {}
        : { default_mode_available: availability.defaultModeAvailable }),
      ...(availability.modes === undefined
        ? {}
        : { modes: [...availability.modes] }),
      client_requirements: emptyClientRequirements(),
      effects,
      annotations: {
        read_only: annotations.readOnlyHint,
        destructive: annotations.destructiveHint,
        idempotent: annotations.idempotentHint,
        open_world: annotations.openWorldHint,
      },
    };
    return availability.reason === "available"
      ? {
          ...facts,
          available: true,
          reason: availability.reason,
          remediation: null,
        }
      : {
          ...facts,
          available: false,
          reason: availability.reason,
          remediation: availability.remediation,
        };
  }).sort((left, right) => compareUnicodeCodePoints(left.name, right.name));
};

type ClientRequirements = ToolAvailability["client_requirements"];

// Current workflows do not require negotiated MCP client features.
const emptyClientRequirements = (): ClientRequirements => ({
  required: [],
  optional: [],
  missing_required: [],
  missing_optional: [],
});

/**
 * Group every operation's current availability inline. Complete detail also
 * groups by the static surface, effect, and annotation flags; summary omits
 * those flags so tools that share a status collapse into one group.
 */
export function compactToolAvailability(
  availability: readonly ToolAvailability[],
  detail?: "complete",
): ToolAvailabilityInventory;
export function compactToolAvailability(
  availability: readonly ToolAvailability[],
  detail: BinarySessionDetail,
): ToolAvailabilityInventory | ToolAvailabilitySummaryInventory;
export function compactToolAvailability(
  availability: readonly ToolAvailability[],
  detail: BinarySessionDetail = "complete",
): ToolAvailabilityInventory | ToolAvailabilitySummaryInventory {
  const clientRequirements =
    availability[0]?.client_requirements ?? emptyClientRequirements();
  const groups = new Map<string, { names: string[] }>();

  for (const entry of availability) {
    const statusFacts = {
      available: entry.available,
      reason: entry.reason,
      remediation: entry.remediation,
      ...(entry.default_mode_available === undefined
        ? {}
        : { default_mode_available: entry.default_mode_available }),
      ...(entry.modes === undefined ? {} : { modes: [...entry.modes] }),
      ...(JSON.stringify(entry.client_requirements) ===
      JSON.stringify(clientRequirements)
        ? {}
        : { client_requirements: entry.client_requirements }),
    };
    const groupFacts =
      detail === "summary"
        ? statusFacts
        : {
            surface: entry.surface,
            effects: TOOL_EFFECT_NAMES.filter((name) => entry.effects[name]),
            annotations: TOOL_ANNOTATION_NAMES.filter(
              (name) => entry.annotations[name],
            ),
            ...statusFacts,
          };
    const key = JSON.stringify(groupFacts);
    const existing = groups.get(key);
    if (existing) existing.names.push(entry.name);
    else groups.set(key, { ...groupFacts, names: [entry.name] });
  }

  const inventory = {
    client_requirements: clientRequirements,
    groups: [...groups.values()],
  };
  return detail === "summary"
    ? toolAvailabilitySummaryInventory.parse(inventory)
    : toolAvailabilityInventory.parse(inventory);
}

const availabilityFor = (context: AvailabilityContext): Availability => {
  const workflowAvailability = workflowAvailabilityFor(context);
  if (
    context.targetOpen &&
    context.resourceSession &&
    context.requiresActiveTarget &&
    !isBundleResourceOperation(context.name) &&
    (workflowAvailability === null || context.kind === "session")
  )
    return {
      reason: "target_unsupported",
      remediation:
        "This resource-only session cannot execute this operation. Call open_binary with an executable analysis target.",
    };
  // These built-in workflows accept a caller-selected endpoint; they do not load the optional passive provider.
  if (
    context.name === "inspect_byte_entropy" ||
    context.name === "observe_web_execution" ||
    context.name === "inspect_web_event_listeners"
  )
    return { reason: "available", remediation: null };
  if (context.name === "get_navigation_context") {
    const modes = availabilityForModes(
      NAVIGATION_CONTEXT_MODES,
      "current_selection",
      context.descriptors,
    );
    return { ...modes, ...targetAvailability(context) };
  }
  const javascriptApplication = javascriptApplicationAvailability(context);
  if (javascriptApplication !== null) return javascriptApplication;
  const failure = optionalProviderFailureFor(context);
  if (failure !== undefined)
    return {
      reason: "provider_unavailable",
      remediation: `Adapter ${failure.providerId} could not load: ${failure.reason}. Repair the adapter installation and restart REA; other capabilities remain available.`,
    };
  if (workflowAvailability !== null) return workflowAvailability;
  const hostDecision = hostAvailability(context);
  if (hostDecision !== null) return hostDecision;
  const targetDecision = targetAvailability(context);
  if (targetDecision !== null) return targetDecision;
  return providerAvailability(context);
};

const optionalProviderFailureFor = ({
  name,
  kind,
  policy,
}: AvailabilityContext): OptionalProviderLoadFailure | undefined => {
  const failures = policy.optionalProviderLoadFailures;
  if (name === "capture_browser_scenario")
    return failures?.browserScenarioCapture;
  if (kind === "browser-provider") return failures?.browserObservation;
  if (name === "capture_electron_scenario")
    return failures?.electronActiveObservation;
  if (kind === "electron-provider") return failures?.electronObservation;
  if (kind === "runtime-provider")
    return failures?.javascriptRuntimeObservation;
  if (FRIDA_OPERATION_NAMES.has(name)) return failures?.fridaInstrumentation;
  return undefined;
};

const javascriptApplicationAvailability = ({
  name,
}: AvailabilityContext): Availability | null => {
  if (name === "analyze_javascript_application")
    return { reason: "available", remediation: null };
  return name === "reconcile_javascript_runtime"
    ? { reason: "available", remediation: null }
    : null;
};

const workflowAvailabilityFor = ({
  name,
  kind,
  policy,
}: AvailabilityContext): Availability | null => {
  if (name === "start_gdb_session" || name === "start_rizin_debug_session")
    return hostRestrictedAvailability(
      policy,
      "persistentDebugger",
      true,
      "Run persistent debugger sessions on Linux with /proc descriptor readback.",
    );
  if (
    name === "inspect_apk_signature" ||
    name === "inspect_desktop_application" ||
    name === "inspect_go_binary" ||
    name === "inspect_il2cpp_metadata" ||
    name === "inspect_model_artifact" ||
    name === "inspect_gpu_code_objects" ||
    name === "inspect_rust_binary" ||
    name === "inspect_python_pyc" ||
    name === "inspect_apple_ips" ||
    name === "inspect_erlang_beam" ||
    name === "inspect_electron_fuses"
  )
    return { reason: "available", remediation: null };
  if (name === "inspect_sqlite_database") {
    const capability = sqliteDatabaseCapability(process.versions.node);
    return capability.available
      ? { reason: "available", remediation: null }
      : {
          reason: "provider_unavailable",
          remediation: capability.reason,
        };
  }
  if (name === "trace_web_module_imports")
    return {
      reason: "available",
      remediation: null,
      defaultModeAvailable: policy.webModuleResolutionEnabled === true,
      modes: [
        {
          name: "sources-without-literal-imports",
          available: true,
          missing_operations: [],
          remediation: null,
        },
        policy.webModuleResolutionEnabled === true
          ? {
              name: "native-literal-resolution",
              available: true,
              missing_operations: [],
              remediation: null,
            }
          : {
              name: "native-literal-resolution",
              available: false,
              missing_operations: ["native-module-resolver"],
              remediation:
                "Provide an absolute REA_BROWSER_EXECUTABLE supporting import.meta.resolve; no binary target is required.",
            },
      ],
    };
  if (name === "recover_javascript_sources")
    return hostRestrictedAvailability(
      policy,
      "javascriptRecovery",
      policy.javascriptRecoveryEnabled,
      "On Linux x64, provide an absolute REA_WAKARU_COMMAND for Wakaru ^1.13.0 (verified with 1.14.0) and util-linux prlimit; see docs/javascript-recovery.md#install-wakaru. No binary target is required.",
    );
  if (name === "inspect_binary_layout")
    return hostRestrictedAvailability(
      policy,
      "binaryLayout",
      policy.binaryLayoutEnabled,
      "On Linux x64, set absolute REA_PWNTOOLS_PYTHON to caller-supplied Python with pwntools 4.15.0. No active binary target is required.",
    );
  if (name === "inspect_packet_capture" || name === "inspect_packet_fields")
    return hostRestrictedAvailability(
      policy,
      "packetCapture",
      policy.packetCaptureEnabled,
      "On Linux, supply TShark 4.x on PATH or through absolute REA_TSHARK_COMMAND, and util-linux prlimit (REA_TSHARK_PRLIMIT_COMMAND, default /usr/bin/prlimit). No active binary target or hardware is required; the tool is checked at execution.",
    );
  if (name === "decode_signal_recording" || name === "inspect_signal_decoders")
    return hostRestrictedAvailability(
      policy,
      "signalRecording",
      policy.signalRecordingEnabled,
      "On Linux, supply sigrok-cli 0.7.2 via absolute REA_SIGROK_COMMAND and util-linux prlimit (REA_SIGROK_PRLIMIT_COMMAND, default /usr/bin/prlimit). No active binary target or hardware is required; the tool is checked at execution.",
    );
  if (name === "inspect_wasm_artifact")
    return policy.wasmArtifactEnabled === true
      ? { reason: "available", remediation: null }
      : {
          reason: "provider_missing",
          remediation:
            "Supply WABT 1.0.42 via absolute REA_WABT_BIN_DIRECTORY. No active binary target is required; tools are checked at execution.",
        };
  if (name === "inspect_pe_resources" || name === "inspect_native_exports")
    return { reason: "available", remediation: null };
  if (name === "inspect_pe_certificates" || name === "inspect_pe_imports")
    return { reason: "available", remediation: null };
  if (
    name === "inspect_elf_notes" ||
    name === "inspect_devicetree" ||
    name === "inspect_kernel_module" ||
    name === "inspect_pe_load_config"
  )
    return { reason: "available", remediation: null };
  if (name === "inspect_evm_interface") {
    const profile = hostRestrictedAvailability(
      policy,
      "evmInterface",
      policy.evmInterfaceEnabled,
      "The bundled offline EVM interface profile is currently real-verified on Linux x64. No active binary target or chain endpoint is required.",
    );
    if (profile.reason !== "available") return profile;
    const limiter = policy.evmLimiterAvailability;
    if (limiter?.status === "unavailable")
      return { reason: "provider_missing", remediation: limiter.reason };
    return { reason: "available", remediation: null };
  }
  if (name === "inspect_recorded_crash")
    return hostRestrictedAvailability(
      policy,
      "recordedCrash",
      policy.recordedCrashEnabled,
      "On Linux x64, set absolute REA_PWNTOOLS_PYTHON to caller-supplied Python with pwntools 4.15.0. No active binary target is required.",
    );
  if (kind === "firmware-provider") {
    const { binwalk, unblob } = FIRMWARE_TOOL_REQUIREMENTS;
    const inspection = name === "inspect_firmware_regions";
    return hostRestrictedAvailability(
      policy,
      inspection ? "firmwareInspection" : "firmwareExtraction",
      inspection
        ? policy.firmwareInspectionEnabled
        : policy.firmwareExtractionEnabled,
      `On Linux, provide an absolute ${binwalk.commandEnvironment} (${binwalk.name} ${binwalk.line}, verified with ${binwalk.version}) or ${unblob.commandEnvironment} (${unblob.name} ${unblob.line}, verified with ${unblob.version}) path and util-linux prlimit. Extraction also requires the selected format’s external extractor.`,
    );
  }
  if (kind === "android-provider")
    return policy.androidAnalysisAvailability?.status === "available"
      ? { reason: "available", remediation: null }
      : {
          reason:
            policy.androidAnalysisAvailability?.code === "unsupported_host"
              ? "unsupported_host"
              : policy.androidAnalysisAvailability?.code ===
                  "runtime_unavailable"
                ? "provider_unavailable"
                : "provider_missing",
          remediation:
            policy.androidAnalysisAvailability?.reason ??
            "Set REA_JADX_MCP_JAR to a caller-supplied jadx-headless-mcp 0.7.1 JAR and provide a full JDK on Linux, macOS, or Windows x64 with its matching bundled native controls.",
        };
  if (kind === "adb-provider")
    return ownerProbeAvailability(
      policy.adbAnalysisAvailability,
      "Set REA_ADB_PATH to a caller-supplied adb executable or make adb available on PATH. This checks the client version only; device and serial availability depend on the request.",
    );
  if (kind === "apktool-provider")
    return ownerProbeAvailability(
      policy.apktoolAnalysisAvailability,
      "Set REA_APKTOOL_COMMAND to a caller-supplied Apktool executable or make Apktool 2.7.0 or newer available on PATH.",
    );
  if (kind === "jeb-provider") {
    const availability = policy.jebAnalysisAvailability;
    if (availability?.status === "available")
      return availability.supportedOperations.some(
        (operation) => operation === name,
      )
        ? { reason: "available", remediation: null }
        : {
            reason: "provider_unavailable",
            remediation: `The running JEB endpoint does not advertise support for ${name}. Use a JEB client build that provides this operation.`,
          };
    return ownerProbeAvailability(
      availability,
      "Start a JEB client serving MCP (GUI client, or headless via its programmatic launcher) and point REA_JEB_MCP_URL at it (default http://127.0.0.1:8425/mcp). REA does not install or launch JEB.",
    );
  }
  const browser = browserProviderAvailability(name, kind, policy);
  if (browser !== null) return browser;
  if (name === "capture_process_scenario" && !policy.processCaptureEnabled)
    return {
      reason: "unsupported_host",
      remediation: "Run process capture on a supported Linux or macOS host.",
    };
  if (kind === "application") return { reason: "available", remediation: null };
  if (name === "inspect_pcap_capture")
    return hostRestrictedAvailability(
      policy,
      "pcapCapture",
      true,
      PCAP_CAPTURE_UNSUPPORTED_HOST_REASON,
    );
  if (kind === "pcap-provider" || kind === "flutter-provider")
    return { reason: "available", remediation: null };
  const electron = electronProviderAvailability(name, kind, policy);
  if (electron !== null) return electron;
  if (kind === "runtime-provider")
    return policy.v8InspectorObservationEnabled === true
      ? { reason: "available", remediation: null }
      : {
          reason: "provider_missing",
          remediation:
            "Start REA with its JavaScript runtime provider available.",
        };
  if (kind === "session") return { reason: "available", remediation: null };
  return null;
};

/**
 * An unsupported host takes precedence over configuration: no environment
 * setting lets these integrations pass their execution host checks here.
 */
const hostRestrictedAvailability = (
  policy: AvailabilityPolicy,
  feature: HostRestrictedFeature,
  enabled: boolean | undefined,
  remediation: string,
): Availability => {
  if (policy.hostUnsupported?.[feature] === true)
    return { reason: "unsupported_host", remediation };
  return enabled === true
    ? { reason: "available", remediation: null }
    : { reason: "provider_missing", remediation };
};

const ownerProbeAvailability = (
  observation: ProviderAvailability | undefined,
  missingRemediation: string,
): Availability => {
  if (observation === undefined)
    return { reason: "provider_missing", remediation: missingRemediation };
  if (observation.status === "available")
    return { reason: "available", remediation: null };
  return {
    reason:
      observation.code === "unsupported_host"
        ? "unsupported_host"
        : observation.code === "not_configured"
          ? "provider_missing"
          : "provider_unavailable",
    remediation: observation.reason,
  };
};

const electronProviderAvailability = (
  name: string,
  kind: ToolKind,
  policy: AvailabilityPolicy,
): Availability | null => {
  if (kind !== "electron-provider") return null;
  if (name === "capture_electron_scenario")
    return policy.electronAutomationEnabled === true
      ? { reason: "available", remediation: null }
      : {
          reason: "provider_missing",
          remediation:
            "Start REA with the Electron scenario provider available.",
        };
  return policy.electronObservationEnabled === true
    ? { reason: "available", remediation: null }
    : {
        reason: "provider_missing",
        remediation:
          "Start REA with its Electron observation provider available.",
      };
};

const browserProviderAvailability = (
  name: string,
  kind: ToolKind,
  policy: AvailabilityPolicy,
): Availability | null => {
  if (name === "capture_browser_scenario")
    return policy.browserScenarioEnabled === true
      ? { reason: "available", remediation: null }
      : {
          reason: "provider_missing",
          remediation:
            "Start REA with its browser scenario provider available.",
        };
  if (kind !== "browser-provider") return null;
  return policy.browserObservationEnabled === true
    ? { reason: "available", remediation: null }
    : {
        reason: "provider_missing",
        remediation:
          "Start REA with its browser observation provider available.",
      };
};

/**
 * Opening another target cannot make an operation run on an unsupported host.
 * Composed operations are decided by their requirements, which another
 * provider may satisfy.
 */
const hostAvailability = ({
  descriptors,
  kind,
  name,
}: AvailabilityContext): Availability | null => {
  if (kind === "enhanced") return null;
  const descriptor = descriptors.get(name);
  return descriptor?.available === false &&
    descriptor.availability_code === "unsupported_host"
    ? { reason: "unsupported_host", remediation: descriptor.reason }
    : null;
};

const targetAvailability = ({
  name,
  kind,
  targetKind,
  targetFormat,
  targetOpen,
  requiresActiveTarget,
  descriptors,
}: AvailabilityContext): Availability | null => {
  if (!targetOpen && requiresActiveTarget)
    return {
      reason: "target_required",
      remediation: "Call open_binary with a supported local target.",
    };
  const descriptor = descriptors.get(name);
  if (
    targetOpen &&
    descriptor?.available === false &&
    (descriptor.availability_code === "target_kind_unsupported" ||
      descriptor.availability_code === "target_format_unsupported")
  )
    return { reason: "target_unsupported", remediation: descriptor.reason };
  if (
    targetKind !== undefined &&
    targetKind !== "executable" &&
    targetKind !== "database" &&
    (kind === "official-proxy" || kind === "enhanced")
  )
    return {
      reason: "target_unsupported",
      remediation:
        "Inventory or extract a native executable, then call open_binary on that executable.",
    };
  if (
    targetOpen &&
    MACHO_TARGET_OPERATIONS.has(name) &&
    (targetKind !== "executable" || !isMachOFormat(targetFormat))
  )
    return {
      reason: "target_unsupported",
      remediation:
        "Call open_binary with a Mach-O executable or an app bundle whose main executable is Mach-O.",
    };
  return null;
};

const providerAvailability = ({
  descriptors,
  kind,
  name,
}: AvailabilityContext): Availability => {
  if (kind === "enhanced") return composedAvailability(name, descriptors);
  const descriptor = descriptors.get(name);
  if (
    descriptor === undefined &&
    (kind === "artifact-provider" ||
      kind === "managed-provider" ||
      kind === "native-provider")
  )
    return { reason: "available", remediation: null };
  if (descriptor === undefined)
    return {
      reason: "provider_missing",
      remediation:
        "Install or configure a provider that declares this operation.",
    };
  return descriptor.available
    ? { reason: "available", remediation: null }
    : {
        reason: "provider_unavailable",
        remediation:
          descriptor.reason ?? "Choose another target or configured provider.",
      };
};

const composedAvailability = (
  name: string,
  descriptors: ReadonlyMap<string, ProviderDescriptor>,
): Availability => {
  if (
    name === "binary_overview" &&
    descriptors.get("read_binary_inventory_summary")?.available === true
  )
    return { reason: "available", remediation: null };
  const requirements = ENHANCED_REQUIREMENTS.get(name);
  if (requirements === undefined)
    return {
      reason: "provider_missing",
      remediation: "No provider composition is declared for this operation.",
    };
  return "modes" in requirements
    ? availabilityForModes(
        requirements.modes,
        requirements.defaultMode,
        descriptors,
      )
    : composedAvailabilityFor(requirements, descriptors).availability;
};

/** Evaluate source groups once so discovery and missing-operation facts agree. */
const composedAvailabilityFor = (
  requirements: CompositionRequirements,
  descriptors: ReadonlyMap<string, ProviderDescriptor>,
): {
  readonly availability: Availability;
  readonly missingOperations: readonly AnalysisOperation[];
} => {
  const unmet = requirements
    .map((requirement) => {
      const operations =
        typeof requirement === "string" ? [requirement] : requirement;
      const observations = operations.map((operation) =>
        descriptors.get(operation),
      );
      return {
        requirement,
        operations,
        available: observations.some(
          (descriptor) => descriptor?.available === true,
        ),
        unavailable: observations.find(
          (descriptor) => descriptor?.available === false,
        ),
      };
    })
    .filter((group) => !group.available);
  const missingOperations = [
    ...new Set(unmet.flatMap((group) => group.operations)),
  ];
  // Preserve the existing admission rule: report an undeclared prerequisite
  // before an unhealthy declaration, in requirement order within each class.
  const undeclared = unmet.find((group) => group.unavailable === undefined);
  if (undeclared !== undefined)
    return {
      missingOperations,
      availability: {
        reason: "provider_missing",
        remediation:
          typeof undeclared.requirement === "string"
            ? `Configure a provider for required operation ${undeclared.requirement}.`
            : `Configure a provider for one of: ${undeclared.operations.join(", ")}.`,
      },
    };
  const unavailable = unmet[0]?.unavailable;
  if (unavailable !== undefined)
    return {
      missingOperations,
      availability: {
        reason:
          unavailable.availability_code === "unsupported_host"
            ? "unsupported_host"
            : "provider_unavailable",
        remediation:
          unavailable.reason ?? "Choose another target or configured provider.",
      },
    };
  return {
    availability: { reason: "available", remediation: null },
    missingOperations,
  };
};

const availabilityForModes = (
  declarations: readonly AvailabilityMode[],
  defaultMode: string | undefined,
  descriptors: ReadonlyMap<string, ProviderDescriptor>,
): Availability => {
  const modeResults: AvailabilityModeResult[] = declarations.map((mode) => {
    const { availability, missingOperations } = composedAvailabilityFor(
      mode.requirements,
      descriptors,
    );
    if (availability.reason === "available")
      return {
        name: mode.name,
        available: true,
        reason: availability.reason,
        missing_operations: [],
        remediation: null,
      };
    return {
      name: mode.name,
      available: false,
      reason: availability.reason,
      missing_operations: [...missingOperations],
      remediation: availability.remediation,
    };
  });
  const modes: ToolAvailabilityMode[] = modeResults.map((mode) =>
    mode.available
      ? {
          name: mode.name,
          available: true,
          missing_operations: [],
          remediation: null,
        }
      : {
          name: mode.name,
          available: false,
          missing_operations: [...mode.missing_operations],
          remediation: mode.remediation,
        },
  );
  const availableMode = modeResults.find((mode) => mode.available);
  const failures = modeResults.flatMap((mode) =>
    mode.available ? [] : [mode],
  );
  const failure = failures.sort(
    (left, right) =>
      availabilityFailurePriority(left.reason) -
      availabilityFailurePriority(right.reason),
  )[0];
  const specificFailureRemediation =
    failure?.reason === "provider_missing" ? undefined : failure?.remediation;
  const facts = {
    ...(defaultMode === undefined
      ? {}
      : {
          defaultModeAvailable:
            modes.find((mode) => mode.name === defaultMode)?.available ?? false,
        }),
    modes,
  };
  if (availableMode !== undefined)
    return { ...facts, reason: "available", remediation: null };
  const missingOperations = [
    ...new Set(modes.flatMap((mode) => mode.missing_operations)),
  ];
  return {
    ...facts,
    reason: failure?.reason ?? "provider_missing",
    remediation:
      specificFailureRemediation ??
      `Configure a provider for one of: ${missingOperations.join(", ")}.`,
  };
};

const availabilityFailurePriority = (
  reason: ToolAvailabilityReason,
): number => {
  switch (reason) {
    case "unsupported_host":
      return 0;
    case "provider_unavailable":
      return 1;
    case "provider_missing":
      return 2;
    default:
      return 3;
  }
};

/** Use the same composition requirements as availability when exposing provider effects. */
const composedEffects = (
  name: string,
  base: ToolEffects,
  descriptors: readonly ProviderDescriptor[],
): ToolEffects => {
  const composition: ProviderComposition | undefined =
    name === "get_navigation_context"
      ? { modes: NAVIGATION_CONTEXT_MODES }
      : ENHANCED_REQUIREMENTS.get(name);
  const requirements: CompositionRequirements =
    composition === undefined
      ? []
      : "modes" in composition
        ? composition.modes.flatMap(({ requirements }) => requirements)
        : composition;
  const operations = new Set<string>([
    name,
    ...requirements.flatMap((group) =>
      typeof group === "string" ? [group] : group,
    ),
  ]);
  const effects = { ...base };
  for (const descriptor of descriptors) {
    if (!operations.has(descriptor.operation)) continue;
    const source = descriptor.effects;
    effects.mutatesTarget ||= source.mutates_artifact;
    effects.launchesProcess ||= source.launches_process;
    effects.changesUiState ||= source.may_show_ui;
    effects.accessesNetwork ||= source.may_access_network;
    effects.writesFilesystem ||=
      source.may_write_filesystem || source.changes_permissions;
  }
  return effects;
};
