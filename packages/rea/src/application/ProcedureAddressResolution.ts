import type { AnalysisOperation } from "./AnalysisProvider.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";

type AnalysisCall = (
  operation: AnalysisOperation,
  parameters: Readonly<Record<string, JsonValue>>,
  signal?: AbortSignal,
) => Promise<Result<JsonValue, AnalysisError>>;

/** Resolve a caller selector to an observed provider procedure identity. */
export const resolveProcedureAddress = async (
  call: AnalysisCall,
  procedure: string,
  signal?: AbortSignal,
): Promise<Result<string, AnalysisError>> => {
  const result = await call("procedure_address", { procedure }, signal);
  if (!result.ok) return result;
  return parseProcedureAddress(result.value);
};

/** Validate the provider-owned canonical identity without changing its source value. */
export const parseProcedureAddress = (
  value: JsonValue,
): Result<string, AnalysisError> =>
  typeof value === "string" && value.length > 0
    ? ok(value)
    : err(
        new AnalysisOutputError(
          "procedure_address",
          "provider returned no canonical procedure address",
        ),
      );
