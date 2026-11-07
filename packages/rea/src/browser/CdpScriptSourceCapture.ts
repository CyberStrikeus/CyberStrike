import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import type { CdpConnection } from "./CdpConnection.js";
import type { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import {
  requiredScriptSource,
  sourceExcluded,
  sourceResult,
} from "./CdpCaptureValues.js";
import {
  CDP_SCRIPT_SOURCE_BYTES_OMISSION_REASON,
  cdpScriptSourceDeadlineOmissionReason,
  type CdpScriptSourceBudget,
} from "./CdpScriptSourceBudget.js";

/** One owner for passive page/Electron source admission and artifact creation. */
export const capturePassiveCdpScriptSource = async (input: {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly operation: BrowserObservationOperation;
  readonly scriptId: string;
  readonly sourceBudget: CdpScriptSourceBudget;
  readonly completeness: CdpCaptureCompleteness;
}): Promise<
  ReturnType<typeof sourceResult> | ReturnType<typeof sourceExcluded>
> => {
  const omitForBudget = () => {
    input.completeness.exclude("script_sources", "resource_budget_exhausted");
    return sourceExcluded(
      input.sourceBudget.timedOut
        ? cdpScriptSourceDeadlineOmissionReason(
            input.sourceBudget.commandTimeoutMs,
          )
        : CDP_SCRIPT_SOURCE_BYTES_OMISSION_REASON,
    );
  };
  const throwIfCancelled = () => {
    if (input.signal?.aborted === true)
      throw new AnalysisCancelledError(input.operation, {
        cause: input.signal.reason,
      });
  };
  throwIfCancelled();
  if (input.sourceBudget.timedOut) return omitForBudget();
  try {
    const response = await input.connection.send(
      "Debugger.getScriptSource",
      { scriptId: input.scriptId },
      input.sessionId,
      input.sourceBudget.signal,
    );
    throwIfCancelled();
    const text = requiredScriptSource(response, input.operation);
    if (input.sourceBudget.timedOut || !input.sourceBudget.admit(text))
      return omitForBudget();
    return sourceResult(text);
  } catch (cause: unknown) {
    throwIfCancelled();
    if (input.sourceBudget.timedOut) return omitForBudget();
    throw cause;
  }
};
