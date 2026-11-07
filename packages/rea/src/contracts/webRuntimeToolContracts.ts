import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import {
  observeWebExecutionInputSchema,
  webExecutionSchema,
} from "../domain/webExecution.js";
import {
  inspectWebEventListenersInputSchema,
  webEventListenersSchema,
} from "../domain/webEventListeners.js";

/** Native website runtime primitives distinguish instrumentation from listener inspection. */
export const WEB_RUNTIME_TOOL_CONTRACTS = [
  {
    name: "observe_web_execution",
    ...toolContractMetadata("observe_web_execution"),
    description:
      "Instrument one selected CDP page for a finite, externally driven precise coverage window. Resets execution counters and prevents optimized execution until stopped. Returns complete nested UTF-16 ranges/counts, independently hashed script text and request initiator associations by session script ID. Does not navigate, click, evaluate selected code or close the externally owned page. Navigation ends document-scoped collection; workers and UI causality remain outside this claim. Emits an actual armed progress notification before external actions.",
    kind: "browser-provider",
    inputSchema: observeWebExecutionInputSchema,
    outputSchema: evidenceResultOf(webExecutionSchema),
    examples: [
      {
        title: "Attribute externally triggered page execution",
        input: {
          cdp_endpoint: "http://127.0.0.1:9222",
          target_id: "TARGET_ID_FROM_LIST_BROWSER_TARGETS",
          observation_ms: 10_000,
        },
      },
    ],
  },
  {
    name: "inspect_web_event_listeners",
    ...toolContractMetadata("inspect_web_event_listeners"),
    description:
      "Inspect listeners registered directly on the first main-document CSS match in one selected CDP page. Returns event flags, native callback locations, source ownership and exact script text/digests inline. Does not dispatch events, evaluate JavaScript or invoke handlers. Delegated ancestor/framework listeners and execution history remain unknown. Releases REA's object group and transport, preserving the external page.",
    kind: "browser-provider",
    inputSchema: inspectWebEventListenersInputSchema,
    outputSchema: evidenceResultOf(webEventListenersSchema),
    examples: [
      {
        title: "Find a selected button's callback source",
        input: {
          cdp_endpoint: "http://127.0.0.1:9222",
          target_id: "TARGET_ID_FROM_LIST_BROWSER_TARGETS",
          selector: "#submit",
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
