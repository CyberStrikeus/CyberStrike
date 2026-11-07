import { createHash } from "node:crypto";

import { sanitizeBrowserUrl } from "../../src/domain/browserObservation.js";
import { browserScenarioCaptureSchema } from "../../src/domain/browserScenarioCapture.js";
import { DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS } from "../../src/domain/browserScenarioCaptureLimits.js";
import { browserScenarioEventSchema } from "../../src/domain/browserScenarioCaptureValues.js";
import { createEvidence } from "../../src/domain/evidence.js";

/** Source-owned script capture with independently authored bytes. */
export const scriptScenarioFixture = (
  scripts = [
    {
      url: "https://fixture.test/app/main.js",
      bytes: Buffer.from("export const marker = 'fixture-source';\n"),
    },
  ],
) => {
  const items = scripts.flatMap(({ url, bytes }, index) => {
    const request = {
      transaction_id: `request-${index + 1}`,
      redirected_from_transaction_id: null,
      redirected_from_transaction_state: "root",
      method: "GET",
      url: sanitizeBrowserUrl(url),
      resource_type: "script",
      header_names: [],
      failure: null,
      step_index: 0,
    };
    const start = index * 3 + 1;
    return [
      browserScenarioEventSchema.parse({
        ...request,
        sequence: start,
        kind: "request",
        status: null,
      }),
      browserScenarioEventSchema.parse({
        ...request,
        sequence: start + 1,
        kind: "response",
        status: 200,
      }),
      browserScenarioEventSchema.parse({
        sequence: start + 2,
        step_index: 0,
        kind: "network-content",
        transaction_id: request.transaction_id,
        phase: "response",
        source_event_sequence: start + 1,
        headers: { state: "not_requested" },
        body: {
          state: "captured",
          representation: "browser-decoded-response-bytes",
          encoding: "base64",
          content: bytes.toString("base64"),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          media_type: "text/javascript",
          redacted: false,
        },
      }),
    ];
  });
  const completeness = {
    status: "complete",
    equality_eligible: true,
    missing_sections: [],
    truncated_sections: [],
  };
  const step = (index: number) => ({
    step_index: index,
    step_id: index === 0 ? "scenario_start" : "ready",
    action: index === 0 ? "goto_start" : "wait_for_timeout",
    status: "completed",
    elapsed_ms: 1,
    before_url: sanitizeBrowserUrl("https://fixture.test/"),
    after_url: sanitizeBrowserUrl("https://fixture.test/"),
    error: null,
    event_sequence_start: 1,
    event_sequence_end: items.length,
    artifacts: {
      screenshot: { state: "not_requested" },
      dom: { state: "not_requested" },
      accessibility: { state: "not_requested" },
      url: { state: "not_requested" },
      history: { state: "not_requested" },
      storage: { state: "not_requested" },
    },
    completeness,
  });
  return browserScenarioCaptureSchema.parse({
    browser: {
      mode: "launch",
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
      product: "Fixture",
      version: "1",
    },
    scenario: {
      start_origin: "https://fixture.test",
      action_count: 1,
      secret_references: [],
      network_content: {
        request_body: false,
        response_body: true,
        header_values: false,
      },
      event_families: ["network"],
      limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
    },
    duration_ms: 2,
    steps: [step(0), step(1)],
    events: {
      items,
      retained: items.length,
      dropped: 0,
      omissions: {
        by_kind: [],
        network_transactions: [],
        network_transaction_range: null,
      },
    },
    completeness,
    limitations: [],
  });
};

/** Complete Evidence envelope for authentication and file-boundary tests. */
export const scriptCaptureEvidenceFixture = () =>
  createEvidence(
    undefined,
    { id: "source-fixture", name: "Source fixture", version: "1" },
    {
      operation: "capture_browser_scenario",
      result: scriptScenarioFixture(),
      parameters: {},
      confidence: "observed",
      authority: "controlled-replay",
    },
  );
