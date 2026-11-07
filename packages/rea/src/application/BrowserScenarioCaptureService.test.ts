import { expect, it } from "vitest";

import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { parseEvidence } from "../domain/evidence.js";
import { browserScenarioInputSchema } from "../domain/browserScenario.js";
import type {
  BrowserScenarioCapture,
  BrowserScenarioPartialObservation,
} from "../domain/browserScenarioCapture.js";
import { err, ok } from "../domain/result.js";
import { scriptScenarioFixture } from "../../tests/fixtures/webScriptCapture.js";
import type { BrowserScenarioCapturePort } from "./BrowserScenarioCapturePort.js";
import { captureBrowserScenario } from "./BrowserScenarioCaptureService.js";
import {
  expectDroppedPartial,
  expectKeptPartial,
  expectOwnerError,
} from "./ownerObservationExpectation.fixture.js";

const scenario = browserScenarioInputSchema.parse({
  browser: { mode: "launch", executable_path: "/fixture/chrome" },
  start_url: { url: "https://fixture.test/", query: [] },
  actions: [{ step_id: "settle", action: "wait_for_timeout", duration_ms: 1 }],
});
const capture = scriptScenarioFixture();
const scenarioIdentity = {
  id: "scenario-fixture",
  name: "Scenario fixture",
  version: "1",
};
const runScenario = (
  failure: AnalysisError,
  id = { id: "fixture", name: "fixture", version: "1" },
) =>
  captureBrowserScenario(
    {
      identity: () => id,
      captureScenario: async () => err(failure),
    },
    scenario,
  );
const expectRetainedCapture = (
  result: Awaited<ReturnType<typeof runScenario>>,
  failure: AnalysisError,
) => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected the retained capture");
  expect(result.error).toBe(failure);
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "capture_browser_scenario",
    normalized_result: capture,
  });
};

it("converts a retained raw scenario capture into partial Evidence", async () => {
  const failure = new AnalysisCancelledError("capture_browser_scenario", {
    partialObservation: {
      kind: "browser-scenario-observation",
      capture,
    },
  });
  expectRetainedCapture(await runScenario(failure, scenarioIdentity), failure);
});

it("converts a raw scenario capture retained after cleanup failure", async () => {
  const failure = new BrowserObservationError(
    "capture_browser_scenario",
    "cleanup_failed",
    {
      cleanup: {
        reason: "browser close failed",
        resources: ["browser process"],
      },
      partialObservation: {
        kind: "browser-scenario-observation",
        capture,
      },
    },
  );
  const result = await runScenario(failure, scenarioIdentity);
  expectRetainedCapture(result, failure);
  if (!result.ok) expect(result.error.cleanupIncomplete).toBe(true);
});

it.each([
  null,
  { request: "opaque cancellation" },
  new BrowserObservationError("capture_browser_scenario", "protocol_error"),
])(
  "preserves the exact pre-admission caller reason without dispatch: %j",
  async (reason) => {
    const caller = new AbortController();
    caller.abort(reason);
    let calls = 0;
    const provider: BrowserScenarioCapturePort = {
      identity: () => ({ id: "fixture", name: "fixture", version: "1" }),
      captureScenario: async () => {
        calls++;
        throw new Error("Unexpected dispatch");
      },
    };
    const result = await captureBrowserScenario(provider, scenario, {
      signal: caller.signal,
    });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(calls).toBe(0);
  },
);

it("keeps startup cancellation and its incomplete capture", async () => {
  const reason = { requested: "stop during initial navigation" };
  const completed = scriptScenarioFixture();
  const {
    completeness: _completeness,
    steps: _steps,
    browser,
    ...retained
  } = completed;
  const partial: BrowserScenarioPartialObservation = {
    kind: "browser-scenario-observation",
    capture: {
      ...retained,
      browser: { ...browser, cleanup: "incomplete" },
      steps: [],
    },
  };
  const failure = new AnalysisCancelledError("capture_browser_scenario", {
    cause: reason,
    partialObservation: partial,
  });
  const result = await runScenario(failure);
  expectKeptPartial(expectOwnerError(result, failure, reason), partial);
});

it.each([{ steps: [undefined] }, { started_at: Number.NaN }])(
  "drops a non-JSON incomplete scenario capture and keeps cancellation primary",
  async (capturePartial) => {
    const reason = { requested: "stop during initial navigation" };
    const partial: BrowserScenarioPartialObservation = {
      kind: "browser-scenario-observation",
      capture: capturePartial as never,
    };
    const failure = new AnalysisCancelledError("capture_browser_scenario", {
      cause: reason,
      partialObservation: partial,
    });
    const result = await runScenario(failure);
    expectDroppedPartial(
      expectOwnerError(result, failure, reason),
      "Browser scenario provider retained a non-JSON incomplete observation.",
    );
  },
);

it("rejects a successful capture that is not a completed scenario", async () => {
  const provider: BrowserScenarioCapturePort = {
    identity: () => ({ id: "fixture", name: "fixture", version: "1" }),
    captureScenario: async () => ok({} as BrowserScenarioCapture),
  };
  const result = await captureBrowserScenario(provider, scenario);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a completed-capture refusal");
  expect(result.error).toBeInstanceOf(AnalysisOutputError);
  expect(result.error.message).toContain(
    "returned a malformed completed capture",
  );
  expect(result.error.partialObservation).toBeUndefined();
});
