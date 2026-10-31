import { describe, expect, it } from "vitest";

import { TOOL_CONTRACTS } from "./toolContracts.js";
import {
  TOOL_EFFECTS,
  annotationsFromEffects,
  type ToolEffects,
} from "./toolEffects.js";

/**
 * Descriptions that name running, launching, executing, starting, installing,
 * or uninstalling something. A matching tool must declare foreign execution or
 * device mutation unless it is listed below with the reason the wording does
 * not describe that effect.
 */
const EXECUTION_WORDING =
  /\b(?:run|runs|running|launch|launches|launching|execute|executes|executing|execution|start|starts|install|installs|uninstall|uninstalls)\b/iu;

const EXECUTION_WORDING_EXCEPTIONS: Readonly<Record<string, string>> = {
  inspect_artifact: "states that mapper execution remains unobserved",
  guided_workflows:
    "renders existing guidance and states that it does not start analysis",
  inspect_analysis_settings:
    "reports launch configuration without launching any process",
  update_analysis_settings:
    "resets defaults to launch configuration without launching any process",
  inspect_with_objdump:
    "runs a caller-selected inspection tool, not target code",
  start_gdb_session:
    "starts a debugger session; execution is attributed to gdb_console",
  start_frida_session:
    "spawned targets remain suspended until resume_frida_session",
  inspect_native_load_image: "states that it does not execute the target",
  resolve_native_call_targets: "states that it does not execute code",
  inspect_byte_entropy: "states that it profiles the file without execution",
  inspect_pe_resources: "states that it does not execute the image",
  inspect_native_exports: "reads the export table without executing it",
  inspect_devicetree: "states that it does not execute the image",
  inspect_elf_notes: "states that it does not execute the image",
  inspect_apple_ips: "states that it does not execute a target",
  inspect_kernel_module: "states that it does not execute the module",
  inspect_pe_load_config: "states that it does not execute the image",
  inspect_desktop_application:
    "states that directory triage performs no target execution",
  inspect_pe_certificates: "states that it does not execute the image",
  inspect_pe_imports: "states that it does not execute the image",
  inspect_go_binary: "reads embedded metadata without executing the target",
  inspect_rust_binary:
    "reads an embedded dependency list without executing the target",
  inspect_python_pyc:
    "states that it does not execute bytecode or invoke CPython",
  inspect_erlang_beam: "states that it does not execute bytecode",
  inspect_sqlite_database:
    "uses a trusted inspector worker without executing application code or caller SQL",
  inspect_binary_layout:
    "parses the binary offline with operator-configured pwntools",
  inspect_recorded_crash: "inspects a core file without launching its target",
  inspect_macho: "runs host Mach-O inspection tools, not the target",
  inspect_evm_interface:
    "decodes bytecode in REA's bundled worker without executing it",
  compare_wasm_interfaces:
    "compares retained inspection Evidence without executing modules",
  inspect_wasm_artifact:
    "WABT validates and decompiles the module without executing it",
  identify_flutter_build:
    "identifies the build through execution-free APK parsing",
  inspect_dart_aot: "inspects snapshot bytes without executing them",
  inspect_analysis_view:
    "reports retained WASM execution/network states without performing execution",
  inspect_managed_artifact: "reads metadata without executing target code",
  inspect_managed_members: "reads metadata without executing target code",
  inspect_managed_native_boundaries:
    "reads metadata without executing target code",
  verify_managed_native_boundaries: "states it does not execute managed code",
  project_managed_application_graph: "states it does not execute managed code",
  inspect_android_package: "states it does not execute the APK",
  search_android_classes: "states it does not execute the APK",
  inspect_android_jni_bindings:
    "reads DEX and ELF bytes without executing target code",
  inspect_apktool_client:
    "inspects the operator-selected apktool launcher; never installs it",
  inspect_pcap_client:
    "probes the operator-selected tshark and capinfos; never installs them",
  inspect_jeb_client: "talks to a caller-started JEB; never launches it",
  open_jeb_project: "the engine analyzes the file; REA does not execute it",
  inspect_adb_client:
    "inspects the operator-selected adb client; never starts its server",
  list_adb_devices: "may start the local adb server, which REA does not own",
  inspect_firmware_regions: "states there is no target execution",
  inspect_gpu_code_objects:
    "reads static declarations without executing GPU code",
  inspect_model_artifact:
    "states that model code and inference are never executed",
  extract_firmware: "states that extracted code is never executed",
  analyze_javascript_application: "reconstructs the graph without executing",
  reconcile_javascript_runtime: "never invents execution claims",
  observe_javascript_runtime: "never evaluates or resumes the target",
  trace_application_feature: "never executes the application",
  trace_javascript_semantics: "static reachability never claims execution",
  compare_javascript_export_shapes: "states it does not execute JavaScript",
  project_android_application_graph: "execution-free inventory",
  project_apple_application_graph: "execution-free inventory",
  project_harmony_application_graph: "execution-free inventory",
  trace_web_source_location: "states there is no application execution",
  trace_web_module_imports:
    "runs only REA's resolver stub in operator-configured Chromium",
  export_web_scripts: "states there is no refetch or execution",
  observe_web_execution:
    "instruments an externally driven page; it does not run code itself",
  recover_javascript_sources: "states there is no application code execution",
  goto_address: "start names an object boundary, not a launch",
  prev_address: "start names an object boundary, not a launch",
  trace_call_path: "start names the traversal origin",
  observe_native_ui: "observes an already-running app without launching it",
  inspect_adb_package: "reports install times without changing the device",
  list_adb_processes: "lists running processes without changing the device",
  inspect_web_event_listeners: "states it does not evaluate JavaScript",
  inspect_apk_signature: "states that no Android code executes",
};

const declaresForeignAuthority = (name: string): boolean => {
  const effects = TOOL_EFFECTS[name];
  return (
    effects !== undefined &&
    (effects.executesForeignCode || effects.mutatesDevice)
  );
};

describe("tool effects", () => {
  it("declares the web bundle worker's private file and child process effects", () => {
    const contract = TOOL_CONTRACTS.find(
      ({ name }) => name === "analyze_web_bundle",
    );
    expect(contract?.effects).toMatchObject({
      mutatesSession: true,
      accessesNetwork: true,
      launchesProcess: true,
      writesFilesystem: true,
      executesForeignCode: false,
      mutatesTarget: false,
    });
  });
  it("audits every public tool exactly once", () => {
    expect(Object.keys(TOOL_EFFECTS).sort()).toEqual(
      TOOL_CONTRACTS.map(({ name }) => name).sort(),
    );
  });

  it("keeps execution and device wording aligned with declared effects", () => {
    const undeclared = TOOL_CONTRACTS.filter(
      ({ name, description }) =>
        EXECUTION_WORDING.test(description) &&
        !declaresForeignAuthority(name) &&
        EXECUTION_WORDING_EXCEPTIONS[name] === undefined,
    ).map(({ name }) => name);
    expect(undeclared).toEqual([]);
    const staleExceptions = Object.keys(EXECUTION_WORDING_EXCEPTIONS).filter(
      (name) => {
        const contract = TOOL_CONTRACTS.find(
          (candidate) => candidate.name === name,
        );
        return (
          contract === undefined ||
          !EXECUTION_WORDING.test(contract.description) ||
          declaresForeignAuthority(name)
        );
      },
    );
    expect(staleExceptions).toEqual([]);
  });

  it("marks foreign execution and device mutation as destructive", () => {
    const destructive = TOOL_CONTRACTS.filter(
      ({ effects }) => effects.executesForeignCode || effects.mutatesDevice,
    );
    expect(destructive.map(({ name }) => name).sort()).toEqual([
      "capture_browser_scenario",
      "capture_electron_scenario",
      "capture_native_ui_scenario",
      "capture_process_scenario",
      "close_frida_session",
      "close_gdb_session",
      "close_rizin_debug_session",
      "cutter_command",
      "execute_rizin_command",
      "gdb_console",
      "install_adb_package",
      "instrument_with_frida",
      "load_frida_script",
      "observe_native_calls",
      "push_adb_file",
      "resume_frida_session",
      "rizin_debug_command",
      "start_adb_activity",
      "start_adb_app",
      "start_rizin_debug_session",
      "stop_adb_app",
      "uninstall_adb_package",
    ]);
    for (const contract of destructive)
      expect(contract.annotations, contract.name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
  });

  it("derives destructiveHint from each destructive effect alone", () => {
    // Keep annotation algebra independent of any operation's audited effects.
    const base: ToolEffects = {
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
    };
    expect(annotationsFromEffects(base)).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    for (const flag of [
      "mayDiscardData",
      "executesForeignCode",
      "mutatesDevice",
    ] as const)
      expect(annotationsFromEffects({ ...base, [flag]: true }), flag).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
  });

  it("marks automatic GDB detach as destructive target execution", () => {
    const effects = TOOL_EFFECTS["close_gdb_session"];
    if (effects === undefined)
      throw new Error("close_gdb_session is unaudited");
    expect(effects).toMatchObject({
      mutatesTarget: true,
      executesForeignCode: true,
    });
    expect(annotationsFromEffects(effects).destructiveHint).toBe(true);
  });

  it("publishes the advertised annotations derived from canonical effects", () => {
    for (const contract of TOOL_CONTRACTS)
      expect(contract.annotations, contract.name).toEqual(
        annotationsFromEffects(contract.effects),
      );
  });
});

it("advertises signature inspection's temporary snapshot filesystem writes", () => {
  expect(TOOL_EFFECTS.inspect_signature).toMatchObject({
    writesFilesystem: true,
    mutatesTarget: false,
    launchesProcess: true,
  });
});
