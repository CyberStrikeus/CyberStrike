import { evidenceInputSchema } from "../../domain/evidenceReference.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";

/** Attribute malformed caller values after admission; authenticated facts keep integrity semantics. */
export const nativeMatchingInputError = (
  input: unknown,
  path: readonly (string | number)[],
  operation: string,
  failure: EvidenceIntegrityError,
): AnalysisInputError | EvidenceIntegrityError => {
  const shape = evidenceInputSchema.safeParse(input);
  if (shape.success) return failure;
  return new AnalysisInputError(
    operation,
    { cause: failure },
    projectInputIssues(shape.error.issues, input).map((issue) => ({
      ...issue,
      path: [...path, ...issue.path],
    })),
  );
};
