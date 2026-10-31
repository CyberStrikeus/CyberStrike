import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { expect, it } from "vitest";
import { apkSignatureAdmission } from "./ApkSignatureAdmission.js";
import { APK_SIGNATURE_LIMITS } from "./ApkSignatureRelease.js";

it("bounds process-wide scans and waiting requests, cancels queued work and recovers capacity", async () => {
  const active = await apkSignatureAdmission.acquire();
  const controller = new AbortController();
  const reason = new Error("cancel queued scan");
  let granted = false;
  const first = apkSignatureAdmission.acquire().then((release) => {
    granted = true;
    return release;
  });
  const cancelled = apkSignatureAdmission.acquire(controller.signal);
  const rejection = expect(cancelled).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
  });
  const waiting = Array.from(
    { length: APK_SIGNATURE_LIMITS.waitingScans - 2 },
    () => apkSignatureAdmission.acquire(),
  );
  try {
    const refused = await apkSignatureAdmission
      .acquire()
      .catch((cause: unknown) => {
        if (!(cause instanceof AnalysisResourceConstraintError)) throw cause;
        return projectAnalysisError(cause);
      });
    expect(refused).toMatchObject({
      code: "resource_constraint",
      retryable: true,
      remediation: {
        action:
          "Wait for an active analysis to complete, then retry within the reported admission limits.",
      },
    });
    expect(granted).toBe(false);
    controller.abort(reason);
    await rejection;
    const replacement = apkSignatureAdmission.acquire();
    active();
    active();
    const releaseFirst = await first;
    releaseFirst();
    for (const queued of waiting) (await queued)();
    (await replacement)();
    (await apkSignatureAdmission.acquire())();
  } finally {
    active();
  }
});
