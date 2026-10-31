import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { APK_SIGNATURE_LIMITS } from "./ApkSignatureRelease.js";

const OPERATION = "inspect_apk_signature";
type Release = () => void;

/** One whole-file scan at a time, shared by every provider in this process. */
class ApkSignatureAdmission {
  #active = false;
  readonly #waiting: (() => void)[] = [];

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted)
      return Promise.reject(
        new AnalysisCancelledError(OPERATION, { cause: signal.reason }),
      );
    if (!this.#active) {
      this.#active = true;
      return Promise.resolve(this.#release());
    }
    if (this.#waiting.length >= APK_SIGNATURE_LIMITS.waitingScans)
      return Promise.reject(
        new AnalysisResourceConstraintError(
          OPERATION,
          "capacity",
          "The process-wide APK inspection queue is full; retry after an active scan finishes.",
          {
            max_active_scans: 1,
            max_waiting_scans: APK_SIGNATURE_LIMITS.waitingScans,
          },
        ),
      );
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.#release());
      };
      const onAbort = () => {
        const index = this.#waiting.indexOf(grant);
        if (index !== -1) this.#waiting.splice(index, 1);
        reject(
          new AnalysisCancelledError(OPERATION, { cause: signal?.reason }),
        );
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push(grant);
    });
  }

  #release(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const grant = this.#waiting.shift();
      if (grant === undefined) this.#active = false;
      else grant();
    };
  }
}

export const apkSignatureAdmission = new ApkSignatureAdmission();
