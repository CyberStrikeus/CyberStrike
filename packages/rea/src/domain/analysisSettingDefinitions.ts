import { z } from "zod";
import type { AnalysisSettingId } from "./analysisSettings.js";
import {
  DEFAULT_ASAR_MAX_HEADER_BYTES,
  MAXIMUM_ASAR_MAX_HEADER_BYTES,
  DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS,
  DEFAULT_HOPPER_STARTUP_TIMEOUT_MS,
  MAX_NODE_TIMER_DELAY_MS,
  MAX_GHIDRA_DECOMPILE_TIMEOUT_SECONDS,
  DEFAULT_REGEX_MATCHING_DEADLINE_MS,
  MAXIMUM_REGEX_MATCHING_DEADLINE_MS,
  DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB,
  MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
  MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
  DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB,
  CAPTURE_DECODER_SEMI_SPACE_MIB,
  MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB,
  DEFAULT_JADX_OPERATION_TIMEOUT_MS,
  DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES,
  MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES,
} from "./analysisResourceLimits.js";
import {
  JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS,
  JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM,
  JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM,
} from "./javascript/javascriptAnalysisResourceControls.js";
import {
  DEFAULT_WASM_COMMAND_TIMEOUT_MS,
  MAX_WASM_COMMAND_TIMEOUT_MS,
} from "./wasm/wasmArtifact.js";
interface SettingDefinition {
  readonly environment?: string;
  readonly defaultValue: number | null;
  readonly minimum: number;
  readonly maximum: number;
  readonly unit: "bytes" | "ms" | "seconds" | "MiB";
  readonly appliesAt: "next_operation" | "next_worker" | "next_startup";
  readonly provider: string;
  readonly relatedProviders?: readonly string[];
  readonly operations: readonly string[];
  readonly parameter?: string;
}
const timer = {
  minimum: 1,
  maximum: MAX_NODE_TIMER_DELAY_MS,
  unit: "ms",
  appliesAt: "next_operation",
} as const;
/** Metadata aggregates existing owner definitions; no environment mutation or engine discovery. */
export const ANALYSIS_SETTINGS = {
  "asar.max_header_bytes": {
    environment: "REA_ASAR_MAX_HEADER_BYTES",
    defaultValue: DEFAULT_ASAR_MAX_HEADER_BYTES,
    minimum: 1,
    maximum: MAXIMUM_ASAR_MAX_HEADER_BYTES,
    unit: "bytes",
    appliesAt: "next_operation",
    provider: "rea-artifact-graph",
    relatedProviders: [
      "rea-javascript-application",
      "rea-cdp-electron",
      "rea-v8-inspector",
    ],
    operations: [
      "open_binary",
      "inspect_artifact",
      "inventory_artifact",
      "extract_artifact",
      "analyze_javascript_application",
      "inspect_electron_page",
      "observe_javascript_runtime",
    ],
  },
  "ghidra.startup_timeout_ms": {
    ...timer,
    environment: "REA_GHIDRA_STARTUP_TIMEOUT_MS",
    defaultValue: DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS,
    appliesAt: "next_startup",
    provider: "ghidra",
    operations: [
      "binary_overview",
      "list_documents",
      "list_procedures",
      "search_procedures",
      "list_strings",
      "search_strings",
      "procedure_pseudo_code",
      "procedure_assembly",
      "analyze_function",
      "decompile_all",
      "trace_native_values",
    ],
  },
  "hopper.startup_timeout_ms": {
    ...timer,
    environment: "REA_HOPPER_STARTUP_TIMEOUT_MS",
    defaultValue: DEFAULT_HOPPER_STARTUP_TIMEOUT_MS,
    appliesAt: "next_startup",
    provider: "hopper",
    operations: [
      "binary_overview",
      "list_documents",
      "list_procedures",
      "search_procedures",
      "list_strings",
      "search_strings",
      "procedure_pseudo_code",
      "procedure_assembly",
      "analyze_function",
      "decompile_all",
      "trace_native_values",
    ],
  },
  "ghidra.decompile_timeout_seconds": {
    environment: "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
    defaultValue: null,
    minimum: 1,
    maximum: MAX_GHIDRA_DECOMPILE_TIMEOUT_SECONDS,
    unit: "seconds",
    appliesAt: "next_operation",
    provider: "ghidra",
    operations: [
      "procedure_pseudo_code",
      "analyze_function",
      "decompile_all",
      "trace_native_values",
    ],
  },
  "jadx.operation_timeout_ms": {
    ...timer,
    environment: "REA_JADX_OPERATION_TIMEOUT_MS",
    defaultValue: DEFAULT_JADX_OPERATION_TIMEOUT_MS,
    provider: "jadx",
    operations: [
      "inspect_android_package",
      "search_android_classes",
      "inspect_android_class",
      "inspect_android_method",
      "trace_android_references",
    ],
  },
  "regex.matching_deadline_ms": {
    ...timer,
    environment: "REA_REGEX_MATCHING_DEADLINE_MS",
    defaultValue: DEFAULT_REGEX_MATCHING_DEADLINE_MS,
    maximum: MAXIMUM_REGEX_MATCHING_DEADLINE_MS,
    provider: "regex",
    relatedProviders: ["ida", "hopper", "kuna"],
    operations: ["search_strings", "search_procedures"],
  },
  "regex.worker_heap_request_mib": {
    environment: "REA_REGEX_WORKER_HEAP_REQUEST_MIB",
    defaultValue: DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB,
    minimum: MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
    maximum: MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB,
    unit: "MiB",
    appliesAt: "next_worker",
    provider: "regex",
    relatedProviders: ["ida", "hopper", "kuna"],
    operations: ["search_strings", "search_procedures"],
  },
  "capture.decoder_old_generation_mib": {
    environment: "REA_CAPTURE_DECODER_OLD_GENERATION_MIB",
    defaultValue: DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB,
    minimum: CAPTURE_DECODER_SEMI_SPACE_MIB,
    maximum: MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB,
    unit: "MiB",
    appliesAt: "next_worker",
    provider: "capture",
    operations: ["inspect_web_network_capture"],
  },
  "javascript.analysis_timeout_ms": {
    ...timer,
    defaultValue: JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.timeoutMs,
    provider: "rea-javascript-application",
    operations: ["analyze_javascript_application"],
    parameter: "analysis_timeout_ms",
  },
  "javascript.max_heap_mb": {
    defaultValue: JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.heapMb,
    minimum: JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM,
    maximum: JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM,
    unit: "MiB",
    appliesAt: "next_worker",
    provider: "rea-javascript-application",
    operations: ["analyze_javascript_application"],
    parameter: "max_heap_mb",
  },
  "wasm.command_timeout_ms": {
    ...timer,
    defaultValue: DEFAULT_WASM_COMMAND_TIMEOUT_MS,
    maximum: MAX_WASM_COMMAND_TIMEOUT_MS,
    provider: "wabt-artifact",
    operations: ["inspect_wasm_artifact"],
    parameter: "command_timeout_ms",
  },
  "native.matching_representation_bytes": {
    environment: "REA_NATIVE_MATCHING_REPRESENTATION_BYTES",
    defaultValue: DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES,
    minimum: 1,
    maximum: MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES,
    unit: "bytes",
    appliesAt: "next_operation",
    provider: "rea-function-comparison",
    operations: ["match_native_functions"],
  },
} as const satisfies Record<AnalysisSettingId, SettingDefinition>;
export const analysisSettingIds = Object.keys(
  ANALYSIS_SETTINGS,
) as AnalysisSettingId[];
export const analysisSettingIdSchema = z.enum(analysisSettingIds);
export const analysisSettingDefinition = (
  id: AnalysisSettingId,
): SettingDefinition => ANALYSIS_SETTINGS[id];
export const analysisSettingValueSchema = (id: AnalysisSettingId) => {
  const definition = analysisSettingDefinition(id);
  const number = z
    .number()
    .int()
    .min(definition.minimum)
    .max(definition.maximum);
  return id === "ghidra.decompile_timeout_seconds" ? number.nullable() : number;
};
/** Project one owner's accepted budget, including the explicit per-call precedence. */
export const analysisSettingLimit = (
  setting: AnalysisSettingId,
  effective_value: number | null,
  source: import("./analysisSettings.js").AnalysisSettingLimit["source"],
): import("./analysisSettings.js").AnalysisSettingLimit => {
  const definition = analysisSettingDefinition(setting);
  return {
    setting,
    effective_value,
    ...(source === undefined ? {} : { source }),
    unit: definition.unit,
    minimum: definition.minimum,
    maximum: definition.maximum,
    applies_at: definition.appliesAt,
    agent_editable: true,
    scope: "rea-runtime",
    rea_restart_required: false,
    ...(definition.parameter === undefined
      ? {}
      : { parameter: definition.parameter }),
  };
};
