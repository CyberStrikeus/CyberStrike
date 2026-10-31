import { z } from "zod";
import type { ExecutionOptions } from "./AnalysisProvider.js";
import type { WebRuntimePort } from "./WebRuntimePort.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import { err, type Result } from "../domain/result.js";
import {
  observeWebExecutionInputSchema,
  webExecutionSchema,
  webExecutionObservationSchema,
} from "../domain/webExecution.js";
import {
  inspectWebEventListenersInputSchema,
  webEventListenersSchema,
  webEventListenersObservationSchema,
} from "../domain/webEventListeners.js";
import {
  completeProviderEvidence,
  keepIncompleteObservation,
} from "./ProviderOperationExecution.js";
import { parseAnalysisInput } from "./AnalysisInput.js";

/** Shared public workflows keep instrumentation and listener inspection independently selectable. */
export class WebRuntimeService {
  constructor(readonly provider: WebRuntimePort) {}

  /** Observe externally triggered execution; selection authorizes the declared instrumentation. */
  async observe(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = "observe_web_execution";
    const parsed = parseAnalysisInput(
      operation,
      rawInput,
      observeWebExecutionInputSchema,
      options?.signal,
    );
    if (!parsed.ok) return parsed;
    const result = await this.provider.observeExecution(parsed.value, options);
    if (!result.ok)
      return this.retainRuntimePartial(
        result.error,
        operation,
        "Provider retained a non-JSON incomplete execution observation.",
        (partial) => {
          if (!("instrumentation" in partial) || !("window" in partial))
            return undefined;
          const verified = webExecutionObservationSchema.safeParse(partial);
          if (!verified.success) return undefined;
          return this.evidence(operation, parsed.value, verified.data);
        },
      );
    const verified = webExecutionSchema.safeParse(result.value);
    if (!verified.success)
      return err(new AnalysisOutputError(operation, verified.error.message));
    return this.evidence(operation, parsed.value, verified.data, options);
  }

  /** Inspect one selected node's listener declarations without dispatching an event. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = "inspect_web_event_listeners";
    const parsed = parseAnalysisInput(
      operation,
      rawInput,
      inspectWebEventListenersInputSchema,
      options?.signal,
    );
    if (!parsed.ok) return parsed;
    const result = await this.provider.inspectEventListeners(
      parsed.value,
      options,
    );
    if (!result.ok)
      return this.retainRuntimePartial(
        result.error,
        operation,
        "Provider retained a non-JSON incomplete event-listener observation.",
        (partial) => {
          if (!("selected_node" in partial) || !("listeners" in partial))
            return undefined;
          const verified =
            webEventListenersObservationSchema.safeParse(partial);
          if (!verified.success) return undefined;
          return this.evidence(operation, parsed.value, verified.data);
        },
      );
    const verified = webEventListenersSchema.safeParse(result.value);
    if (!verified.success)
      return err(new AnalysisOutputError(operation, verified.error.message));
    return this.evidence(operation, parsed.value, verified.data, options);
  }

  /** Promote a schema-valid partial, or keep a JSON snapshot of an incomplete one. */
  private retainRuntimePartial(
    error: AnalysisError,
    operation: string,
    nonJsonReason: string,
    promote: (
      partial: NonNullable<AnalysisError["partialObservation"]>,
    ) => Result<Evidence, AnalysisError> | undefined,
  ): Result<Evidence, AnalysisError> {
    const partial = error.partialObservation;
    if (partial !== undefined && !("evidence_id" in partial)) {
      const evidence = promote(partial);
      if (evidence !== undefined) {
        if (evidence.ok) {
          error.partialObservation = evidence.value;
          return err(error);
        }
      }
    }
    return err(keepIncompleteObservation(error, operation, nonJsonReason));
  }

  private evidence(
    operation: string,
    input:
      | z.infer<typeof observeWebExecutionInputSchema>
      | z.infer<typeof inspectWebEventListenersInputSchema>,
    result:
      | z.infer<typeof webExecutionObservationSchema>
      | z.infer<typeof webEventListenersObservationSchema>,
    options?: ExecutionOptions,
  ): Result<Evidence, AnalysisError> {
    if (
      result.target.target_id !== input.target_id ||
      ("observation_ms" in input &&
        (!("window" in result) ||
          result.window.requested_ms !== input.observation_ms)) ||
      ("selector" in input &&
        (!("selected_node" in result) ||
          result.selected_node.selector !== input.selector))
    )
      return err(
        new AnalysisOutputError(
          operation,
          "observation_ms" in input
            ? "Provider changed the selected target or requested window."
            : "Provider changed the selected target or node selector.",
        ),
      );
    if (
      input.allowed_origins.length > 0 &&
      !input.allowed_origins.includes(result.target.origin)
    )
      return err(
        new AnalysisOutputError(
          operation,
          "Provider returned a document outside the selected origin scope.",
        ),
      );
    return completeProviderEvidence(
      createEvidence(undefined, this.provider.identity(), {
        predicateType: `rea.${operation.replaceAll("_", "-")}`,
        operation,
        parameters: input,
        result,
        confidence: "observed",
        authority: "external-service",
        limitations: result.limitations,
      }),
      options?.signal,
    );
  }
}
