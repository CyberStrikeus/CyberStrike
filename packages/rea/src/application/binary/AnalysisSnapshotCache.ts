import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import type { AnalysisProfileCommitment } from "../../domain/analysisProfile.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { EvidenceBundle } from "../../domain/evidenceBundle.js";
import {
  EvidenceIntegrityError,
  AnalysisSnapshotMismatchError,
} from "../../domain/evidenceErrors.js";
import { NoBinaryOpenError } from "../../domain/configurationErrors.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import {
  rebindEvidenceSubjectTargetPath,
  type Evidence,
} from "../../domain/evidence.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  analysisQueryId,
  evidenceMatchesEntry,
  evidenceMatchesWorkflowEntry,
  createAnalysisSnapshotEntry,
  createAnalysisSnapshotWorkflowEntry,
  snapshotBinding,
  snapshotMatchesProfile,
  snapshotMatchesTarget,
  snapshotTarget,
  parseAnalysisSnapshot,
  immutableAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotEntry,
  type AnalysisSnapshotWorkflowEntry,
  type AnalysisSnapshotBinding,
  type AnalysisSnapshotTarget,
} from "../../domain/analysisSnapshot.js";
import type {
  AnalysisExecution,
  AnalysisOperation,
  CapabilityDescriptor,
} from "../AnalysisProvider.js";
import { OFFICIAL_TOOL_CONTRACTS } from "../../contracts/officialToolContracts.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";

import type { EvidenceMetadataReplacement } from "../investigation/EvidenceLedger.js";
import {
  snapshotReplayBinding,
  type SnapshotReplayBinding,
} from "./AnalysisSnapshotReplayBinding.js";

const RELATIONSHIP_OPERATIONS: ReadonlySet<AnalysisOperation> = new Set([
  "procedure_callers",
  "procedure_callees",
]);

// These reports depend on selected bundle resources or loader context beyond
// the immutable executable identity carried by a binary analysis snapshot.
const RESOURCE_SCOPED_OPERATIONS: ReadonlySet<AnalysisOperation> = new Set([
  "decode_interface_builder",
  "inspect_asset_catalog",
  "inspect_keyed_archive",
  "trace_dylib_resolution",
]);

const STATEFUL_OPERATIONS: ReadonlySet<AnalysisOperation> = new Set([
  "health",
  "current_address",
  "current_procedure",
  "current_document",
  "goto_address",
  "list_documents",
]);

const CURSOR_DEFAULT_OPERATIONS: ReadonlySet<AnalysisOperation> = new Set([
  "address_name",
  "comment",
  "inline_comment",
  "next_address",
  "prev_address",
  "xrefs",
]);

const DOCUMENT_SCOPED_OPERATIONS: ReadonlySet<string> = new Set(
  OFFICIAL_TOOL_CONTRACTS.map(({ name }) => name).filter(
    (name) => name !== "current_document" && name !== "list_documents",
  ),
);

/** Maximum duplicated result bindings retained across direct and workflow queries. */
export const SNAPSHOT_CACHE_ENTRY_CEILING = 10_000;

const replayDocumentSelected = (
  operation: AnalysisOperation,
  parameters: Readonly<Record<string, JsonValue>>,
): boolean =>
  !DOCUMENT_SCOPED_OPERATIONS.has(operation) ||
  typeof parameters.document === "string";

/**
 * Caller and callee walks omit `document`. Their observations are still
 * Evidence. Other document-scoped reads, including `procedure_pseudo_code`
 * from `decompile_all`, already keep each body in the file-backed export.
 * Copying those bodies into the in-memory ledger would retain the export.
 */
const DOCUMENTLESS_SOURCE_EVIDENCE_OPERATIONS: ReadonlySet<AnalysisOperation> =
  new Set(["procedure_callers", "procedure_callees"]);

/**
 * Whether a source observation is safe to retain as Evidence.
 * A missing document selector blocks snapshot replay. Only caller and callee
 * walks stay in the ledger without one.
 */
export const isSourceEvidenceRetainable = (
  operation: AnalysisOperation,
  descriptor: CapabilityDescriptor | undefined,
  parameters: Readonly<Record<string, JsonValue>>,
): descriptor is CapabilityDescriptor =>
  !STATEFUL_OPERATIONS.has(operation) &&
  !RESOURCE_SCOPED_OPERATIONS.has(operation) &&
  (!DOCUMENT_SCOPED_OPERATIONS.has(operation) ||
    typeof parameters.document === "string" ||
    DOCUMENTLESS_SOURCE_EVIDENCE_OPERATIONS.has(operation)) &&
  (!CURSOR_DEFAULT_OPERATIONS.has(operation) ||
    typeof parameters.address === "string") &&
  descriptor?.effects.mutatesArtifact === false &&
  (descriptor.cachePolicy === "snapshot" ||
    descriptor.effects.mayWriteFilesystem === false) &&
  descriptor.effects.changesPermissions === false;

/** Whether an observation can additionally be replayed as a snapshot. */
export const isSnapshotCacheable = (
  operation: AnalysisOperation,
  descriptor: CapabilityDescriptor | undefined,
  parameters: Readonly<Record<string, JsonValue>>,
): descriptor is CapabilityDescriptor =>
  isSourceEvidenceRetainable(operation, descriptor, parameters) &&
  replayDocumentSelected(operation, parameters) &&
  descriptor.cachePolicy !== "live";

/** Windows Ghidra must admit the selected source through its native snapshot owner. */
export const requiresNativeSourceAdmissionBeforeReplay = (
  providerId: string | undefined,
): boolean => process.platform === "win32" && providerId === "ghidra";

/** Limitation that marks every observation replayed from a snapshot. */
export const SNAPSHOT_REPLAY_LIMITATION =
  "Loaded from a local REA analysis snapshot; this call did not re-run the provider.";

/** Bounded in-memory cache for one immutable binary identity. */
export class AnalysisSnapshotCache {
  readonly #entries = new Map<string, AnalysisSnapshotEntry>();
  // Null means imported provenance cannot be faithfully replayed. It is distinct
  // from an entry recorded before an Evidence ID was assigned.
  readonly #replayBindings = new Map<string, SnapshotReplayBinding | null>();
  readonly #workflowEntries = new Map<string, AnalysisSnapshotWorkflowEntry>();
  #target: AnalysisSnapshotTarget | undefined;
  #binding: AnalysisSnapshotBinding | undefined;

  /** Whether staged entries belong to the supplied target and profile. */
  matches(
    target: BinaryTarget,
    profile: AnalysisProfileCommitment | undefined,
  ): boolean {
    return (
      (this.#target === undefined && this.#binding === undefined) ||
      (this.#target !== undefined &&
        this.#binding !== undefined &&
        profile !== undefined &&
        snapshotMatchesTarget(this.#target, target) &&
        snapshotMatchesProfile(this.#binding, profile))
    );
  }

  /** Replace cache state when the target or selected profile changes. */
  select(target: BinaryTarget, profile: AnalysisProfileCommitment): void {
    if (!this.matches(target, profile)) this.#clearEntries();
    this.#target = snapshotTarget(target);
    this.#binding = snapshotBinding(profile);
  }

  /** Merge already-validated entries and return the new-entry count. */
  stage(snapshot: AnalysisSnapshot): number {
    snapshot = immutableAnalysisSnapshot(snapshot);
    if (
      (this.#target !== undefined &&
        JSON.stringify(this.#target) !== JSON.stringify(snapshot.target)) ||
      (this.#binding !== undefined &&
        !snapshotMatchesProfile(
          this.#binding,
          snapshot.binding.analysis_profile,
        ))
    )
      this.#clearEntries();
    this.#target = structuredClone(snapshot.target);
    this.#binding = structuredClone(snapshot.binding);
    let imported = 0;
    const stagedQueryIds = new Set<string>();
    for (const entry of snapshot.entries) {
      if (!this.#entries.has(entry.query_id) && !this.#hasCapacity()) continue;
      if (!this.#entries.has(entry.query_id)) imported += 1;
      this.#entries.set(entry.query_id, entry);
      stagedQueryIds.add(entry.query_id);
      this.#replayBindings.delete(entry.query_id);
    }
    // Snapshot validation authenticated these records. Recover the original
    // identity before lookup adds replay caveats; do not mint a new record.
    const evidenceByQuery = new Map<string, Evidence>();
    const records = new Map(
      snapshot.evidence_bundle.records.map((record) => [
        record.evidence_id,
        record,
      ]),
    );
    const ambiguous = new Set<string>();
    for (const evidence of snapshot.evidence_bundle.records) {
      const queryId = analysisQueryId(
        snapshot.target,
        snapshot.binding,
        evidence.operation,
        evidence.parameters,
      );
      if (!stagedQueryIds.has(queryId)) continue;
      const entry = this.#entries.get(queryId);
      if (
        entry === undefined ||
        !evidenceMatchesEntry(evidence, entry, snapshot)
      )
        continue;
      const previous = evidenceByQuery.get(queryId);
      if (
        previous !== undefined &&
        previous.evidence_id !== evidence.evidence_id
      )
        ambiguous.add(queryId);
      else evidenceByQuery.set(queryId, evidence);
    }
    for (const [queryId, evidence] of evidenceByQuery) {
      this.#replayBindings.set(
        queryId,
        ambiguous.has(queryId)
          ? null
          : snapshotReplayBinding(evidence, records),
      );
    }
    for (const entry of snapshot.workflow_entries) {
      if (!this.#workflowEntries.has(entry.query_id) && !this.#hasCapacity())
        continue;
      if (!this.#workflowEntries.has(entry.query_id)) imported += 1;
      this.#workflowEntries.set(entry.query_id, entry);
    }
    return imported;
  }

  /** Refresh subject bindings backed by replaced authenticated metadata. */
  refreshEvidenceMetadata(
    replacements: readonly EvidenceMetadataReplacement[],
  ): void {
    if (
      replacements.length === 0 ||
      this.#target === undefined ||
      this.#binding === undefined
    )
      return;
    const currentRecords = new Map(
      replacements.map(({ current }) => [current.evidence_id, current]),
    );
    for (const [queryId, binding] of this.#replayBindings) {
      if (binding === null || binding.sourceEvidence === undefined) continue;
      const sources = binding.sourceEvidence;
      if (!sources.some((source) => currentRecords.has(source.evidence_id)))
        continue;
      this.#replayBindings.set(queryId, {
        evidenceId: binding.evidenceId,
        sourceEvidence: Object.freeze(
          sources.map(
            (source) => currentRecords.get(source.evidence_id) ?? source,
          ),
        ),
      });
    }
    const header = { target: this.#target, binding: this.#binding };
    for (const { previous, current } of replacements) {
      if (
        current.subject === null ||
        previous.subject?.local_path === current.subject.local_path
      )
        continue;
      const queryId = analysisQueryId(
        header.target,
        header.binding,
        previous.operation,
        previous.parameters,
      );
      const entry = this.#entries.get(queryId);
      if (
        entry !== undefined &&
        entry.execution.subject !== null &&
        evidenceMatchesEntry(previous, entry, header)
      )
        this.#entries.set(queryId, {
          ...entry,
          execution: {
            ...entry.execution,
            subject: {
              ...entry.execution.subject,
              path: current.subject.local_path,
            },
          },
        });
      const workflow = this.#workflowEntries.get(queryId);
      if (
        workflow !== undefined &&
        workflow.execution.subject !== null &&
        evidenceMatchesWorkflowEntry(previous, workflow, header)
      )
        this.#workflowEntries.set(queryId, {
          ...workflow,
          execution: {
            ...workflow.execution,
            subject: {
              ...workflow.execution.subject,
              path: current.subject.local_path,
            },
          },
        });
    }
  }

  /** Build a complete snapshot for an active target. */
  export(
    target: BinaryTarget | undefined,
    profile: AnalysisProfileCommitment | undefined,
    evidenceBundle: EvidenceBundle,
  ): Result<AnalysisSnapshot, AnalysisError> {
    if (target === undefined || profile === undefined)
      return err(new NoBinaryOpenError());
    try {
      const snapshotTargetIdentity = snapshotTarget(target);
      const binding = snapshotBinding(profile);
      // In-memory replay can preserve unbound and child-artifact observations.
      // A persisted target snapshot can authenticate only rows whose Evidence
      // has that target subject; the record owner applies the same scope to its bundle.
      const entries = [...this.#entries.values()]
        .filter((entry) => entry.execution.subject?.sha256 === target.sha256)
        .sort((left, right) =>
          compareUnicodeCodePoints(left.query_id, right.query_id),
        );
      const workflows = [...this.#workflowEntries.values()]
        .filter((entry) => entry.execution.subject?.sha256 === target.sha256)
        .sort((left, right) =>
          compareUnicodeCodePoints(left.query_id, right.query_id),
        );
      // Parsing owns the returned JSON and metadata; pre-cloning the same
      // payloads here only adds another full materialization.
      return ok(
        parseAnalysisSnapshot({
          target: snapshotTargetIdentity,
          binding,
          entries,
          workflow_entries: workflows,
          evidence_bundle: evidenceBundle,
        }),
      );
    } catch (cause: unknown) {
      return err(
        new EvidenceIntegrityError("Analysis snapshot validation failed", {
          cause,
        }),
      );
    }
  }

  /** Validate target identity, merge evidence atomically, then stage entries. */
  import(
    snapshot: AnalysisSnapshot,
    active:
      | {
          readonly target: BinaryTarget;
          readonly profile: AnalysisProfileCommitment;
        }
      | undefined,
    mergeEvidence: (
      bundle: EvidenceBundle,
    ) => Result<number, EvidenceIntegrityError | AnalysisInputError>,
  ): Result<number, AnalysisError> {
    let validated: AnalysisSnapshot;
    try {
      validated = immutableAnalysisSnapshot(snapshot);
    } catch (cause: unknown) {
      return err(
        new EvidenceIntegrityError("Analysis snapshot validation failed", {
          cause,
        }),
      );
    }
    if (
      active !== undefined &&
      (!snapshotMatchesTarget(validated.target, active.target) ||
        !snapshotMatchesProfile(validated.binding, active.profile))
    )
      return err(
        new AnalysisSnapshotMismatchError(
          "Analysis snapshot profile_mismatch: target, provider, or analysis profile does not match the active binary",
        ),
      );
    const importedEvidence = mergeEvidence(validated.evidence_bundle);
    return importedEvidence.ok ? ok(this.stage(validated)) : importedEvidence;
  }

  /** Return canonical entries for persistence. */
  entries(): AnalysisSnapshotEntry[] {
    return [...this.#entries.values()]
      .sort((left, right) =>
        compareUnicodeCodePoints(left.query_id, right.query_id),
      )
      .map((entry) => structuredClone(entry));
  }

  /** Return canonical composed-workflow entries for persistence. */
  workflowEntries(): AnalysisSnapshotWorkflowEntry[] {
    return [...this.#workflowEntries.values()]
      .sort((left, right) =>
        compareUnicodeCodePoints(left.query_id, right.query_id),
      )
      .map((entry) => structuredClone(entry));
  }

  /** Record one exact derived workflow result unless the shared cache is full. */
  recordWorkflow(input: {
    readonly target: BinaryTarget;
    readonly profile: AnalysisProfileCommitment;
    readonly operation: string;
    readonly parameters: Readonly<Record<string, JsonValue>>;
    readonly execution: {
      readonly result: JsonValue;
      readonly rawResult: JsonValue | null;
      readonly provider: AnalysisExecution["provider"];
      readonly analysisProfile: AnalysisProfileCommitment;
      readonly limitations: readonly string[];
      readonly relationshipCoverage?: AnalysisExecution["relationshipCoverage"];
      readonly locations: AnalysisExecution["locations"];
      readonly subject: NonNullable<AnalysisExecution["subject"]> | null;
    };
  }): void {
    this.select(input.target, input.profile);
    const queryId = analysisQueryId(
      snapshotTarget(input.target),
      snapshotBinding(input.profile),
      input.operation,
      input.parameters,
    );
    if (!this.#workflowEntries.has(queryId) && !this.#hasCapacity()) return;
    const entry = createAnalysisSnapshotWorkflowEntry({
      target: snapshotTarget(input.target),
      binding: snapshotBinding(input.profile),
      operation: input.operation,
      parameters: input.parameters,
      execution: input.execution,
    });
    this.#workflowEntries.set(entry.query_id, entry);
  }

  /** Replay an exact provider-specific query, marking its cached provenance. */
  lookup(
    target: BinaryTarget,
    profile: AnalysisProfileCommitment,
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
  ): AnalysisExecution | undefined {
    const queryId = analysisQueryId(
      snapshotTarget(target),
      snapshotBinding(profile),
      operation,
      parameters,
    );
    const cached = this.#entries.get(queryId);
    if (cached === undefined) return undefined;
    const binding = this.#replayBindings.get(queryId);
    // Do not turn a refused provenance selection into a fresh, unlinked record.
    // The provider must produce a new observation before this query can replay.
    if (binding === null) return undefined;
    const cachedSubject = cached.execution.subject;
    const subject =
      cachedSubject == null
        ? null
        : rebindEvidenceSubjectTargetPath(
            {
              path: cachedSubject.path,
              sha256: cachedSubject.sha256,
              format: cachedSubject.format,
              ...(cachedSubject.architecture === null
                ? {}
                : { architecture: cachedSubject.architecture }),
            },
            target,
          );
    const execution: AnalysisExecution = structuredClone({
      ...(binding === undefined ? {} : { evidenceId: binding.evidenceId }),
      result: cached.execution.result,
      rawResult: cached.execution.raw_result,
      provider: cached.execution.provider,
      analysisProfile: structuredClone(profile),
      limitations: [
        ...cached.execution.limitations,
        SNAPSHOT_REPLAY_LIMITATION,
      ],
      ...(cached.execution.relationship_coverage === null &&
      RELATIONSHIP_OPERATIONS.has(operation)
        ? {
            relationshipCoverage: {
              status: "unknown",
              reason: "Snapshot entry does not report relationship coverage.",
            },
          }
        : cached.execution.relationship_coverage === null
          ? {}
          : {
              relationshipCoverage: cached.execution.relationship_coverage,
            }),
      locations: cached.execution.locations,
      subject: subject ?? null,
    });
    return binding?.sourceEvidence === undefined
      ? execution
      : { ...execution, sourceEvidence: binding.sourceEvidence };
  }

  /** Record one successful immutable call unless the cache is full. */
  record(input: {
    readonly target: BinaryTarget;
    readonly profile: AnalysisProfileCommitment;
    readonly operation: AnalysisOperation;
    readonly parameters: Readonly<Record<string, JsonValue>>;
    readonly execution: AnalysisExecution;
  }): void {
    const { target, profile, operation, parameters, execution } = input;
    this.select(target, profile);
    // The snapshot format does not carry reference truncation; a replay would
    // present a capped read as complete, so it is not recorded.
    if (execution.referencesTruncated === true) return;
    // Provider snapshot entries do not carry execution source records. Replay
    // must not discard the source closure that supplies the parent's Evidence links.
    if ((execution.sourceEvidence?.length ?? 0) > 0) return;
    const queryId = analysisQueryId(
      snapshotTarget(target),
      snapshotBinding(profile),
      operation,
      parameters,
    );
    if (!this.#entries.has(queryId) && !this.#hasCapacity()) return;
    const entry = createAnalysisSnapshotEntry({
      target: snapshotTarget(target),
      binding: snapshotBinding(profile),
      operation,
      parameters,
      execution: {
        ...execution,
        subject:
          execution.subject === undefined
            ? {
                path: target.path,
                sha256: target.sha256,
                format: target.format,
                ...(target.architecture === undefined
                  ? {}
                  : { architecture: target.architecture }),
              }
            : execution.subject,
      },
    });
    this.#entries.set(entry.query_id, entry);
    if (execution.evidenceId === undefined)
      this.#replayBindings.delete(entry.query_id);
    else
      this.#replayBindings.set(entry.query_id, {
        evidenceId: execution.evidenceId,
      });
  }

  /** Forget all target-bound entries. */
  clear(): void {
    this.#clearEntries();
    this.#target = undefined;
    this.#binding = undefined;
  }

  #clearEntries(): void {
    this.#entries.clear();
    this.#replayBindings.clear();
    this.#workflowEntries.clear();
  }

  #hasCapacity(): boolean {
    return (
      this.#entries.size + this.#workflowEntries.size <
      SNAPSHOT_CACHE_ENTRY_CEILING
    );
  }
}
