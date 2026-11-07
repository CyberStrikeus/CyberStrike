import type { WebRuntimePort } from "./WebRuntimePort.js";
import { ok } from "../domain/result.js";
import type { WebExecution } from "../domain/webExecution.js";
import type { WebEventListeners } from "../domain/webEventListeners.js";

const browser = {
  product: "RecordingChrome/1",
  protocol_version: "1.3",
  revision: "fixture",
  user_agent: "fixture",
  js_version: "fixture",
};
const target = {
  target_id: "selected-page",
  initial_url: "http://127.0.0.1:9222/app",
  origin: "http://127.0.0.1:9222",
  frame_id: "main-frame",
  loader_id: "fixture-document",
};
const at = "2026-01-01T00:00:00.000Z";

/** Immutable application-port result; it makes no real browser or socket claim. */
export const webExecutionFixture = (
  targetId = target.target_id,
  duration = 5,
): WebExecution => ({
  browser,
  target: { ...target, target_id: targetId },
  window: {
    armed_at: at,
    ended_at: at,
    requested_ms: duration,
    end_reason: "window_elapsed",
    producer_started_seconds: 1,
    producer_sampled_seconds: 2,
  },
  coverage: {
    state: "captured",
    reason: null,
    offset_units: "utf16-code-units",
    end_offset: "exclusive",
    scripts: [],
    excluded_scripts: 0,
  },
  requests: [],
  excluded_requests: 0,
  sources: [],
  script_inventory: {
    main_document_scripts: 0,
    not_reported_script_ids: [],
    coverage_absence: "unknown",
  },
  instrumentation: {
    resets_execution_counters: true,
    disables_optimized_execution: true,
    takes_one_resetting_sample: true,
    executes_selected_code: false,
    cleanup: "confirmed",
    page_ownership: "external",
  },
  limitations: ["Recording port fixture, not real browser evidence."],
});

/** Immutable listener port result for application and SDK schema boundaries. */
export const webListenersFixture = (
  targetId = target.target_id,
  selector = "#selected",
): WebEventListeners => ({
  browser,
  target: { ...target, target_id: targetId },
  inspected_at: at,
  selected_node: { selector, match: "found", backend_node_id: 22 },
  listeners: [],
  sources: [],
  cleanup: "confirmed",
  limitations: ["Recording port fixture, not real listener evidence."],
});

/** Provider-neutral recording seam preserves the exact parsed caller target and window. */
export const recordingWebRuntimePort = (): WebRuntimePort => ({
  identity: () => ({
    id: "runtime-recording",
    name: "Runtime recording fixture",
    version: "1",
  }),
  observeExecution: async (input) =>
    ok(webExecutionFixture(input.target_id, input.observation_ms)),
  inspectEventListeners: async (input) =>
    ok(webListenersFixture(input.target_id, input.selector)),
});
