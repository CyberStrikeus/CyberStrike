import type { AnalysisOperationPort } from "../application/AnalysisProvider.js";
import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";

/** Run a provider-backed tool while its target binding stays admitted. */
export type WithAdmittedAnalysis = <Value>(
  operationName: string,
  signal: AbortSignal | undefined,
  operation: (analysis: AnalysisOperationPort) => Promise<Value>,
) => Promise<Result<Value, AnalysisError>>;

/** Select exactly one owner for a server's analysis operation binding. */
export type ServerAnalysisSource =
  | { readonly kind: "session"; readonly session: BinarySessionPort }
  | { readonly kind: "fixed"; readonly analysis: AnalysisOperationPort };

/** Run against the source's explicit owner, admitting session-scoped work. */
export const withAdmittedAnalysis = (
  source: ServerAnalysisSource,
): WithAdmittedAnalysis =>
  source.kind === "session"
    ? (operationName, signal, operation) =>
        source.session.withAdmittedAnalysis(operationName, signal, operation)
    : async (operationName, signal, operation) =>
        signal?.aborted === true
          ? err(
              new AnalysisCancelledError(operationName, {
                cause: signal.reason,
              }),
            )
          : ok(await operation(source.analysis));
