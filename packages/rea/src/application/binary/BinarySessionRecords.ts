import type { AnalysisProfileCommitment } from "../../domain/analysisProfile.js";
import { analysisProfilesEqual } from "../../domain/analysisProfile.js";
import type { AnalysisSnapshot } from "../../domain/analysisSnapshot.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import type { Evidence } from "../../domain/evidence.js";
import type { EvidenceBundle } from "../../domain/evidenceBundle.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { evidenceBundleForTarget } from "../../domain/evidenceBundle.js";
import {
  EvidenceIntegrityError,
  AnalysisSnapshotMismatchError,
} from "../../domain/evidenceErrors.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCapabilityUnavailableError,
  type AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import type { UnknownRegistryError } from "../../domain/unknownRegistryError.js";
import type {
  RecordUnknownInput,
  ResidualUnknown,
  UnknownStatus,
  UpdateUnknownInput,
} from "../../domain/residualUnknown.js";
import type {
  EvidenceImportReceipt,
  UnknownPage,
  UnknownQuery,
} from "../investigation/InvestigationRecordPort.js";
import { err, ok, type Result } from "../../domain/result.js";
import type {
  AnalysisExecution,
  AnalysisOperation,
  RetainedResourceScope,
} from "../AnalysisProvider.js";
import { AnalysisSnapshotCache } from "./AnalysisSnapshotCache.js";
import { InvestigationRecords } from "../investigation/InvestigationRecords.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { bindRegularFileCleanup } from "../RegularFileRead.js";
import {
  writeAnalysisSnapshot as writeSnapshotFile,
  readAnalysisSnapshot as readSnapshotFile,
} from "./AnalysisSnapshotFiles.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { workflowAnalysisProfile } from "../WorkflowAnalysisProfile.js";
import {
  hasOnlyProfilelessNativeDispatchEntries,
  isProfilelessNativeDispatchSnapshot,
} from "./ProfilelessNativeWorkflowSnapshot.js";

const SNAPSHOT_MUTATION_RECOVERY =
  "Export session observations through export_evidence_bundle if needed. Close the active target without saving a snapshot, then reopen it before importing or saving a snapshot.";

/** A missing replay prerequisite is not an Evidence integrity failure. */
const snapshotUnavailable = (reason: string) =>
  new AnalysisCapabilityUnavailableError(
    "rea",
    "export_analysis_snapshot",
    reason,
    {
      userMessage: `Analysis snapshot unavailable: ${reason}`,
      remediationAction:
        "Export session observations with export_evidence_bundle if needed, or call close_binary without snapshot_path to close the session.",
    },
  );

export interface ActiveAnalysisBinding {
  readonly target: BinaryTarget;
  readonly profile: AnalysisProfileCommitment | null;
  /** Current route profile for the single profileless native dispatch workflow. */
  readonly profilelessWorkflowProfile?: AnalysisProfileCommitment;
}

/** Validated composed-workflow payload bound to the active target and profile. */
export interface WorkflowSnapshotRecordInput {
  readonly operation: AnalysisOperation;
  readonly bindingProfile: AnalysisProfileCommitment;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly execution: Parameters<
    AnalysisSnapshotCache["recordWorkflow"]
  >[0]["execution"];
}

/** Own binary snapshots and coordinate the composed investigation records. */
export abstract class BinarySessionRecords {
  readonly #records: InvestigationRecords;
  protected readonly fileResources = new ArtifactResourceScope();

  readonly resourceScope: RetainedResourceScope = {
    retain: (owner, resource) =>
      this.fileResources.retain({
        kind: "lease",
        resource,
        lease: { release: () => owner.close() },
      }),
    run: (operation) => this.fileResources.run(operation),
  };

  protected get hasPendingFileResources(): boolean {
    return this.fileResources.hasPending;
  }
  readonly #snapshot = new AnalysisSnapshotCache();
  #snapshotInvalidated = false;
  readonly #snapshotListeners = new Set<() => void | Promise<void>>();

  constructor(records: InvestigationRecords = new InvestigationRecords()) {
    this.#records = records;
  }

  /** Observe changes to the mutable current analysis snapshot resource. */
  onAnalysisSnapshotChanged(listener: () => void | Promise<void>): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  recordEvidence(
    evidence: Evidence,
  ): Result<"added" | "duplicate", EvidenceIntegrityError> {
    const recorded = this.#records.recordEvidence(evidence);
    if (recorded.ok && recorded.value === "added") this.#emitSnapshotChanged();
    return recorded;
  }

  hasEvidence(evidenceId: string): boolean {
    return this.#records.hasEvidence(evidenceId);
  }

  evidenceById(evidenceId: string): Evidence | undefined {
    return this.#records.evidenceById(evidenceId);
  }

  /** Borrow immutable investigation Evidence without copying a complete graph. */
  evidenceForAnalysis(evidenceId: string): Evidence | undefined {
    return this.#records.evidenceForAnalysis(evidenceId);
  }

  exportEvidenceBundle(): EvidenceBundle {
    return this.#records.exportEvidenceBundle();
  }

  /** Borrow the record owner's immutable bundle for read-only workflows. */
  immutableEvidenceBundle(): EvidenceBundle {
    return this.#records.immutableEvidenceBundle();
  }

  /** Read one snapshot while retaining failed descriptors under this session. */
  readAnalysisSnapshot(path: string, signal?: AbortSignal) {
    return readSnapshotFile(path, signal, this.fileResources);
  }

  /** Persist one provider-neutral snapshot under this session's resource owner. */
  writeAnalysisSnapshot(
    snapshot: AnalysisSnapshot,
    path: string,
    overwrite: boolean,
  ): Promise<
    Result<{ readonly path: string; readonly bytes: number }, AnalysisError>
  > {
    return writeSnapshotFile(snapshot, path, overwrite, this.fileResources);
  }

  /** Retry retained target reads and snapshot files at the owning session shutdown. */
  async closeFileResources(): Promise<Result<null, AnalysisError>> {
    try {
      await this.fileResources.retryCleanup();
      return ok(null);
    } catch (cause: unknown) {
      const observation = ArtifactReaderFailure.cleanupObservation(
        cause,
        "analysis session files",
      );
      const error = new ProviderCleanupError(
        "rea",
        observation.resources,
        { reason: observation.reason },
        { cause, operation: "close_binary" },
      );
      bindRegularFileCleanup(cause, error);
      return err(error);
    }
  }

  importEvidenceBundle(
    bundle: unknown,
  ): Result<
    EvidenceImportReceipt,
    EvidenceIntegrityError | AnalysisInputError
  > {
    const imported = this.#records.mergeEvidenceBundle(bundle);
    if (!imported.ok) return imported;
    this.#snapshot.refreshEvidenceMetadata(imported.value.replacements);
    if (imported.value.changed) this.#emitSnapshotChanged();
    return ok({
      recordsAdded: imported.value.recordsAdded,
      unknownsAdded: imported.value.unknownsAdded,
      totalRecords: this.#records.immutableEvidenceBundle().records.length,
    });
  }

  protected abstract activeAnalysisBinding(): ActiveAnalysisBinding | undefined;

  exportAnalysisSnapshot(): Result<AnalysisSnapshot, AnalysisError> {
    const active = this.activeAnalysisBinding();
    if (this.#snapshotInvalidated)
      return err(
        new EvidenceIntegrityError(
          "Analysis snapshots are unavailable because analysis metadata may have changed",
          {
            userMessage: `Analysis snapshots are unavailable because analysis metadata may have changed. ${SNAPSHOT_MUTATION_RECOVERY}`,
          },
        ),
      );
    const target = active?.target;
    const profile =
      active?.profile ?? active?.profilelessWorkflowProfile ?? undefined;
    if (target !== undefined && profile === undefined)
      return err(
        snapshotUnavailable(
          "The active target has no provider analysis profile for a snapshot.",
        ),
      );
    if (
      active?.profile === null &&
      (target === undefined ||
        profile === undefined ||
        !this.#snapshot.matches(target, profile) ||
        this.#snapshot.entries().length !== 0 ||
        !hasOnlyProfilelessNativeDispatchEntries(
          this.#snapshot.workflowEntries(),
          profile,
        ))
    )
      return err(
        snapshotUnavailable(
          "The active session does not have a supported snapshot binding with replayable workflow observations for this target.",
        ),
      );
    return this.#snapshot.export(
      target,
      profile,
      target === undefined
        ? this.#records.exportEvidenceBundle()
        : evidenceBundleForTarget(
            this.#records.exportEvidenceBundle(),
            target.sha256,
          ),
    );
  }

  importAnalysisSnapshot(
    snapshot: AnalysisSnapshot,
  ): Result<number, AnalysisError> {
    const active = this.activeAnalysisBinding();
    if (active !== undefined && this.#snapshotInvalidated)
      return err(
        new EvidenceIntegrityError(
          "Analysis snapshots cannot be imported because analysis metadata may have changed",
          {
            userMessage: `Analysis snapshots cannot be imported because analysis metadata may have changed. ${SNAPSHOT_MUTATION_RECOVERY}`,
          },
        ),
      );
    const profile = active?.profile ?? active?.profilelessWorkflowProfile;
    if (
      active?.profile === null &&
      (profile === undefined ||
        !isProfilelessNativeDispatchSnapshot(snapshot, active.target, profile))
    )
      return err(
        new AnalysisSnapshotMismatchError(
          "Analysis snapshot profile_mismatch: the snapshot is not bound to the active native dispatch reader",
        ),
      );
    const imported = this.#snapshot.import(
      snapshot,
      active === undefined
        ? undefined
        : profile === undefined
          ? undefined
          : { target: active.target, profile },
      (bundle) => {
        const imported = this.#records.mergeEvidenceBundle(bundle);
        if (!imported.ok) return imported;
        this.#snapshot.refreshEvidenceMetadata(imported.value.replacements);
        return ok(imported.value.recordsAdded);
      },
    );
    if (imported.ok) this.#emitSnapshotChanged();
    return imported;
  }

  protected matchesSnapshot(
    target: BinaryTarget,
    profile: AnalysisProfileCommitment | null,
  ): boolean {
    return this.#snapshot.matches(target, profile ?? undefined);
  }

  protected selectSnapshot(
    target: BinaryTarget,
    profile: AnalysisProfileCommitment,
  ): void {
    this.#snapshot.select(target, profile);
    this.#emitSnapshotChanged();
  }

  protected lookupSnapshot(
    target: BinaryTarget,
    profile: AnalysisProfileCommitment,
    operation: AnalysisOperation,
    parameters: Readonly<
      Record<string, import("../../domain/jsonValue.js").JsonValue>
    >,
  ): AnalysisExecution | undefined {
    if (this.#snapshotInvalidated) return undefined;
    return this.#snapshot.lookup(target, profile, operation, parameters);
  }

  protected recordSnapshot(
    input: Parameters<AnalysisSnapshotCache["record"]>[0],
  ): void {
    if (this.#snapshotInvalidated) return;
    this.#snapshot.record(input);
    this.#emitSnapshotChanged();
  }

  /** Retain one derived workflow result alongside its provider cache entries. */
  recordWorkflowSnapshot(
    input: WorkflowSnapshotRecordInput,
  ): Result<null, EvidenceIntegrityError> {
    const active = this.activeAnalysisBinding();
    if (active === undefined)
      return err(
        new EvidenceIntegrityError(
          "Workflow snapshot entries require an active concrete provider profile",
        ),
      );
    if (this.#snapshotInvalidated) return ok(null);
    const profile = active.profile ?? active.profilelessWorkflowProfile;
    if (
      profile === undefined ||
      !analysisProfilesEqual(profile, input.bindingProfile) ||
      !analysisProfilesEqual(
        input.execution.analysisProfile,
        workflowAnalysisProfile(profile, input.operation),
      ) ||
      (active.profile === null &&
        input.operation !== "inspect_native_dispatch_metadata")
    )
      return err(
        new EvidenceIntegrityError(
          "Workflow snapshot entry does not match the active reader profile",
        ),
      );
    try {
      this.#snapshot.recordWorkflow({
        target: active.target,
        profile,
        ...input,
      });
      this.#emitSnapshotChanged();
      return ok(null);
    } catch (cause: unknown) {
      return err(
        new EvidenceIntegrityError(
          cause instanceof Error
            ? cause.message
            : "Workflow snapshot entry validation failed",
          { cause },
        ),
      );
    }
  }

  protected invalidateSnapshot(): void {
    this.#snapshot.clear();
    this.#snapshotInvalidated = true;
    this.#emitSnapshotChanged();
  }

  protected resetSnapshotInvalidation(): void {
    if (!this.#snapshotInvalidated) return;
    this.#snapshot.clear();
    this.#snapshotInvalidated = false;
    this.#emitSnapshotChanged();
  }

  protected clearSnapshot(): void {
    this.#snapshot.clear();
    this.#emitSnapshotChanged();
  }

  protected clearSessionRecords(): void {
    this.#records.clear();
    this.#snapshot.clear();
    this.#snapshotInvalidated = false;
    this.#emitSnapshotChanged();
  }

  #emitSnapshotChanged(): void {
    for (const listener of this.#snapshotListeners) {
      try {
        const notification = listener();
        if (notification !== undefined)
          void notification.catch((cause: unknown) => {
            // best-effort cleanup: async observer notifications must not reject unhandled.
            void cause;
          });
      } catch (cause: unknown) {
        // External resource observers are best-effort; one callback must not
        // make a committed evidence mutation appear to fail.
        void cause;
      }
    }
  }

  recordUnknown(
    input: RecordUnknownInput,
  ): Result<ResidualUnknown, AnalysisError> {
    const target = this.activeAnalysisBinding()?.target;
    const recorded = this.#records.recordUnknown(input, target);
    if (recorded.ok) this.#emitSnapshotChanged();
    return recorded;
  }

  recordEvidenceWithUnknown(
    evidence: Evidence,
    input: RecordUnknownInput,
  ): Result<ResidualUnknown | null, AnalysisError> {
    const recorded = this.#records.recordEvidenceWithUnknown(evidence, input);
    if (recorded.ok) this.#emitSnapshotChanged();
    return recorded;
  }

  updateUnknown(
    input: UpdateUnknownInput,
  ): Result<ResidualUnknown, AnalysisError> {
    const target = this.activeAnalysisBinding()?.target;
    const updated = this.#records.updateUnknown(input, target);
    if (updated.ok) this.#emitSnapshotChanged();
    return updated;
  }

  listUnknowns(
    filters: {
      readonly status?: UnknownStatus;
      readonly severity?: ResidualUnknown["severity"];
      readonly domain?: string;
    } = {},
  ): ResidualUnknown[] {
    return this.#records.listUnknowns(filters);
  }

  listUnknownsPage(query: UnknownQuery = {}): UnknownPage {
    return this.#records.listUnknownsPage(query);
  }

  verifyUnknownResolution(unknownId: string): Result<
    {
      readonly valid: boolean;
      readonly truthVerified: boolean;
      readonly unknown: ResidualUnknown;
    },
    UnknownRegistryError
  > {
    return this.#records.verifyUnknownResolution(unknownId);
  }
}
