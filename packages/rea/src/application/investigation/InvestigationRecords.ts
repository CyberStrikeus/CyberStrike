import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import type { Evidence } from "../../domain/evidence.js";
import type { EvidenceBundle } from "../../domain/evidenceBundle.js";
import type { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import type { UnknownRegistryError } from "../../domain/unknownRegistryError.js";
import type {
  RecordUnknownInput,
  ResidualUnknown,
  UnknownStatus,
  UpdateUnknownInput,
} from "../../domain/residualUnknown.js";
import type { Result } from "../../domain/result.js";
import { EvidenceLedger, type EvidenceImportDelta } from "./EvidenceLedger.js";
import { unknownMutationEvidence } from "./UnknownEvidence.js";
import type {
  EvidenceReader,
  EvidenceWriter,
  EvidenceUnknownWriter,
  UnknownRegistryPort,
  UnknownPage,
  UnknownQuery,
} from "./InvestigationRecordPort.js";

/** One investigation's validated record owner, independent of binary execution. */
export class InvestigationRecords
  implements
    EvidenceReader,
    EvidenceWriter,
    EvidenceUnknownWriter,
    UnknownRegistryPort
{
  readonly #evidence = new EvidenceLedger();

  /** Record immutable Evidence idempotently; reject conflicting content. */
  recordEvidence(
    evidence: Evidence,
  ): Result<"added" | "duplicate", EvidenceIntegrityError> {
    return this.#evidence.record(evidence);
  }

  /** Check one semantic Evidence ID without exposing stored values. */
  hasEvidence(evidenceId: string): boolean {
    return this.#evidence.has(evidenceId);
  }

  /** Return a detached Evidence value for one semantic ID. */
  evidenceById(evidenceId: string): Evidence | undefined {
    return this.#evidence.get(evidenceId);
  }

  /** Borrow an immutable authenticated record for a read-only application workflow. */
  evidenceForAnalysis(evidenceId: string): Evidence | undefined {
    return this.#evidence.forAnalysis(evidenceId);
  }

  /** Export a detached deterministic bundle of Evidence and Unknown revisions. */
  exportEvidenceBundle(): EvidenceBundle {
    return this.#evidence.export();
  }

  /** Borrow an authenticated immutable bundle snapshot without copying its records. */
  immutableEvidenceBundle(): EvidenceBundle {
    return this.#evidence.immutableBundle();
  }

  /** Atomically merge a bundle and report changes for the owner's post-commit observers. */
  mergeEvidenceBundle(
    bundle: unknown,
  ): Result<EvidenceImportDelta, EvidenceIntegrityError | AnalysisInputError> {
    return this.#evidence.import(bundle);
  }

  /** Clear records when the owning runtime applies its existing lifecycle policy. */
  clear(): void {
    this.#evidence.clear();
  }

  /** Record an Unknown with an explicitly supplied Evidence subject, if any. */
  recordUnknown(
    input: RecordUnknownInput,
    target?: BinaryTarget,
  ): Result<ResidualUnknown, AnalysisError> {
    return this.#evidence.recordUnknown(
      input,
      unknownMutationEvidence(target, { operation: "record_unknown", input }),
    );
  }

  /** Commit derived Evidence and its Unknown atomically without an implicit subject. */
  recordEvidenceWithUnknown(
    evidence: Evidence,
    input: RecordUnknownInput,
  ): Result<ResidualUnknown | null, AnalysisError> {
    return this.#evidence.recordWithUnknown(
      evidence,
      input,
      unknownMutationEvidence(undefined, {
        operation: "record_unknown",
        input,
      }),
    );
  }

  /** Update an optimistic revision with an explicitly supplied Evidence subject. */
  updateUnknown(
    input: UpdateUnknownInput,
    target?: BinaryTarget,
  ): Result<ResidualUnknown, AnalysisError> {
    const evidence = unknownMutationEvidence(target, {
      operation: "update_unknown",
      input,
    });
    return this.#evidence.updateUnknown(input, evidence);
  }

  /** Return detached current Unknown revisions matching the selected filters. */
  listUnknowns(
    filters: {
      readonly status?: UnknownStatus;
      readonly severity?: ResidualUnknown["severity"];
      readonly domain?: string;
    } = {},
  ): ResidualUnknown[] {
    return this.#evidence.listUnknowns(filters);
  }

  listUnknownsPage(query: UnknownQuery = {}): UnknownPage {
    return this.#evidence.listUnknownsPage(query);
  }

  /** Verify registry consistency without asserting the answer is true. */
  verifyUnknownResolution(unknownId: string): Result<
    {
      readonly valid: boolean;
      readonly truthVerified: boolean;
      readonly unknown: ResidualUnknown;
    },
    UnknownRegistryError
  > {
    return this.#evidence.verifyUnknownResolution(unknownId);
  }
}
