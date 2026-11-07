import { expect, it, onTestFinished } from "vitest";

import { BinarySession } from "../../../src/application/binary/BinarySession.js";
import { InvestigationRecords } from "../../../src/application/investigation/InvestigationRecords.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { recordUnknownInputSchema } from "../../../src/domain/residualUnknown.js";
import {
  createBinarySessionTargets,
  createCacheProvider,
  createTestBinarySession,
  createTestProviderRouter,
} from "../../fixtures/binarySession.js";

const ownSession = (session: BinarySession): BinarySession => {
  onTestFinished(async () => {
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  return session;
};

const createSession = (
  records: InvestigationRecords = new InvestigationRecords(),
) =>
  ownSession(
    new BinarySession(
      createTestProviderRouter(createCacheProvider([])),
      records,
    ),
  );

it("uses the composed record owner and preserves best-effort post-commit notifications", async () => {
  const records = new InvestigationRecords();
  const session = createSession(records);
  const observed: number[] = [];
  const unsubscribe = session.onAnalysisSnapshotChanged(() => {
    observed.push(records.exportEvidenceBundle().records.length);
  });
  session.onAnalysisSnapshotChanged(() => {
    throw new Error("Synthetic observer failure");
  });
  session.onAnalysisSnapshotChanged(async () => {
    throw new Error("Synthetic async observer failure");
  });
  const evidence = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    { operation: "independent-app", parameters: {}, result: true },
  );
  expect(session.recordEvidence(evidence)).toEqual({
    ok: true,
    value: "added",
  });
  expect(records.evidenceById(evidence.evidence_id)).toEqual(evidence);
  expect(session.recordEvidence(evidence)).toEqual({
    ok: true,
    value: "duplicate",
  });
  expect(observed).toEqual([1]);
  expect((await session.close()).ok).toBe(true);
  expect(records.exportEvidenceBundle().records).toEqual([]);
  expect(session.exportAnalysisSnapshot()).toMatchObject({
    ok: false,
    error: { _tag: "NoBinaryOpenError" },
  });
  expect(observed).toEqual([1, 0]);
  unsubscribe();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

it("notifies after snapshot and Evidence import both commit, and rejects mismatched targets atomically", async () => {
  const [first, second] = await createBinarySessionTargets();
  const source = ownSession(createTestBinarySession(createCacheProvider([])));
  expect((await source.open(first)).ok).toBe(true);
  expect(
    (
      await source.execute("address_name", {
        address: "0x1000",
        document: "fixture",
      })
    ).ok,
  ).toBe(true);
  const exported = source.exportAnalysisSnapshot();
  if (!exported.ok) throw exported.error;
  expect(exported.value.entries.length).toBeGreaterThan(0);
  const recipient = createSession();
  expect((await recipient.open(first)).ok).toBe(true);
  const notifications: Array<{ entries: number; evidence: number }> = [];
  recipient.onAnalysisSnapshotChanged(() => {
    const snapshot = recipient.exportAnalysisSnapshot();
    if (!snapshot.ok) throw snapshot.error;
    notifications.push({
      entries: snapshot.value.entries.length,
      evidence: snapshot.value.evidence_bundle.records.length,
    });
  });
  expect(recipient.importAnalysisSnapshot(exported.value).ok).toBe(true);
  expect(notifications).toEqual([
    {
      entries: exported.value.entries.length,
      evidence: exported.value.evidence_bundle.records.length,
    },
  ]);
  const incompatible = createSession();
  expect((await incompatible.open(second)).ok).toBe(true);
  let mismatchNotifications = 0;
  incompatible.onAnalysisSnapshotChanged(() => {
    mismatchNotifications += 1;
  });
  const before = incompatible.exportEvidenceBundle();
  expect(incompatible.importAnalysisSnapshot(exported.value).ok).toBe(false);
  expect(incompatible.exportEvidenceBundle()).toEqual(before);
  expect(mismatchNotifications).toBe(0);
});

it("notifies an Unknown-only bundle change even when no new Evidence is added", () => {
  const source = createSession();
  expect(
    source.recordUnknown(
      recordUnknownInputSchema.parse({
        question: "Is this import complete?",
        severity: "medium",
        domain: "investigation",
        required_authority: "analyst-inference",
        required_confidence: "derived",
        required_environment: null,
        recommended_probes: [],
        relationships: [],
      }),
    ).ok,
  ).toBe(true);
  const bundle = source.exportEvidenceBundle();
  const recipient = createSession();
  expect(recipient.importEvidenceBundle({ ...bundle, unknowns: [] }).ok).toBe(
    true,
  );
  const revisions: number[] = [];
  recipient.onAnalysisSnapshotChanged(() => {
    revisions.push(recipient.listUnknowns().length);
  });
  expect(recipient.importEvidenceBundle(bundle)).toEqual({
    ok: true,
    value: {
      recordsAdded: 0,
      unknownsAdded: 1,
      totalRecords: bundle.records.length,
    },
  });
  expect(revisions).toEqual([1]);
  expect(recipient.importEvidenceBundle(bundle)).toEqual({
    ok: true,
    value: {
      recordsAdded: 0,
      unknownsAdded: 0,
      totalRecords: bundle.records.length,
    },
  });
  expect(revisions).toEqual([1]);
});
