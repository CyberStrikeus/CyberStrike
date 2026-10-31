import { permitsCapabilityFallback } from "./CapabilityFallback.js";
import type {
  AnalysisExecution,
  AnalysisOperationPort,
} from "./AnalysisProvider.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { parseDocuments } from "../domain/native/nativeDocument.js";
import { err, ok, type Result } from "../domain/result.js";

const executionOptions = (signal: AbortSignal | undefined) =>
  signal === undefined ? undefined : { signal };

/** Resolve an explicit or provider-selected document without guessing among candidates. */
export const resolveAnalysisDocument = async (
  analysis: AnalysisOperationPort,
  document: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Result<string, AnalysisError>> => {
  if (document !== undefined) return ok(document);
  if (signal?.aborted === true)
    return err(
      new AnalysisCancelledError("current_document", { cause: signal.reason }),
    );
  const current = await analysis.execute(
    "current_document",
    {},
    executionOptions(signal),
  );
  if (!current.ok) {
    if (!permitsCapabilityFallback(current.error)) return current;
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError("current_document", {
          cause: signal.reason,
        }),
      );
    const listed = await analysis.execute(
      "list_documents",
      {},
      executionOptions(signal),
    );
    if (!listed.ok) return listed;
    const parsed = parseDocuments(listed.value.result);
    if (!parsed.ok)
      return err(
        new AnalysisOutputError(
          "list_documents",
          "expected one document identity when resolving a headless provider",
          { cause: parsed.error },
        ),
      );
    if (parsed.value.length !== 1)
      return err(
        new AnalysisOutputError(
          "list_documents",
          `expected exactly one document identity for a provider without current-document selection, received ${parsed.value.length}`,
        ),
      );
    const [documentName] = parsed.value;
    if (documentName === undefined || documentName.length === 0)
      return err(
        new AnalysisOutputError(
          "list_documents",
          "provider returned no document identity",
        ),
      );
    return completeSelection(
      documentName,
      "list_documents",
      listed.value,
      signal,
    );
  }
  return typeof current.value.result === "string" &&
    current.value.result.length > 0
    ? completeSelection(
        current.value.result,
        "current_document",
        current.value,
        signal,
      )
    : err(
        new AnalysisOutputError(
          "current_document",
          "expected a nonempty document identity string",
        ),
      );
};

/** Preserve the completed provider observation after validating document identity. */
const completeSelection = (
  document: string,
  operation: "current_document" | "list_documents",
  execution: AnalysisExecution,
  signal: AbortSignal | undefined,
): Result<string, AnalysisError> => {
  if (signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, {
        cause: signal.reason,
        partialObservation: createAnalysisExecutionEvidence(
          operation,
          {},
          execution,
          "observed",
        ),
      }),
    );
  return ok(document);
};
