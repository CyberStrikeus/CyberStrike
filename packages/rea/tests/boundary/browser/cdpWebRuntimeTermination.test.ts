import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import type { CdpEvent } from "../../../src/browser/CdpConnection.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { observeWebExecutionInputSchema } from "../../../src/domain/webExecution.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

describe("runtime flat-session lifecycle", () => {
  it("rejects session detachment between counter startup and local arming", async () => {
    let emitEvent: ((event: CdpEvent) => void) | undefined;
    const browser = await startRuntimeBrowser({
      commandResult: (command) => {
        if (command.method !== "Profiler.startPreciseCoverage")
          return undefined;
        emitEvent?.({
          method: "Target.detachedFromTarget",
          params: { sessionId: "session-1" },
        });
        return { timestamp: 12 };
      },
    });
    emitEvent = browser.emitEvent;
    onTestFinished(() => browser.close());
    let reportedArmed = false;
    const result = await new CdpWebRuntimeProvider().observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 2_147_483_647,
      }),
      {
        signal: AbortSignal.timeout(2_000),
        progress: {
          report: async (update) => {
            if (update.completed === 1) reportedArmed = true;
          },
        },
      },
    );
    if (result.ok)
      throw new Error("A detached session cannot arm an execution window");
    expect(result.error).toMatchObject({ reason: "target_session_detached" });
    expect(reportedArmed).toBe(false);
  });

  it.each([
    {
      case: "matching detach after an unrelated session detaches",
      events: [
        {
          method: "Target.detachedFromTarget",
          params: { sessionId: "another-session" },
        },
        {
          method: "Target.detachedFromTarget",
          params: { sessionId: "session-1" },
        },
      ] as CdpEvent[],
      observationMs: 2_147_483_647,
      endReason: "session_detached",
    },
    {
      case: "detach for another flat session",
      events: [
        {
          method: "Target.detachedFromTarget",
          params: { sessionId: "another-session" },
        },
      ] as CdpEvent[],
      observationMs: 30,
      endReason: "window_elapsed",
    },
    {
      case: "the observed crash event",
      events: [
        {
          method: "Inspector.targetCrashed",
          sessionId: "session-1",
          params: {},
        },
      ] as CdpEvent[],
      observationMs: 2_147_483_647,
      endReason: "target_terminated",
    },
  ])("preserves lifecycle identity for $case", async (scenario) => {
    const browser = await startRuntimeBrowser();
    onTestFinished(() => browser.close());
    const result = await new CdpWebRuntimeProvider().observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: scenario.observationMs,
      }),
      {
        signal: AbortSignal.timeout(2_000),
        progress: {
          report: async (update) => {
            if (update.completed === 1)
              for (const event of scenario.events) browser.emitEvent(event);
          },
        },
      },
    );
    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe(scenario.endReason);
    if (scenario.endReason !== "window_elapsed") {
      expect(result.value.coverage.state).toBe("unavailable");
      expect(result.value.instrumentation.takes_one_resetting_sample).toBe(
        false,
      );
    }
  });
});

describe("runtime stop lifecycle", () => {
  it.each(["cleanup failure", "caller cancellation"] as const)(
    "retains explicit session detachment during precise-coverage stop with %s",
    async (outcome) => {
      const controller = new AbortController();
      const reason = { caller: "stop precise coverage" };
      const browser = await startRuntimeBrowser(
        outcome === "cleanup failure"
          ? {
              commandError: (command) =>
                command.method === "Profiler.stopPreciseCoverage"
                  ? { code: -32_000, message: "Target session is detached" }
                  : undefined,
            }
          : {
              commandResult: (command) => {
                if (command.method === "Profiler.stopPreciseCoverage")
                  controller.abort(reason);
                return undefined;
              },
            },
      );
      onTestFinished(() => browser.close());
      const result = await new CdpWebRuntimeProvider().observeExecution(
        observeWebExecutionInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          observation_ms: 2_147_483_647,
        }),
        {
          signal:
            outcome === "cleanup failure"
              ? AbortSignal.timeout(2_000)
              : controller.signal,
          progress: {
            report: async (update) => {
              if (update.completed === 1)
                browser.emitEvent({
                  method: "Target.detachedFromTarget",
                  params: { sessionId: "session-1" },
                });
            },
          },
        },
      );
      if (outcome === "caller cancellation") {
        if (result.ok) throw new Error("The aborted stop command must fail");
        expect(result.error).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
        });
        return;
      }
      if (result.ok)
        throw new Error("Unconfirmed cleanup must remain a failure");

      const projection = projectAnalysisError(result.error);
      expect(projection.code).toBe("cleanup_incomplete");
      expect(projection.details?.diagnostics).toMatchObject({
        primary_error: {
          message: expect.stringContaining("Target session is detached"),
          details: {
            diagnostics: {
              observed_window: {
                target_id: "allowed-page",
                end_reason: "session_detached",
              },
            },
          },
        },
        cleanup_error: {
          details: {
            diagnostics: {
              cleanup_failures: expect.arrayContaining([
                expect.stringContaining("Profiler.stopPreciseCoverage"),
              ]),
            },
          },
        },
      });
      expect(
        browser.commands.filter(
          ({ method }) => method === "Profiler.stopPreciseCoverage",
        ),
      ).toHaveLength(2);
      expect(result.error.cleanupPrimary).toMatchObject({
        _tag: "BrowserObservationError",
        reason: "protocol_error",
        diagnostics: {
          observed_window: {
            target_id: "allowed-page",
            end_reason: "session_detached",
          },
        },
      });
    },
  );
});

describe("runtime disconnect ownership", () => {
  it("preserves a pending stop-command transport failure after session detachment", async () => {
    const browser = await startRuntimeBrowser({
      hangOnMethod: "Profiler.stopPreciseCoverage",
    });
    let closed = false;
    onTestFinished(async () => {
      if (!closed) await browser.close();
    });
    const observed = new CdpWebRuntimeProvider().observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 1,
      }),
      { signal: AbortSignal.timeout(2_000) },
    );
    await vi.waitFor(() => {
      expect(
        browser.commands.some(
          ({ method }) => method === "Profiler.stopPreciseCoverage",
        ),
      ).toBe(true);
    });
    browser.emitEvent({
      method: "Target.detachedFromTarget",
      params: { sessionId: "session-1" },
    });
    await browser.close();
    closed = true;
    const result = await observed;
    if (result.ok) throw new Error("The pending stop request must fail");
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "BrowserObservationError",
      reason: "disconnected",
    });
  });

  it("does not infer target termination from transport disconnect", async () => {
    const browser = await startRuntimeBrowser();
    let closed = false;
    onTestFinished(async () => {
      if (!closed) await browser.close();
    });
    const result = await new CdpWebRuntimeProvider().observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 2_147_483_647,
      }),
      {
        progress: {
          report: async (update) => {
            if (update.completed === 1) {
              await browser.close();
              closed = true;
            }
          },
        },
      },
    );
    if (result.ok) throw new Error("A disconnected transport is not a result");
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "BrowserObservationError",
      reason: "disconnected",
    });
  });
});

describe("runtime cleanup failure ordering", () => {
  it.each([
    ["Profiler.takePreciseCoverage", "Coverage sample failed"],
    ["Profiler.stopPreciseCoverage", "Coverage stop failed"],
  ] as const)(
    "keeps the %s protocol failure primary when transport later closes",
    async (method, message) => {
      const browser = await startRuntimeBrowser({
        commandError: (command) =>
          command.method === method ? { code: -32_000, message } : undefined,
        closeAfterMethod: method,
      });
      onTestFinished(() => browser.close());
      const result = await new CdpWebRuntimeProvider().observeExecution(
        observeWebExecutionInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          target_id: "allowed-page",
          observation_ms: 1,
        }),
        { signal: AbortSignal.timeout(2_000) },
      );
      if (result.ok) throw new Error("The failed CDP command must fail");
      const primary = result.error.cleanupPrimary;
      expect(primary).toMatchObject({
        _tag: "BrowserObservationError",
        reason: "protocol_error",
      });
      if (method === "Profiler.takePreciseCoverage")
        expect(primary?.secondaryFailures).toHaveLength(0);
    },
  );
});

describe("coverage URL representation", () => {
  it("sanitizes proven resource URLs while preserving declared source names", async () => {
    let resourceUrl = "";
    let declaredUrl = "";
    const browser = await startRuntimeBrowser({
      commandResult: (command) => {
        if (command.method === "Profiler.takePreciseCoverage")
          return {
            timestamp: 12,
            result: [
              { scriptId: "transport-script", url: resourceUrl, functions: [] },
              { scriptId: "declared-script", url: declaredUrl, functions: [] },
            ],
          };
        if (
          command.method === "Debugger.getScriptSource" &&
          ["transport-script", "declared-script"].includes(
            String(command.params.scriptId),
          )
        )
          return { scriptSource: ";" };
        return undefined;
      },
    });
    onTestFinished(() => browser.close());
    resourceUrl =
      browser.endpoint.replace("http://", "http://transport:credential@") +
      "/resource.js?caller=value#fragment";
    declaredUrl =
      browser.endpoint.replace("http://", "http://declared:label@") +
      "/declared.js?caller=value#fragment";
    const result = await new CdpWebRuntimeProvider().observeExecution(
      observeWebExecutionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 30,
      }),
      {
        progress: {
          report: async (update) => {
            if (update.completed !== 1) return;
            for (const [scriptId, url, hasSourceURL] of [
              ["transport-script", resourceUrl, false],
              ["declared-script", declaredUrl, true],
            ] as const)
              browser.emitEvent({
                method: "Debugger.scriptParsed",
                sessionId: "session-1",
                params: {
                  scriptId,
                  url,
                  hasSourceURL,
                  executionContextId: 1,
                  executionContextAuxData: { frameId: "runtime-main" },
                  startLine: 0,
                  startColumn: 0,
                  endLine: 0,
                  endColumn: 1,
                },
              });
          },
        },
      },
    );
    if (!result.ok) throw result.error;
    expect(
      result.value.coverage.scripts.map(({ reported_url }) => reported_url),
    ).toEqual([
      `${browser.endpoint}/resource.js?caller=value#fragment`,
      declaredUrl,
    ]);
    expect(JSON.stringify(result.value)).not.toContain("transport:credential@");
  });
});
