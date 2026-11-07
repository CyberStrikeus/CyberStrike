import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import {
  analysisDetailOutputSchemaOf,
  analysisDetailSchema,
} from "./analysisDetail.js";
import { browserScenarioSummaryViewResultSchema } from "../domain/analysisView/analysisView.js";
import { browserScenarioInputSchema } from "../domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../domain/browserScenarioCapture.js";
import type { JsonValue } from "../domain/jsonValue.js";

const example: Record<string, JsonValue> = {
  browser: {
    mode: "launch",
    executable_path: "/opt/chromium/chrome",
  },
  start_url: { url: "https://app.example.test/", query: [] },
  actions: [
    {
      step_id: "settle",
      action: "wait_for_timeout",
      duration_ms: 250,
    },
  ],
};

/** Controlled browser scenario contract shared by MCP and catalog generation. */
export const BROWSER_SCENARIO_TOOL_CONTRACTS = [
  {
    name: "capture_browser_scenario",
    ...toolContractMetadata("capture_browser_scenario"),
    description:
      "Run a controlled browser scenario when passive observation cannot exercise the application. Launch the selected executable or connect to a loopback CDP target, provide a start URL and actions, and select storage or artifacts when needed. A request action sends one HTTP request to the start origin through the page's own fetch, with header values from secrets, page cookies or local storage; write methods change application state. Environment, empty storage, a URL-only final capture, and measured event-retention budgets are defaults. capture.network selects request_body, response_body, and header_values independently; capture.limits lets callers raise or lower the event count, retained-allocation estimates, network transaction count, and network content budgets. Selected content is returned inline with transaction and event references, byte digests, and explicit unavailable states. Budget omissions identify affected event kinds and network transactions. Credentials and declared secrets are redacted. Agents can run their own local fixture servers to control application responses. Actions run until completion or cancellation unless timeout_ms is set. Default detail complete returns the capture inline. Detail summary retains complete Evidence and returns step outcomes, the final or first unsuccessful step’s accessibility tree, and event/network counts. Read exact steps with selected artifacts, UTF-16 text pages, transactions with opt-in content, or events filtered by step, kind and transaction, through inspect_analysis_view kind browser-scenario.",
    kind: "browser-provider",
    inputSchema: browserScenarioInputSchema.extend({
      detail: analysisDetailSchema,
    }),
    outputSchema: analysisDetailOutputSchemaOf(
      browserScenarioCaptureSchema,
      browserScenarioSummaryViewResultSchema,
    ),
    examples: [
      { title: "Capture a deterministic browser scenario", input: example },
    ],
  },
] as const satisfies readonly ToolContract[];
