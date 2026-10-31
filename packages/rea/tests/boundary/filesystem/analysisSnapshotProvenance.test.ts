import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";

import { readAnalysisSnapshot } from "../../../src/application/binary/AnalysisSnapshotFiles.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { MANAGED_STATIC_PROVIDER } from "../../../src/domain/investigationProviders.js";
import { ok } from "../../../src/domain/result.js";
import { ManagedStaticProvider } from "../../../src/dotnet/ManagedStaticProvider.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("keeps real provider replay and persisted Evidence independent of caller edits", async () => {
  const directory = await createTestTempDirectory(
    "rea-snapshot-result-ownership-",
  );
  const path = join(directory, "application.exe");
  await writeFile(path, buildManagedPeFixture());
  const provider = new ManagedStaticProvider();
  const profile = createAnalysisProfile(MANAGED_STATIC_PROVIDER, {
    fixture: "snapshot-result-ownership",
  });
  const session = createTestBinarySession(provider, {
    resolveAnalysisProfile: () => Promise.resolve(ok({ profile })),
  });
  onTestFinished(async () => {
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  const opened = await session.open(path);
  if (!opened.ok) throw opened.error;
  const observed = await session.execute("inspect_managed_artifact", {});
  if (!observed.ok) throw observed.error;
  const expected = structuredClone(observed.value.result);
  if (observed.value.evidenceId === undefined)
    throw new Error("Real managed observation has no Evidence identity");
  const historical = session.evidenceById(observed.value.evidenceId);
  if (historical === undefined) throw new Error("Observation was not retained");
  if (
    observed.value.result === null ||
    typeof observed.value.result !== "object"
  )
    throw new Error("Expected a structured managed artifact result");
  Reflect.set(observed.value.result, "caller_edit", "must not enter replay");

  const replayed = await session.execute("inspect_managed_artifact", {});
  if (!replayed.ok) throw replayed.error;
  expect(replayed.value.evidenceId).toBe(observed.value.evidenceId);
  expect(replayed.value.result).toEqual(expected);
  expect(session.evidenceById(observed.value.evidenceId)).toEqual(historical);
  const snapshot = session.exportAnalysisSnapshot();
  if (!snapshot.ok) throw snapshot.error;
  const snapshotPath = join(directory, "analysis.json");
  const written = await session.writeAnalysisSnapshot(
    snapshot.value,
    snapshotPath,
    false,
  );
  if (!written.ok) throw written.error;
  const restored = await readAnalysisSnapshot(snapshotPath);
  if (!restored.ok) throw restored.error;
  expect(restored.value.entries[0]?.execution.result).toEqual(expected);
  expect(restored.value.evidence_bundle.records).toContainEqual(historical);
});

it("reruns ambiguous imported observations without changing their historical Evidence", async () => {
  const directory = await createTestTempDirectory("rea-snapshot-provenance-");
  const path = join(directory, "application.exe");
  const originalPath = join(directory, "original.json");
  const ambiguousPath = join(directory, "ambiguous.json");
  const bytes = buildManagedPeFixture();
  const changedBytes = buildManagedPeFixture({ methodName: "Changed" });
  await writeFile(path, bytes);

  const provider = new ManagedStaticProvider();
  // Select a concrete profile for the real static reader at the session boundary.
  // Production managed composition normally uses it as a profileless auxiliary.
  const profile = createAnalysisProfile(MANAGED_STATIC_PROVIDER, {
    fixture: "snapshot-provenance",
  });
  const session = createTestBinarySession(provider, {
    resolveAnalysisProfile: () => Promise.resolve(ok({ profile })),
  });
  onTestFinished(async () => {
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  const opened = await session.open(path);
  if (!opened.ok) throw opened.error;
  const observed = await session.execute("inspect_managed_artifact", {});
  if (!observed.ok) throw observed.error;
  const members = await session.execute("inspect_managed_members", {});
  if (!members.ok) throw members.error;
  if (
    observed.value.evidenceId === undefined ||
    members.value.evidenceId === undefined
  )
    throw new Error("Real managed observations have no Evidence identity");
  const original = session.evidenceById(observed.value.evidenceId);
  const source = session.evidenceById(members.value.evidenceId);
  if (original === undefined || source === undefined)
    throw new Error("Real managed observations were not retained");
  const saved = session.exportAnalysisSnapshot();
  if (!saved.ok) throw saved.error;
  const written = await session.writeAnalysisSnapshot(
    saved.value,
    originalPath,
    false,
  );
  if (!written.ok) throw written.error;

  // Evidence import admits a second authenticated observation of the same facts
  // with different upstream provenance. Neither ID identifies the cache entry alone.
  const alternative = createEvidence(opened.value, provider.identity(), {
    operation: original.operation,
    parameters: original.parameters,
    result: original.normalized_result,
    rawResult: original.raw_result,
    analysisProfile: profile,
    limitations: original.limitations,
    locations: original.locations,
    evidenceLinks: [source.evidence_id],
  });
  expect(alternative.evidence_id).not.toBe(original.evidence_id);
  const imported = session.importEvidenceBundle(
    createEvidenceBundle([source, alternative]),
  );
  if (!imported.ok) throw imported.error;
  const closed = await session.closeWithSnapshot(ambiguousPath, false);
  if (!closed.ok) throw closed.error;
  const originalSnapshot = await readAnalysisSnapshot(originalPath);
  const ambiguousSnapshot = await readAnalysisSnapshot(ambiguousPath);
  if (!originalSnapshot.ok) throw originalSnapshot.error;
  if (!ambiguousSnapshot.ok) throw ambiguousSnapshot.error;
  const historicalBytes = await readFile(ambiguousPath);
  const historicalEvidence = ambiguousSnapshot.value.evidence_bundle;

  // An unambiguous recorded snapshot remains immutable: replay does not promise
  // to re-read bytes after open admitted the selected target.
  const control = await session.open(path, {
    snapshot: originalSnapshot.value,
  });
  if (!control.ok) throw control.error;
  await writeFile(path, changedBytes);
  const replayed = await session.execute("inspect_managed_artifact", {});
  if (!replayed.ok) throw replayed.error;
  expect(replayed.value.result).toEqual(observed.value.result);
  expect(replayed.value.limitations).toContain(
    "Loaded from a local REA analysis snapshot; this call did not re-run the provider.",
  );
  const controlClosed = await session.close();
  if (!controlClosed.ok) throw controlClosed.error;

  await writeFile(path, bytes);
  const reopened = await session.open(path, {
    snapshot: ambiguousSnapshot.value,
  });
  if (!reopened.ok) throw reopened.error;
  await writeFile(path, changedBytes);
  const ambiguous = await session.execute("inspect_managed_artifact", {});
  expect(ambiguous).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisArtifactChangedError",
      operation: "inspect_managed_artifact",
    },
  });
  expect(session.exportEvidenceBundle()).toEqual(historicalEvidence);
  expect((await readFile(ambiguousPath)).equals(historicalBytes)).toBe(true);

  // Once fresh source bytes are available again, the real reader can observe
  // them while the imported records and their upstream links remain retained.
  await writeFile(path, bytes);
  const fresh = await session.execute("inspect_managed_artifact", {});
  if (!fresh.ok) throw fresh.error;
  expect(fresh.value.result).toEqual(observed.value.result);
  expect(fresh.value.limitations).not.toContain(
    "Loaded from a local REA analysis snapshot; this call did not re-run the provider.",
  );
  expect(session.evidenceById(original.evidence_id)).toEqual(original);
  expect(session.evidenceById(alternative.evidence_id)).toEqual(alternative);
  expect((await readFile(ambiguousPath)).equals(historicalBytes)).toBe(true);
});
