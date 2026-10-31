import { expect, it } from "vitest";

import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { captureJadxFailure } from "./JadxFailure.js";
import { jadxOperationTimeoutGuidance } from "./JadxOperationTimeout.js";

it("names REA_JADX_OPERATION_TIMEOUT_MS when the operation deadline elapses", () => {
  const timeout = AbortSignal.abort(new Error("deadline"));
  const present = captureJadxFailure({
    cause: timeout.reason,
    request: {
      operation: "inspect_android_package",
      input: { path: "/targets/app.apk" },
    },
    timeout,
    timeoutMs: 1500,
    signal: undefined,
    session: undefined,
  });
  const projected = projectAnalysisError(present());
  const guidance = jadxOperationTimeoutGuidance(1500);
  expect(projected.message).toBe(guidance.userMessage);
  expect(projected.remediation.action).toBe(guidance.remediationAction);
  expect(projected.details).toMatchObject({
    limit: {
      setting: "jadx.operation_timeout_ms",
      effective_value: 1500,
      unit: "ms",
      minimum: 1,
      maximum: 2_147_483_647,
      applies_at: "next_operation",
      agent_editable: true,
      scope: "rea-runtime",
      rea_restart_required: false,
    },
  });
  expect(projected).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: 1500 },
  });
});
