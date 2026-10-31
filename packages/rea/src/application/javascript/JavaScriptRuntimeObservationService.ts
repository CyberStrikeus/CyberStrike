import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { JavaScriptRuntimeObservationPort } from "./JavaScriptRuntimeObservationPort.js";
import { createJavaScriptRuntimeObservationEvidence } from "./JavaScriptRuntimeObservationEvidence.js";
import type { Evidence } from "../../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  ListJavaScriptRuntimeTargetsInput,
  ObserveJavaScriptRuntimeInput,
} from "../../domain/javascript/javascriptRuntimeObservation.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  completeProviderEvidence,
  keepIncompleteObservation,
} from "../ProviderOperationExecution.js";
import {
  javascriptRuntimeObservationSchema,
  javascriptRuntimeTargetListSchema,
} from "../../domain/javascript/javascriptRuntimeObservation.js";

/** List targets exposed by the explicitly selected loopback Inspector. */
export const listJavaScriptRuntimeTargets = async (
  provider: JavaScriptRuntimeObservationPort | undefined,
  input: ListJavaScriptRuntimeTargetsInput,
  options: ExecutionOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const ready = requireProvider(provider, "list_javascript_runtime_targets");
  if (!ready.ok) return ready;
  if (options.signal?.aborted)
    return err(
      new AnalysisCancelledError("list_javascript_runtime_targets", {
        cause: options.signal.reason,
      }),
    );
  const result = await ready.value.listTargets(input, options);
  if (!result.ok) return result;
  const report = javascriptRuntimeTargetListSchema.safeParse(result.value);
  if (!report.success)
    return err(
      new AnalysisOutputError(
        "list_javascript_runtime_targets",
        "Inspector returned a malformed target list.",
        { cause: report.error },
      ),
    );
  return runtimeEvidence(
    "list_javascript_runtime_targets",
    input,
    report.data,
    ready.value.identity(),
    options,
  );
};

/** Observe one attach-only Inspector target selected by the request. */
export const observeJavaScriptRuntime = async (
  provider: JavaScriptRuntimeObservationPort | undefined,
  input: ObserveJavaScriptRuntimeInput,
  options: ExecutionOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const ready = requireProvider(provider, "observe_javascript_runtime");
  if (!ready.ok) return ready;
  if (options.signal?.aborted)
    return err(
      new AnalysisCancelledError("observe_javascript_runtime", {
        cause: options.signal.reason,
      }),
    );
  const result = await ready.value.observe(input, options);
  if (!result.ok) {
    const partial = result.error.partialObservation;
    if (
      partial !== undefined &&
      !("evidence_id" in partial) &&
      !("kind" in partial)
    ) {
      const report = javascriptRuntimeObservationSchema.safeParse(partial);
      if (report.success) {
        result.error.partialObservation =
          createJavaScriptRuntimeObservationEvidence(
            "observe_javascript_runtime",
            input,
            report.data,
            ready.value.identity(),
          );
        return result;
      }
    }
    return err(
      keepIncompleteObservation(
        result.error,
        "observe_javascript_runtime",
        "Inspector retained a non-JSON incomplete observation.",
      ),
    );
  }
  const report = javascriptRuntimeObservationSchema.safeParse(result.value);
  if (!report.success)
    return err(
      new AnalysisOutputError(
        "observe_javascript_runtime",
        "Inspector returned a malformed runtime observation.",
        { cause: report.error },
      ),
    );
  return runtimeEvidence(
    "observe_javascript_runtime",
    input,
    report.data,
    ready.value.identity(),
    options,
  );
};

const requireProvider = (
  provider: JavaScriptRuntimeObservationPort | undefined,
  operation: "list_javascript_runtime_targets" | "observe_javascript_runtime",
): Result<JavaScriptRuntimeObservationPort, AnalysisError> =>
  provider === undefined
    ? err(
        new AnalysisCapabilityUnavailableError(
          "rea-v8-inspector",
          operation,
          "V8 Inspector observation provider is not configured",
        ),
      )
    : ok(provider);

const runtimeEvidence = (
  operation: Parameters<typeof createJavaScriptRuntimeObservationEvidence>[0],
  input: Parameters<typeof createJavaScriptRuntimeObservationEvidence>[1],
  result: Parameters<typeof createJavaScriptRuntimeObservationEvidence>[2],
  provider: Parameters<typeof createJavaScriptRuntimeObservationEvidence>[3],
  options: ExecutionOptions,
): Result<Evidence, AnalysisError> => {
  return completeProviderEvidence(
    createJavaScriptRuntimeObservationEvidence(
      operation,
      input,
      result,
      provider,
    ),
    options.signal,
  );
};
