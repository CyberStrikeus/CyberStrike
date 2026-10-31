import type { DoctorProviderInspection } from "./Doctor.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

const SELECTED_REGISTRATION_SETTINGS = [
  "GHIDRA_INSTALL_DIR",
  "GHIDRA_HEADLESS_MAXMEM",
  "GHIDRA_MAXMEM",
  "JAVA_HOME",
  "HOPPER_LAUNCHER_PATH",
  "HOPPER_LOADER_ARGS_JSON",
  "REA_ILSPY_CMD_PATH",
  "REA_ADB_PATH",
  "REA_APKTOOL_COMMAND",
  "REA_TSHARK_COMMAND",
  "REA_CAPINFOS_COMMAND",
  "REA_TSHARK_PRLIMIT_COMMAND",
  "REA_OBJDUMP_COMMAND",
  "REA_GDB_COMMAND",
  "REA_RIZIN_COMMAND",
  "REA_CUTTER_BRIDGE_DIR",
  "REA_WABT_BIN_DIRECTORY",
  "REA_WAKARU_COMMAND",
  "REA_JAVASCRIPT_PRLIMIT_COMMAND",
  "REA_BINWALK_COMMAND",
  "REA_UNBLOB_COMMAND",
  "REA_FIRMWARE_PRLIMIT_COMMAND",
  "REA_EVM_PRLIMIT_COMMAND",
  "REA_SIGROK_COMMAND",
  "REA_SIGROK_PRLIMIT_COMMAND",
  "REA_MITMDUMP_COMMAND",
  "REA_BROWSER_EXECUTABLE",
  "REA_BROWSER_NO_SANDBOX",
  "REA_PWNTOOLS_PYTHON",
  "REA_PWNTOOLS_MAX_INPUT_BYTES",
  "REA_PWNDBG_GDB",
  "REA_PWNDBG_GDBINIT",
  "REA_PWNDBG_VENV_PATH",
  "REA_DARWIN_SWIFTC_PATH",
  "REA_DARWIN_MODULE_CACHE_PATH",
  "SDKROOT",
  "REA_SWIFTC_COMPILE_TIMEOUT_MS",
  "REA_LOG_LEVEL",
  "REA_REFERENCE_SECRET_PATTERNS_JSON",
  "REA_IDA_MCP_CONFIG",
  "REA_JADX_MCP_JAR",
  "REA_JADX_HEAP_MIB",
  "REA_JADX_ACTIVE_PROCESSOR_COUNT",
  "REA_JADX_OPERATION_TIMEOUT_MS",
  "REA_KUNA_COMMAND",
  "REA_KUNA_CACHE_DIR",
  "REA_KUNA_CACHE_MAX_BYTES",
  "REA_KUNA_PROJECT_TIMEOUT_MS",
  "REA_KUNA_TIMEOUT_MS",
  "REA_KUNA_JOBS",
  "REA_ANALYSIS_PROVIDER",
  "REA_ASAR_MAX_HEADER_BYTES",
  "REA_BRIDGE_MAX_REQUEST_BYTES",
  "REA_CAPTURE_DECODER_OLD_GENERATION_MIB",
  "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
  "REA_GHIDRA_STARTUP_TIMEOUT_MS",
  "REA_GHIDRA_LANGUAGE_ID",
  "REA_GHIDRA_COMPILER_SPEC_ID",
  "REA_GHIDRA_DISABLED_ANALYZERS",
  "REA_GHIDRA_SEED_FILE",
  "REA_GHIDRA_PROJECT_PATH",
  "REA_GHIDRA_PROGRAM_NAME",
  "REA_GHIDRA_NATIVEAOT_JAR",
  "REA_HOPPER_CALLER_SCAN_BUDGET_MS",
  "REA_HOPPER_STARTUP_TIMEOUT_MS",
  "REA_JEB_MCP_URL",
  "REA_JEB_MCP_TIMEOUT_MS",
  "REA_MCP_INPUT_SCHEMA_PROFILE",
  "REA_MCP_TOOL_FAMILIES",
  "REA_MCP_OUTPUT_SCHEMA_PROFILE",
  "REA_MCP_MAX_RESPONSE_BYTES",
  "REA_MCP_MAX_INPUT_ELEMENTS",
  "REA_NATIVE_MATCHING_REPRESENTATION_BYTES",
  "REA_REGEX_MATCHING_DEADLINE_MS",
  "REA_REGEX_WORKER_HEAP_REQUEST_MIB",
  "REA_MCP_INITIALIZE_BUDGET_MS",
  "REA_MCP_TOOLS_LIST_BUDGET_MS",
  "REA_MCP_FIRST_CATALOG_BUDGET_MS",
  "REA_MCP_DOCTOR_DEADLINE_MS",
] as const;

/** Explicit selections override discovered defaults even when a provider is unavailable.
 * This is a registration policy, not a prefix match against the ambient environment.
 */
export const explicitSetupRegistrationEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    SELECTED_REGISTRATION_SETTINGS.flatMap((key) => {
      const value = environment[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

/** Discovered provider defaults; explicit selections are applied separately. */
export const providerRegistrationEnvironment = (
  inspections: readonly DoctorProviderInspection[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    inspections
      .flatMap(({ registrationEnvironment }) =>
        Object.entries(registrationEnvironment),
      )
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right)),
  );
