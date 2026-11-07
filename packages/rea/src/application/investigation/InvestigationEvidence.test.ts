import { expect, it } from "vitest";

import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { createEvidenceBundle } from "../../domain/evidenceBundle.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { analysisErrorProjectionSchema } from "../../contracts/errorSchemas.js";
import { InvestigationRecords } from "./InvestigationRecords.js";
import { resolveInvestigationEvidenceClosure } from "./InvestigationEvidence.js";

const observation = (path: string, links: readonly string[] = []): Evidence =>
  createEvidence(
    { path, sha256: "a".repeat(64), format: "elf" },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "observe",
      parameters: {},
      result: { value: "observed" },
      evidenceLinks: [...links],
    },
  );

it("reads current immutable metadata while preserving earlier snapshots", () => {
  const records = new InvestigationRecords();
  const first = observation("/original");
  const added = records.recordEvidence(first);
  if (!added.ok) throw added.error;
  const lookup = records.evidenceForAnalysis.bind(records);
  const snapshot = records.immutableEvidenceBundle();
  const replacement = observation("/moved");
  expect(replacement.evidence_id).toBe(first.evidence_id);
  const merged = records.mergeEvidenceBundle(
    createEvidenceBundle([replacement]),
  );
  if (!merged.ok) throw merged.error;
  expect(merged.value.replacements).toEqual([
    { kind: "metadata", previous: first, current: replacement },
  ]);
  expect(lookup(first.evidence_id)?.subject?.local_path).toBe("/moved");
  expect(
    records.immutableEvidenceBundle().records[0]?.subject?.local_path,
  ).toBe("/moved");
  expect(snapshot.records[0]?.subject?.local_path).toBe("/original");
  expect(Object.isFrozen(snapshot.records[0]?.subject)).toBe(true);
  records.clear();
  expect(lookup(first.evidence_id)).toBeUndefined();
  expect(records.immutableEvidenceBundle().records).toEqual([]);
  expect(snapshot.records).toHaveLength(1);
});

it("keeps a selected transitive closure distinct from unrelated records and rejects a missing dependency", () => {
  const records = new InvestigationRecords();
  const leaf = observation("/leaf");
  const middle = observation("/middle", [leaf.evidence_id]);
  const root = observation("/root", [middle.evidence_id, leaf.evidence_id]);
  const unrelated = observation("/unrelated", [root.evidence_id]);
  for (const record of [leaf, middle, root, unrelated]) {
    const added = records.recordEvidence(record);
    if (!added.ok) throw added.error;
  }
  expect(
    resolveInvestigationEvidenceClosure(records, [root.evidence_id]),
  ).toEqual({
    ok: true,
    value: [leaf.evidence_id, middle.evidence_id, root.evidence_id].sort(),
  });
  records.clear();
  const added = records.recordEvidence(root);
  if (!added.ok) throw added.error;
  const missing = resolveInvestigationEvidenceClosure(records, [
    root.evidence_id,
  ]);
  expect(missing).toMatchObject({
    ok: false,
    error: {
      _tag: "EvidenceIntegrityError",
      reason: "missing",
      referenceScope: "retained-closure",
    },
  });
  if (missing.ok) throw new Error("missing source closure was resolved");
  const projected = projectAnalysisError(missing.error);
  expect(projected).toMatchObject({
    details: {
      evidence_id: leaf.evidence_id,
      reference_scope: "retained-closure",
      reason: "missing",
    },
  });
  expect(projected.message).toContain(leaf.evidence_id);
  expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
});

it("rejects a lookup that returns another semantic Evidence identity", () => {
  const record = observation("/source");
  const selectedId = `ev_${"0".repeat(64)}`;
  expect(
    resolveInvestigationEvidenceClosure({ evidenceForAnalysis: () => record }, [
      selectedId,
    ]),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "EvidenceIntegrityError",
      reason: "identity_mismatch",
      evidenceId: selectedId,
      actual: record.evidence_id,
      referenceScope: undefined,
    },
  });
});
