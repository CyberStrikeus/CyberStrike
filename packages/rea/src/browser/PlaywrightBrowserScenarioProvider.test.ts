import { EventEmitter } from "node:events";
import type { BrowserContext, Page, Request, Response } from "playwright-core";
import { capturePlaywrightStepArtifacts } from "./PlaywrightScenarioArtifacts.js";
import { resolveScenarioSecrets } from "../../tests/fixtures/browserScenarioSecrets.js";
import {
  failBrowserScenarioOperation,
  PlaywrightScenarioBrowserCleanupOwner,
} from "./PlaywrightScenarioBrowser.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
// Fake-backed composition coverage; real browser verification lives in
// `npm run verify:browser`.
import { describe, expect, it, vi } from "vitest";

import type { BrowserScenarioSessionPort } from "./BrowserScenarioSessionPort.js";
import { PlaywrightBrowserScenarioProvider } from "./PlaywrightBrowserScenarioProvider.js";
import { PlaywrightScenarioEvents } from "./PlaywrightScenarioEvents.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import {
  browserScenarioSchema,
  type BrowserScenario,
} from "../domain/browserScenario.js";
import type { BrowserScenarioAction } from "../domain/browserScenarioValues.js";
import {
  browserStepArtifactsSchema,
  type BrowserScenarioEvent,
  type BrowserScenarioEventFamily,
  type BrowserStepArtifacts,
} from "../domain/browserScenarioCaptureValues.js";
import { PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION } from "../domain/browserNetworkEvidence.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { compareBrowserScenarios } from "../domain/browserScenarioDiff.js";
import { compareBrowserScenariosInputSchema } from "../domain/browserScenarioDiffValues.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";

const scenario = (
  options: {
    readonly mode?: "launch" | "connect";
    readonly captures?: readonly (
      | "screenshot"
      | "dom"
      | "accessibility"
      | "url"
      | "history"
      | "storage"
    )[];
    readonly events?: readonly (
      | "console"
      | "page-errors"
      | "network"
      | "websockets"
      | "frames"
      | "workers"
      | "popups"
      | "downloads"
    )[];
    readonly actions?: number;
  } = {},
): BrowserScenario =>
  browserScenarioSchema.parse({
    browser:
      options.mode === "connect"
        ? {
            mode: "connect",
            cdp_endpoint: "http://127.0.0.1:9222",
            target_id: "page-1",
          }
        : {
            mode: "launch",
            executable_path: "/opt/chromium",
          },
    start_url: { url: "https://app.example.test/" },
    actions: Array.from({ length: options.actions ?? 1 }, (_, index) => ({
      step_id: `wait_${index}`,
      action: "wait_for_timeout",
      duration_ms: 1,
    })),
    storage: {},
    secrets: [],
    capture: {
      after_each_step: options.captures ?? ["url"],
      at_end: [],
      events: options.events ?? [],
    },
  });

const connectedPlatformEmulationLimitation = expect.stringContaining(
  "Detaching a CDP page session may clear caller-owned navigator.platform emulation",
);

type SnapshotKind = BrowserScenario["capture"]["after_each_step"][number];

interface FakeSessionFailures {
  readonly incomplete?: boolean;
  readonly action?: Error;
  readonly capture?: { readonly call: number; readonly error: Error };
  readonly close?: Error;
}

const artifactState = (
  kind: SnapshotKind,
  requested: ReadonlySet<SnapshotKind>,
  incomplete: boolean,
) => {
  if (!requested.has(kind)) return { state: "not_requested" as const };
  if (kind === "url")
    return {
      state: "captured" as const,
      value: sanitizeBrowserUrl("https://app.example.test/current"),
    };
  if (incomplete && kind === "screenshot")
    return {
      state: "truncated" as const,
      observed: 2_048,
      retained: 0,
      reason: "fixture limit",
    };
  return { state: "missing" as const, reason: "fixture unavailable" };
};

class FakeSession implements BrowserScenarioSessionPort {
  readonly product = "Fake Chromium";
  readonly version = "1";
  readonly initialUrl = "about:blank";
  readonly processOwnership: "provider-owned" | "external";
  cleanupLease = new AnalysisCleanupLease(async () => {
    await this.close();
  }, ["browser_transport"]);
  closeCalls = 0;
  performCalls = 0;
  captureCalls = 0;
  onPerform: (() => void) | undefined;
  onClose: (() => void) | undefined;
  eventGaps: readonly string[] = [];
  storageGaps: readonly string[] = [];
  eventItems: readonly BrowserScenarioEvent[] = [];

  constructor(
    readonly mode: "launch" | "connect",
    private readonly failures: FakeSessionFailures = {},
  ) {
    this.processOwnership = mode === "launch" ? "provider-owned" : "external";
  }

  currentUrl() {
    return "https://app.example.test/current";
  }

  sanitizeUrl(value: string) {
    return sanitizeBrowserUrl(value);
  }

  setStep(_index: number) {}

  nextEventSequence() {
    return 1;
  }

  lastEventSequence() {
    return 0;
  }

  events(): ReturnType<BrowserScenarioSessionPort["events"]> {
    return {
      retained: this.eventItems.length,
      dropped: 0,
      items: this.eventItems,
      omissions: {
        by_kind: [],
        network_transactions: [],
        network_transaction_range: null,
      },
    };
  }

  eventLimitations(): readonly string[] {
    return this.eventGaps;
  }

  storageLimitations(): readonly string[] {
    return this.storageGaps;
  }

  async perform(_action: BrowserScenarioAction, signal?: AbortSignal) {
    this.performCalls += 1;
    this.onPerform?.();
    if (signal?.aborted === true) throw new Error("request cancelled");
    if (this.failures.action !== undefined) throw this.failures.action;
  }

  capture(
    requested: ReadonlySet<SnapshotKind>,
    _signal?: AbortSignal,
  ): Promise<BrowserStepArtifacts> {
    this.captureCalls += 1;
    if (this.failures.capture?.call === this.captureCalls)
      return Promise.reject(this.failures.capture.error);
    return Promise.resolve(
      browserStepArtifactsSchema.parse({
        screenshot: artifactState(
          "screenshot",
          requested,
          this.failures.incomplete === true,
        ),
        dom: artifactState("dom", requested, this.failures.incomplete === true),
        accessibility: artifactState(
          "accessibility",
          requested,
          this.failures.incomplete === true,
        ),
        url: artifactState("url", requested, this.failures.incomplete === true),
        history: artifactState(
          "history",
          requested,
          this.failures.incomplete === true,
        ),
        storage: artifactState(
          "storage",
          requested,
          this.failures.incomplete === true,
        ),
      }),
    );
  }

  close() {
    this.closeCalls += 1;
    this.onClose?.();
    if (this.failures.close !== undefined)
      return Promise.reject(this.failures.close);
    return Promise.resolve(
      this.mode === "launch"
        ? ("terminated-owned-process" as const)
        : ("disconnected-external" as const),
    );
  }

  redactError(error: unknown) {
    return error instanceof Error
      ? error.message.replaceAll("secret", "[REDACTED]")
      : "fixture failure";
  }
}

const capturedResponseBodyEvents = (): readonly BrowserScenarioEvent[] => [
  {
    sequence: 1,
    step_index: 0,
    kind: "response",
    transaction_id: "request-1",
    redirected_from_transaction_id: null,
    method: "GET",
    url: sanitizeBrowserUrl("https://app.example.test/main.js"),
    resource_type: "script",
    header_names: [],
    status: 200,
    failure: null,
  },
  {
    sequence: 2,
    step_index: 0,
    kind: "network-content",
    transaction_id: "request-1",
    source_event_sequence: 1,
    phase: "response",
    headers: { state: "not_requested" },
    body: {
      state: "captured",
      representation: "playwright-response-body-bytes",
      encoding: "base64",
      content: "",
      bytes: 0,
      sha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      media_type: "text/javascript",
      redacted: false,
    },
  },
];

it("compares retained network observations despite a failed subresource", async () => {
  const selected = scenario({ events: ["network"] });
  const input = browserScenarioSchema.parse({
    ...selected,
    capture: {
      ...selected.capture,
      network: { response_body: true },
    },
  });
  const capture = async (reply: string) => {
    const context = new EventEmitter();
    const page = new EventEmitter() as unknown as Page;
    const events = new PlaywrightScenarioEvents({
      page,
      context: context as unknown as BrowserContext,
      ownsContext: true,
      enabled: new Set(["network"]),
      network: input.capture.network,
      secrets: resolveScenarioSecrets(input, {}),
    });
    const failedBody = vi.fn(async () => Buffer.from("unread"));
    for (const failed of [true, false]) {
      const request = {
        method: () => "GET",
        url: () =>
          `https://app.example.test/${failed ? "extra.js" : "api/data"}`,
        resourceType: () => (failed ? "script" : "fetch"),
        headers: () => ({}),
        redirectedFrom: () => null,
        failure: () => ({ errorText: "net::ERR_ABORTED" }),
      } as unknown as Request;
      const response = {
        request: () => request,
        url: () => request.url(),
        status: () => (failed ? 404 : 200),
        headers: () => ({}),
        body: failed ? failedBody : async () => Buffer.from(reply),
      } as unknown as Response;
      context.emit("request", request);
      context.emit("response", response);
      context.emit(failed ? "requestfailed" : "requestfinished", request);
    }
    const session = new FakeSession("launch");
    vi.spyOn(session, "events").mockImplementation(() => events.result());
    vi.spyOn(session, "eventLimitations").mockImplementation(() =>
      events.limitations(),
    );
    vi.spyOn(session, "nextEventSequence").mockImplementation(() =>
      events.nextSequence(),
    );
    vi.spyOn(session, "lastEventSequence").mockImplementation(() =>
      events.lastSequence(),
    );
    vi.spyOn(session, "close").mockImplementation(async () => {
      await events.finish();
      return "terminated-owned-process";
    });
    const provider = new PlaywrightBrowserScenarioProvider(async () => session);
    const result = await provider.captureScenario(input);
    if (!result.ok) throw result.error;
    expect(failedBody).not.toHaveBeenCalled();
    expect(result.value.completeness).toMatchObject({
      status: "complete",
      equality_eligible: true,
      missing_sections: [],
    });
    expect(result.value.events.dropped).toBe(0);
    expect(result.value.events.items).toContainEqual(
      expect.objectContaining({
        kind: "network-content",
        body: {
          state: "unavailable",
          reason: "request-failed",
          message: "net::ERR_ABORTED",
        },
      }),
    );
    return result.value;
  };
  const before = await capture('{"value":1}');
  for (const [reply, expected] of [
    ['{"value":1}', "unchanged"],
    ['{"value":2}', "changed"],
  ] as const) {
    const after = await capture(reply);
    const comparison = compareBrowserScenarios(
      compareBrowserScenariosInputSchema.parse({
        before_scenario: before,
        after_scenario: after,
      }),
    );
    expect(comparison.overall_status).toBe(expected);
    expect(comparison.steps[0]?.status).toBe(expected);
  }
});

describe("PlaywrightBrowserScenarioProvider", () => {
  it("reports response-body provenance uncertainty without marking event coverage missing", async () => {
    const session = new FakeSession("launch");
    const selected = scenario();
    session.eventItems = capturedResponseBodyEvents();
    const input = browserScenarioSchema.parse({
      ...selected,
      capture: {
        ...selected.capture,
        network: { ...selected.capture.network, response_body: true },
      },
    });
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );

    const result = await provider.captureScenario(input);
    if (!result.ok) throw result.error;
    expect(result.value.limitations).toContain(
      PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION,
    );
    expect(result.value.completeness.missing_sections).not.toContain("events");
    expect(result.value.events.items[1]).toMatchObject({
      kind: "network-content",
      body: {
        state: "captured",
        representation: "playwright-response-body-bytes",
      },
    });
  });

  it("makes reported event gaps ineligible for equality even in launch mode", async () => {
    const session = new FakeSession("launch");
    session.eventGaps = ["Popup frames before discovery are unavailable"];
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(
      scenario({ events: ["frames"] }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.completeness).toMatchObject({
      status: "incomplete",
      equality_eligible: false,
      missing_sections: ["events"],
    });
    expect(result.value.limitations).toContain(session.eventGaps[0]);
  });

  it("retains completed observations while popup initial-storage coverage remains unknown", async () => {
    const session = new FakeSession("launch");
    session.storageGaps = [
      "First-script seed coverage is unknown for popup top-level contexts",
    ];
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(scenario());
    if (!result.ok) throw result.error;
    expect(result.value.completeness).toMatchObject({
      status: "incomplete",
      equality_eligible: false,
      missing_sections: ["storage"],
    });
    expect(result.value.steps.map(({ status }) => status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(result.value.limitations).toContain(session.storageGaps[0]);
  });

  it("returns an initial state and every step beyond the former action ceiling", async () => {
    const session = new FakeSession("launch");
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(scenario({ actions: 129 }));
    if (!result.ok) throw result.error;
    expect(result.value.scenario.action_count).toBe(129);
    expect(result.value.steps).toHaveLength(130);
    expect(result.value.steps.at(-1)?.step_id).toBe("wait_128");
  });

  it("makes missing and truncated captures ineligible for equality", async () => {
    const session = new FakeSession("launch", { incomplete: true });
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(
      scenario({ captures: ["screenshot", "dom"] }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.completeness).toMatchObject({
      status: "truncated",
      equality_eligible: false,
      missing_sections: ["dom"],
      truncated_sections: ["screenshot"],
    });
  });

  it("records one failed step, cancels later actions, and still cleans up", async () => {
    const session = new FakeSession("launch", {
      action: new Error("fixture secret action failure"),
    });
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(scenario({ actions: 2 }));
    if (!result.ok) throw result.error;
    expect(result.value.steps.map(({ status }) => status)).toEqual([
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(result.value.steps[1]?.error).toBe(
      "fixture [REDACTED] action failure",
    );
    expect(result.value.steps[2]?.error).toBe(
      "not executed after an earlier action failure",
    );
    expect(session.performCalls).toBe(1);
    expect(session.closeCalls).toBe(1);
    expect(result.value.completeness.equality_eligible).toBe(false);
  });
});

describe("connected browser scenario captures", () => {
  it("disconnects external CDP sessions and marks pre-attach events missing", async () => {
    const session = new FakeSession("connect");
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(
      scenario({ mode: "connect" }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.browser).toMatchObject({
      process_ownership: "external",
      cleanup: "disconnected-external",
    });
    expect(result.value.completeness).toMatchObject({
      status: "incomplete",
      equality_eligible: false,
      missing_sections: ["events"],
    });
    expect(result.value.limitations).toEqual(
      expect.arrayContaining([connectedPlatformEmulationLimitation]),
    );
    expect(session.closeCalls).toBe(1);
  });

  it("retains the attached platform-emulation limitation in partial observations", async () => {
    const session = new FakeSession("connect", {
      capture: { call: 1, error: new Error("fixture capture failure") },
    });
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(
      scenario({ mode: "connect" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error)).toMatchObject({
      details: {
        partial_observation: {
          capture: {
            limitations: expect.arrayContaining([
              connectedPlatformEmulationLimitation,
            ]),
          },
        },
      },
    });
  });
});

describe("PlaywrightBrowserScenarioProvider timing", () => {
  it("keeps capture elapsed values valid across a backward wall-clock jump", async () => {
    let wallClock = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => wallClock);
    const session = new FakeSession("launch");
    session.onPerform = () => {
      wallClock = 1;
    };
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );

    try {
      const result = await provider.captureScenario(scenario());
      if (!result.ok) throw result.error;
      expect(wallClock).toBe(1);
      expect(Number.isInteger(result.value.duration_ms)).toBe(true);
      expect(result.value.duration_ms).toBeGreaterThanOrEqual(0);
      expect(
        result.value.steps.every(
          ({ elapsed_ms }) => Number.isInteger(elapsed_ms) && elapsed_ms >= 0,
        ),
      ).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("PlaywrightBrowserScenarioProvider comparison coverage", () => {
  it("keeps quiet captures with different event families from comparing unchanged", async () => {
    const capture = async (events: readonly BrowserScenarioEventFamily[]) => {
      const provider = new PlaywrightBrowserScenarioProvider(() =>
        Promise.resolve(new FakeSession("launch")),
      );
      const result = await provider.captureScenario(scenario({ events }));
      if (!result.ok) throw result.error;
      return result.value;
    };
    const compare = async (
      before: readonly BrowserScenarioEventFamily[],
      after: readonly BrowserScenarioEventFamily[],
    ) =>
      compareBrowserScenarios(
        compareBrowserScenariosInputSchema.parse({
          before_scenario: await capture(before),
          after_scenario: await capture(after),
        }),
      );

    const recorded = await capture(["page-errors", "console", "console"]);
    expect(recorded.completeness.equality_eligible).toBe(true);
    expect(recorded.scenario.event_families).toEqual([
      "console",
      "page-errors",
    ]);
    for (const [before, after] of [
      [[], ["console"]],
      [["console"], ["page-errors"]],
    ] as const) {
      const compared = await compare(before, after);
      expect(compared.overall_status).toBe("unknown");
      expect(
        compared.steps.flatMap((step) => step.artifact_diffs),
      ).toContainEqual(
        expect.objectContaining({
          artifact: "events",
          status: "unknown",
          reason: expect.stringContaining("Event family selections differ"),
        }),
      );
    }
    expect(
      (await compare(["console", "page-errors"], ["page-errors", "console"]))
        .overall_status,
    ).toBe("unchanged");
  });
});

describe("PlaywrightBrowserScenarioProvider cleanup", () => {
  it("returns a cleanup failure with completed observations when close fails", async () => {
    const session = new FakeSession("launch", {
      action: new Error("fixture secret action failure"),
      close: new Error("browser close failed"),
    });
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(scenario());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const projection = projectAnalysisError(result.error);
    expect(projection).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        cleanup: "incomplete",
        resources: ["browser_transport"],
        partial_observation: {
          kind: "browser-scenario-observation",
          capture: {
            browser: { cleanup: "incomplete" },
            steps: [
              { step_id: "scenario_start" },
              { step_id: "wait_0", status: "failed" },
            ],
          },
        },
      },
    });
    expect(session.closeCalls).toBe(1);
  });
});

describe("PlaywrightBrowserScenarioProvider operation failures", () => {
  it.each([{ cleanupFails: false }, { cleanupFails: true }])(
    "retains typed partial data when operation fails and cleanupFails=$cleanupFails",
    async ({ cleanupFails }) => {
      const session = new FakeSession("launch", {
        capture: {
          call: 2,
          error: new AnalysisOutputError(
            "capture_browser_scenario",
            "step capture failed",
            {
              capturedOutput: {
                stdout: "partial stdout",
                stderr: "",
                truncated: false,
              },
              cleanup: {
                reason: "capture cleanup is uncertain",
                resources: ["capture_handle"],
              },
            },
          ),
        },
        ...(cleanupFails ? { close: new Error("browser close failed") } : {}),
      });
      session.eventItems = [
        {
          sequence: 1,
          step_index: 0,
          kind: "console",
          level: "log",
          text: "navigation started",
          url: sanitizeBrowserUrl("https://app.example.test/"),
        },
      ];
      const provider = new PlaywrightBrowserScenarioProvider(() =>
        Promise.resolve(session),
      );
      const result = await provider.captureScenario(scenario());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const projection = projectAnalysisError(result.error);
      expect(projection).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          ...(cleanupFails
            ? {
                diagnostics: {
                  primary_error: {
                    code: "cleanup_incomplete",
                    details: {
                      operation: "capture_browser_scenario",
                      diagnostics: {
                        primary_error: {
                          details: { reason: "step capture failed" },
                        },
                      },
                    },
                  },
                  cleanup_error: { code: "cleanup_incomplete" },
                },
              }
            : { reason: "step capture failed" }),
          partial_observation: {
            kind: "browser-scenario-observation",
            capture: {
              browser: {
                cleanup: cleanupFails
                  ? "incomplete"
                  : "terminated-owned-process",
              },
              steps: [{ step_id: "scenario_start" }],
              events: {
                retained: 1,
                dropped: 0,
                items: [
                  expect.objectContaining({ text: "navigation started" }),
                ],
                omissions: {
                  by_kind: [],
                  network_transactions: [],
                  network_transaction_range: null,
                },
              },
            },
          },
        },
      });
      expect(result.error.capturedOutput).toEqual({
        stdout: "partial stdout",
        stderr: "",
        truncated: false,
      });
      expect(result.error.cleanupResources).toEqual(
        cleanupFails
          ? ["capture_handle", "browser_transport"]
          : ["capture_handle"],
      );
      if (!cleanupFails)
        expect(result.error.cleanup).toEqual({
          reason: "capture cleanup is uncertain",
          resources: ["capture_handle"],
        });
      expect(session.closeCalls).toBe(1);
    },
  );
});

describe("PlaywrightBrowserScenarioProvider cancellation and timeout", () => {
  it.each([
    {
      name: "cancellation",
      error: new AnalysisCancelledError("capture_browser_scenario"),
      code: "cancelled",
      category: "cancelled",
      details: { operation: "capture_browser_scenario", cleanup: "complete" },
    },
    {
      name: "timeout",
      error: new AnalysisTimeoutError("capture_browser_scenario", 250),
      code: "provider_timeout",
      category: "timeout",
      details: { operation: "capture_browser_scenario", timeout_ms: 250 },
    },
  ])(
    "preserves $name category and details when cleanup succeeds",
    async ({ error, code, category, details }) => {
      const session = new FakeSession("launch", {
        capture: { call: 1, error },
      });
      const provider = new PlaywrightBrowserScenarioProvider(() =>
        Promise.resolve(session),
      );
      const result = await provider.captureScenario(scenario());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const projection = projectAnalysisError(result.error);
      expect(projection).toMatchObject({
        code,
        category,
        details: {
          ...details,
          partial_observation: {
            kind: "browser-scenario-observation",
            capture: { browser: { cleanup: "terminated-owned-process" } },
          },
        },
      });
      expect(session.closeCalls).toBe(1);
    },
  );
});

describe("PlaywrightBrowserScenarioProvider request cancellation", () => {
  it("does not open a session for an already-cancelled request", async () => {
    let opens = 0;
    const provider = new PlaywrightBrowserScenarioProvider(() => {
      opens += 1;
      return Promise.resolve(new FakeSession("launch"));
    });
    const controller = new AbortController();
    controller.abort();
    const result = await provider.captureScenario(scenario(), {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    expect(opens).toBe(0);
  });

  it("cancels an active action and still closes the session", async () => {
    const controller = new AbortController();
    const cancellationReason = new Error("cancel active scenario");
    const session = new FakeSession("launch");
    session.onPerform = () => controller.abort(cancellationReason);
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );
    const result = await provider.captureScenario(scenario({ actions: 2 }), {
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        partialObservation: {
          kind: "browser-scenario-observation",
          capture: {
            browser: { cleanup: "terminated-owned-process" },
            steps: [
              { status: "completed" },
              { status: "cancelled" },
              {
                status: "cancelled",
                error: "not executed after scenario request cancellation",
              },
            ],
          },
        },
      },
    });
    if (result.ok) throw new Error("Expected active scenario cancellation");
    expect(session.performCalls).toBe(1);
    expect(result.error.cause).toBe(cancellationReason);
    expect(session.closeCalls).toBe(1);
  });

  it("retains the completed capture when cancellation arrives during final close", async () => {
    const controller = new AbortController();
    const cancellationReason = new Error("cancel final close");
    const session = new FakeSession("launch");
    session.onClose = () => controller.abort(cancellationReason);
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );

    const result = await provider.captureScenario(scenario(), {
      signal: controller.signal,
    });

    expect(session.closeCalls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        partialObservation: {
          kind: "browser-scenario-observation",
          capture: {
            browser: { cleanup: "terminated-owned-process" },
            steps: [{ status: "completed" }, { status: "completed" }],
          },
        },
      },
    });
    if (result.ok) throw new Error("Expected final-close cancellation");
    expect(result.error.cause).toBe(cancellationReason);
  });

  it("retains final-close cancellation alongside failed cleanup", async () => {
    const controller = new AbortController();
    const session = new FakeSession("launch", {
      close: new Error("fixture close failed"),
    });
    session.onClose = () => controller.abort();
    const provider = new PlaywrightBrowserScenarioProvider(() =>
      Promise.resolve(session),
    );

    const result = await provider.captureScenario(scenario(), {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        cleanupIncomplete: true,
        partialObservation: {
          kind: "browser-scenario-observation",
          capture: {
            browser: { cleanup: "incomplete" },
            steps: [{ status: "completed" }, { status: "completed" }],
          },
        },
      },
    });
    if (result.ok)
      throw new Error("Expected final-close cancellation with cleanup");
    let primary = result.error.cleanupPrimary;
    while (primary?.cleanupPrimary !== undefined)
      primary = primary.cleanupPrimary;
    expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(primary?.cause).toBe(controller.signal.reason);
    await expect(provider.close()).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      operation: "capture_browser_scenario",
    });
    expect(session.closeCalls).toBe(2);
  });
});

it("shares concurrent close and retries browser cleanup after failure", async () => {
  const browserClose = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("browser close failed"))
    .mockResolvedValue(undefined);
  const removeProfile = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const finishEvents = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const cleanupSettlements: boolean[] = [];
  const cleanup = new PlaywrightScenarioBrowserCleanupOwner({
    closeBrowser: (disconnectAtBoundary) =>
      disconnectAtBoundary(() => browserClose()),
    removeProfile,
    onSettled: (browserClosed) => cleanupSettlements.push(browserClosed),
  });

  const first = cleanup.close(finishEvents);
  const concurrent = cleanup.close(finishEvents);
  await expect(first).rejects.toMatchObject({ reason: "cleanup_failed" });
  await expect(concurrent).rejects.toMatchObject({ reason: "cleanup_failed" });
  expect(browserClose).toHaveBeenCalledTimes(1);
  expect(removeProfile).not.toHaveBeenCalled();
  expect(finishEvents).toHaveBeenCalledTimes(1);
  expect(cleanupSettlements).toEqual([false]);

  await expect(cleanup.close(finishEvents)).resolves.toBeUndefined();
  await expect(cleanup.close(finishEvents)).resolves.toBeUndefined();
  expect(browserClose).toHaveBeenCalledTimes(2);
  expect(removeProfile).toHaveBeenCalledTimes(1);
  expect(finishEvents).toHaveBeenCalledTimes(1);
  expect(cleanupSettlements).toEqual([false, true]);
});

it("keeps failed event finalization failed across cleanup retries", async () => {
  const finishEvents = vi
    .fn<() => Promise<void>>()
    .mockRejectedValue(new Error("event finalization failed"));
  const closeBrowser = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const cleanup = new PlaywrightScenarioBrowserCleanupOwner({
    closeBrowser: (disconnectAtBoundary) =>
      disconnectAtBoundary(() => closeBrowser()),
    removeProfile: undefined,
  });

  await expect(cleanup.close(finishEvents)).rejects.toMatchObject({
    reason: "cleanup_failed",
  });
  await expect(cleanup.close(finishEvents)).rejects.toMatchObject({
    reason: "cleanup_failed",
  });
  expect(finishEvents).toHaveBeenCalledTimes(1);
  expect(closeBrowser).toHaveBeenCalledTimes(1);
});

it.each(["launch", "connect"] as const)(
  "reports locale coverage in %s success and retained operation/cleanup failures",
  async (mode) => {
    const input = scenario({ mode });
    input.environment.locale = "fr-FR";
    for (const failures of [
      {},
      {
        capture: {
          call: 1,
          error: new AnalysisCancelledError("capture_browser_scenario"),
        },
      },
      { close: new Error("fixture cleanup interrupted") },
    ]) {
      const session = new FakeSession(mode, failures);
      const provider = new PlaywrightBrowserScenarioProvider(
        async () => session,
      );
      const result = await provider.captureScenario(input);
      expect(result.ok).toBe(!("capture" in failures || "close" in failures));
      const expected = {
        limitations:
          mode === "connect"
            ? expect.arrayContaining([
                "Attached locale fr-FR applies to Intl formatting only; navigator.language(s) and Accept-Language remain caller-controlled. Use launch mode for matching page and request languages.",
              ])
            : expect.not.arrayContaining([
                expect.stringContaining("Attached locale"),
              ]),
      };
      if (result.ok) expect(result.value).toMatchObject(expected);
      else
        expect(projectAnalysisError(result.error)).toMatchObject({
          details: {
            partial_observation: {
              kind: "browser-scenario-observation",
              capture: expected,
            },
          },
        });
      expect(session.closeCalls).toBe(1);
    }
  },
);

it.each([false, true])(
  "follows the browser owner through provider recovery (operation failed: %s)",
  async (operationFailed) => {
    const reason = { caller: "authored capture cancellation" };
    const primary = new AnalysisCancelledError("capture_browser_scenario", {
      cause: reason,
    });
    const session = new FakeSession(
      "launch",
      operationFailed ? { capture: { call: 1, error: primary } } : {},
    );
    let denied = true;
    const owner = new PlaywrightScenarioBrowserCleanupOwner({
      closeBrowser: (disconnectAtBoundary) =>
        disconnectAtBoundary(async () => undefined),
      removeProfile: async () => {
        if (denied) throw new Error("profile removal denied");
      },
    });
    session.cleanupLease = owner.cleanupLease;
    session.close = async () => {
      await owner.close();
      return "terminated-owned-process";
    };
    const provider = new PlaywrightBrowserScenarioProvider(async () => session);
    try {
      const result = await provider.captureScenario(scenario());
      if (result.ok) throw new Error("Expected retained cleanup");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual(["browser_profile"]);
      const partial = result.error.partialObservation;
      await expect(provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      denied = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.cleanupResources).toEqual([]);
      expect(result.error.partialObservation).toBe(partial);
      if (operationFailed) {
        let restored = result.error.cleanupPrimary;
        while (restored?.cleanupPrimary !== undefined)
          restored = restored.cleanupPrimary;
        expect(restored).toBe(primary);
        expect(primary.cause).toBe(reason);
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "cancelled",
        });
      }
    } finally {
      denied = false;
      await provider.close();
    }
  },
);

it("resolves the returned failure after retrying a plain session cleanup capability", async () => {
  const session = new FakeSession("launch");
  let denied = true;
  session.close = async () => {
    if (denied) throw new Error("authored session cleanup denial");
    return "terminated-owned-process";
  };
  const provider = new PlaywrightBrowserScenarioProvider(async () => session);
  try {
    const result = await provider.captureScenario(scenario());
    if (result.ok) throw new Error("Expected cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    const failed: unknown = await provider
      .close()
      .catch((cause: unknown) => cause);
    expect(failed).toMatchObject({ cleanupIncomplete: true });
    denied = false;
    await provider.close();
    expect(result.error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(failed).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
  } finally {
    denied = false;
    await provider.close();
  }
});

it("retries every retained opening cleanup and preserves the original failure through mixed recovery", async () => {
  let denied = true;
  let healthyCloses = 0;
  const physical = new AnalysisOutputError(
    "capture_browser_scenario",
    "authored open failure",
  );
  const provider = new PlaywrightBrowserScenarioProvider(
    async (_scenario, options) => {
      options.retainCleanup?.(
        new AnalysisCleanupLease(async () => {
          if (denied) throw new Error("first cleanup denied");
        }, ["first cleanup"]),
      );
      options.retainCleanup?.(
        new AnalysisCleanupLease(async () => {
          healthyCloses++;
        }, ["healthy cleanup"]),
      );
      throw physical;
    },
  );
  try {
    const result = await provider.captureScenario(scenario());
    if (result.ok) throw new Error("Expected opening failure");
    const failed: unknown = await provider
      .close()
      .catch((cause: unknown) => cause);
    expect(failed).toMatchObject({ cleanupIncomplete: true });
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(healthyCloses).toBe(1);
    denied = false;
    await provider.close();
    expect(result.error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(failed).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(result.error.cleanupPrimary).toBe(physical);
    expect(healthyCloses).toBe(1);
  } finally {
    denied = false;
    await provider.close();
  }
});

it("keeps a cancelled opening incomplete until its retained late cleanup finishes", async () => {
  let finish: () => void = () => {};
  const late = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reason = { caller: "cancelled opening before late handshake" };
  const primary = new AnalysisCancelledError("capture_browser_scenario", {
    cause: reason,
  });
  const provider = new PlaywrightBrowserScenarioProvider(
    async (_scenario, options) => {
      options.retainCleanup?.(
        new AnalysisCleanupLease(() => late, ["late opening"]),
      );
      throw primary;
    },
  );
  try {
    const result = await provider.captureScenario(scenario());
    if (result.ok) throw new Error("Expected cancelled opening");
    expect(result.error.cleanupIncomplete).toBe(true);
    const closing = provider.close();
    await Promise.resolve();
    expect(result.error.cleanupIncomplete).toBe(true);
    finish();
    await closing;
    expect(result.error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(result.error.cleanupPrimary).toBe(primary);
    expect(primary.cause).toBe(reason);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cancelled",
    });
  } finally {
    finish();
    await provider.close();
  }
});

it.each([false, true])(
  "follows late browser acknowledgement without another retry (cancelled during close: %s)",
  async (cancelled) => {
    vi.useFakeTimers();
    let acknowledge: () => void = () => {};
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const caller = new AbortController();
    const reason = { caller: "during final browser close" };
    const owner = new PlaywrightScenarioBrowserCleanupOwner({
      closeBrowser: (disconnectAtBoundary) =>
        disconnectAtBoundary(() => acknowledgement),
      removeProfile: undefined,
    });
    const session = new FakeSession("launch");
    session.cleanupLease = owner.cleanupLease;
    session.close = async () => {
      if (cancelled) caller.abort(reason);
      await owner.close();
      return "terminated-owned-process";
    };
    const provider = new PlaywrightBrowserScenarioProvider(async () => session);
    try {
      const pending = provider.captureScenario(scenario(), {
        signal: caller.signal,
      });
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      if (result.ok) throw new Error("Expected timed out cleanup response");
      expect(result.error.cleanupIncomplete).toBe(true);
      const partial = result.error.partialObservation;
      acknowledge();
      await owner.cleanupLease.release();
      expect(result.error).toMatchObject({
        cleanupIncomplete: false,
        cleanupResources: [],
      });
      expect(result.error.partialObservation).toBe(partial);
      if (cancelled) {
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "cancelled",
        });
        let primary = result.error.cleanupPrimary;
        while (primary?.cleanupPrimary !== undefined)
          primary = primary.cleanupPrimary;
        expect(primary?.cause).toBe(reason);
      }
    } finally {
      acknowledge();
      await provider.close();
      vi.useRealTimers();
    }
  },
);

it("retains a profile-only opening lease without adding transport labels or waiting for another retry", async () => {
  let denied = true;
  let releases = 0;
  const primary = new AnalysisOutputError(
    "capture_browser_scenario",
    "authored opening failure",
  );
  const lease = new AnalysisCleanupLease(async () => {
    releases++;
    if (denied) throw new Error("profile removal denied");
  }, ["browser_profile"]);
  const provider = new PlaywrightBrowserScenarioProvider(
    async (_scenario, options) => {
      try {
        return await failBrowserScenarioOperation(lease, primary);
      } catch (cause: unknown) {
        options.retainCleanup?.(lease);
        throw cause;
      }
    },
  );
  try {
    const result = await provider.captureScenario(scenario());
    if (result.ok) throw new Error("Expected opening failure");
    expect(result.error).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: ["browser_profile"],
    });
    denied = false;
    await lease.release();
    expect(result.error).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
    });
    await provider.close();
    expect(releases).toBe(2);
  } finally {
    denied = false;
    await provider.close();
  }
});

it("keeps an earlier physical failure primary when final cleanup also observes cancellation", async () => {
  const caller = new AbortController();
  const physical = new Error("physical capture failure");
  const primary = new AnalysisOutputError(
    "capture_browser_scenario",
    physical.message,
    { cause: physical },
  );
  const session = new FakeSession("launch", {
    capture: { call: 1, error: primary },
  });
  let denied = true;
  session.close = async () => {
    caller.abort({ caller: "later during final cleanup" });
    if (denied) throw new Error("cleanup denied");
    return "terminated-owned-process";
  };
  const provider = new PlaywrightBrowserScenarioProvider(async () => session);
  try {
    const result = await provider.captureScenario(scenario(), {
      signal: caller.signal,
    });
    if (result.ok) throw new Error("Expected physical failure");
    denied = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
    });
    let restored = result.error.cleanupPrimary;
    while (restored?.cleanupPrimary !== undefined)
      restored = restored.cleanupPrimary;
    expect(restored).toBe(primary);
    expect(primary.cause).toBe(physical);
  } finally {
    denied = false;
    await provider.close();
  }
});

it.each([false, true])(
  "keeps planned secret screenshots unavailable through success and cleanup failure (failure: %s)",
  async (cleanupFailure) => {
    const input = browserScenarioSchema.parse({
      ...scenario({ captures: ["screenshot"] }),
      actions: [
        {
          step_id: "request",
          action: "request",
          method: "POST",
          path: "/api/items",
          save: [{ name: "token", json_pointer: "/token", secret: true }],
        },
      ],
    });
    const secrets = resolveScenarioSecrets(input, {});
    const screenshot = vi.fn(async () =>
      Buffer.from("private screenshot pixels"),
    );
    const session = new FakeSession(
      "launch",
      cleanupFailure ? { close: new Error("cleanup failed") } : {},
    );
    session.capture = async (requested) =>
      capturePlaywrightStepArtifacts({
        context: {} as BrowserContext,
        page: { screenshot } as unknown as Page,
        secrets,
        requested,
      });
    session.onPerform = () =>
      secrets.save("request.token", "token", "late-pixel-token", true);
    const provider = new PlaywrightBrowserScenarioProvider(async () => session);
    const result = await provider.captureScenario(input);
    const step = {
      artifacts: { screenshot: { state: "missing" } },
      completeness: {
        equality_eligible: false,
        missing_sections: ["screenshot"],
      },
    };
    if (cleanupFailure)
      expect(result).toMatchObject({
        ok: false,
        error: { partialObservation: { capture: { steps: [step, step] } } },
      });
    else {
      if (!result.ok) throw result.error;
      expect(result.value.steps).toMatchObject([step, step]);
      expect(result.value.completeness.equality_eligible).toBe(false);
    }
    expect(screenshot).not.toHaveBeenCalled();
  },
);
