import { z } from "zod";
import { absoluteLocalPathStringSchema } from "../../domain/localPath.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { electronFuseOutputSchemas } from "../toolOutputSchemaGroups.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { inspectElectronFusesInputSchema } from "../../domain/electron/electronFuses.js";
import {
  electronPageInspectionSchema,
  electronTargetListSchema,
  inspectElectronPageInputSchema,
  listElectronTargetsInputSchema,
} from "../../domain/javascript/electronObservation.js";
import {
  electronActiveObservationInputSchema,
  electronActiveObservationResultSchema,
} from "../../domain/javascript/electronActiveObservation.js";
import {
  javaScriptRoutesCompleteDeliveryShape,
  javaScriptRoutesSummaryDeliveryShape,
} from "../../domain/analysisView/javascriptRoutesView.js";
import {
  javaScriptRoutesViewResultSchema,
  javascriptApplicationSummaryViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import { analysisDetailOutputSchemaOf } from "../analysisDetail.js";
import {
  analyzeJavaScriptApplicationInputSchema,
  javascriptApplicationAnalysisResultSchema,
} from "../../domain/javascript/javascriptApplicationAnalysis.js";
import { javascriptRuntimeReconciliationResultSchema } from "../../domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { reconcileJavaScriptRuntimeRequestSchema } from "./applicationWorkflowInputContracts.js";
import { JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE } from "./javascriptRuntimeReconciliationExample.js";

const listOutputSchema = evidenceResultOf(electronTargetListSchema);
const inspectionOutputSchema = evidenceResultOf(electronPageInspectionSchema);
const javascriptApplicationMcpInputSchema =
  analyzeJavaScriptApplicationInputSchema.extend({
    input_path: absoluteLocalPathStringSchema.describe(
      "Absolute path to the JavaScript application on the machine running REA.",
    ),
  });
/** Caller-selected delivery of a completed JavaScript application analysis. */
export const analyzeJavaScriptApplicationRequestSchema = z
  .discriminatedUnion("detail", [
    javascriptApplicationMcpInputSchema.extend(
      javaScriptRoutesCompleteDeliveryShape,
    ),
    javascriptApplicationMcpInputSchema.extend(
      javaScriptRoutesSummaryDeliveryShape,
    ),
  ])
  .meta({ "x-rea-root-discriminator": "detail" });
const applicationOutputSchema = analysisDetailOutputSchemaOf(
  javascriptApplicationAnalysisResultSchema,
  z.union([
    javascriptApplicationSummaryViewResultSchema,
    javaScriptRoutesViewResultSchema,
  ]),
);
const reconciliationOutputSchema = evidenceResultOf(
  javascriptRuntimeReconciliationResultSchema,
);

const endpoint = "http://127.0.0.1:9223";
const activeExample = {
  executable_path: "/Applications/Electron.app/Contents/MacOS/Electron",
  application_path: "/Applications/Example.app/Contents/Resources/main.js",
  args: [],
  actions: [{ step_id: "exercise-ipc", kind: "click", selector: "#run" }],
};

/** Endpoint-scoped Electron file-page discovery and inspection contracts. */
export const ELECTRON_TOOL_CONTRACTS = [
  {
    name: "list_electron_targets",
    ...toolContractMetadata("list_electron_targets"),
    description:
      "List every Electron file:// page target from a selected loopback CDP endpoint. Local file paths are canonicalized after symlink resolution. Selecting an endpoint exposes every eligible target and its local path metadata.",
    kind: "electron-provider",
    inputSchema: listElectronTargetsInputSchema,
    outputSchema: listOutputSchema,
    examples: [
      {
        title: "List Electron file pages",
        input: {
          cdp_endpoint: endpoint,
        },
      },
    ],
  },
  {
    name: "inspect_electron_page",
    ...toolContractMetadata("inspect_electron_page"),
    description:
      "Passively inspect one Electron file page by supplying its loopback CDP endpoint and target ID. The provider rechecks that the target currently exists at that endpoint and is a local file page. Returns frames, DOM structure, resource paths, and scripts without evaluating renderer JavaScript or invoking Electron APIs. The selected endpoint exposes every local file page and its metadata to this tool.",
    kind: "electron-provider",
    inputSchema: inspectElectronPageInputSchema,
    outputSchema: inspectionOutputSchema,
    examples: [
      {
        title: "Inspect an Electron page",
        input: {
          cdp_endpoint: endpoint,
          target_id: "TARGET_ID_FROM_LIST_ELECTRON_TARGETS",
        },
      },
    ],
  },
  {
    name: "analyze_javascript_application",
    ...toolContractMetadata("analyze_javascript_application"),
    description:
      "Reconstruct one local ASAR or extracted JavaScript application as an inline application graph without executing it. Returns recovered graph nodes, edges, semantic relations, integrity contradictions, limitations, and coverage. Select source_paths to acquire and analyze only exact inventoried file paths; the complete artifact inventory and identity remain intact, and unselected sources remain explicit unknowns. Dependencies are not implicitly analyzed. Select detail summary to retain the complete analysis Evidence in this session and receive only its summary view, then inspect selected modules or pages with inspect_analysis_view. Select a javascript-routes view with summary detail to query deduplicated static patterns, source-linked occurrences, source status or interpretation gaps with filters, fields and paging. Static routes do not establish reachability or the full application route set. Summary detail reduces delivery, whereas source_paths bounds source analysis. Integrity mismatches fail by default; record-and-continue retains observed bytes as untrusted and marks graph coverage partial. Timeout recovery: returned provider_timeout uses the per-source analysis_timeout_ms budget. A host-only 'timed out awaiting tools/call' needs a longer client tool deadline, not a larger analysis_timeout_ms. Never repeat the unchanged call to test whether that timeout persists; report the host setting if configuration is not editable (Codex: mcp_servers.<server>.tool_timeout_sec, seconds).",
    kind: "electron-provider",
    inputSchema: analyzeJavaScriptApplicationRequestSchema,
    outputSchema: applicationOutputSchema,
    examples: [
      {
        title: "Analyze one local JavaScript application",
        input: {
          input_path: "/Applications/Example.app/Contents/Resources/app.asar",
          format: "auto",
          integrity_policy: "fail",
        },
      },
      {
        title: "Analyze selected entry sources before unrelated vendor files",
        input: {
          input_path: "/Applications/Example.app/Contents/Resources/app.asar",
          source_paths: ["package.json", "main.js", "preload.js"],
          detail: "summary",
        },
      },
      {
        title: "Retain the complete analysis and return its summary view",
        input: {
          input_path: "/Applications/Example.app/Contents/Resources/app.asar",
          detail: "summary",
        },
      },
    ],
  },
  {
    name: "reconcile_javascript_runtime",
    ...toolContractMetadata("reconcile_javascript_runtime"),
    description:
      "Reconcile verified static JavaScript application graphs with existing passive web/Electron CDP, passive V8 Inspector, or provider-owned active Electron Evidence. Active Electron captures contribute an explicitly partial target-only runtime record; they never invent renderer scripts, frames, workers, or execution claims. Exact captured-source digests take priority over caller-declared file/URL mappings; target, frame, script, and worker ambiguity remains explicit, and source-map authority stays separate.",
    kind: "electron-provider",
    inputSchema: reconcileJavaScriptRuntimeRequestSchema,
    outputSchema: reconciliationOutputSchema,
    examples: [
      {
        title: "Reconcile one passive Electron capture",
        input: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
      },
    ],
  },
  {
    name: "capture_electron_scenario",
    ...toolContractMetadata("capture_electron_scenario"),
    description:
      "Use this for a provider-owned Electron run when passive CDP or Inspector observation cannot exercise application behavior. REA owns startup and teardown, accepts caller-defined click/wait actions plus window-targeted renderer reload/crash and synthetic open-url/second-instance delivery, and returns correlated window/WebContents/process/preload/session/navigation/shell/IPC evidence without retaining payload values. Actions wait for completion or request cancellation; a missing click target can keep the request pending. Results identify observed and unavailable event families, coverage status, action targets, and truncation. Cleanup failures retain collected observations with explicit cleanup uncertainty. External shell, navigation, permission, download, popup, updater, and OS-integration effects are blocked and recorded. Use passive Electron tools for observation-only work.",
    kind: "electron-provider",
    inputSchema: electronActiveObservationInputSchema,
    outputSchema: evidenceResultOf(electronActiveObservationResultSchema),
    examples: [
      { title: "Exercise an owned Electron application", input: activeExample },
    ],
  },
  {
    name: "inspect_electron_fuses",
    ...toolContractMetadata("inspect_electron_fuses"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect packaged Electron fuse bytes in one local macOS app bundle, Electron Framework binary, Windows PE executable, or Linux ELF executable. Returns the artifact digest, per-slice wire version, fuse index, version-1 name, state, and raw byte, plus derived implications for Inspector flags, ELECTRON_RUN_AS_NODE, embedded ASAR integrity, and app.asar-only loading. A missing sentinel is unknown fuse state. Reads artifact bytes only and does not modify the selected file or open a runtime target.",
    inputSchema: inspectElectronFusesInputSchema,
    outputSchema: electronFuseOutputSchemas.inspect_electron_fuses,
    examples: [
      {
        title: "Read packaged Electron fuse state",
        input: { path: "/Applications/Example.app" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
