/** Provider identity for deterministic composed analysis workflows. */
export const REA_WORKFLOW_PROVIDER = {
  id: "rea-workflow",
  name: "REA composed investigation workflow",
  version: "1",
} as const;

/** Provider identity for deterministic artifact inventories. */
export const ARTIFACT_GRAPH_PROVIDER = Object.freeze({
  id: "rea-artifact-graph",
  name: "REA safe artifact graph provider",
  version: "1",
} as const);

/** Provider identity for execution-free managed PE/CLI analysis. */
export const MANAGED_STATIC_PROVIDER = Object.freeze({
  id: "rea-dotnet-static",
  name: "REA managed static analysis provider",
  version: "1",
} as const);

/** Provider identity for portable, execution-free PE resource decoding. */
export const PE_RESOURCES_PROVIDER = Object.freeze({
  id: "rea-pe-resources",
  name: "REA PE resource parser",
  version: "1",
} as const);

/** Provider identity for portable, execution-free PE Authenticode table decoding. */
export const PE_CERTIFICATES_PROVIDER = Object.freeze({
  id: "rea-pe-certificates",
  name: "REA PE certificate parser",
  version: "1",
} as const);

/** Provider identity for portable, execution-free PE import-table decoding. */
export const PE_IMPORTS_PROVIDER = Object.freeze({
  id: "rea-pe-imports",
  name: "REA PE import parser",
  version: "1",
} as const);

/** Provider identity for portable, execution-free ELF note-table decoding. */
export const DEVICETREE_PROVIDER = Object.freeze({
  id: "rea-devicetree",
  name: "REA flattened devicetree parser",
  version: "1",
} as const);

export const ELF_NOTES_PROVIDER = Object.freeze({
  id: "rea-elf-notes",
  name: "REA ELF note parser",
  version: "1",
} as const);

/** Provider identity for portable, execution-free Apple .ips crash-report decoding. */
export const APPLE_IPS_PROVIDER = Object.freeze({
  id: "rea-apple-ips",
  name: "REA Apple IPS parser",
  version: "1",
} as const);
/** Provider identity for portable, execution-free Linux kernel-module metadata. */
export const KERNEL_MODULE_PROVIDER = Object.freeze({
  id: "rea-kernel-module",
  name: "REA kernel module parser",
  version: "1",
} as const);

/** Provider identity for execution-free Shannon byte-entropy profiling. */
export const BYTE_ENTROPY_PROVIDER = Object.freeze({
  id: "byte-entropy",
  name: "REA byte entropy",
  version: "1",
} as const);

/** Provider identity for portable, execution-free PE and ELF export tables. */
export const NATIVE_EXPORTS_PROVIDER = Object.freeze({
  id: "rea-native-exports",
  name: "REA PE/ELF export table reader",
  version: "1",
} as const);

/** Provider identity for deterministic managed-code comparison workflows. */
export const MANAGED_WORKFLOW_PROVIDER = {
  id: "rea-dotnet-workflows",
  name: "REA managed-code workflows",
  version: "1",
} as const;

/** Provider identity for deterministic Apple application projections. */
export const APPLE_APPLICATION_PROVIDER = {
  id: "rea-apple-application",
  name: "REA Apple application workflows",
  version: "1",
} as const;

/** Provider identity for deterministic Android application projections. */
export const ANDROID_APPLICATION_PROVIDER = {
  id: "rea-android-application",
  name: "REA Android application workflows",
  version: "1",
} as const;

/** Provider identity for deterministic HarmonyOS application projections. */
export const HARMONY_APPLICATION_PROVIDER = {
  id: "rea-harmony-application",
  name: "REA HarmonyOS application workflows",
  version: "1",
} as const;

/** Provider identity for verified publication of retained website scripts. */
export const WEB_SCRIPT_EXPORT_PROVIDER = {
  id: "rea-web-script-export",
  name: "REA captured script export",
  version: "1",
} as const;

/** Provider identity for deterministic static JavaScript application analysis. */
export const JAVASCRIPT_APPLICATION_PROVIDER = {
  id: "rea-javascript-application",
  name: "REA JavaScript application analyzer",
  version: "1",
} as const;

/** Provider identity for static/passive-runtime JavaScript reconciliation. */
export const JAVASCRIPT_RUNTIME_RECONCILIATION_PROVIDER = {
  id: "rea-javascript-runtime-reconciliation",
  name: "REA JavaScript runtime reconciliation",
  version: "1",
} as const;

/** Provider identity for selected views of retained analysis Evidence. */
export const ANALYSIS_VIEW_PROVIDER = {
  id: "rea-analysis-view",
  name: "REA analysis view projection",
  version: "1",
} as const;

/** Provider identity for graph-native feature tracing and version comparison. */
export const JAVASCRIPT_APPLICATION_WORKFLOW_PROVIDER = {
  id: "rea-javascript-application-workflows",
  name: "REA JavaScript application workflows",
  version: "1",
} as const;

/** Provider identity for deterministic Evidence bundle comparisons. */
export const BUNDLE_COMPARISON_PROVIDER = {
  id: "rea-bundle-comparison",
  name: "REA Evidence bundle comparison",
  version: "1",
} as const;

/** Provider identity for comparison-Evidence behavior aggregation. */
export const CHANGED_BEHAVIOR_PROVIDER = {
  id: "rea-changed-behavior",
  name: "REA changed behavior investigation",
  version: "1",
} as const;

/** Provider identity for Evidence-backed call-path reconstruction. */
export const CALL_PATH_PROVIDER = {
  id: "rea-call-path",
  name: "REA call path reconstruction",
  version: "1",
} as const;

/** Provider identity for explicit static/runtime hypothesis correlation. */
export const STATIC_RUNTIME_PROVIDER = {
  id: "rea-static-runtime-correlation",
  name: "REA static/runtime correlation",
  version: "1",
} as const;

/** Provider identity for finite reconstruction specification verification. */
export const RECONSTRUCTION_PROVIDER = {
  id: "rea-reconstruction-verifier",
  name: "REA reconstruction verifier",
  version: "1",
} as const;

export const PE_LOAD_CONFIG_PROVIDER = Object.freeze({
  id: "rea-pe-load-config",
  name: "REA PE TLS/load-config parser",
  version: "1",
} as const);
