import type {
  EvidenceInput,
  EvidenceSourceInput,
} from "../domain/evidenceReference.js";
import type { Evidence } from "../domain/evidence.js";
import type { z } from "zod";
import {
  getEvidenceInputContract,
  type EvidenceInputPath,
  type EvidenceRequestFrameInput,
  type ResolvedEvidenceRequestInput,
} from "../domain/evidenceInputContract.js";
import { retainedEvidenceReferenceSchema } from "../domain/evidenceReference.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { EvidenceReferenceError } from "../domain/evidenceErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { parseAnalysisInput } from "./AnalysisInput.js";
import {
  readEvidenceFileSource,
  type EvidenceFileReadOptions,
} from "./analysisView/evidenceFileSource.js";

/** Read-only lookup supplied by the current investigation's Evidence ledger. */
export type EvidenceLookup = (evidenceId: string) => Evidence | undefined;

export interface EvidenceRequestResolutionOptions {
  readonly signal?: AbortSignal;
  readonly referenceScope?: "retained-closure";
  /** Optional format-owner admission, after lookup and before source use. */
  readonly readEvidence?: (
    input: unknown,
    path: EvidenceInputPath,
  ) => Result<Evidence, AnalysisError>;
}

interface EvidenceRequestResolution<Input> {
  readonly input: Input;
  readonly sources: readonly unknown[];
}

/** An admitting owner may rely on complete Evidence at each declared source. */
export function resolveEvidenceRequest<Schema extends z.ZodType>(
  operation: string,
  rawInput: unknown,
  schema: Schema,
  lookup: EvidenceLookup | undefined,
  options: EvidenceRequestResolutionOptions & {
    readonly readEvidence: NonNullable<
      EvidenceRequestResolutionOptions["readEvidence"]
    >;
  },
): Result<
  EvidenceRequestResolution<ResolvedEvidenceRequestInput<z.output<Schema>>>,
  AnalysisError
>;
/** Source carriers remain unknown until their format owner admits them. */
export function resolveEvidenceRequest<Schema extends z.ZodType>(
  operation: string,
  rawInput: unknown,
  schema: Schema,
  lookup?: EvidenceLookup,
  options?: EvidenceRequestResolutionOptions,
): Result<
  EvidenceRequestResolution<EvidenceRequestFrameInput<z.output<Schema>>>,
  AnalysisError
>;
/** Resolve only schema-declared Evidence fields, sharing one lookup per exact ID. */
export function resolveEvidenceRequest(
  operation: string,
  rawInput: unknown,
  schema: z.ZodType,
  lookup?: EvidenceLookup,
  options: EvidenceRequestResolutionOptions = {},
): Result<EvidenceRequestResolution<unknown>, AnalysisError> {
  const contract = getEvidenceInputContract(schema);
  const parsed = parseAnalysisInput(
    operation,
    rawInput,
    contract.frameSchema,
    options.signal,
  );
  if (!parsed.ok) return parsed;
  const records = new Map<string, Evidence | undefined>();
  const read: EvidenceLookup = (id) => {
    if (!records.has(id)) records.set(id, lookup?.(id));
    return records.get(id);
  };
  const sources = new Set<unknown>();
  const result = contract.resolve<AnalysisError>(
    parsed.value,
    (input, path) => {
      if (options.signal?.aborted)
        return err(
          new AnalysisCancelledError(operation, {
            cause: options.signal.reason,
          }),
        );
      let selected = input;
      if (typeof input === "object" && input !== null && "kind" in input) {
        const reference = retainedEvidenceReferenceSchema.safeParse(input);
        if (!reference.success)
          return err(
            analysisInputErrorFromIssues(
              operation,
              reference.error.issues.map((issue) => ({
                ...issue,
                path: [...path, ...issue.path],
              })),
              rawInput,
              { cause: reference.error },
            ),
          );
        const found = resolveEvidenceInput(
          reference.data,
          read,
          options.referenceScope,
        );
        if (!found.ok)
          return err(
            new EvidenceReferenceError(
              found.error.evidenceId,
              found.error.reason,
              {
                cause: found.error,
                expected: found.error.expected,
                actual: found.error.actual,
                referenceScope: found.error.referenceScope,
                diagnostics: { input_path: [...path] },
              },
            ),
          );
        selected = found.value;
      }
      if (options.readEvidence !== undefined) {
        const admitted = options.readEvidence(selected, path);
        if (!admitted.ok) {
          if (admitted.error.diagnostics?.input_path === undefined)
            admitted.error.retainDiagnostics({ input_path: [...path] });
          return admitted;
        }
        selected = admitted.value;
      }
      sources.add(selected);
      return ok(selected);
    },
  );
  if (result.ok && options.signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, { cause: options.signal.reason }),
    );
  return result.ok
    ? ok({
        input: result.value,
        sources: [...sources],
      })
    : result;
}

/** Normalize each selected record using its file context and the current ledger. */
export interface EvidenceSourceResolutionOptions extends EvidenceFileReadOptions {
  readonly operation: string;
  readonly resolveEvidence?: (
    evidence: Evidence,
    lookup: EvidenceLookup | undefined,
    side: "left" | "right",
  ) => Result<Evidence, AnalysisError>;
}

/** Resolve an exact reference; callers declare when recovery requires retained closure. */
export const resolveEvidenceInput = (
  input: EvidenceInput,
  lookup: EvidenceLookup | undefined,
  referenceScope?: EvidenceReferenceError["referenceScope"],
): Result<Evidence, EvidenceReferenceError> => {
  if (!("kind" in input)) return ok(input);
  const record = lookup?.(input.evidence_id);
  if (record === undefined)
    return err(
      new EvidenceReferenceError(input.evidence_id, "missing", {
        expected: "Evidence available to the selected source",
        actual: null,
        referenceScope,
      }),
    );
  if (record.evidence_id !== input.evidence_id)
    return err(
      new EvidenceReferenceError(input.evidence_id, "identity_mismatch", {
        expected: input.evidence_id,
        actual: record.evidence_id,
      }),
    );
  return ok(record);
};

/** Resolve explicit paired sources; Evidence files use the shared file reader. */
export const resolvePairedEvidenceSources = async <
  T extends {
    readonly left: EvidenceSourceInput;
    readonly right: EvidenceSourceInput;
  },
>(
  input: T,
  lookup: EvidenceLookup | undefined,
  options: EvidenceSourceResolutionOptions,
): Promise<
  Result<
    Omit<T, "left" | "right"> & {
      readonly left: Evidence;
      readonly right: Evidence;
    },
    AnalysisError
  >
> => {
  const left = await resolveEvidenceSource(input.left, "left", lookup, options);
  if (!left.ok) return left;
  const right = await resolveEvidenceSource(
    input.right,
    "right",
    lookup,
    options,
  );
  if (!right.ok) return right;
  return ok({ ...input, left: left.value, right: right.value });
};

const resolveEvidenceSource = async (
  input: EvidenceSourceInput,
  side: "left" | "right",
  lookup: EvidenceLookup | undefined,
  options: EvidenceSourceResolutionOptions,
): Promise<Result<Evidence, AnalysisError>> => {
  if ("kind" in input && input.kind === "evidence-file")
    return readEvidenceFileSource(input.path, options, input.evidence_id, {
      operation: options.operation,
      path: [side],
      resolveSelected: (selected, fileLookup) =>
        options.resolveEvidence?.(
          selected,
          (id) => fileLookup(id) ?? lookup?.(id),
          side,
        ) ?? ok(selected),
    });
  const selected = resolveEvidenceInput(input, lookup);
  return selected.ok
    ? (options.resolveEvidence?.(selected.value, lookup, side) ?? selected)
    : selected;
};
