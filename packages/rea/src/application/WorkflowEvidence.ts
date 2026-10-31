import { AnalysisWorkScope } from "./AnalysisWorkScope.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";
import { REA_WORKFLOW_PROVIDER } from "../domain/investigationProviders.js";
import { workflowAnalysisProfile } from "./WorkflowAnalysisProfile.js";
import type {
  AnalysisOperation,
  AnalysisOperationPort,
} from "./AnalysisProvider.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { ok, type Result } from "../domain/result.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import type { WorkflowSnapshotRecordInput } from "./binary/BinarySessionRecords.js";
import {
  analysisProfileSchema,
  committedProviderSchema,
} from "../domain/analysisProfile.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  createEvidence,
  type Evidence,
  type EvidenceLocation,
} from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { UnknownRegistryPort } from "./investigation/InvestigationRecordPort.js";
import { UnknownRegistryError } from "../domain/unknownRegistryError.js";
import { EvidenceLedger } from "./investigation/EvidenceLedger.js";
import {
  recordEvidenceSources,
  withEvidenceSources,
  type AnalysisResultWithSources,
} from "./investigation/recordEvidenceSources.js";
import { workflowUnknownInput } from "./investigation/WorkflowUnknown.js";
import {
  renderSourceLimitations,
  sourceLimitationGroupKey,
  sourceLimitationKey,
  type SourceLimitation,
} from "./SourceLimitations.js";

/**
 * Bound for caveats a workflow observes once per item. Provider caveats can
 * name per-item addresses, so they do not deduplicate and would otherwise grow
 * with the number of items.
 */
export interface ComposedLimitationBudget {
  /** Operations the workflow calls once per item. */
  readonly perItemOperations: ReadonlySet<AnalysisOperation>;
  /**
   * First distinct per-item caveats retained, grouped by provider and text.
   * Kept lines are rendered in the usual sorted order.
   */
  readonly maxDistinct: number;
  /** Retained caveat text as JSON-encoded UTF-8 bytes; defaults to 8,000. */
  readonly maxBytes?: number;
  /** Where the omitted per-item caveats remain, as a clause. */
  readonly retainedIn: string;
}

const DECOMPILE_ALL_LIMITATIONS: ComposedLimitationBudget = {
  perItemOperations: new Set(["procedure_info", "procedure_pseudo_code"]),
  maxDistinct: 8,
  retainedIn:
    "each function's record in decompile-index.json keeps the caveats of the observations it used",
};

/** The caveat budget for a composed workflow, when it has one. */
export const composedLimitationBudget = (
  operation: string,
): ComposedLimitationBudget | undefined =>
  operation === "decompile_all" ? DECOMPILE_ALL_LIMITATIONS : undefined;

/** Retain the limits of exactly the observations used by one composed call. */
export const executeComposedWorkflow = async (
  analysis: AnalysisOperationPort,
  execute: (
    observed: AnalysisOperationPort,
  ) => Promise<Result<JsonValue, AnalysisError>>,
  budget?: ComposedLimitationBudget,
): Promise<
  AnalysisResultWithSources<{
    readonly result: JsonValue;
    readonly limitations: readonly string[];
    readonly cachePolicy?: "live";
    readonly evidenceLinks?: readonly string[];
  }>
> => {
  const limitations = new Map<string, SourceLimitation>();
  const evidenceLinks = new Set<string>();
  const sourceLedger = new EvidenceLedger();
  const perItemGroups = new Set<string>();
  let perItemBytes = 0;
  let omittedObservations = 0;
  let cachePolicy: "live" | undefined;
  const workScope = new AnalysisWorkScope();
  const observed: AnalysisOperationPort = {
    resourceScope: analysis.resourceScope,
    execute: async (operation, parameters, options) => {
      const execution = await analysis.execute(operation, parameters, {
        ...options,
        workScope,
      });
      if (execution.ok && execution.value.evidenceId !== undefined)
        evidenceLinks.add(execution.value.evidenceId);
      if (execution.ok && execution.value.sourceEvidence !== undefined) {
        const recorded = recordEvidenceSources(
          (source) => sourceLedger.record(source),
          execution.value.sourceEvidence,
        );
        if (!recorded.ok) return recorded;
      }
      if (execution.ok && execution.value.cachePolicy === "live")
        cachePolicy = "live";
      if (execution.ok)
        for (const limitation of execution.value.limitations) {
          const fact = {
            provider: execution.value.provider,
            operation,
            limitation,
          } satisfies SourceLimitation;
          if (budget?.perItemOperations.has(operation) === true) {
            // Reject oversized text before allocating a grouping key. Complete
            // caveats are already retained by the export's per-function owner.
            const maxBytes = budget.maxBytes ?? 8_000;
            const bytes = jsonStringByteLength(limitation, maxBytes);
            if (bytes > maxBytes) {
              omittedObservations += 1;
              continue;
            }
            const group = sourceLimitationGroupKey(fact);
            if (!perItemGroups.has(group)) {
              if (
                perItemGroups.size >= budget.maxDistinct ||
                perItemBytes + bytes > maxBytes
              ) {
                omittedObservations += 1;
                continue;
              }
              perItemGroups.add(group);
              perItemBytes += bytes;
            }
          }
          limitations.set(sourceLimitationKey(fact), fact);
        }
      return execution;
    },
  };
  const result = await Promise.resolve()
    .then(() => execute(observed))
    .finally(() => workScope.clear());
  const sources = sourceLedger.recordsForAnalysis();
  if (!result.ok) return withEvidenceSources(result, sources);
  for (const source of sources) evidenceLinks.add(source.evidence_id);
  return withEvidenceSources(
    ok({
      result: result.value,
      limitations: [
        ...renderSourceLimitations([...limitations.values()]),
        ...(omittedObservations === 0
          ? []
          : [
              `${omittedObservations} per-item provider limitation observation${omittedObservations === 1 ? " was" : "s were"} omitted from this answer; ${budget?.retainedIn}.`,
            ]),
      ],
      ...(cachePolicy === undefined ? {} : { cachePolicy }),
      ...(evidenceLinks.size === 0
        ? {}
        : { evidenceLinks: [...evidenceLinks].sort(compareUnicodeCodePoints) }),
    }),
    sources,
  );
};

/** Build the shared Evidence record for a successful composed binary workflow. */
export const createWorkflowEvidence = (input: {
  readonly target: BinaryTarget | undefined;
  readonly operation: AnalysisOperation;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly result: JsonValue;
  readonly upstreamProfile: AnalysisProfileCommitment | undefined;
  readonly upstreamLimitations: readonly string[];
  readonly upstreamEvidenceLinks?: readonly string[];
}): Evidence =>
  createEvidence(input.target, REA_WORKFLOW_PROVIDER, {
    operation: input.operation,
    parameters: input.parameters,
    result: input.result,
    ...(input.upstreamProfile === undefined
      ? {}
      : {
          analysisProfile: workflowAnalysisProfile(
            input.upstreamProfile,
            input.operation,
          ),
        }),
    confidence: "derived",
    ...(input.upstreamEvidenceLinks === undefined
      ? {}
      : { evidenceLinks: input.upstreamEvidenceLinks }),
    limitations: [
      "Derived by an REA composed workflow.",
      ...input.upstreamLimitations,
    ],
    ...(input.operation === "batch_decompile"
      ? { locations: batchProcedureLocations(input.result) }
      : {}),
  });

const batchProcedureLocations = (result: JsonValue): EvidenceLocation[] => {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !Array.isArray(result.items)
  )
    return [];
  const addresses = new Set<string>();
  for (const item of result.items) {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      continue;
    const procedure = item.procedure;
    if (
      procedure !== null &&
      typeof procedure === "object" &&
      !Array.isArray(procedure) &&
      procedure.status === "resolved" &&
      typeof procedure.address === "string"
    )
      addresses.add(procedure.address);
  }
  return [...addresses].map((address) => ({ kind: "address", address }));
};

/** Convert workflow Evidence into its exact replay binding, when it has a profile. */
export const workflowSnapshotRecord = (
  evidence: Evidence,
  operation: AnalysisOperation,
  bindingProfile: AnalysisProfileCommitment | undefined,
  cachePolicy?: "live",
): WorkflowSnapshotRecordInput | undefined => {
  if (
    evidence.analysis_profile === null ||
    bindingProfile === undefined ||
    cachePolicy === "live"
  )
    return undefined;
  return {
    operation,
    bindingProfile,
    parameters: evidence.parameters,
    execution: {
      result: evidence.normalized_result,
      rawResult: evidence.raw_result,
      provider: committedProviderSchema.parse(evidence.provider),
      analysisProfile: analysisProfileSchema.parse(evidence.analysis_profile),
      limitations: evidence.limitations,
      locations: evidence.locations,
      subject:
        evidence.subject === null
          ? null
          : {
              path: evidence.subject.local_path,
              sha256: evidence.subject.digest.sha256,
              format: evidence.subject.format,
              ...(evidence.subject.architecture === null
                ? {}
                : { architecture: evidence.subject.architecture }),
            },
    },
  };
};

interface WorkflowUnknownInput {
  readonly name: string;
  readonly result: JsonValue;
  readonly evidenceId: string;
  readonly recordUnknown: UnknownRegistryPort["recordUnknown"] | undefined;
}

/** Retain residual workflow questions using the shared investigation policy. */
export const recordWorkflowUnknowns = ({
  name,
  result,
  evidenceId,
  recordUnknown,
}: WorkflowUnknownInput):
  | ReturnType<UnknownRegistryPort["recordUnknown"]>
  | { readonly ok: true; readonly value: null } => {
  if (
    !["trace_feature", "trace_call_path", "inspect_native_api"].includes(
      name,
    ) ||
    recordUnknown === undefined ||
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    !Array.isArray(result.residual_unknowns)
  )
    return { ok: true, value: null };
  for (const question of result.residual_unknowns) {
    if (typeof question !== "string") continue;
    const input = workflowUnknownInput(evidenceId, {
      question,
      severity: "medium",
      domain: name === "inspect_native_api" ? "native-api" : "control-flow",
      required_authority: "shipped-artifact",
      required_confidence: "observed",
      required_environment: null,
      recommended_probes: [
        {
          operation: name,
          rationale:
            name === "inspect_native_api"
              ? "Confirm the unsupported boundary with a capable provider or ABI probe."
              : "Continue with a focused query or another available provider.",
        },
      ],
      relationships: [],
    });
    if (!input.ok) return input;
    const recorded = recordUnknown(input.value);
    if (
      !recorded.ok &&
      !(
        recorded.error instanceof UnknownRegistryError &&
        recorded.error.reason === "already-exists"
      )
    )
      return recorded;
  }
  return { ok: true, value: null };
};
