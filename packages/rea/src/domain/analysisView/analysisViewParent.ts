import type { z } from "zod";
import type { AnalysisInputError } from "../analysisErrorCore.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type { Evidence } from "../evidence.js";
import { analysisInputErrorFromIssues } from "../inputIssueProjection.js";
import { err, ok, type Result } from "../result.js";
import { ownedJsonValueSchema } from "../jsonValue.js";

/** Parent record already resolved from inline Evidence or a session reference. */
export interface AnalysisViewParent {
  readonly evidenceId: string;
  readonly operation: string;
  readonly normalizedResult: unknown;
  readonly provider?: Evidence["provider"];
  readonly analysisProfile?: Evidence["analysis_profile"];
  readonly authority?: Evidence["authority"];
  readonly environment?: Evidence["environment"];
  /** The owner proved normalizedResult belongs to a sealed, deep-frozen Evidence snapshot. */
  readonly sealedResult?: boolean;
  /** Subject presentation for this delivery, including explicit absence. */
  readonly subject?: Evidence["subject"];
  readonly limitations: readonly string[];
  readonly artifact?: { readonly path: string; readonly sha256: string } | null;
  /** Parent Evidence parameters, when the parent operation records them. */
  readonly parameters?: unknown;
}
import {
  canBorrowParsedJsonSnapshot,
  freezeOwnedJsonTreeSnapshot,
  isImmutableJsonSnapshot,
} from "../immutableJson.js";

/** One owning schema reuses validated immutable facts for their retained lifetime. */
export const createAnalysisViewResultReader = <Value>(parser: {
  readonly safeParse: (input: unknown) => z.ZodSafeParseResult<Value>;
}): ((parent: AnalysisViewParent) => Result<Value, AnalysisError>) => {
  const checked = new WeakMap<object, Value>();
  return (parent) => {
    const source = parent.normalizedResult;
    const reusable =
      parent.sealedResult === true &&
      typeof source === "object" &&
      source !== null &&
      isImmutableJsonSnapshot(source);
    const known = reusable ? checked.get(source) : undefined;
    if (known !== undefined) return ok(known);
    const parsed = parseAnalysisViewResult(parser, parent);
    if (!parsed.ok || !reusable) return parsed;
    if (canBorrowParsedJsonSnapshot(source, parsed.value)) {
      checked.set(source, source);
      return ok(source);
    }
    const normalized = ownedJsonValueSchema.safeParse(parsed.value);
    if (!normalized.success) return parsed;
    freezeOwnedJsonTreeSnapshot(normalized.data);
    checked.set(source, parsed.value);
    return parsed;
  };
};

/** Parse a parent's result with its owning parser; issues point into the view source. */
export const parseAnalysisViewResult = <Value>(
  parser: {
    readonly safeParse: (input: unknown) => z.ZodSafeParseResult<Value>;
  },
  parent: AnalysisViewParent,
): Result<Value, AnalysisError> => {
  const parsed = parser.safeParse(parent.normalizedResult);
  if (parsed.success) return ok(parsed.data);
  return err(
    analysisViewResultInputError(parent.normalizedResult, parsed.error),
  );
};

/** Locate schema failures inside the retained result, including throwing parsers. */
export const analysisViewResultInputError = (
  input: unknown,
  cause: z.ZodError,
): AnalysisInputError =>
  analysisInputErrorFromIssues(
    "inspect_analysis_view",
    cause.issues.map((issue) => ({
      ...issue,
      path: ["source", "normalized_result", ...issue.path],
    })),
    { source: { normalized_result: input } },
    { cause },
  );
