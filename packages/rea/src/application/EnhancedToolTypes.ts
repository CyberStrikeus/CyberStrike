import type { z } from "zod";

import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { ContainingProcedureResolution } from "../domain/native/nativeObservation.js";
import { err, type Result } from "../domain/result.js";
import {
  enhancedInputSchemas,
  type EnhancedToolName,
} from "../contracts/enhancedInputs.js";

export type EnhancedResult = Promise<Result<JsonValue, AnalysisError>>;
export type TraceReference = {
  readonly target_address: string;
  readonly source_address: string;
  readonly containing_procedure: ContainingProcedureResolution;
};

/** One enhanced call whose input was parsed at its owning adapter boundary. */
export type ValidatedEnhancedCall = {
  [Name in EnhancedToolName]: {
    readonly name: Name;
    readonly input: z.output<(typeof enhancedInputSchemas)[Name]>;
  };
}[EnhancedToolName];

export const invalidEnhancedInput = (
  name: EnhancedToolName,
  cause: z.ZodError,
  input: unknown,
): EnhancedResult =>
  Promise.resolve(
    err(analysisInputErrorFromIssues(name, cause.issues, input, { cause })),
  );
