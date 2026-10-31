import { resolveEvidenceInput } from "../EvidenceInputResolver.js";
import type { EvidenceReader } from "./InvestigationRecordPort.js";
import { uniqueSorted } from "../../domain/canonicalOrdering.js";
import type { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import type { Evidence } from "../../domain/evidence.js";
import { ok, type Result } from "../../domain/result.js";

/** Follow exact session references without exporting unrelated records or Unknowns. */
export const resolveInvestigationEvidenceClosure = (
  reader: Pick<EvidenceReader, "evidenceForAnalysis">,
  seedIds: readonly string[],
  sources: readonly Evidence[] = [],
): Result<string[], EvidenceIntegrityError> => {
  // Supplied authenticated records are part of this investigation too. A
  // portable inline source need not already have been inserted in the ledger.
  const supplied = new Map(
    sources.map((source) => [source.evidence_id, source]),
  );
  const lookup = (id: string) =>
    supplied.get(id) ?? reader.evidenceForAnalysis(id);
  const visited = new Set<string>();
  const pending = [...seedIds];
  while (pending.length > 0) {
    const evidenceId = pending.pop();
    if (evidenceId === undefined || visited.has(evidenceId)) continue;
    const evidence = resolveEvidenceInput(
      { kind: "retained-evidence", evidence_id: evidenceId },
      lookup,
      "retained-closure",
    );
    if (!evidence.ok) return evidence;
    visited.add(evidenceId);
    pending.push(...evidence.value.evidence_links);
  }
  return ok(uniqueSorted([...visited]));
};
