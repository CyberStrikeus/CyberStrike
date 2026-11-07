import { z } from "zod";
import type {
  AnalysisError,
  AnalysisErrorOptions,
  AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { Evidence } from "../domain/evidence.js";
import {
  freezeJsonSnapshot,
  isImmutableJsonSnapshot,
} from "../domain/immutableJson.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { analysisOperationInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import type {
  AnalysisExecution,
  ExecutionOptions,
} from "./AnalysisProvider.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";

/** Validated caller-selected request carrying its operation input. */
export interface ProviderOperationRequest {
  readonly input: unknown;
}

/** Provider boundary executing one validated caller-selected request. */
export interface ProviderOperationPort<
  TRequest extends ProviderOperationRequest,
> {
  execute(
    request: TRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}

/**
 * Shared CLI/MCP admission, execution, and Evidence composition for
 * single-request providers. The caller retains its operation vocabulary and
 * confidence; this normalizes cancellation, input validation, and Evidence
 * assembly once instead of per provider.
 */
export const executeProviderOperation = async <
  TRequest extends ProviderOperationRequest,
>(
  operation: string,
  input: unknown,
  options: ExecutionOptions | undefined,
  schema: z.ZodType<TRequest>,
  provider: ProviderOperationPort<TRequest>,
  confidence: "observed" | "derived",
): Promise<Result<Evidence, AnalysisError>> => {
  if (options?.signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, { cause: options.signal.reason }),
    );
  const request = schema.safeParse({ operation, input });
  if (!request.success)
    return err(
      analysisOperationInputErrorFromIssues(
        operation,
        request.error.issues,
        input,
        request.error,
      ),
    );
  const executed = await provider.execute(request.data, options);
  if (!executed.ok) return executed;
  const evidence = createAnalysisExecutionEvidence(
    operation,
    request.data.input,
    executed.value,
    confidence,
  );
  return completeProviderEvidence(evidence, options?.signal);
};

/** Classify completion after Evidence assembly, preserving facts on late abort. */
export const completeProviderEvidence = (
  evidence: Evidence,
  signal?: AbortSignal,
  capturedOutput?: AnalysisErrorOptions["capturedOutput"],
): Result<Evidence, AnalysisCancelledError> => {
  if (signal?.aborted)
    return err(
      new AnalysisCancelledError(evidence.operation, {
        cause: signal.reason,
        partialObservation: evidence,
        ...(capturedOutput === undefined ? {} : { capturedOutput }),
      }),
    );
  return ok(evidence);
};

/**
 * Retain an incomplete observation when projection can serialize it.
 * A JSON partial is replaced by one frozen snapshot, so a later mutation
 * cannot make projection throw and projection does not copy it again.
 * A partial that is not JSON is cleared from the returned error and from
 * every cleanup primary projection can select later. Each cleared error
 * records an output failure, leaving cancellation or timeout primary.
 */
export const keepIncompleteObservation = (
  error: AnalysisError,
  operation: string,
  reason: string,
): AnalysisError => {
  const seen = new Set<AnalysisError>();
  // One source object can sit on a wrapper and its cleanup primary.
  const judged = new Map<object, AnalysisPartialObservation | undefined>();
  let current: AnalysisError | undefined = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const partial = current.partialObservation;
    if (
      partial !== undefined &&
      !isImmutableJsonSnapshot(partial) &&
      typeof partial === "object"
    ) {
      // safeParse clones only after validation succeeds. Freeze that copy once.
      let snapshot = judged.get(partial);
      if (!judged.has(partial)) {
        const parsed = jsonValueSchema.safeParse(partial);
        snapshot = parsed.success
          ? (freezeJsonSnapshot(parsed.data) as AnalysisPartialObservation)
          : undefined;
        judged.set(partial, snapshot);
      }
      if (snapshot === undefined) {
        current.partialObservation = undefined;
        current.retainSecondaryFailure(
          new AnalysisOutputError(operation, reason),
        );
      } else current.partialObservation = snapshot;
    }
    current = current.cleanupPrimary;
  }
  return error;
};
