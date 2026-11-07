import type {
  CapabilityDescriptor,
  ProviderIdentity,
} from "../application/AnalysisProvider.js";
import {
  inspectWindowsNativeReadiness,
  type WindowsNativeReadiness,
} from "../process/WindowsAuthority.js";
import { GHIDRA_FUNCTION_OPERATIONS } from "./GhidraFunctionValues.js";
import { GHIDRA_INVENTORY_OPERATIONS } from "./GhidraInventoryValues.js";
import { GHIDRA_MUTATING_OPERATIONS } from "./GhidraSessionValues.js";
import { ghidraLoadImageVerificationNote } from "./GhidraVerifiedLoadImageFormats.js";

/** Target architectures admitted by the Windows P0 native PE boundary. */
export const WINDOWS_P0_NATIVE_PE_ARCHITECTURES: readonly string[] =
  Object.freeze(["x86", "x86_64", "arm", "arm64"]);

/** Public identity committed by every Ghidra-backed observation. */
export const GHIDRA_PROVIDER_IDENTITY: ProviderIdentity = Object.freeze({
  id: "ghidra",
  name: "Ghidra",
  version: null,
});

/** Provider observations, including internal aggregates consumed by workflows. */
const providerOperations = Object.freeze([
  ...GHIDRA_INVENTORY_OPERATIONS,
  ...GHIDRA_FUNCTION_OPERATIONS,
]);

/** Public analyst tools backed by these observations; aggregates stay internal. */
export const GHIDRA_OPERATIONS = Object.freeze(
  providerOperations.map((operation) =>
    operation === "read_binary_inventory_summary"
      ? "binary_overview"
      : operation,
  ),
);

/** Health limitations shared by every Ghidra-backed capability. */
export const healthLimitations = Object.freeze([
  "The session serves operations only after Ghidra reports default auto-analysis complete; incomplete analysis does not expose partial results.",
  "The imported Program and temporary project are ephemeral and deleted on close. Annotation operations edit session database metadata; original executable bytes are never written.",
  "Cancelling an active Ghidra request terminates its ephemeral database and discards session annotations. The selected target remains open; the next provider query imports the original artifact again.",
]);

/** Additional limitations applied to the experimental Windows x64 P0 boundary. */
export const windowsP0Limitations = Object.freeze([
  "Windows Ghidra P0 accepts native x86, x86-64, ARMNT (Thumb-2) and ARM64 PE applications and DLLs, and explicitly selected raw 6502 images; managed, hostile, sensitive, and mutable-path targets are unsupported.",
  "The Windows bridge uses authenticated IPv4 loopback because Node path-based IPC does not expose Java AF_UNIX sockets; the endpoint file contains no bearer token.",
  "Windows sessions require the matching packaged Windows x64 native addon, local NTFS targets and runtimes, and Windows 10 or later. Native handles enforce path admission, private DACLs, and Job Object ownership automatically.",
]);

/** Existing databases have their own unknown analysis history; reopening does not complete it. */
export const ghidraHealthLimitations = (
  existingProject = false,
): readonly string[] =>
  existingProject
    ? [
        "This session opens a caller-selected existing Ghidra project through a private copy, without import, auto-analysis or repair scripts. Original analysis completeness and settings are unknown.",
        "The original project is never opened by Ghidra or modified. The private copy is read-only to bridge operations and deleted on close; original executable bytes are never written.",
        "The analysis profile records the selected project content fingerprint and program name. The imported program SHA-256 must match the admitted target; the project may contain caller annotations or earlier edits, which are not fresh REA discoveries.",
      ]
    : healthLimitations;

const stringInventoryLimitation =
  "Only Ghidra-defined string Data is observed; packed or undefined string bytes may be absent. Completeness applies to that inventory, and an empty search does not establish that text is absent from the artifact. If an address is known, use read_bytes and xrefs to inspect bytes and references.";

const searchLimitation =
  "Regex mode uses Java Pattern semantics. Matcher or compiler stack exhaustion returns a resource constraint without closing the session; literal mode avoids regex recursion and returns complete matching values.";

/** Limitation text for one admitted operation, including the common base. */
export const limitationsFor = (
  operation: string,
  existingProject = false,
): readonly string[] => {
  const common = [
    ...ghidraHealthLimitations(existingProject),
    "Default-space addresses use lowercase 0x-prefixed hexadecimal; other address spaces use <percent-encoded-space>:0x<hex>.",
  ];
  switch (operation) {
    case "read_binary_inventory_summary":
      return [
        ...common,
        stringInventoryLimitation,
        "Counts use the complete defined-string inventory and the same local/external function inventory as list_strings and list_procedures. They do not establish discovery of undefined strings or unidentified functions.",
        "Memory-block end addresses are exclusive; segment lengths use those observed address coordinates.",
      ];
    case "annotate_native_function":
      return [
        ...common,
        "Names use Ghidra USER_DEFINED source. Name writes accept a leaf name or a fully qualified name within the existing namespace; readback uses the fully qualified name and can be reused without adding namespace prefixes. Edits retain the current namespace; other namespace-like text remains literal leaf-name text. Regular comments map to PRE and inline comments to EOL at the exact function entry. Changes commit together after readback and refreshed analysis; failure rolls them all back.",
        "Annotation text rejects NUL and unpaired Unicode surrogates before mutation, with the field and UTF-16 index in the error. Supported Unicode and line endings are preserved.",
        "Metadata edits invalidate immutable analysis snapshots and are discarded on close. CLI returns the updated dossier before session cleanup; this is not a saved Ghidra project.",
      ];
    case "set_address_name":
    case "set_addresses_names":
      return [
        ...common,
        "Names use Ghidra USER_DEFINED source. A local function entry renames that function; any other mapped address receives a new or renamed primary label. Existing symbols retain their namespace and accept leaf names or qualified names within that namespace; qualified readback can be reused without adding namespace prefixes. Readback compares the primary symbol name.",
        operation === "set_address_name"
          ? "A name held by another address in the destination namespace is not moved; a false result reports its reason in raw_result.failures."
          : "set_addresses_names decides every address from the names held before the batch: addresses requesting one destination name, or a name another selected address holds, are rejected rather than ordered. Others apply in their own transactions. raw_result.failures gives each failure's reason; raw_result.conflicts lists each contested name once with its requesting and holding addresses.",
        "Metadata edits invalidate immutable analysis snapshots and are discarded on close; this is not a saved Ghidra project.",
      ];
    case "inspect_native_load_image":
      return [...common, ghidraLoadImageVerificationNote()];
    case "read_bytes":
      return [
        ...common,
        "Bytes reflect Ghidra's initialized memory, including loader fixups. Reads stop at an unmapped or uninitialized byte and report completeness explicitly.",
      ];
    case "search_bytes":
      return [
        ...common,
        "Searches initialized loader-adjusted memory independently per block, in provider address order. Bounds and page coverage ends are inclusive. Uninitialized blocks are listed separately. Overlapping matches are included; patterns never cross block boundaries. A cursor resumes the same target, profile and query. Cancellation discards the active search and returns no successful partial page.",
      ];
    case "address_to_file_offset":
      return [
        ...common,
        "Offsets come from Ghidra source-byte mappings, not virtual-address arithmetic. Uninitialized memory, missing mappings and ambiguous mappings fail explicitly.",
      ];
    case "list_documents":
      return [
        ...common,
        "A headless Ghidra session contains exactly one imported Program, unlike Hopper's multi-document GUI session.",
      ];
    case "list_names":
      return [
        ...common,
        "The symbol inventory includes memory and external symbols, including dynamic symbols, but excludes variable and no-address namespace records.",
      ];
    case "list_procedures":
    case "procedure_address":
      return [
        ...common,
        "External functions and local thunks are distinct; procedure metadata identifies both and preserves a thunk target when Ghidra resolves one.",
      ];
    case "list_strings":
      return [
        ...common,
        stringInventoryLimitation,
        "Charset is reported, while a non-missing terminator cannot distinguish a present terminator from a fixed or Pascal layout.",
      ];
    case "resolve_containing_procedure":
      return [
        ...common,
        "An exact external entry resolves to its observed function identity even when its body is empty. This does not establish mapped executable bytes or containment of nearby external addresses.",
      ];
    case "list_segments":
      return [
        ...common,
        "Memory-block end addresses are exclusive; permissions come from Ghidra MemoryBlock flags rather than inference from section names.",
      ];
    case "search_procedures":
      return [...common, searchLimitation];
    case "search_strings":
      return [...common, stringInventoryLimitation, searchLimitation];
    case "procedure_pseudo_code":
      return [
        ...common,
        "Pseudocode is Ghidra decompiler output, not original source and not text-equivalent to Hopper output.",
        "External functions and functions without an analyzable body return null; other decompiler failures remain explicit.",
      ];
    case "read_function_instructions":
      return [
        ...common,
        "This fast path reads only the requested function and does not invoke the decompiler or whole-program string/name inventories.",
        "Instruction text is Ghidra-specific and does not claim textual equivalence with Hopper output.",
      ];
    case "procedure_assembly":
      return [
        ...common,
        "Assembly is Ghidra Listing text and does not claim textual equivalence with Hopper output.",
      ];
    case "procedure_callers":
    case "procedure_callees":
      return common;
    case "xrefs":
      return [
        ...common,
        "The direct address list projects exact Ghidra references to one address but does not expose their kinds; procedure_references and analyze_function preserve available kind metadata.",
        "Synthetic Ghidra entry-point references without actionable memory sources are omitted.",
      ];
    case "procedure_references":
      return [
        ...common,
        "References cover the complete Ghidra function-body AddressSet and exact entry, including instruction-interior destinations and embedded-data sources; an enclosing address span does not establish function ownership.",
        "Reference kinds are direct Ghidra ReferenceManager observations; unresolved computed flows without a target are absent and remain unknown.",
        "Synthetic Ghidra entry-point references without actionable memory sources are omitted.",
      ];
    case "analyze_function":
      return [
        ...common,
        "References cover the complete Ghidra function-body AddressSet and exact entry. Dossier incoming edges omit sources owned by that function; procedure_references also retains those internal edges.",
        "The dossier combines Ghidra FunctionManager, Listing, ReferenceManager, BasicBlockModel, and decompiler observations; provider-specific pseudocode and assembly are not cross-provider text invariants.",
        "Resolved reference metadata identifies computed, indirect, external, call, jump, and data edges; unresolved targetless flows remain unknown, and function classifications distinguish thunks and externals.",
        "Synthetic Ghidra entry-point references without actionable memory sources are omitted.",
        "The Java bridge serializes one function request per Program. Decompilation runs until completion or caller cancellation unless REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS sets a per-function limit. That limit stops the requested decompile without requesting session closure; caller cancellation requests session closure.",
      ];
    default:
      return common;
  }
};

/** Provider-neutral capabilities advertised by every non-Windows Ghidra session. */
export const CAPABILITIES: readonly CapabilityDescriptor[] = Object.freeze(
  providerOperations.map((operation) => {
    return Object.freeze({
      provider: GHIDRA_PROVIDER_IDENTITY,
      operation,
      available: true,
      reason: null,
      // Project writes are private import machinery. Analysis reads are bound
      // to the artifact/profile; session annotations disable snapshot replay.
      ...(GHIDRA_MUTATING_OPERATIONS.has(operation) ||
      operation === "list_documents"
        ? {}
        : { cachePolicy: "snapshot" as const }),
      effects: Object.freeze({
        mutatesArtifact: GHIDRA_MUTATING_OPERATIONS.has(operation),
        launchesProcess: true,
        mayShowUi: false,
        mayAccessNetwork: false,
        mayWriteFilesystem: true,
        changesPermissions: false,
        requiresRoot: false,
      }),
      limitations: Object.freeze(limitationsFor(operation)),
    });
  }),
);

/** The selected database mode is not part of Windows P0 authority. */
export const EXISTING_PROJECT_WINDOWS_UNAVAILABLE =
  "An existing Ghidra project cannot be opened on the Windows launch path.";

/** Read-only project mode retains precise unavailable mutation capabilities. */
export const existingProjectCapabilities = (
  platform: NodeJS.Platform,
): readonly CapabilityDescriptor[] =>
  CAPABILITIES.map((capability): CapabilityDescriptor => {
    const limitations = limitationsFor(
      capability.operation === "binary_overview"
        ? "read_binary_inventory_summary"
        : capability.operation,
      true,
    );
    if (platform === "win32")
      return {
        ...capability,
        limitations,
        available: false,
        reason: EXISTING_PROJECT_WINDOWS_UNAVAILABLE,
        availabilityCode: "unsupported_host",
      };
    if (capability.effects.mutatesArtifact)
      return {
        ...capability,
        limitations,
        available: false,
        reason: "Existing Ghidra project sessions are read-only.",
        availabilityCode: "open_options_invalid",
      };
    return { ...capability, limitations };
  });
/** Capabilities advertised for the experimental Windows x64 P0 boundary. */
export const windowsP0Capabilities = (
  readiness: WindowsNativeReadiness = inspectWindowsNativeReadiness("win32"),
): readonly CapabilityDescriptor[] => {
  return Object.freeze(
    CAPABILITIES.map((capability): CapabilityDescriptor => {
      const limitations = Object.freeze([
        ...capability.limitations,
        ...windowsP0Limitations,
      ]);
      if (capability.effects.mutatesArtifact)
        return Object.freeze({
          ...capability,
          available: false,
          reason: "Windows Ghidra P0 does not admit database mutation.",
          availabilityCode: "unsupported_host",
          limitations,
        });
      return readiness.available
        ? Object.freeze({ ...capability, limitations })
        : Object.freeze({
            ...capability,
            available: false,
            reason: readiness.reason,
            availabilityCode: readiness.code,
            limitations,
          });
    }),
  );
};
