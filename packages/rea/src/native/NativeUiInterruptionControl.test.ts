import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { expect, it } from "vitest";
import { NativeUiInterruptionControl } from "./NativeUiInterruptionControl.js";

it("reports the selected native UI deadline", () => {
  const deadline = AbortSignal.abort();
  const control = new NativeUiInterruptionControl(undefined, deadline, 2_500);
  const error = control.error("observe_native_ui");
  expect(error).toBeInstanceOf(AnalysisTimeoutError);
  if (!(error instanceof AnalysisTimeoutError)) return;
  const projected = projectAnalysisError(error);
  expect(projected).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: 2500 },
  });
  control.dispose();
});

it("gives a pre-aborted caller priority over a pre-aborted deadline", () => {
  const reason = { phase: "shared" };
  const caller = new AbortController();
  const deadline = new AbortController();
  caller.abort(reason);
  deadline.abort(reason);
  const control = new NativeUiInterruptionControl(
    caller.signal,
    deadline.signal,
  );
  expect(control.error("observe_native_ui")).toBeInstanceOf(
    AnalysisCancelledError,
  );
  expect(control.error("observe_native_ui")?.cause).toBe(reason);
  control.dispose();
});

it("keeps the first observed source when caller and deadline share a reason", () => {
  const reason = { phase: "shared" };
  const caller = new AbortController();
  const deadline = new AbortController();
  const control = new NativeUiInterruptionControl(
    caller.signal,
    deadline.signal,
  );
  deadline.abort(reason);
  caller.abort(reason);
  expect(control.error("observe_native_ui")).toBeInstanceOf(
    AnalysisTimeoutError,
  );
  expect(control.error("observe_native_ui")?.cause).toBe(reason);
  control.dispose();
});

it("records a helper subprocess timeout as the selected UI deadline", () => {
  const deadline = new AbortController();
  const control = new NativeUiInterruptionControl(
    undefined,
    deadline.signal,
    2_500,
  );
  const error = control.deadlineFailure("observe_native_ui");
  expect(error).toBeInstanceOf(AnalysisTimeoutError);
  if (!(error instanceof AnalysisTimeoutError)) return;
  const projected = projectAnalysisError(error);
  expect(projected).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: 2500 },
  });
  control.dispose();
});

it("keeps caller cancellation ahead of a later helper subprocess timeout", () => {
  const reason = { phase: "caller" };
  const caller = new AbortController();
  caller.abort(reason);
  const control = new NativeUiInterruptionControl(
    caller.signal,
    new AbortController().signal,
    2_500,
  );
  const error = control.deadlineFailure("observe_native_ui");
  expect(error).toBeInstanceOf(AnalysisCancelledError);
  expect(error.cause).toBe(reason);
  control.dispose();
});

it("records a caller interruption before a later deadline", () => {
  const reason = { phase: "shared" };
  const caller = new AbortController();
  const deadline = new AbortController();
  const control = new NativeUiInterruptionControl(
    caller.signal,
    deadline.signal,
  );
  caller.abort(reason);
  deadline.abort(reason);
  expect(control.error("observe_native_ui")).toBeInstanceOf(
    AnalysisCancelledError,
  );
  expect(control.error("observe_native_ui")?.cause).toBe(reason);
  control.dispose();
});
