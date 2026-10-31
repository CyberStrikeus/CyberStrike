/** Possible effects across a tool's supported inputs, including temporary work. */
export interface ToolEffects {
  readonly mutatesTarget: boolean;
  /** Includes additive Evidence recording, navigation state, and unknown updates. */
  readonly mutatesSession: boolean;
  readonly writesFilesystem: boolean;
  readonly launchesProcess: boolean;
  readonly accessesNetwork: boolean;
  readonly changesUiState: boolean;
  /** Can overwrite, clear, or drop state that the caller cannot recover from REA. */
  readonly mayDiscardData: boolean;
  /**
   * Runs or drives code REA does not own on the host: the analysis target, a
   * caller-selected executable, or the application loaded into one. Running
   * REA's own pinned helpers or operator-configured analysis engines does not
   * count.
   */
  readonly executesForeignCode: boolean;
  /** Changes an attached Android device: packages, files, or running apps. */
  readonly mutatesDevice: boolean;
  readonly idempotent: boolean;
}

/** MCP execution hints derived only from canonical effects. */
export interface DerivedToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

const effects = (overrides: Partial<ToolEffects> = {}): ToolEffects => ({
  mutatesTarget: false,
  mutatesSession: false,
  writesFilesystem: false,
  launchesProcess: false,
  accessesNetwork: false,
  changesUiState: false,
  mayDiscardData: false,
  executesForeignCode: false,
  mutatesDevice: false,
  idempotent: true,
  ...overrides,
});

const evidence = effects({ mutatesSession: true });
const nativeEvidence = effects({ mutatesSession: true, launchesProcess: true });
const browserEvidence = effects({
  mutatesSession: true,
  accessesNetwork: true,
});

/** Explicit effect audit for every public tool. */
export const TOOL_EFFECTS: Readonly<Record<string, ToolEffects>> = {
  inspect_analysis_settings: effects(),
  update_analysis_settings: effects({ mutatesSession: true }),
  list_cutter_sessions: effects({ accessesNetwork: true }),
  cutter_command: effects({
    mutatesTarget: true,
    executesForeignCode: true,
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    changesUiState: true,
    idempotent: false,
  }),
  inspect_with_objdump: effects({
    mutatesSession: true,
    launchesProcess: true,
  }),
  start_gdb_session: effects({
    launchesProcess: true,
    mutatesSession: true,
    idempotent: false,
  }),
  gdb_console: effects({
    mutatesTarget: true,
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  gdb_session_status: effects(),
  start_rizin_debug_session: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  rizin_debug_command: effects({
    mutatesTarget: true,
    mutatesSession: true,
    executesForeignCode: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    changesUiState: true,
    mayDiscardData: true,
    idempotent: false,
  }),
  rizin_debug_session_status: effects({ mutatesSession: true }),
  close_rizin_debug_session: effects({
    mutatesSession: true,
    launchesProcess: true,
    mutatesTarget: true,
    executesForeignCode: true,
  }),
  close_gdb_session: effects({
    launchesProcess: true,
    mutatesSession: true,
    mutatesTarget: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  execute_rizin_command: effects({
    mutatesTarget: true,
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    mayDiscardData: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  inspect_desktop_application: evidence,
  inspect_go_binary: evidence,
  inspect_il2cpp_metadata: evidence,
  inspect_model_artifact: evidence,
  inspect_gpu_code_objects: evidence,
  inspect_rust_binary: evidence,
  inspect_apk_signature: evidence,
  inspect_python_pyc: evidence,
  inspect_erlang_beam: evidence,
  inspect_sqlite_database: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  inspect_packet_fields: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_packet_capture: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_signal_decoders: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  decode_signal_recording: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_wasm_artifact: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  inspect_evm_interface: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  inspect_web_network_capture: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  observe_web_execution: effects({
    mutatesTarget: true,
    mutatesSession: true,
    accessesNetwork: true,
    mayDiscardData: true,
    idempotent: false,
  }),
  inspect_web_event_listeners: browserEvidence,
  trace_web_source_location: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  trace_web_module_imports: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  inspect_recorded_crash: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  inspect_binary_layout: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  list_frida_devices: effects({ launchesProcess: true, accessesNetwork: true }),
  list_frida_processes: effects({
    launchesProcess: true,
    accessesNetwork: true,
  }),
  start_frida_session: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  load_frida_script: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  resume_frida_session: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  unload_frida_script: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  frida_session_status: evidence,
  close_frida_session: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  instrument_with_frida: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  inspect_byte_entropy: evidence,
  inspect_pe_resources: evidence,
  inspect_pe_certificates: evidence,
  inspect_pe_imports: evidence,
  inspect_native_exports: evidence,
  inspect_elf_notes: evidence,
  inspect_apple_ips: evidence,
  inspect_devicetree: evidence,
  inspect_kernel_module: evidence,
  inspect_pe_load_config: evidence,
  inspect_analysis_view: evidence,
  inspect_firmware_regions: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  extract_firmware: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    idempotent: false,
  }),
  inspect_android_package: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_pcap_client: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_pcap_capture: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  identify_flutter_build: effects({
    mutatesSession: true,
    writesFilesystem: true,
  }),
  inspect_dart_aot: effects({
    mutatesSession: true,
    writesFilesystem: true,
  }),
  inspect_apktool_client: effects({
    mutatesSession: true,
    launchesProcess: true,
  }),
  decode_android_resources: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_jeb_client: effects({
    mutatesSession: true,
    accessesNetwork: true,
  }),
  open_jeb_project: effects({
    mutatesSession: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  list_jeb_units: effects({
    mutatesSession: true,
    accessesNetwork: true,
  }),
  decompile_jeb_item: effects({
    mutatesSession: true,
    accessesNetwork: true,
  }),
  inspect_adb_client: effects({
    mutatesSession: true,
    launchesProcess: true,
  }),
  list_adb_devices: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  inspect_adb_device: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  list_adb_packages: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  pull_adb_package: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  read_adb_logcat: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  inspect_adb_package: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  pull_adb_file: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  push_adb_file: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    accessesNetwork: true,
    mutatesDevice: true,
    idempotent: false,
  }),
  capture_adb_screen: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  list_adb_processes: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  list_adb_directory: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  list_adb_features: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  list_adb_services: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  inspect_adb_display: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  inspect_adb_window: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  read_adb_setting: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  collect_adb_bugreport: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    accessesNetwork: true,
    idempotent: false,
  }),
  resolve_adb_packages: effects({
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
  }),
  install_adb_package: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    mutatesDevice: true,
    idempotent: false,
  }),
  uninstall_adb_package: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    mutatesDevice: true,
    idempotent: false,
  }),
  start_adb_app: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    mutatesDevice: true,
    idempotent: false,
  }),
  start_adb_activity: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    mutatesDevice: true,
    idempotent: false,
  }),
  stop_adb_app: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    mutatesDevice: true,
    idempotent: false,
  }),
  search_android_classes: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_android_class: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_android_method: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  inspect_android_jni_bindings: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  trace_android_references: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  annotate_native_function: effects({
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
    mayDiscardData: true,
  }),
  inspect_native_load_image: evidence,
  inspect_native_dispatch_metadata: evidence,
  trace_native_ui_action: evidence,
  trace_native_values: evidence,
  address_name: evidence,
  comment: evidence,
  current_address: evidence,
  current_procedure: evidence,
  current_document: evidence,
  goto_address: effects({ mutatesSession: true, changesUiState: true }),
  inline_comment: evidence,
  list_bookmarks: evidence,
  list_documents: evidence,
  list_names: evidence,
  list_procedures: evidence,
  list_segments: evidence,
  list_strings: evidence,
  next_address: evidence,
  prev_address: evidence,
  procedure_address: evidence,
  procedure_assembly: evidence,
  procedure_callees: evidence,
  procedure_callers: evidence,
  procedure_info: evidence,
  read_function_instructions: evidence,
  inspect_native_instruction: evidence,
  inspect_native_data_type: evidence,
  resolve_native_call_targets: evidence,
  read_bytes: evidence,
  search_bytes: evidence,
  address_to_file_offset: evidence,
  procedure_references: evidence,
  procedure_pseudo_code: evidence,
  resolve_containing_procedure: evidence,
  search_procedures: evidence,
  search_strings: evidence,
  set_address_name: effects({
    mutatesTarget: true,
    mutatesSession: true,
    mayDiscardData: true,
  }),
  set_addresses_names: effects({
    mutatesTarget: true,
    mutatesSession: true,
    mayDiscardData: true,
  }),
  set_bookmark: effects({
    mutatesTarget: true,
    mutatesSession: true,
    mayDiscardData: true,
  }),
  set_comment: effects({
    mutatesTarget: true,
    mutatesSession: true,
    mayDiscardData: true,
  }),
  set_inline_comment: effects({
    mutatesTarget: true,
    mutatesSession: true,
    mayDiscardData: true,
  }),
  unset_bookmark: effects({
    mutatesTarget: true,
    mutatesSession: true,
    mayDiscardData: true,
  }),
  xrefs: evidence,
  get_objc_classes: evidence,
  get_objc_protocols: evidence,
  batch_decompile: evidence,
  decompile_all: effects({
    mutatesSession: true,
    writesFilesystem: true,
    idempotent: false,
  }),
  get_call_graph: evidence,
  analyze_swift_types: evidence,
  find_xrefs_to_name: evidence,
  binary_overview: evidence,
  analyze_function: evidence,
  inspect_native_api: effects({ mutatesSession: true, idempotent: false }),
  trace_feature: effects({ mutatesSession: true, idempotent: false }),
  trace_call_path: effects({ mutatesSession: true, idempotent: false }),
  observe_native_ui: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  capture_native_ui_scenario: effects({
    writesFilesystem: true,
    mutatesTarget: true,
    mutatesSession: true,
    launchesProcess: true,
    accessesNetwork: true,
    changesUiState: true,
    mayDiscardData: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  // The owned process can change files, show UI and use the network.
  observe_native_calls: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    changesUiState: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  inspect_macho: nativeEvidence,
  inspect_signature: { ...nativeEvidence, writesFilesystem: true },
  inspect_plist: nativeEvidence,
  list_architectures: nativeEvidence,
  demangle_swift: nativeEvidence,
  inspect_artifact: effects({
    mutatesSession: true,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  extract_artifact: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    idempotent: false,
  }),
  decode_interface_builder: evidence,
  inspect_asset_catalog: nativeEvidence,
  inspect_keyed_archive: evidence,
  trace_dylib_resolution: evidence,
  inspect_managed_artifact: evidence,
  inspect_managed_members: evidence,
  inspect_managed_native_boundaries: evidence,
  compare_managed_members: evidence,
  verify_managed_native_boundaries: evidence,
  import_managed_reconstruction: evidence,
  project_managed_application_graph: evidence,
  list_browser_targets: browserEvidence,
  inspect_web_page: browserEvidence,
  analyze_web_bundle: effects({
    ...browserEvidence,
    launchesProcess: true,
    writesFilesystem: true,
  }),
  observe_web_session: browserEvidence,
  discover_webmcp_tools: browserEvidence,
  compare_web_captures: evidence,
  capture_web_screenshot: browserEvidence,
  compare_web_screenshots: evidence,
  capture_browser_scenario: effects({
    mutatesTarget: true,
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    changesUiState: true,
    mayDiscardData: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  list_electron_targets: browserEvidence,
  inspect_electron_page: browserEvidence,
  capture_electron_scenario: effects({
    mutatesTarget: true,
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    changesUiState: true,
    mayDiscardData: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  list_javascript_runtime_targets: browserEvidence,
  observe_javascript_runtime: browserEvidence,
  analyze_javascript_application: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
  }),
  inspect_electron_fuses: evidence,
  export_web_scripts: effects({
    mutatesSession: true,
    writesFilesystem: true,
    idempotent: false,
  }),
  export_environment_bundle: effects({
    writesFilesystem: true,
    idempotent: false,
  }),
  reconcile_javascript_runtime: evidence,
  recover_javascript_sources: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    idempotent: false,
  }),
  trace_application_feature: evidence,
  trace_javascript_semantics: evidence,
  compare_application_versions: evidence,
  search_guidance: effects(),
  read_guidance_section: effects(),
  guided_workflows: effects(),
  compare_source_to_bundle: evidence,
  compare_javascript_export_shapes: evidence,
  build_reconstruction_obligation_ledger: evidence,
  evaluate_reconstruction_coverage: effects(),
  project_android_application_graph: evidence,
  project_apple_application_graph: evidence,
  project_harmony_application_graph: evidence,
  open_binary: effects({ mutatesSession: true, launchesProcess: true }),
  open_bundle_resources: effects({ mutatesSession: true }),
  close_binary: effects({
    mutatesSession: true,
    writesFilesystem: true,
    mayDiscardData: true,
    idempotent: false,
  }),
  binary_session: effects({ launchesProcess: true }),
  export_evidence_bundle: effects({
    writesFilesystem: true,
    mayDiscardData: true,
  }),
  get_evidence_bundle: effects(),
  get_navigation_context: effects({ mutatesSession: true }),
  inspect_address_context: effects({ mutatesSession: true }),
  import_evidence_bundle: effects({ mutatesSession: true }),
  capture_process_scenario: effects({
    mutatesSession: true,
    writesFilesystem: true,
    launchesProcess: true,
    accessesNetwork: true,
    executesForeignCode: true,
    idempotent: false,
  }),
  compare_process_captures: evidence,
  compare_artifacts: evidence,
  compare_wasm_interfaces: evidence,
  compare_functions: evidence,
  match_native_functions: evidence,
  compare_bundles: effects({ mutatesSession: true }),
  find_changed_behavior: evidence,
  build_call_path: evidence,
  correlate_static_and_runtime: evidence,
  verify_reconstruction: evidence,
  list_unknowns: effects(),
  record_unknown: effects({ mutatesSession: true, idempotent: false }),
  update_unknown: effects({ mutatesSession: true, idempotent: false }),
  verify_unknown_resolution: effects(),
};

/** Derive MCP annotations without tool-name or tool-family heuristics. */
export const annotationsFromEffects = (
  value: ToolEffects,
): DerivedToolAnnotations => ({
  readOnlyHint: !(
    value.mutatesTarget ||
    value.mutatesSession ||
    value.writesFilesystem ||
    value.launchesProcess ||
    value.accessesNetwork ||
    value.changesUiState ||
    value.mayDiscardData ||
    value.executesForeignCode ||
    value.mutatesDevice
  ),
  // MCP defines destructive as possibly non-additive changes to the
  // environment. Running foreign code or changing a device cannot be bounded
  // to additive effects, so either one is destructive even without data loss.
  destructiveHint:
    value.mayDiscardData || value.executesForeignCode || value.mutatesDevice,
  idempotentHint: value.idempotent,
  openWorldHint: value.launchesProcess || value.accessesNetwork,
});

/**
 * Tools whose results, successful or failed, carry only REA-authored session
 * state or caller-supplied values, never text originating from an analysis
 * target, a provider, a launcher or a device. Every other tool can return
 * such text (strings, symbols, code, page text, scripts, captures, logs, file
 * listings, provider diagnostics or captured process output), so a newly
 * added tool is marked untrusted until it is audited into this set. A tool
 * stays out when any error path can project external process output, as
 * close_binary (provider cleanup diagnostics), binary_session (provider
 * failure reasons and availability diagnostics) and the adb and apktool
 * client probes (version output and stderr excerpts) can.
 */
export const TARGET_CONTENT_FREE_TOOLS: ReadonlySet<string> = new Set([
  "inspect_analysis_settings",
  "update_analysis_settings",
  "export_evidence_bundle",
  "search_guidance",
  "read_guidance_section",
  "guided_workflows",
  "record_unknown",
]);

/**
 * Whether results of the named tool, successful or failed, can carry text that
 * originates from the analysis target. Unknown names are treated as target
 * content so an unaudited path never loses the untrusted marker.
 */
export const toolReturnsTargetContent = (name: string): boolean =>
  !TARGET_CONTENT_FREE_TOOLS.has(name);

/** Resolve the audited metadata for one public tool. */
export const toolContractMetadata = (name: string) => {
  const audited = TOOL_EFFECTS[name];
  if (audited === undefined)
    throw new Error(`Missing effect audit for ${name}`);
  return {
    title: name
      .split("_")
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" "),
    effects: audited,
    annotations: annotationsFromEffects(audited),
    returnsTargetContent: toolReturnsTargetContent(name),
  };
};
