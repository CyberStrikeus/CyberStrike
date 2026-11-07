import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { executeComposedWorkflow } from "../../../src/application/WorkflowEvidence.js";
import { parseAnalysisSnapshot } from "../../../src/domain/analysisSnapshot.js";
import { ok } from "../../../src/domain/result.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { expect, it } from "vitest";
import { runDirectAnalysis } from "../../../src/application/DirectAnalysis.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { composedWorkflowFixture } from "../../fixtures/composedWorkflowEvidence.js";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";

it.each([0, 1, 12])(
  "does not replay an arbitrary historical workflow provenance when the snapshot binding is ambiguous (%i procedures)",
  async (procedureCount) => {
    const original = await composedWorkflowFixture();
    original.summary.procedure_count = procedureCount;
    const target = await original.open();
    const snapshotPath = join(dirname(original.path), "analysis.json");
    const current = parseEvidence(
      await runDirectAnalysis(
        original.dependencies,
        original.path,
        "binary_overview",
        {},
        { snapshotPath },
      ).then(projectCliAnalysisResult),
    );
    expect(current.evidence_links).toHaveLength(1);
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(await readFile(snapshotPath, "utf8")),
    );
    const uniqueReplay = await composedWorkflowFixture();
    expect(uniqueReplay.session.importAnalysisSnapshot(snapshot).ok).toBe(true);
    expect(uniqueReplay.session.importAnalysisSnapshot(snapshot)).toEqual(
      ok(0),
    );
    const unique = parseEvidence(
      await runDirectAnalysis(
        uniqueReplay.dependencies,
        original.path,
        "binary_overview",
        {},
        { snapshotPath },
      ).then(projectCliAnalysisResult),
    );
    expect(unique.evidence_id).toBe(current.evidence_id);
    expect(unique.evidence_links).toEqual(current.evidence_links);
    expect(uniqueReplay.calls).toEqual([]);
    // Earlier composed observations did not carry links. Both are authentic,
    // but the serialized replay binding does not identify which provenance won.
    const historical = createEvidence(target, current.provider, {
      operation: current.operation,
      parameters: current.parameters,
      result: current.normalized_result,
      rawResult: current.raw_result,
      analysisProfile: current.analysis_profile!,
      confidence: "derived",
      limitations: current.limitations,
    });
    expect(historical.evidence_links).toEqual([]);
    expect(historical.evidence_id).not.toBe(current.evidence_id);
    const ambiguous = parseAnalysisSnapshot({
      ...snapshot,
      evidence_bundle: createEvidenceBundle([
        ...snapshot.evidence_bundle.records,
        historical,
      ]),
    });
    expect(ambiguous.workflow_entries).toEqual(snapshot.workflow_entries);
    await writeFile(snapshotPath, JSON.stringify(ambiguous));
    const replay = await composedWorkflowFixture();
    const delivered = parseEvidence(
      await runDirectAnalysis(
        replay.dependencies,
        original.path,
        "binary_overview",
        {},
        { snapshotPath },
      ).then(projectCliAnalysisResult),
    );
    expect(delivered.normalized_result).toEqual(current.normalized_result);
    expect([current.evidence_id, historical.evidence_id]).not.toContain(
      delivered.evidence_id,
    );
    expect(delivered.evidence_links).toEqual(current.evidence_links);
    expect(
      delivered.limitations.some((limitation) =>
        limitation.includes("this call did not re-run the provider"),
      ),
    ).toBe(true);
    expect(replay.calls).toEqual([]);
    const refreshedReplay = await composedWorkflowFixture();
    const refreshed = parseEvidence(
      await runDirectAnalysis(
        refreshedReplay.dependencies,
        original.path,
        "binary_overview",
        {},
        { snapshotPath },
      ).then(projectCliAnalysisResult),
    );
    expect(refreshed.evidence_id).toBe(delivered.evidence_id);
    expect(refreshed.evidence_links).toEqual(delivered.evidence_links);
    expect(refreshedReplay.calls).toEqual([]);
  },
);

it.each([false, true])(
  "links a profiled binary overview only to the atomic record it consumed (cached=%s)",
  async (warmCache) => {
    const fixture = await composedWorkflowFixture();
    const { path, summary, calls, session } = fixture;
    const createSession = async () => {
      const opened = await session.open(path);
      if (!opened.ok) throw opened.error;
      const unrelated = await session.execute("address_name", {
        document: "fixture",
        address: "0x2000",
      });
      if (!unrelated.ok) throw unrelated.error;
      if (warmCache) {
        const warmed = await session.execute(
          "read_binary_inventory_summary",
          {},
        );
        if (!warmed.ok) throw warmed.error;
      }
      return session;
    };
    const dependencies = {
      ...fixture.dependencies,
      createBinarySession: createSession,
    };
    try {
      const evidence = parseEvidence(
        await runDirectAnalysis(dependencies, path, "binary_overview", {}).then(
          projectCliAnalysisResult,
        ),
      );
      expect(evidence.normalized_result).toEqual(summary);
      expect(evidence.confidence).toBe("derived");
      const records = fixture.closedRecords();
      const atomic = records.filter(
        (record) => record.operation === "read_binary_inventory_summary",
      );
      const unrelated = records.filter(
        (record) => record.operation === "address_name",
      );
      expect(atomic).toHaveLength(1);
      expect(unrelated).toHaveLength(1);
      expect(atomic[0]?.normalized_result).toEqual(summary);
      expect(
        calls.filter(
          (operation) => operation === "read_binary_inventory_summary",
        ),
      ).toHaveLength(1);
      // These are real, already committed ledger IDs, not hashes fabricated by
      // the workflow and not a before/after scan used to infer consumption.
      expect(evidence.evidence_links).toEqual(
        atomic.map((record) => record.evidence_id),
      );
      expect(evidence.evidence_links).not.toContain(unrelated[0]?.evidence_id);
    } finally {
      expect((await session.close()).ok).toBe(true);
    }
  },
);

it("deduplicates repeated and nested consumed records without linking unrelated concurrent work", async () => {
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const fixture = await composedWorkflowFixture({
    beforeSummary: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  await fixture.open();
  const overview = executeComposedWorkflow(
    fixture.session,
    async (observed) => {
      const first = await observed.execute("read_binary_inventory_summary", {});
      if (!first.ok) return first;
      const nested = await executeComposedWorkflow(observed, async (inner) => {
        const repeated = await inner.execute(
          "read_binary_inventory_summary",
          {},
        );
        return repeated.ok ? ok(repeated.value.result) : repeated;
      });
      return nested.ok ? ok(nested.value.result) : nested;
    },
  );
  await entered.promise;
  try {
    const other = await executeComposedWorkflow(
      fixture.session,
      async (observed) => {
        const execution = await observed.execute("address_name", {
          address: "0x2000",
          document: "fixture",
        });
        return execution.ok ? ok(execution.value.result) : execution;
      },
    );
    if (!other.ok) throw other.error;
    release.resolve();
    const result = await overview;
    if (!result.ok) throw result.error;
    const atomic = fixture.session
      .exportEvidenceBundle()
      .records.find(
        (record) => record.operation === "read_binary_inventory_summary",
      );
    const unrelated = fixture.session
      .exportEvidenceBundle()
      .records.find((record) => record.operation === "address_name");
    expect(atomic).toBeDefined();
    expect(unrelated).toBeDefined();
    expect(result.value.evidenceLinks).toEqual([atomic?.evidence_id]);
    expect(other.value.evidenceLinks).toEqual([unrelated?.evidence_id]);
    expect(
      fixture.calls.filter(
        (operation) => operation === "read_binary_inventory_summary",
      ),
    ).toHaveLength(1);
  } finally {
    release.resolve();
    await overview;
  }
});

it("rehydrates the original atomic identity from an authenticated snapshot without rerunning the provider", async () => {
  const original = await composedWorkflowFixture();
  await original.open();
  const executed = await original.session.execute(
    "read_binary_inventory_summary",
    {},
  );
  if (!executed.ok) throw executed.error;
  const exported = original.session.exportAnalysisSnapshot();
  if (!exported.ok) throw exported.error;
  const snapshot = parseAnalysisSnapshot(
    JSON.parse(JSON.stringify(exported.value)),
  );
  const atomic = snapshot.evidence_bundle.records.find(
    (record) => record.operation === "read_binary_inventory_summary",
  );
  expect(executed.value.evidenceId).toBe(atomic?.evidence_id);
  const replay = await composedWorkflowFixture();
  expect(replay.session.importAnalysisSnapshot(snapshot).ok).toBe(true);
  await replay.open();
  const composed = await executeComposedWorkflow(
    replay.session,
    async (observed) => {
      const execution = await observed.execute(
        "read_binary_inventory_summary",
        {},
      );
      if (!execution.ok) return execution;
      expect(execution.value.limitations).toContain(
        "Loaded from a local REA analysis snapshot; this call did not re-run the provider.",
      );
      return ok(execution.value.result);
    },
  );
  if (!composed.ok) throw composed.error;
  expect(composed.value.evidenceLinks).toEqual([atomic?.evidence_id]);
  expect(replay.calls).not.toContain("read_binary_inventory_summary");
  expect(
    replay.session.evidenceById(atomic!.evidence_id)?.normalized_result,
  ).toEqual(original.summary);
});

it.each(["profileless", "uncacheable"] as const)(
  "does not trust provider-supplied Evidence IDs on %s executions",
  async (mode) => {
    const spoofedEvidenceId = `ev_${"f".repeat(64)}`;
    const fixture = await composedWorkflowFixture({
      profiled: mode !== "profileless",
      live: mode === "uncacheable",
      spoofedEvidenceId,
    });
    await fixture.open();
    const composed = await executeComposedWorkflow(
      fixture.session,
      async (observed) => {
        const execution = await observed.execute(
          "read_binary_inventory_summary",
          {},
        );
        if (!execution.ok) return execution;
        if (mode === "profileless")
          expect(execution.value.evidenceId).toBeUndefined();
        else {
          expect(execution.value.evidenceId).toEqual(expect.any(String));
          expect(execution.value.evidenceId).not.toBe(spoofedEvidenceId);
        }
        return ok(execution.value.result);
      },
    );
    if (!composed.ok) throw composed.error;
    if (mode === "profileless") {
      expect(composed.value.evidenceLinks).toBeUndefined();
      expect(fixture.session.exportEvidenceBundle().records).toEqual([]);
    } else {
      const evidenceId = composed.value.evidenceLinks?.[0];
      expect(evidenceId).toEqual(expect.any(String));
      expect(evidenceId).not.toBe(spoofedEvidenceId);
      expect(
        fixture.session
          .exportEvidenceBundle()
          .records.map((record) => record.evidence_id),
      ).toEqual([evidenceId]);
    }
  },
);

it("does not manufacture links for empty or failed composed calls", async () => {
  const fixture = await composedWorkflowFixture();
  await fixture.open();
  const empty = await executeComposedWorkflow(fixture.session, async () =>
    ok(null),
  );
  expect(empty).toEqual(ok({ result: null, limitations: [] }));
  const failed = await executeComposedWorkflow(
    fixture.session,
    async (observed) => {
      const result = await observed.execute("list_strings", {});
      return result.ok ? ok(result.value.result) : result;
    },
  );
  expect(failed.ok).toBe(false);
  expect(fixture.session.exportEvidenceBundle().records).toEqual([]);
});

it("reruns an ambiguous snapshot binding before selecting composed Evidence links", async () => {
  const fixture = await composedWorkflowFixture();
  const target = await fixture.open();
  const initial = await fixture.session.execute(
    "read_binary_inventory_summary",
    {},
  );
  if (!initial.ok) throw initial.error;
  const snapshot = fixture.session.exportAnalysisSnapshot();
  if (!snapshot.ok) throw snapshot.error;
  const unrelated = await fixture.session.execute("address_name", {
    address: "0x2000",
    document: "fixture",
  });
  if (!unrelated.ok || unrelated.value.evidenceId === undefined)
    throw new Error("Expected recorded dependency");
  const alternative = createEvidence(target, fixture.profile.provider, {
    operation: "read_binary_inventory_summary",
    parameters: {},
    result: fixture.summary,
    analysisProfile: fixture.profile,
    evidenceLinks: [unrelated.value.evidenceId],
  });
  expect(fixture.session.recordEvidence(alternative).ok).toBe(true);
  const ambiguous = fixture.session.exportAnalysisSnapshot();
  if (!ambiguous.ok) throw ambiguous.error;
  const replay = await composedWorkflowFixture();
  expect(replay.session.importAnalysisSnapshot(snapshot.value).ok).toBe(true);
  await replay.open();
  const before = await replay.session.execute(
    "read_binary_inventory_summary",
    {},
  );
  if (!before.ok) throw before.error;
  expect(before.value.evidenceId).toBe(initial.value.evidenceId);
  expect(replay.calls).not.toContain("read_binary_inventory_summary");
  expect(replay.session.importAnalysisSnapshot(ambiguous.value).ok).toBe(true);
  const after = await replay.session.execute(
    "read_binary_inventory_summary",
    {},
  );
  if (!after.ok) throw after.error;
  expect(after.value.result).toEqual(fixture.summary);
  expect(
    replay.calls.filter(
      (operation) => operation === "read_binary_inventory_summary",
    ),
  ).toHaveLength(1);
  expect(after.value.limitations).not.toContain(
    "Loaded from a local REA analysis snapshot; this call did not re-run the provider.",
  );
  if (after.value.evidenceId === undefined)
    throw new Error("Fresh provider observation was not committed");
  // Unchanged facts reproduce their deterministic identity. The provider call,
  // rather than a choice between historical records, establishes this binding.
  expect(after.value.evidenceId).toBe(initial.value.evidenceId);
  expect(after.value.evidenceId).not.toBe(alternative.evidence_id);
  const originalRecord = snapshot.value.evidence_bundle.records.find(
    ({ evidence_id }) => evidence_id === initial.value.evidenceId,
  );
  expect(replay.session.evidenceById(after.value.evidenceId)).toEqual(
    originalRecord,
  );
  expect(replay.session.evidenceById(alternative.evidence_id)).toEqual(
    alternative,
  );

  const composed = await executeComposedWorkflow(
    replay.session,
    async (observed) => {
      const execution = await observed.execute(
        "read_binary_inventory_summary",
        {},
      );
      return execution.ok ? ok(execution.value.result) : execution;
    },
  );
  if (!composed.ok) throw composed.error;
  expect(composed.value.evidenceLinks).toEqual([after.value.evidenceId]);
  expect(
    replay.calls.filter(
      (operation) => operation === "read_binary_inventory_summary",
    ),
  ).toHaveLength(1);
});

it("replaces provider-supplied identity with the record actually committed by the session", async () => {
  const spoofedEvidenceId = `ev_${"f".repeat(64)}`;
  const fixture = await composedWorkflowFixture({ spoofedEvidenceId });
  await fixture.open();
  const executed = await fixture.session.execute(
    "read_binary_inventory_summary",
    {},
  );
  if (!executed.ok) throw executed.error;
  const records = fixture.session.exportEvidenceBundle().records;
  expect(records).toHaveLength(1);
  expect(executed.value.evidenceId).toBe(records[0]?.evidence_id);
  expect(executed.value.evidenceId).not.toBe(spoofedEvidenceId);
  expect((await fixture.session.close()).ok).toBe(true);
  await fixture.open();
  const refreshed = await fixture.session.execute(
    "read_binary_inventory_summary",
    {},
  );
  if (!refreshed.ok) throw refreshed.error;
  expect(
    fixture.calls.filter(
      (operation) => operation === "read_binary_inventory_summary",
    ),
  ).toHaveLength(2);
  expect(fixture.session.hasEvidence(refreshed.value.evidenceId!)).toBe(true);
});
