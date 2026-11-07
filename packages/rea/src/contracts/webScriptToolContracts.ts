import {
  exportWebScriptsInputSchema,
  webScriptExportResultSchema,
} from "../domain/webScriptExport.js";
import type { ToolContract } from "./toolContractTypes.js";
import {
  webModuleTraceInputSchema,
  webModuleTraceResultSchema,
} from "../domain/webModuleTrace.js";
import { toolContractMetadata } from "./toolEffects.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import {
  webSourceLocationInputSchema,
  webSourceLocationResultSchema,
} from "../domain/webSourceLocation.js";

/** Local captured-script publication contracts shared by CLI and MCP. */
export const WEB_SCRIPT_TOOL_CONTRACTS = [
  {
    name: "trace_web_source_location",
    ...toolContractMetadata("trace_web_source_location"),
    description:
      "Trace one generated position in an exported website script through an explicitly paired local source map. Verifies manifest, selected script and map SHA-256/byte identities; returns every equal-position mapping, reported source/root, resolved source URL, embedded sourcesContent and original position inline. One-based lines and zero-based UTF-16 columns; greatest generated position <= requested across lines. Duplicate sources and generated-only mappings remain distinct. Caller-selected pairing does not establish deployment authenticity or execution. Regular maps and inline indexed sections only; external section URLs are unsupported. No network access or application execution; uses the pinned upstream codec in an owned Node process with private temporary files, independent 192 MiB old-generation heap and 20-second deadline. 4 MiB map, 32 MiB reply; complete evidence or actionable resource failure. Cleanup may extend the deadline.",
    kind: "application",
    inputSchema: webSourceLocationInputSchema,
    outputSchema: evidenceResultOf(webSourceLocationResultSchema),
    examples: [
      {
        title:
          "Trace a selected captured JavaScript point to embedded original source",
        input: {
          manifest_path: "/analysis/scripts/manifest.json",
          script_index: 0,
          source_map: {
            path: "/analysis/app.js.map",
            url: "https://example.test/app.js.map",
          },
          generated_position: { line: 1, column: 25 },
        },
      },
    ],
  },
  {
    name: "trace_web_module_imports",
    ...toolContractMetadata("trace_web_module_imports"),
    description:
      "Trace one exported website script's outgoing native ES imports/re-exports, using exact URL and optional selected import-map context. Reads a local export_web_scripts manifest and verifies the selected source's SHA-256/size; returns source positions, native resolved URLs or exact errors, every matching captured candidate and explicit unknown execution. Query/fragment identities are preserved. Computed imports and bundler IDs remain unknown. Select importer_url for unknown inline/document-base context. Caller-supplied Chromium executes only a trusted REA resolver stub in an owned context with page requests locally fulfilled/blocked; no captured application execution or asset refetch. Requires absolute REA_BROWSER_EXECUTABLE for literal imports. 32 MiB manifest, 16 MiB source, 4 MiB map and 20-second native deadline; cleanup may extend the deadline.",
    kind: "application",
    inputSchema: webModuleTraceInputSchema,
    outputSchema: evidenceResultOf(webModuleTraceResultSchema),
    examples: [
      {
        title: "Trace an exported module under a selected import map",
        input: {
          manifest_path: "/analysis/exported-scripts/manifest.json",
          script_index: 0,
          import_map: {
            path: "/analysis/import-map.json",
            base_url: "https://example.test/app/",
          },
        },
      },
    ],
  },
  {
    name: "export_web_scripts",
    ...toolContractMetadata("export_web_scripts"),
    description:
      "Export JavaScript bytes already retained in one local inspect_web_page or capture_browser_scenario JSON capture (normalized result or complete Evidence). Writes scripts and a digest-verified manifest into an absent absolute output_directory. Returns all source URLs, script or transaction/event references, unavailable states, and an analysis_input for analyze_javascript_application when any bytes were exported. Include script sources in inspect_web_page or select capture.network.response_body in scenarios. No refetch or execution. Safe unambiguous URL layouts preserve relative module paths; versions, query variants, inline scripts, and path collisions are isolated with explicit resolution limitations.",
    kind: "application",
    inputSchema: exportWebScriptsInputSchema,
    outputSchema: evidenceResultOf(webScriptExportResultSchema),
    examples: [
      {
        title: "Export a saved website capture for static JavaScript analysis",
        input: {
          capture_path: "/analysis/capture.json",
          output_directory: "/analysis/exported-scripts",
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
