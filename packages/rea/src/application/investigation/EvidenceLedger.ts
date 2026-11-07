import { InvalidResidualUnknownGraphError } from "../../domain/residualUnknownGraphError.js";
import canonicalize from "canonicalize";
import { z } from "zod";

import {
  createEvidenceBundle,
  createImmutableEvidenceBundle,
  safeParseImmutableEvidenceBundle,
  validateResidualUnknownAddition,
  type EvidenceBundle,
} from "../../domain/evidenceBundle.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import { UnknownRegistryError } from "../../domain/unknownRegistryError.js";
import {
  evidenceSemanticContent,
  type Evidence,
} from "../../domain/evidence.js";
import { safeParseImmutableEvidence } from "../../domain/evidenceValidation.js";
import {
  createResidualUnknown,
  updateResidualUnknown,
  type RecordUnknownInput,
  type ResidualUnknown,
  type UnknownStatus,
  type UpdateUnknownInput,
} from "../../domain/residualUnknown.js";
import { err, ok, type Result } from "../../domain/result.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";
import type { UnknownPage, UnknownQuery } from "./InvestigationRecordPort.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";

type EvidenceLedgerFailure = EvidenceIntegrityError;
type RecordResult = Result<"added" | "duplicate", EvidenceLedgerFailure>;

/** Same authenticated semantic identity with new local display/request metadata. */
export interface EvidenceMetadataReplacement {
  readonly kind: "metadata";
  readonly previous: Evidence;
  readonly current: Evidence;
}

/** Committed changes made by one atomic bundle import. */
export interface EvidenceImportDelta {
  readonly recordsAdded: number;
  readonly unknownsAdded: number;
  readonly changed: boolean;
  readonly replacements: readonly EvidenceMetadataReplacement[];
}

type ImportResult = Result<
  EvidenceImportDelta,
  EvidenceLedgerFailure | AnalysisInputError
>;

/** Session-owned set of immutable evidence records. */
export class EvidenceLedger {
  #records = new Map<string, Evidence>();
  #unknownRevisions = new Map<string, ResidualUnknown>();
  #unknownHeads = new Map<string, ResidualUnknown>();
  /** Record evidence idempotently; conflicting content is rejected. */
  record(input: Evidence): RecordResult {
    const authenticated = readLedgerEvidence(
      input,
      "Evidence record validation failed",
    );
    if (!authenticated.ok) return authenticated;
    const evidence = authenticated.value;
    const existing = this.#records.get(evidence.evidence_id);
    if (existing !== undefined) {
      // A borrowed record is already authenticated and deeply immutable. Its
      // identity cannot change between reads, so comparing document-sized
      // canonical strings again would add no integrity check.
      if (existing === evidence) return ok("duplicate");
      return recordsAgree(existing, evidence)
        ? ok("duplicate")
        : err(new EvidenceIntegrityError("Conflicting evidence record"));
    }
    this.#records.set(evidence.evidence_id, evidence);
    return ok("added");
  }

  /** Validate an entire bundle before atomically merging its records. */
  import(input: unknown): ImportResult {
    const parsed = safeParseImmutableEvidenceBundle(input);
    if (!parsed.ok) {
      const { kind, message, cause } = parsed.error;
      if (kind === "single-record")
        return err(
          new AnalysisInputError("import_evidence_bundle", {
            cause,
            userMessage: message,
          }),
        );
      return err(
        new EvidenceIntegrityError("Evidence bundle validation failed", {
          cause,
          userMessage: message,
        }),
      );
    }
    const bundle = parsed.value;
    // Stage record conflicts and display metadata once, before either commit
    // path. Unknown history additionally requires validating the merged graph.
    const recordChanges = new Map<string, Evidence>();
    let recordsAdded = 0;
    const replacements: EvidenceMetadataReplacement[] = [];
    for (const evidence of bundle.records) {
      const existing = this.#records.get(evidence.evidence_id);
      if (existing === undefined) {
        recordChanges.set(evidence.evidence_id, evidence);
        recordsAdded += 1;
        continue;
      }
      if (!recordsAgree(existing, evidence))
        return err(new EvidenceIntegrityError("Conflicting evidence record"));
      if (!displayMetadataAgree(existing, evidence)) {
        recordChanges.set(evidence.evidence_id, evidence);
        replacements.push({
          kind: "metadata",
          previous: existing,
          current: evidence,
        });
      }
    }
    // A record-only bundle cannot change the already-valid unknown graph.
    if (bundle.unknowns.length === 0) {
      for (const evidence of recordChanges.values())
        this.#records.set(evidence.evidence_id, evidence);
      return ok({
        recordsAdded,
        unknownsAdded: 0,
        changed: recordChanges.size > 0,
        replacements,
      });
    }
    const pending = new Map(this.#records);
    for (const evidence of recordChanges.values())
      pending.set(evidence.evidence_id, evidence);
    const pendingUnknowns = new Map(this.#unknownRevisions);
    let unknownsAdded = 0;
    for (const unknown of bundle.unknowns) {
      const key = unknownRevisionKey(unknown);
      const existing = pendingUnknowns.get(key);
      if (
        existing !== undefined &&
        existing.revision_digest !== unknown.revision_digest
      )
        return err(
          new EvidenceIntegrityError("Conflicting unknown revision", {
            userMessage:
              "The incoming residual-unknown history conflicts with a revision retained in this session. Inspect each history in a separate session; importing the unchanged bundle into this session cannot reconcile them.",
            diagnostics: {
              unknown_id: unknown.unknown_id,
              revision: unknown.revision,
            },
          }),
        );
      pendingUnknowns.set(key, unknown);
      if (existing === undefined) unknownsAdded += 1;
    }
    const checked = this.#validateCandidate(pending, pendingUnknowns);
    if (!checked.ok) {
      return err(
        new EvidenceIntegrityError("Evidence bundle unknown registry failed", {
          cause: checked.error,
        }),
      );
    }
    this.#commit(checked.value);
    return ok({
      recordsAdded,
      unknownsAdded,
      changed: recordChanges.size > 0 || unknownsAdded > 0,
      replacements,
    });
  }

  /** Export records in deterministic, semantically irrelevant ID order. */
  export(): EvidenceBundle {
    return structuredClone(
      createEvidenceBundle(
        [...this.#records.values()],
        [...this.#unknownRevisions.values()],
      ),
    );
  }

  /** Borrow an authenticated immutable bundle without copying its records. */
  immutableBundle(): EvidenceBundle {
    return createImmutableEvidenceBundle(
      [...this.#records.values()],
      [...this.#unknownRevisions.values()],
    );
  }

  /** Borrow immutable source records without constructing or hashing a bundle. */
  recordsForAnalysis(): readonly Evidence[] {
    return [...this.#records.values()];
  }

  /** Check whether one immutable Evidence ID is present in this ledger. */
  has(evidenceId: string): boolean {
    return this.#records.has(evidenceId);
  }

  /** Return a detached immutable Evidence value by semantic ID. */
  get(evidenceId: string): Evidence | undefined {
    const evidence = this.#records.get(evidenceId);
    return evidence === undefined ? undefined : structuredClone(evidence);
  }

  /** Borrow authenticated immutable Evidence for read-only analysis without a full clone. */
  forAnalysis(evidenceId: string): Evidence | undefined {
    return this.#records.get(evidenceId);
  }

  /** Create one approved unknown and atomically append its mutation evidence. */
  recordUnknown(
    input: RecordUnknownInput,
    mutationEvidence: Evidence,
  ): Result<
    ResidualUnknown,
    EvidenceIntegrityError | UnknownRegistryError | AnalysisInputError
  > {
    const authenticated = readLedgerEvidence(
      mutationEvidence,
      "Unknown mutation evidence is invalid",
    );
    if (!authenticated.ok) return authenticated;
    const parsedMutation = authenticated.value;
    let unknown: ResidualUnknown;
    try {
      unknown = createResidualUnknown(
        input,
        parsedMutation.evidence_id,
        parsedMutation.subject?.digest.sha256 ?? null,
      );
    } catch (cause: unknown) {
      if (!(cause instanceof z.ZodError)) throw cause;
      return err(
        analysisInputErrorFromIssues("record_unknown", cause.issues, input, {
          cause,
        }),
      );
    }
    if (this.#unknownHeads.has(unknown.unknown_id))
      return err(new UnknownRegistryError("already-exists"));
    return this.#appendUnknown(unknown, parsedMutation);
  }

  /** Atomically record derived Evidence and a linked residual unknown. */
  recordWithUnknown(
    evidenceInput: Evidence,
    input: RecordUnknownInput,
    mutationInput: Evidence,
  ): Result<
    ResidualUnknown | null,
    EvidenceIntegrityError | UnknownRegistryError
  > {
    const authenticatedEvidence = readLedgerEvidence(
      evidenceInput,
      "Atomic Evidence validation failed",
    );
    if (!authenticatedEvidence.ok) return authenticatedEvidence;
    const authenticatedMutation = readLedgerEvidence(
      mutationInput,
      "Atomic Evidence validation failed",
    );
    if (!authenticatedMutation.ok) return authenticatedMutation;
    const evidence = authenticatedEvidence.value;
    const mutation = authenticatedMutation.value;
    const existingEvidence = this.#records.get(evidence.evidence_id);
    if (
      existingEvidence !== undefined &&
      !recordsAgree(existingEvidence, evidence)
    )
      return err(new EvidenceIntegrityError("Conflicting evidence record"));
    let unknown: ResidualUnknown;
    try {
      unknown = createResidualUnknown(
        input,
        mutation.evidence_id,
        mutation.subject?.digest.sha256 ?? null,
      );
    } catch (cause: unknown) {
      if (!(cause instanceof z.ZodError)) throw cause;
      return err(new UnknownRegistryError("invalid-transition", { cause }));
    }
    const creationUnknown = this.#unknownRevisions.get(
      unknownRevisionKey(unknown),
    );
    if (creationUnknown !== undefined) {
      if (creationUnknown.revision_digest !== unknown.revision_digest)
        return err(new UnknownRegistryError("already-exists"));
      const checked = this.#appendIncremental([evidence]);
      if (!checked.ok) return checked;
      return ok(null);
    }
    const checked = this.#appendIncremental([evidence, mutation], unknown);
    if (!checked.ok) return checked;
    return ok(structuredClone(unknown));
  }

  /** Apply one approved full-state update using optimistic revision matching. */
  updateUnknown(
    input: UpdateUnknownInput,
    mutationEvidence: Evidence,
  ): Result<
    ResidualUnknown,
    EvidenceIntegrityError | UnknownRegistryError | AnalysisInputError
  > {
    const current = this.#unknownHeads.get(input.unknown_id);
    if (current === undefined)
      return err(new UnknownRegistryError("not-found"));
    if (current.revision !== input.expected_revision)
      return err(new UnknownRegistryError("revision-conflict"));
    let unknown: ResidualUnknown;
    try {
      unknown = updateResidualUnknown(
        current,
        input,
        mutationEvidence.evidence_id,
      );
    } catch (cause: unknown) {
      if (!(cause instanceof z.ZodError)) throw cause;
      return err(
        analysisInputErrorFromIssues("update_unknown", cause.issues, input, {
          cause,
        }),
      );
    }
    const authenticated = readLedgerEvidence(
      mutationEvidence,
      "Unknown mutation evidence is invalid",
    );
    if (!authenticated.ok) return authenticated;
    return this.#appendUnknown(unknown, authenticated.value);
  }

  /** Query current heads in stable ID order. */
  listUnknowns(
    filters: {
      readonly status?: UnknownStatus;
      readonly severity?: ResidualUnknown["severity"];
      readonly domain?: string;
    } = {},
  ): ResidualUnknown[] {
    return this.listUnknownsPage(filters).items;
  }

  /** Select a stable page of current heads before detaching record payloads. */
  listUnknownsPage(query: UnknownQuery = {}): UnknownPage {
    const offset = query.offset ?? 0;
    const matching = [...this.#unknownHeads.values()]
      .filter(
        (unknown) =>
          (query.status === undefined || unknown.status === query.status) &&
          (query.severity === undefined ||
            unknown.severity === query.severity) &&
          (query.domain === undefined || unknown.domain === query.domain),
      )
      .sort((left, right) =>
        compareUnicodeCodePoints(left.unknown_id, right.unknown_id),
      );
    const start = Math.min(offset, matching.length);
    const end =
      query.limit === undefined
        ? undefined
        : start + Math.min(query.limit, matching.length - start);
    const page = matching.slice(start, end);
    const nextOffset =
      offset <= matching.length && start + page.length < matching.length
        ? start + page.length
        : null;
    return {
      items: page.map((unknown) => structuredClone(unknown)),
      total: matching.length,
      offset,
      next_offset: nextOffset,
    };
  }

  /** Return current resolution validity; imported invalid states are rejected. */
  verifyUnknownResolution(unknownId: string): Result<
    {
      readonly valid: boolean;
      readonly truthVerified: boolean;
      readonly unknown: ResidualUnknown;
    },
    UnknownRegistryError
  > {
    const unknown = this.#unknownHeads.get(unknownId);
    if (unknown === undefined)
      return err(new UnknownRegistryError("not-found"));
    return ok({
      valid: unknown.status === "resolved",
      truthVerified: unknown.resolution?.disposition === "verified",
      unknown: structuredClone(unknown),
    });
  }

  /** Clear records when the owning session closes. */
  clear(): void {
    this.#records.clear();
    this.#unknownRevisions.clear();
    this.#unknownHeads.clear();
  }

  #appendUnknown(
    unknown: ResidualUnknown,
    mutationEvidence: Evidence,
  ): Result<ResidualUnknown, EvidenceIntegrityError | UnknownRegistryError> {
    const checked = this.#appendIncremental([mutationEvidence], unknown);
    if (!checked.ok) return checked;
    return ok(structuredClone(unknown));
  }

  /** Incoming records were authenticated and sealed at the ingestion boundary. */
  #appendIncremental(
    records: readonly Evidence[],
    unknown?: ResidualUnknown,
  ): Result<void, EvidenceIntegrityError | UnknownRegistryError> {
    const additions = new Map<string, Evidence>();
    for (const evidence of records) {
      const existing =
        additions.get(evidence.evidence_id) ??
        this.#records.get(evidence.evidence_id);
      if (existing !== undefined) {
        if (!recordsAgree(existing, evidence))
          return err(new EvidenceIntegrityError("Conflicting evidence record"));
        continue;
      }
      additions.set(evidence.evidence_id, evidence);
    }
    const unknownKey =
      unknown === undefined ? undefined : unknownRevisionKey(unknown);
    if (unknownKey !== undefined && this.#unknownRevisions.has(unknownKey))
      return err(new UnknownRegistryError("integrity"));
    if (unknown !== undefined)
      try {
        validateResidualUnknownAddition(
          unknown,
          {
            get: (id) => additions.get(id) ?? this.#records.get(id),
            has: (id) => additions.has(id) || this.#records.has(id),
          },
          this.#unknownHeads,
        );
      } catch (cause: unknown) {
        if (!(cause instanceof InvalidResidualUnknownGraphError)) throw cause;
        return err(new UnknownRegistryError(cause.constraint, { cause }));
      }
    for (const [id, evidence] of additions) this.#records.set(id, evidence);
    if (unknown !== undefined && unknownKey !== undefined) {
      this.#unknownRevisions.set(unknownKey, unknown);
      this.#unknownHeads.set(unknown.unknown_id, unknown);
    }
    return ok(undefined);
  }

  /** Return the sealed candidate facts that the commit will adopt. */
  #validateCandidate(
    records: ReadonlyMap<string, Evidence>,
    unknowns: ReadonlyMap<string, ResidualUnknown>,
  ): Result<EvidenceBundle, UnknownRegistryError> {
    try {
      return ok(
        createImmutableEvidenceBundle(
          [...records.values()],
          [...unknowns.values()],
        ),
      );
    } catch (cause: unknown) {
      if (
        !(cause instanceof z.ZodError) &&
        !(cause instanceof InvalidResidualUnknownGraphError)
      )
        throw cause;
      return err(
        new UnknownRegistryError(
          cause instanceof InvalidResidualUnknownGraphError
            ? cause.constraint
            : "integrity",
          { cause },
        ),
      );
    }
  }

  #commit(bundle: EvidenceBundle): void {
    const records = new Map(
      bundle.records.map((evidence) => [evidence.evidence_id, evidence]),
    );
    const unknownRevisions = new Map(
      bundle.unknowns.map((unknown) => [unknownRevisionKey(unknown), unknown]),
    );
    const unknownHeads = new Map<string, ResidualUnknown>();
    for (const unknown of bundle.unknowns) {
      const head = unknownHeads.get(unknown.unknown_id);
      if (head === undefined || head.revision < unknown.revision)
        unknownHeads.set(unknown.unknown_id, unknown);
    }
    this.#records = records;
    this.#unknownRevisions = unknownRevisions;
    this.#unknownHeads = unknownHeads;
  }
}

const readLedgerEvidence = (
  input: unknown,
  message: string,
): Result<Evidence, EvidenceIntegrityError> => {
  const checked = safeParseImmutableEvidence(input);
  return checked.ok
    ? checked
    : err(
        new EvidenceIntegrityError(message, {
          cause: checked.error,
        }),
      );
};

const unknownRevisionKey = (unknown: ResidualUnknown): string =>
  `${unknown.unknown_id}:${String(unknown.revision)}`;

const recordsAgree = (left: Evidence, right: Evidence): boolean =>
  canonicalize(evidenceSemanticContent(left)) ===
  canonicalize(evidenceSemanticContent(right));

const displayMetadataAgree = (left: Evidence, right: Evidence): boolean =>
  left.subject?.name === right.subject?.name &&
  left.subject?.local_path === right.subject?.local_path &&
  left.caller_input_path === right.caller_input_path;
