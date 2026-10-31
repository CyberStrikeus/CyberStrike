import { projectAnalysisErrorWithoutCapturedOutput } from "../../domain/analysisErrorProjection.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import { isNativeObservationOperation } from "../../domain/native/nativeObservation.js";
import { dispatchQueuedInterrupts } from "../../process/queuedInterrupts.js";
import { readImmutableEvidenceBundle } from "../EvidenceBundleFiles.js";
import { INSPECT_ANALYSIS_VIEW_OPERATION } from "../../domain/analysisView/analysisViewErrors.js";

import { ANALYSIS_VIEW_PROVIDER } from "../../domain/investigationProviders.js";
import type { EvidenceLookup } from "../EvidenceInputResolver.js";
import { resolveEvidenceInput } from "../EvidenceInputResolver.js";
import type { EvidenceWriter } from "../investigation/InvestigationRecordPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisCapabilityUnavailableError,
} from "../../domain/analysisErrorCore.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import { safeParseEvidence } from "../../domain/evidenceValidation.js";
import {
  createEvidence,
  rebindEvidenceToTargetPath,
  type Evidence,
  type EvidenceSubjectTarget,
} from "../../domain/evidence.js";
import {
  inspectAnalysisViewInputSchema,
  prepareAnalysisViewProjection,
  type AnalysisViewResult,
  type AnalysisViewRequest,
  type InspectAnalysisViewInput,
} from "../../domain/analysisView/analysisView.js";
import {
  immutableJsonSnapshotMember,
  isImmutableJsonSnapshot,
} from "../../domain/immutableJson.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  readEvidenceFileSource,
  type EvidenceFileReadOptions,
} from "./evidenceFileSource.js";

/** A parsed request whose source can be projected without filesystem access. */
export interface ReadyAnalysisViewInput {
  readonly source: Exclude<
    InspectAnalysisViewInput["source"],
    { kind: "evidence-file" }
  >;
  readonly view: AnalysisViewRequest;
}

/** Source acquisition controls shared by CLI and MCP; bundles are selected by the CLI. */
export interface AnalysisViewReadOptions extends EvidenceFileReadOptions {
  readonly evidenceBundlePath?: string;
}

/** Validate one view request, resolve its selected source, then project completed Evidence. */
export const inspectAnalysisView = async (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: AnalysisViewReadOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const parsed = parseAnalysisInput(
    INSPECT_ANALYSIS_VIEW_OPERATION,
    rawInput,
    inspectAnalysisViewInputSchema,
    options.signal,
  );
  if (!parsed.ok) return parsed;
  if (options.evidenceBundlePath !== undefined)
    return inspectBundleView(parsed.value, options.evidenceBundlePath, options);
  const source = parsed.value.source;
  if (source.kind === "evidence-file")
    return inspectFileView({ ...parsed.value, source }, lookup, options);
  return inspectAnalysisViewValidated({ ...parsed.value, source }, lookup);
};

/**
 * Read and authenticate an Evidence-file source, then project it as retained
 * Evidence: its strings are bounded by the file reader rather than charged as
 * inline input.
 */
const inspectFileView = async (
  input: InspectAnalysisViewInput & {
    readonly source: Extract<
      InspectAnalysisViewInput["source"],
      { kind: "evidence-file" }
    >;
  },
  lookup?: EvidenceLookup,
  options: EvidenceFileReadOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const loaded = await readEvidenceFileSource(
    input.source.path,
    options,
    input.source.evidence_id,
  );
  // Authentication and projection are synchronous; dispatch queued callbacks and
  // the signal notifications they enqueue before accepting either result.
  await dispatchQueuedInterrupts();
  // A request cancelled during authentication reports cancellation, even when authentication failed.
  const admitted = cancelledFileViewResult(
    loaded,
    options.signal,
    loaded.ok ? loaded.value : undefined,
  );
  if (!admitted.ok) return admitted;
  const id = admitted.value.evidence_id;
  const projected = inspectAnalysisViewValidated(
    { ...input, source: { kind: "retained-evidence", evidence_id: id } },
    (evidenceId) => (evidenceId === id ? admitted.value : lookup?.(evidenceId)),
  );
  await dispatchQueuedInterrupts();
  if (!projected.ok) return projected;
  return cancelledFileViewResult(projected, options.signal, projected.value);
};

/** Resolve the caller's exact retained parent from an authenticated portable bundle. */
const inspectBundleView = async (
  input: InspectAnalysisViewInput,
  bundlePath: string,
  { resources, signal }: EvidenceFileReadOptions,
): Promise<Result<Evidence, AnalysisError>> => {
  if (input.source.kind !== "retained-evidence")
    return err(
      new AnalysisInputError("inspect_analysis_view", undefined, [
        {
          path: ["source", "kind"],
          reason: "invalid_value",
          message:
            "--evidence-bundle requires a retained-evidence source with the exact parent evidence_id; inline Evidence already supplies its source",
        },
      ]),
    );
  const loaded = await readImmutableEvidenceBundle(
    bundlePath,
    signal,
    resources,
    "inspect_analysis_view",
  );
  // Authentication and projection are synchronous; dispatch queued interrupts before accepting either result.
  await dispatchQueuedInterrupts();
  // Preserve an already-produced bundle failure before considering a later abort.
  if (!loaded.ok) return loaded;
  const parentId = input.source.evidence_id;
  const admitted = cancelledFileViewResult(
    loaded,
    signal,
    signal?.aborted
      ? loaded.value.records.find((record) => record.evidence_id === parentId)
      : undefined,
  );
  if (!admitted.ok) return admitted;
  const projected = inspectAnalysisViewValidated(
    { source: input.source, view: input.view },
    (id) => admitted.value.records.find((record) => record.evidence_id === id),
  );
  await dispatchQueuedInterrupts();
  if (!projected.ok) return projected;
  return cancelledFileViewResult(projected, signal, projected.value);
};

/** Retain completed work and pending cleanup when this stage accepts cancellation.
 * File-source admission explicitly gives queued cancellation precedence over
 * authentication errors; callers preserve other already-produced failures.
 */
const cancelledFileViewResult = <T>(
  result: Result<T, AnalysisError>,
  signal?: AbortSignal,
  completedEvidence?: Evidence,
): Result<T, AnalysisError> => {
  if (!signal?.aborted) return result;
  const cancellation = new AnalysisCancelledError(
    INSPECT_ANALYSIS_VIEW_OPERATION,
    {
      cause: signal.reason,
      ...(completedEvidence !== undefined
        ? { partialObservation: completedEvidence }
        : {}),
    },
  );
  if (!result.ok)
    cancellation.retainSecondaryFailure(result.error, {
      source_error: projectAnalysisErrorWithoutCapturedOutput(result.error),
    });
  return err(
    !result.ok && result.error.cleanupIncomplete
      ? analysisErrorWithCleanupFailure(
          cancellation,
          result.error,
          INSPECT_ANALYSIS_VIEW_OPERATION,
        ).bindCleanupDependencies([result.error])
      : cancellation,
  );
};

/** Project a parsed request whose selected source is inline or retained. */
export const inspectAnalysisViewValidated = (
  input: ReadyAnalysisViewInput,
  lookup?: EvidenceLookup,
): Result<Evidence, AnalysisError> => {
  const projection = prepareAnalysisViewProjection(input.view);
  if (input.source.kind === "inline") {
    const admitted = projection.admitInlineEvidence(input.source.evidence);
    if (!admitted.ok) return admitted;
  }
  const resolved = resolveAnalysisViewSource(input.source, lookup);
  if (!resolved.ok) return resolved;
  return projectResolvedAnalysisView(input, projection, resolved.value);
};

/** Keep payload ownership separate from this delivery's display-only subject. */
const projectResolvedAnalysisView = (
  input: ReadyAnalysisViewInput,
  projection: ReturnType<typeof prepareAnalysisViewProjection>,
  parent: Evidence,
  selectedTarget?: EvidenceSubjectTarget,
): Result<Evidence, AnalysisError> => {
  const presentation =
    selectedTarget === undefined
      ? parent
      : rebindEvidenceToTargetPath(parent, selectedTarget);
  const projected = projection.project({
    evidenceId: parent.evidence_id,
    operation: parent.operation,
    provider: parent.provider,
    analysisProfile: parent.analysis_profile,
    authority: parent.authority,
    environment: parent.environment,
    normalizedResult:
      immutableJsonSnapshotMember(parent, "normalized_result") ??
      parent.normalized_result,
    // Sealing an Evidence root deep-freezes it; only the root is registered.
    sealedResult: isImmutableJsonSnapshot(parent),
    subject: presentation.subject,
    limitations: parent.limitations,
    parameters: parent.parameters,
    artifact:
      presentation.subject === null
        ? null
        : {
            path: presentation.subject.local_path,
            sha256: presentation.subject.digest.sha256,
          },
  });
  if (!projected.ok) return projected;
  if (
    parent.subject !== null &&
    parent.subject.digest.sha256 !== projected.value.artifact?.sha256
  )
    return err(
      new EvidenceIntegrityError(
        `Parent subject SHA-256 ${parent.subject.digest.sha256} differs from analysis artifact SHA-256 ${projected.value.artifact?.sha256 ?? "unknown"}.`,
      ),
    );
  return ok(createAnalysisViewEvidence(input, presentation, projected.value));
};

/** Session Evidence ownership required to deliver a view instead of a complete record. */
export interface AnalysisViewRetention {
  readonly evidenceById: EvidenceLookup | undefined;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
}

/** Fail before analysis when selected delivery cannot keep its complete source. */
export const requireAnalysisViewRetention = (
  operation: string,
  retention: AnalysisViewRetention,
): Result<
  {
    readonly evidenceById: EvidenceLookup;
    readonly recordEvidence: EvidenceWriter["recordEvidence"];
  },
  AnalysisError
> => {
  if (
    retention.recordEvidence === undefined ||
    retention.evidenceById === undefined
  )
    return err(
      new AnalysisCapabilityUnavailableError(
        ANALYSIS_VIEW_PROVIDER.id,
        operation,
        "summary detail requires a server session that retains Evidence for later views",
        {
          userMessage:
            "This server does not retain Evidence. Select detail complete to receive the complete analysis inline.",
        },
      ),
    );
  return ok({
    evidenceById: retention.evidenceById,
    recordEvidence: retention.recordEvidence,
  });
};

/**
 * Retain complete analysis Evidence in the session, then project its summary
 * with this observation's subject path. Callers page or select the rest through
 * inspect_analysis_view with the view's parent Evidence ID.
 */
export const summarizeRetainedAnalysis = (
  evidence: Evidence,
  retention: AnalysisViewRetention,
): Result<Evidence, AnalysisError> =>
  projectRetainedAnalysis(evidence, retention, { kind: "summary" });

/** Retain the complete owner observation and deliver one explicitly selected view. */
export const projectRetainedAnalysis = (
  evidence: Evidence,
  retention: AnalysisViewRetention,
  view: AnalysisViewRequest,
): Result<Evidence, AnalysisError> => {
  const ready = requireAnalysisViewRetention(evidence.operation, retention);
  if (!ready.ok) return ready;
  const recorded = ready.value.recordEvidence(evidence);
  if (!recorded.ok) return recorded;
  const source = {
    kind: "retained-evidence" as const,
    evidence_id: evidence.evidence_id,
  };
  const retained = resolveEvidenceInput(source, ready.value.evidenceById);
  if (!retained.ok) return retained;
  // Duplicate semantic records retain their original ledger metadata. Detail
  // selection changes presentation, not the historical lookup or payload owner.
  const subject = evidence.subject;
  return projectResolvedAnalysisView(
    { source, view },
    prepareAnalysisViewProjection(view),
    retained.value,
    subject === null
      ? undefined
      : {
          path: subject.local_path,
          sha256: subject.digest.sha256,
          format: subject.format,
          ...(subject.architecture === null
            ? {}
            : { architecture: subject.architecture }),
        },
  );
};

const resolveAnalysisViewSource = (
  source: ReadyAnalysisViewInput["source"],
  lookup: EvidenceLookup | undefined,
): Result<Evidence, AnalysisError> => {
  if (source.kind === "retained-evidence")
    return resolveEvidenceInput(source, lookup);
  return authenticateEvidence(source.evidence, ["source", "evidence"], {
    source,
  });
};

/** Parse complete Evidence, reporting schema issues under the given request path. */
const authenticateEvidence = (
  value: unknown,
  path: readonly (string | number)[],
  input: unknown,
): Result<Evidence, AnalysisError> => {
  const parsed = safeParseEvidence(value);
  if (parsed.ok) return parsed;
  const cause = parsed.error;
  return err(
    analysisInputErrorFromIssues(
      INSPECT_ANALYSIS_VIEW_OPERATION,
      cause.issues.map((issue) => ({
        ...issue,
        path: [...path, ...issue.path],
      })),
      input,
      { cause },
    ),
  );
};

const createAnalysisViewEvidence = (
  input: ReadyAnalysisViewInput,
  parent: Evidence,
  result: AnalysisViewResult,
): Evidence => {
  const target =
    parent.subject === null
      ? undefined
      : {
          path: parent.subject.local_path,
          sha256: parent.subject.digest.sha256,
          format: parent.subject.format,
          ...(parent.subject.architecture === null
            ? {}
            : { architecture: parent.subject.architecture }),
        };
  const nativeFunctionView =
    result.kind === "native" ||
    (result.kind === "summary" &&
      result.parent_operation === "analyze_function")
      ? result
      : undefined;
  const nativeObservationView =
    result.kind === "native-observation" ||
    result.kind === "native-context" ||
    (result.kind === "summary" &&
      isNativeObservationOperation(result.parent_operation));
  return createEvidence(
    target,
    ANALYSIS_VIEW_PROVIDER,
    {
      predicateType: "rea.analysis-view",
      operation: INSPECT_ANALYSIS_VIEW_OPERATION,
      parameters: {
        parent_evidence_id: parent.evidence_id,
        view: input.view,
      },
      result,
      rawResult: null,
      confidence:
        // A projection never strengthens its parent: inferred facts stay inferred.
        // Grouping is whole-capture, so any templated group or parameter makes the result inferred;
        // entity types and identity in an extracted state, and the coverage summarizing it, always are.
        parent.confidence === "inferred" ||
        result.kind === "environment-state" ||
        result.kind === "environment-coverage" ||
        ((result.kind === "api-surface" ||
          result.kind === "environment-manifest") &&
          result.templated_groups > 0)
          ? "inferred"
          : "derived",
      authority: parent.authority,
      environment: parent.environment,
      limitations: result.limitations,
      ...((nativeFunctionView !== undefined || nativeObservationView) &&
      parent.relationship_coverage !== null
        ? { relationshipCoverage: parent.relationship_coverage }
        : {}),
      locations: [
        ...(result.artifact != null && result.artifact.path.length > 0
          ? [{ kind: "artifact-path" as const, path: result.artifact.path }]
          : []),
        ...(nativeFunctionView !== undefined &&
        nativeFunctionView.procedure_address !== null &&
        nativeFunctionView.procedure_address.length > 0
          ? [
              {
                kind: "address" as const,
                address: nativeFunctionView.procedure_address,
              },
            ]
          : []),
      ],
      evidenceLinks: [parent.evidence_id],
    },
    { immutable: true },
  );
};
