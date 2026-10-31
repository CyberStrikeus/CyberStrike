import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SCENARIO_ORIGIN,
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import { inspectAnalysisView } from "./AnalysisViewService.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { sanitizeBrowserUrl } from "../../domain/browserObservation.js";
import type { BrowserScenarioCapture } from "../../domain/browserScenarioCapture.js";
import type { AnalysisViewRequest } from "../../domain/analysisView/analysisView.js";
import { projectBrowserScenarioView } from "../../domain/analysisView/browserScenarioView.js";

const tree = (text: string) => ({
  state: "captured" as const,
  value: {
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    text,
  },
});

/** Three steps: navigate to /quiz, capture its tree, then fail on a missing control. */
const quizCapture = (
  thirdStep: "failed" | "completed" = "failed",
): BrowserScenarioCapture => {
  const base = scenarioCaptureFixture();
  const [initial, browse] = base.steps;
  if (initial === undefined || browse === undefined)
    throw new Error("Fixture lacks steps");
  const quiz = sanitizeBrowserUrl(`${SCENARIO_ORIGIN}/quiz`);
  return {
    ...base,
    scenario: { ...base.scenario, action_count: 2 },
    steps: [
      {
        ...initial,
        artifacts: {
          ...initial.artifacts,
          url: { state: "captured", value: initial.after_url },
        },
      },
      {
        ...browse,
        after_url: quiz,
        artifacts: {
          ...browse.artifacts,
          accessibility: tree('- heading "Question 1"'),
          screenshot: { state: "missing", reason: "page closed" },
        },
      },
      {
        ...browse,
        step_index: 2,
        step_id: "answer",
        action: "click",
        before_url: quiz,
        after_url: quiz,
        ...(thirdStep === "failed"
          ? { status: "failed" as const, error: "locator not found" }
          : { status: "completed" as const, error: null }),
      },
    ],
  };
};

const view = async (
  capture: BrowserScenarioCapture,
  request: AnalysisViewRequest,
) => {
  const projected = await inspectAnalysisView({
    source: { kind: "inline", evidence: scenarioCaptureEvidence(capture) },
    view: request,
  });
  if (!projected.ok) throw projected.error;
  return projected.value.normalized_result as Record<string, unknown>;
};

describe("browser scenario analysis views", () => {
  it("counts inherited Evidence limitations alongside capture-local caveats", async () => {
    const capture = scenarioCaptureFixture();
    expect(capture.limitations).toEqual([]);
    const summary = await view(capture, { kind: "summary" });
    expect(summary).toMatchObject({
      limitations: [
        "Artifact identity is unavailable for this observation.",
        "Browser host platform and architecture were not observed.",
      ],
      summary: { limitation_count: 2 },
    });
  });

  it("summarizes steps compactly and focuses the first failing step's nearest captured tree", async () => {
    const summary = await view(quizCapture(), { kind: "summary" });
    expect(summary).toMatchObject({
      kind: "summary",
      parent_operation: "capture_browser_scenario",
      artifact: null,
      coverage: { status: "complete-within-view", exhausted: true },
    });
    const { steps, final_accessibility, network, events } =
      summary.summary as Record<string, unknown> & {
        steps: Record<string, unknown>[];
      };
    // before_url repeats only across a discontinuity; not_requested sections are omitted.
    expect(steps[0]).toHaveProperty("before_url");
    expect(steps[1]).not.toHaveProperty("before_url");
    expect(steps[2]).not.toHaveProperty("before_url");
    expect(steps[0]?.sections).toEqual({
      captured: ["url"],
      missing: [],
      truncated: [],
    });
    expect(steps[1]?.sections).toEqual({
      captured: ["accessibility"],
      missing: ["screenshot"],
      truncated: [],
    });
    expect(steps[2]).toMatchObject({
      status: "failed",
      error: "locator not found",
      after_url: { url: `${SCENARIO_ORIGIN}/quiz` },
    });
    expect(final_accessibility).toEqual({
      focus_step_index: 2,
      focus: "first-unsuccessful-step",
      step_index: 1,
      accessibility: tree('- heading "Question 1"'),
    });
    expect(network).toEqual({
      selected: true,
      transactions: 8,
      without_request: 0,
      ambiguous_transactions: 0,
      failed_transactions: 1,
      by_origin: [{ origin: SCENARIO_ORIGIN, transactions: 8 }],
      by_resource_type: [
        { resource_type: "document", transactions: 1 },
        { resource_type: "fetch", transactions: 7 },
      ],
      by_status_class: [
        { status_class: "2xx", transactions: 7 },
        { status_class: "failed", transactions: 1 },
      ],
    });
    expect(events).toMatchObject({ retained: 24, dropped: 0 });
  });

  it("reports the last step's own state when no step captured a tree", async () => {
    const capture = scenarioCaptureFixture();
    expect(await view(capture, { kind: "summary" })).toMatchObject({
      summary: {
        final_accessibility: {
          focus_step_index: 1,
          focus: "last-step",
          step_index: null,
          accessibility: { state: "not_requested" },
        },
      },
    });
  });
});

describe("browser scenario analysis view pages", () => {
  it("pages exact steps with only the selected captured sections", async () => {
    const page = await view(quizCapture("completed"), {
      kind: "browser-scenario",
      collection: "steps",
      step_indices: [1, 2],
      artifacts: ["accessibility"],
      offset: 0,
      limit: 1,
    });
    expect(page).toMatchObject({
      kind: "browser-scenario",
      source_completeness: { status: "complete" },
      source_events: { retained: 24, dropped: 0 },
      coverage: { status: "page", examined: 1, total: 2, next_offset: 1 },
      items: {
        collection: "steps",
        rows: [
          {
            step_index: 1,
            artifacts: { accessibility: tree('- heading "Question 1"') },
            omitted_artifacts: [{ section: "screenshot", state: "missing" }],
          },
        ],
      },
    });
  });

  it("filters events by step, kind and transaction, keeping original item indices", async () => {
    const capture = scenarioCaptureFixture();
    const responses = (await view(capture, {
      kind: "browser-scenario",
      collection: "events",
      event_kinds: ["response", "request-failed"],
      transaction_ids: ["request-2", "request-8"],
      offset: 0,
      limit: 64,
    })) as { items: { rows: { item_index: number; event: unknown }[] } };
    expect(
      responses.items.rows.map(({ item_index, event }) => ({
        item_index,
        event,
      })),
    ).toEqual(
      capture.events.items.flatMap((event, item_index) =>
        (event.kind === "response" || event.kind === "request-failed") &&
        ["request-2", "request-8"].includes(event.transaction_id)
          ? [{ item_index, event }]
          : [],
      ),
    );
    expect(responses.items.rows).toHaveLength(2);
    for (const empty of [
      { step_indices: [] },
      { event_kinds: [] },
      { transaction_ids: [] },
      { step_indices: [0] },
    ])
      expect(
        await view(capture, {
          kind: "browser-scenario",
          collection: "events",
          offset: 0,
          limit: 64,
          ...empty,
        }),
      ).toMatchObject({
        items: { rows: [] },
        coverage: { status: "empty", total: 0, exhausted: true },
      });
  });

  it("states dropped events and refuses views of other parents", async () => {
    const base = scenarioCaptureFixture();
    const dropped = {
      ...base,
      events: {
        ...base.events,
        dropped: 3,
        omissions: {
          ...base.events.omissions,
          by_kind: [
            {
              kind: "console" as const,
              count: 3,
              reasons: ["max-events" as const],
            },
          ],
        },
      },
      completeness: {
        status: "truncated" as const,
        equality_eligible: false as const,
        missing_sections: [],
        truncated_sections: ["events" as const],
      },
    };
    const summary = await view(dropped, { kind: "summary" });
    expect(summary.unknowns).toContain(
      "3 events were dropped by capture budgets; counts and pages cover retained events only.",
    );
    expect(summary).toMatchObject({
      summary: {
        events: {
          dropped: 3,
          omissions: {
            by_kind: [{ kind: "console", count: 3 }],
            network_transactions: 0,
          },
        },
      },
    });
    const refused = await inspectAnalysisView({
      source: { kind: "inline", evidence: scenarioCaptureEvidence() },
      view: { kind: "go", collection: "dependencies" },
    });
    if (refused.ok) throw new Error("Expected an unsupported view refusal");
    expect(projectAnalysisError(refused.error)).toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("browser scenario retained boundaries", () => {
  it("counts transactions whose request event was omitted and keeps source omissions on an exhausted page", async () => {
    const base = scenarioCaptureFixture();
    const omitted = (
      event: BrowserScenarioCapture["events"]["items"][number],
    ) =>
      event.kind === "request" ||
      (event.kind === "network-content" && event.phase === "request");
    const removed = base.events.items.filter(omitted);
    const items = base.events.items.filter((event) => !omitted(event));
    const capture: BrowserScenarioCapture = {
      ...base,
      events: {
        ...base.events,
        items,
        retained: items.length,
        dropped: removed.length,
        omissions: {
          ...base.events.omissions,
          by_kind: [
            { kind: "request", count: 8, reasons: ["max-events"] },
            { kind: "network-content", count: 1, reasons: ["max-events"] },
          ],
        },
      },
      completeness: {
        status: "truncated",
        equality_eligible: false,
        missing_sections: [],
        truncated_sections: ["events"],
      },
    };
    expect(await view(capture, { kind: "summary" })).toMatchObject({
      summary: {
        network: {
          transactions: 8,
          without_request: 8,
          failed_transactions: 1,
        },
      },
    });
    expect(
      await view(capture, {
        kind: "browser-scenario",
        collection: "transactions",
        transaction_ids: ["request-8"],
        event_kinds: [],
        offset: 0,
        limit: 1,
      }),
    ).toMatchObject({
      source_completeness: { status: "truncated" },
      source_events: { dropped: 9 },
      coverage: { total: 1, exhausted: true },
      items: {
        rows: [
          {
            transaction_id: "request-8",
            events: [],
            omitted_events: [{ kind: "request-failed" }],
          },
        ],
      },
    });
  });

  it("keeps network bodies opt-in while retaining each transaction's event identities", async () => {
    const capture = scenarioCaptureFixture();
    const request = {
      kind: "browser-scenario" as const,
      collection: "transactions" as const,
      transaction_ids: ["request-2"],
      offset: 0,
      limit: 1,
    };
    // Parse defaults at the public boundary rather than supplying a manually normalized request.
    const page = await inspectAnalysisView({
      source: { kind: "inline", evidence: scenarioCaptureEvidence(capture) },
      view: request,
    });
    if (!page.ok) throw page.error;
    const result = page.value.normalized_result;
    expect(result).toMatchObject({
      items: {
        collection: "transactions",
        rows: [{ transaction_id: "request-2" }],
      },
    });
    expect(result).toMatchObject({
      items: {
        rows: [
          {
            events: expect.not.arrayContaining([
              expect.objectContaining({
                event: expect.objectContaining({ kind: "network-content" }),
              }),
            ]),
            omitted_events: expect.arrayContaining([
              expect.objectContaining({ kind: "network-content" }),
            ]),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('"content":');
    const selected = await view(capture, {
      ...request,
      event_kinds: ["network-content"],
    });
    expect(selected).toMatchObject({
      items: {
        rows: [
          {
            transaction_id: "request-2",
            events: [
              expect.objectContaining({
                event: expect.objectContaining({
                  kind: "network-content",
                  transaction_id: "request-2",
                  phase: "response",
                  body: expect.objectContaining({
                    state: "captured",
                    content: Buffer.from('{"id":2,"login":"probe"}').toString(
                      "base64",
                    ),
                  }),
                }),
              }),
            ],
            omitted_events: expect.arrayContaining([
              { item_index: expect.any(Number), kind: "request" },
            ]),
          },
        ],
      },
    });
  });
});

describe("browser scenario network observation", () => {
  it("distinguishes unrequested and legacy-unknown network observation from an observed empty inventory", () => {
    const base = scenarioCaptureFixture([], {
      request_body: false,
      response_body: false,
      header_values: false,
    });
    const project = (capture: unknown) => {
      const result = projectBrowserScenarioView(
        {
          evidenceId: `ev:${"a".repeat(64)}`,
          operation: "capture_browser_scenario",
          normalizedResult: capture,
          limitations: [],
        },
        { kind: "summary" },
      );
      if (!result.ok) throw result.error;
      return result.value;
    };
    expect(project(base)).toMatchObject({
      summary: { network: { selected: true, transactions: 0 } },
    });
    expect(
      project({ ...base, scenario: { ...base.scenario, event_families: [] } }),
    ).toMatchObject({
      summary: { network: { selected: false, transactions: null } },
    });
    const { event_families: _families, ...legacyScenario } = base.scenario;
    expect(project({ ...base, scenario: legacyScenario })).toMatchObject({
      summary: { network: { selected: null, transactions: null } },
    });
  });
});

describe("browser scenario text and selection boundaries", () => {
  it("pages exact Unicode text with the full artifact digest and reports unavailable text explicitly", async () => {
    const capture = quizCapture("completed");
    const step = capture.steps[1]!;
    step.artifacts.accessibility = tree("A💡B\nC");
    const request = {
      kind: "browser-scenario" as const,
      collection: "text" as const,
      step_index: 1,
      artifact: "accessibility" as const,
      offset: 1,
      limit: 2,
    };
    expect(await view(capture, request)).toMatchObject({
      items: {
        state: "captured",
        text: "💡",
        sha256: tree("A💡B\nC").value.sha256,
        bytes: Buffer.byteLength("A💡B\nC"),
      },
      coverage: { examined: 2, total: 6, next_offset: 3 },
    });
    expect(await view(capture, { ...request, offset: 99 })).toMatchObject({
      items: { text: "" },
      coverage: { status: "empty", total: 6, exhausted: true },
    });
    expect(await view(capture, { ...request, step_index: 0 })).toMatchObject({
      items: { state: "not_requested", text: null, sha256: null, bytes: null },
    });
  });

  it("rejects irrelevant selection fields and nonexistent text steps with typed diagnostics", async () => {
    for (const request of [
      { kind: "browser-scenario", collection: "events", artifacts: [] },
      {
        kind: "browser-scenario",
        collection: "text",
        step_index: 99,
        artifact: "dom",
      },
    ]) {
      const result = await inspectAnalysisView({
        source: { kind: "inline", evidence: scenarioCaptureEvidence() },
        view: request,
      });
      if (result.ok)
        throw new Error("Expected the invalid view to be rejected");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
      });
    }
  });

  it("keeps source truncation facts when a text page has no retained payload", async () => {
    const capture = quizCapture("completed");
    const completeness = {
      status: "truncated" as const,
      equality_eligible: false as const,
      missing_sections: [],
      truncated_sections: ["accessibility" as const],
    };
    capture.steps[1]!.artifacts.accessibility = {
      state: "truncated",
      observed: 1000,
      retained: 0,
      reason: "capture budget",
    };
    capture.steps[1]!.completeness = completeness;
    capture.completeness = completeness;
    expect(
      await view(capture, {
        kind: "browser-scenario",
        collection: "text",
        step_index: 1,
        artifact: "accessibility",
        offset: 0,
        limit: 20,
      }),
    ).toMatchObject({
      source_completeness: { status: "truncated" },
      items: {
        state: "truncated",
        observed: 1000,
        retained: 0,
        reason: "capture budget",
        text: null,
      },
      coverage: { status: "empty", exhausted: true },
    });
  });
});
