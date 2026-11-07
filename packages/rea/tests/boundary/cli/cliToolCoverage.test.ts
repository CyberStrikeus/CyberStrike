import { describe, expect, it } from "vitest";

import { createCli } from "../../../src/cli.js";
import { createCliInventory } from "../../../scripts/lib/catalog-cli.mjs";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { CLI_COMMAND_NAMES } from "../../../src/cliCommandNames.js";

/** Canonical MCP operations reached by CLI commands with different names. */
const CLI_COMMAND_TOOL_ALIASES = Object.freeze({
  "environment-build": ["export_environment_bundle"],
  guidance: ["search_guidance", "read_guidance_section"],
  analyze: ["binary_overview"],
  inspect: ["binary_overview"],
  decompile: ["procedure_pseudo_code"],
  function: ["analyze_function"],
  instructions: ["read_function_instructions"],
  trace: ["trace_feature"],
  search: ["search_strings", "search_procedures"],
  "capture-process": ["capture_process_scenario"],
  compare: ["compare_bundles"],
  "list-objdump-architectures": ["inspect_with_objdump"],
  "debug-with-gdb": ["gdb_console"],
  "debug-with-rizin": ["rizin_debug_command"],
});

/** MCP operations without a dedicated CLI command or direct command alias. */
const MCP_TOOLS_WITHOUT_DEDICATED_CLI = Object.freeze([
  // Runtime settings belong to the long-lived MCP server; CLI calls use launch/per-call controls.
  "inspect_analysis_settings",
  "update_analysis_settings",
  // MCP session control selects a resource root; CLI resource commands take paths directly.
  "open_bundle_resources",
  "address_name",
  "comment",
  "current_address",
  "current_procedure",
  "current_document",
  "goto_address",
  "inline_comment",
  "list_bookmarks",
  "list_documents",
  "list_names",
  "list_procedures",
  "list_segments",
  "list_strings",
  "next_address",
  "prev_address",
  "procedure_address",
  "procedure_assembly",
  "procedure_callees",
  "procedure_callers",
  "procedure_info",
  "procedure_references",
  "resolve_containing_procedure",
  "set_address_name",
  "set_addresses_names",
  "set_bookmark",
  "set_comment",
  "set_inline_comment",
  "unset_bookmark",
  "get_objc_classes",
  "get_objc_protocols",
  "batch_decompile",
  "get_call_graph",
  "analyze_swift_types",
  "find_xrefs_to_name",
  "trace_call_path",
  "open_binary",
  "close_binary",
  "binary_session",
  "export_evidence_bundle",
  "import_evidence_bundle",
  "compare_functions",
  "find_changed_behavior",
  "build_call_path",
  "correlate_static_and_runtime",
  "verify_reconstruction",
  "list_unknowns",
  "record_unknown",
  "update_unknown",
  "verify_unknown_resolution",
  "get_evidence_bundle",
  "get_navigation_context",
  "inspect_address_context",
  "start_gdb_session",
  "gdb_session_status",
  "close_gdb_session",
  "start_rizin_debug_session",
  "rizin_debug_session_status",
  "close_rizin_debug_session",
  "start_frida_session",
  "load_frida_script",
  "resume_frida_session",
  "unload_frida_script",
  "frida_session_status",
  "close_frida_session",
]);

describe("CLI canonical tool coverage", () => {
  it("accounts for every MCP tool on the CLI or marks it intentionally MCP-only", () => {
    const registeredCli = createCliInventory(createCli());
    const registeredCommandNames = new Set([
      ...registeredCli.primary,
      ...registeredCli.aliases.map(({ name }) => name),
    ]);
    const cliToolNames = new Set(
      registeredCli.primary.map((command) => command.replaceAll("-", "_")),
    );
    for (const [command, names] of Object.entries(CLI_COMMAND_TOOL_ALIASES)) {
      expect(registeredCommandNames.has(command)).toBe(true);
      for (const name of names) cliToolNames.add(name);
    }
    for (const command of CLI_COMMAND_NAMES)
      expect(registeredCommandNames.has(command)).toBe(true);
    const intentionalMcpOnly = new Set<string>(MCP_TOOLS_WITHOUT_DEDICATED_CLI);
    expect(
      [...intentionalMcpOnly].filter((name) => cliToolNames.has(name)).sort(),
    ).toEqual([]);
    const unaccounted = TOOL_CONTRACTS.map(({ name }) => name).filter(
      (name) => !cliToolNames.has(name) && !intentionalMcpOnly.has(name),
    );
    expect(unaccounted).toEqual([]);
    expect(new Set(MCP_TOOLS_WITHOUT_DEDICATED_CLI).size).toBe(
      MCP_TOOLS_WITHOUT_DEDICATED_CLI.length,
    );
    expect(
      MCP_TOOLS_WITHOUT_DEDICATED_CLI.every((name) =>
        TOOL_CONTRACTS.some((contract) => contract.name === name),
      ),
    ).toBe(true);
  });
});
