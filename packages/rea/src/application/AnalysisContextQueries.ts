import type {
  AnalysisExecution,
  AnalysisOperation,
  AnalysisOperationPort,
} from "./AnalysisProvider.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { analysisBookmarkSchema } from "../domain/native/nativeInventory.js";
import { parseContainingProcedureResolution } from "../domain/native/nativeObservation.js";
import { nativeAddressCoordinateInputSchema } from "../domain/native/nativeAddress.js";
import { resolveAnalysisDocument } from "./AnalysisDocument.js";
import { err, ok, type Result } from "../domain/result.js";

type Facet =
  | { readonly state: "available"; readonly value: JsonValue }
  | {
      readonly state: "unavailable";
      readonly reason: string;
      readonly remediation: string;
    };

const parameters = (
  document: string | undefined,
  address?: string,
): Readonly<Record<string, JsonValue>> => ({
  ...(document === undefined ? {} : { document }),
  ...(address === undefined ? {} : { address }),
});

const executionOptions = (
  signal: AbortSignal | undefined,
): { readonly signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

/** Compose the provider's volatile selection state into one coherent query. */
export const getNavigationContext = async (
  analysis: AnalysisOperationPort,
  input: { readonly document?: string | undefined },
  signal?: AbortSignal,
): Promise<Result<JsonValue, AnalysisError>> => {
  const document =
    input.document ??
    (await analysis.execute("current_document", {}, executionOptions(signal)));
  if (typeof document !== "string" && !document.ok) return document;
  const documentName =
    typeof document === "string" ? document : document.value.result;
  if (typeof documentName !== "string")
    return err(
      new AnalysisOutputError(
        "current_document",
        "expected a document identity string",
      ),
    );
  const documentArgs = parameters(documentName);
  const address = await analysis.execute(
    "current_address",
    documentArgs,
    executionOptions(signal),
  );
  if (!address.ok) return address;
  if (typeof address.value.result !== "string")
    return err(
      new AnalysisOutputError("current_address", "expected an address string"),
    );
  const procedure = await analysis.execute(
    "resolve_containing_procedure",
    parameters(documentName, address.value.result),
    executionOptions(signal),
  );
  if (!procedure.ok) return procedure;
  const resolution = parseContainingProcedureResolution(procedure.value.result);
  if (!resolution.ok) return resolution;
  return ok({
    document: documentName,
    address: address.value.result,
    procedure: resolution.value.found ? resolution.value.procedure.name : null,
  });
};

/** Inspect bounded provider-neutral facets at one explicit reproducible address. */
export const inspectAddressContext = async (
  analysis: AnalysisOperationPort,
  input: { readonly address: string; readonly document?: string | undefined },
  signal?: AbortSignal,
): Promise<Result<JsonValue, AnalysisError>> => {
  const document = await resolveAnalysisDocument(
    analysis,
    input.document,
    signal,
  );
  if (!document.ok) return document;
  const args = parameters(document.value, input.address);
  const operations = [
    "address_name",
    "resolve_containing_procedure",
    "comment",
    "inline_comment",
    "list_bookmarks",
  ] as const satisfies readonly AnalysisOperation[];
  const results = await Promise.all(
    operations.map((operation) =>
      analysis.execute(
        operation,
        operation === "list_bookmarks" ? parameters(document.value) : args,
        executionOptions(signal),
      ),
    ),
  );
  for (const result of results) {
    if (!result.ok && isRequestLevelFailure(result.error)) return result;
  }
  const name = facet(results[0], operations[0]);
  const procedureResult = results[1];
  const resolution = procedureResult?.ok
    ? parseContainingProcedureResolution(procedureResult.value.result)
    : procedureResult;
  const procedure: Facet = resolution?.ok
    ? { state: "available", value: resolution.value }
    : unavailableFacet(resolution?.error, operations[1]);
  const comment = facet(results[2], operations[2]);
  const inlineComment = facet(results[3], operations[3]);
  const bookmarks = facet(results[4], operations[4]);
  return ok({
    address: input.address,
    document: document.value,
    name,
    procedure,
    comment,
    inline_comment: inlineComment,
    bookmarks:
      bookmarks.state === "available"
        ? matchingBookmarks(
            bookmarks.value,
            resolution?.ok ? resolution.value.query_address : input.address,
          )
        : bookmarks,
  });
};

const facet = (
  result: Result<AnalysisExecution, AnalysisError> | undefined,
  operation: AnalysisOperation,
): Facet =>
  result?.ok === true
    ? { state: "available", value: result.value.result }
    : unavailableFacet(result?.error, operation);

const unavailableFacet = (
  error: AnalysisError | undefined,
  operation: AnalysisOperation,
): Facet => ({
  state: "unavailable",
  reason: error?.message ?? `${operation} returned no result`,
  remediation: `Call ${operation} directly to inspect provider availability and diagnostics.`,
});

const isRequestLevelFailure = (error: AnalysisError): boolean =>
  error._tag === "AnalysisCancelledError" ||
  error._tag === "AnalysisTimeoutError" ||
  error._tag === "NoBinaryOpenError";

const matchingBookmarks = (value: JsonValue, address: string): Facet => {
  if (!Array.isArray(value))
    return {
      state: "unavailable",
      reason: "list_bookmarks returned malformed output; expected an array.",
      remediation:
        "Retry list_bookmarks directly and report the provider output shape if it remains malformed.",
    };
  const parsed = analysisBookmarkSchema.array().safeParse(value);
  if (!parsed.success)
    return {
      state: "unavailable",
      reason:
        "list_bookmarks returned malformed entries; expected an address string and a string or null name.",
      remediation:
        "Retry list_bookmarks directly and report the provider output shape if it remains malformed.",
    };
  const target = nativeAddressCoordinateInputSchema.safeParse(address);
  const matching = [];
  for (const bookmark of parsed.data) {
    if (bookmark.address === address) {
      matching.push(bookmark);
      continue;
    }
    const candidate = nativeAddressCoordinateInputSchema.safeParse(
      bookmark.address,
    );
    if (
      !target.success ||
      !candidate.success ||
      (target.data.offset === candidate.data.offset &&
        target.data.space !== candidate.data.space)
    )
      return {
        state: "unavailable",
        reason:
          "Bookmark address identity could not be compared with the selected address.",
        remediation:
          "Call list_bookmarks directly to inspect the provider addresses.",
      };
    if (
      target.data.offset === candidate.data.offset &&
      target.data.space === candidate.data.space
    )
      matching.push(bookmark);
  }
  return { state: "available", value: matching };
};
