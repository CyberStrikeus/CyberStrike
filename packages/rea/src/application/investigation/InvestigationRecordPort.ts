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

/** Read-only investigation Evidence access without target execution or lifecycle authority. */
export interface EvidenceReader {
  hasEvidence(evidenceId: string): boolean;
  evidenceById(evidenceId: string): Evidence | undefined;
  /** Borrow an immutable authenticated record for read-only application workflows. */
  evidenceForAnalysis(evidenceId: string): Evidence | undefined;
  /** Borrow an immutable bundle snapshot for read-only workflows and serialization. */
  immutableEvidenceBundle(): EvidenceBundle;
  exportEvidenceBundle(): EvidenceBundle;
}

/** Idempotent investigation Evidence writes without target execution. */
export interface EvidenceWriter {
  recordEvidence(
    evidence: Evidence,
  ): Result<"added" | "duplicate", EvidenceIntegrityError>;
}

/** Atomic derived Evidence and linked Unknown writes. */
export interface EvidenceUnknownWriter {
  recordEvidenceWithUnknown(
    evidence: Evidence,
    input: RecordUnknownInput,
  ): Result<ResidualUnknown | null, AnalysisError>;
}

export type UnknownPage = {
  readonly items: ResidualUnknown[];
  readonly total: number;
  readonly offset: number;
  readonly next_offset: number | null;
};

export interface UnknownQuery {
  readonly status?: UnknownStatus;
  readonly severity?: ResidualUnknown["severity"];
  readonly domain?: string;
  readonly offset?: number;
  readonly limit?: number;
}

/** Optimistic Unknown revisions and consistency verification. */
export interface UnknownRegistryPort {
  recordUnknown(
    input: RecordUnknownInput,
  ): Result<ResidualUnknown, AnalysisError>;
  updateUnknown(
    input: UpdateUnknownInput,
  ): Result<ResidualUnknown, AnalysisError>;
  listUnknowns(filters?: {
    readonly status?: UnknownStatus;
    readonly severity?: ResidualUnknown["severity"];
    readonly domain?: string;
  }): ResidualUnknown[];
  listUnknownsPage(query?: UnknownQuery): UnknownPage;
  verifyUnknownResolution(unknownId: string): Result<
    {
      readonly valid: boolean;
      readonly truthVerified: boolean;
      readonly unknown: ResidualUnknown;
    },
    UnknownRegistryError
  >;
}

/** Counts from the committed merge, before adapter response projection. */
export interface EvidenceImportReceipt {
  readonly recordsAdded: number;
  readonly unknownsAdded: number;
  readonly totalRecords: number;
}

/** Investigation record surface; binary execution and snapshots remain separate. */
export interface InvestigationRecordPort
  extends
    EvidenceReader,
    EvidenceWriter,
    EvidenceUnknownWriter,
    UnknownRegistryPort {
  importEvidenceBundle(
    bundle: unknown,
  ): Result<EvidenceImportReceipt, EvidenceIntegrityError | AnalysisInputError>;
}
