import {
  parseEvidence,
  withEvidenceCallerInputPath,
  type Evidence,
} from "../domain/evidence.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";
import { ZodError } from "zod";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** Bind the CLI selection before final cleanup or publication can retain it. */
export const bindCliEvidenceCallerPath =
  (
    callerPath: string,
    run: () => Promise<Result<Evidence, AnalysisError>>,
  ): (() => Promise<Result<Evidence, AnalysisError>>) =>
  async () => {
    const result = await run();
    if (result.ok)
      return {
        ok: true,
        value: withEvidenceCallerInputPath(result.value, callerPath),
      };
    if (result.error.partialObservation !== undefined) {
      try {
        result.error.partialObservation = withEvidenceCallerInputPath(
          parseEvidence(result.error.partialObservation),
          callerPath,
        );
      } catch (cause) {
        // Raw or invalid partial observations must retain their original form.
        if (!(cause instanceof ZodError)) throw cause;
      }
    }
    return result;
  };

/** Finalize a one-shot file inspection with its original CLI selection. */
export const finishCliEvidenceCommand = (
  callerPath: string,
  run: () => Promise<Result<Evidence, AnalysisError>>,
  service: { close(): Promise<void> },
  providerId: string,
  operation: string,
  signal: AbortSignal,
) =>
  finishAnalysisCommand(
    bindCliEvidenceCallerPath(callerPath, run),
    service,
    providerId,
    operation,
    signal,
  );
