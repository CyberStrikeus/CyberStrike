import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import { describe, expect, it } from "vitest";

import { EvidenceLedger } from "./EvidenceLedger.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  createEvidence,
  withEvidenceCallerInputPath,
} from "../../domain/evidence.js";
import {
  createEvidenceBundle,
  parseEvidenceBundle,
  serializeEvidenceBundle,
} from "../../domain/evidenceBundle.js";
import {
  createResidualUnknown,
  recordUnknownInputSchema,
  updateUnknownInputSchema,
  type RecordUnknownInput,
  type ResidualUnknown,
} from "../../domain/residualUnknown.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };
const ledger = (): EvidenceLedger => new EvidenceLedger();
const evidence = (
  label: string,
  confidence: "observed" | "derived" | "inferred" = "derived",
) =>
  createEvidence(undefined, provider, {
    operation: label,
    parameters: {},
    result: { label },
    confidence,
    authority:
      confidence === "observed" ? "controlled-replay" : "analyst-inference",
    environment:
      confidence === "observed"
        ? {
            id: "fixture-linux",
            platform: "linux",
            architecture: "x86_64",
            isolation: "process",
          }
        : null,
  });
const input = (
  question: string,
  overrides: Partial<RecordUnknownInput> = {},
): RecordUnknownInput =>
  recordUnknownInputSchema.parse({
    question,
    severity: "high",
    domain: "protocol",
    required_authority: "controlled-replay",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    ...overrides,
  });
const mutation = (label: string) => evidence(`mutation-${label}`);
const expectHistoryConflict = (
  error: import("../../domain/analysisErrorBase.js").AnalysisError,
  unknownId: string,
) => {
  expect(projectAnalysisError(error)).toMatchObject({
    code: "evidence_integrity_mismatch",
    retryable: false,
    message: expect.stringContaining("conflicts with a revision retained"),
    remediation: { action: expect.stringContaining("cannot reconcile") },
    details: {
      reason: "Conflicting unknown revision",
      diagnostics: { unknown_id: unknownId, revision: 2 },
    },
  });
};
const update = (
  unknown: ResidualUnknown,
  overrides: Readonly<Record<string, unknown>> = {},
) =>
  updateUnknownInputSchema.parse({
    unknown_id: unknown.unknown_id,
    expected_revision: unknown.revision,
    status: "investigating",
    severity: unknown.severity,
    supporting_evidence_ids: unknown.supporting_evidence_ids,
    contradicting_evidence_ids: unknown.contradicting_evidence_ids,
    required_authority: unknown.required_authority,
    required_confidence: unknown.required_confidence,
    required_environment: unknown.required_environment,
    recommended_probes: unknown.recommended_probes,
    relationships: unknown.relationships,
    resolution: null,
    ...overrides,
  });

describe("residual unknown registry reads and identity", () => {
  it("seals mutation Evidence without freezing caller-owned inputs", () => {
    const store = ledger();
    const recordMutation = mutation("mutable-record-mutation");
    const recorded = store.recordUnknown(
      input("Does record mutation evidence stay stable?"),
      recordMutation,
    );
    if (!recorded.ok) throw recorded.error;

    const updateMutation = mutation("mutable-update-mutation");
    const updated = store.updateUnknown(update(recorded.value), updateMutation);
    if (!updated.ok) throw updated.error;
    const atomicEvidence = evidence("mutable-atomic-evidence");
    const atomicMutation = mutation("mutable-atomic-mutation");
    const atomicallyRecorded = store.recordWithUnknown(
      atomicEvidence,
      input("Does atomic evidence stay stable?"),
      atomicMutation,
    );
    if (!atomicallyRecorded.ok) throw atomicallyRecorded.error;

    for (const callerEvidence of [
      recordMutation,
      updateMutation,
      atomicEvidence,
      atomicMutation,
    ]) {
      expect(Object.isFrozen(callerEvidence)).toBe(false);
      const retained = store.forAnalysis(callerEvidence.evidence_id);
      if (retained === undefined) throw new Error("Missing retained Evidence");
      const originalResult = structuredClone(retained.normalized_result);
      expect(Object.isFrozen(retained)).toBe(true);
      Reflect.set(callerEvidence, "operation", "caller mutation");
      expect(
        Reflect.set(
          callerEvidence.normalized_result as object,
          "label",
          "caller nested mutation",
        ),
      ).toBe(true);
      expect(retained.operation).not.toBe("caller mutation");
      expect(retained.normalized_result).toEqual(originalResult);
    }
  });

  it("merges record-only bundles without changing retained unknown history", () => {
    const store = ledger();
    const created = store.recordUnknown(
      input("Does a later record preserve this unknown?"),
      mutation("record-only-import"),
    );
    expect(created.ok).toBe(true);
    const originalUnknowns = store.export().unknowns;
    const addition = evidence("record-only-addition");
    const bundle = createEvidenceBundle([addition]);

    expect(store.import(bundle)).toEqual({
      ok: true,
      value: {
        recordsAdded: 1,
        unknownsAdded: 0,
        changed: true,
        replacements: [],
      },
    });
    expect(store.export().unknowns).toEqual(originalUnknowns);
    expect(store.import(bundle)).toEqual({
      ok: true,
      value: {
        recordsAdded: 0,
        unknownsAdded: 0,
        changed: false,
        replacements: [],
      },
    });
  });
});

describe("residual unknown dependency histories", () => {
  it("imports a valid dependency chain deeper than the JavaScript call stack", () => {
    const records = [];
    const unknowns: ResidualUnknown[] = [];
    let previousId: string | undefined;
    for (let index = 0; index < 10_000; index += 1) {
      const mutationEvidence = mutation(`deep-chain-${index}`);
      records.push(mutationEvidence);
      const relationships =
        previousId === undefined
          ? []
          : [{ type: "depends-on" as const, unknown_id: previousId }];
      const unknown = createResidualUnknown(
        input(`Does chain item ${index} meet the expected state?`, {
          domain: "chain-profile",
          required_authority: null,
          relationships,
        }),
        mutationEvidence.evidence_id,
        null,
      );
      unknowns.push(unknown);
      previousId = unknown.unknown_id;
    }
    const bundle = createEvidenceBundle(records, unknowns);
    const store = ledger();

    expect(store.import(bundle)).toEqual({
      ok: true,
      value: {
        recordsAdded: 10_000,
        unknownsAdded: 10_000,
        changed: true,
        replacements: [],
      },
    });
    expect(store.export()).toEqual(bundle);
  });

  it("returns detached unknowns and evidence bundles from every read surface", () => {
    const store = ledger();
    expect(store.record(evidence("detached-record")).ok).toBe(true);
    const created = store.recordUnknown(
      input("Does detached state remain intact?"),
      mutation("detached-unknown"),
    );
    if (!created.ok) throw created.error;

    Reflect.set(created.value, "status", "resolved");
    const listed = store.listUnknowns();
    expect(listed[0]?.status).toBe("open");
    if (listed[0] !== undefined) Reflect.set(listed[0], "status", "resolved");
    const verified = store.verifyUnknownResolution(created.value.unknown_id);
    expect(verified).toMatchObject({ ok: true, value: { valid: false } });
    if (verified.ok) Reflect.set(verified.value.unknown, "status", "resolved");

    const exported = store.export();
    const exportedRecord = exported.records.find(
      ({ operation }) => operation === "detached-record",
    );
    if (exportedRecord !== undefined)
      Reflect.set(exportedRecord, "operation", "forged");
    expect(store.export().records.map(({ operation }) => operation)).toContain(
      "detached-record",
    );
    expect(
      store.verifyUnknownResolution(created.value.unknown_id),
    ).toMatchObject({ ok: true, value: { valid: false } });
  });

  it("derives stable IDs, filters heads, and rejects duplicate creation", () => {
    const store = ledger();
    const first = store.recordUnknown(
      input("  Is branch live?  "),
      mutation("one"),
    );
    if (!first.ok) throw first.error;
    expect(first.value.unknown_id).toMatch(/^unk_[a-f0-9]{64}$/u);
    expect(first.value.revision).toBe(1);
    expect(store.listUnknowns({ severity: "high" })).toHaveLength(1);
    expect(store.listUnknowns({ status: "resolved" })).toEqual([]);
    const duplicate = store.recordUnknown(
      input("Is branch live?"),
      mutation("two"),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.error._tag).toBe("UnknownRegistryError");
    const mutationId = `ev_${"a".repeat(64)}`;
    const normalized = createResidualUnknown(
      input("A   scoped question"),
      mutationId,
      "0".repeat(64),
    );
    expect(
      createResidualUnknown(
        input("A scoped question"),
        mutationId,
        "0".repeat(64),
      ).unknown_id,
    ).toBe(normalized.unknown_id);
    expect(
      createResidualUnknown(
        input("A scoped question"),
        mutationId,
        "1".repeat(64),
      ).unknown_id,
    ).not.toBe(normalized.unknown_id);
  });

  it("uses immutable CAS revisions and rejects a stale concurrent writer atomically", () => {
    const store = ledger();
    const created = store.recordUnknown(
      input("Which codec wins?"),
      mutation("create"),
    );
    if (!created.ok) throw created.error;
    const command = update(created.value);
    const winner = store.updateUnknown(command, mutation("winner"));
    expect(winner.ok).toBe(true);
    const loser = store.updateUnknown(command, mutation("loser"));
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.error.message).toContain("revision-conflict");
    expect(store.export().unknowns.map(({ revision }) => revision)).toEqual([
      1, 2,
    ]);
  });
});

describe("residual unknown registry resolution and history", () => {
  it("rejects inference for observed resolution, then accepts matching live evidence", () => {
    const store = ledger();
    const inferred = evidence("inference", "inferred");
    expect(store.record(inferred).ok).toBe(true);
    const created = store.recordUnknown(
      input("Does replay confirm response?", {
        supporting_evidence_ids: [inferred.evidence_id],
        required_environment: {
          id: "fixture-linux",
          platform: "linux",
          architecture: "x86_64",
          isolation: "process",
        },
      }),
      mutation("create-resolution"),
    );
    if (!created.ok) throw created.error;
    const invalid = store.updateUnknown(
      update(created.value, {
        status: "resolved",
        resolution: {
          disposition: "verified",
          rationale: "Inference alone is insufficient.",
          evidence_ids: [inferred.evidence_id],
        },
      }),
      mutation("invalid-resolution"),
    );
    expect(invalid.ok).toBe(false);
    expect(store.listUnknowns()[0]?.revision).toBe(1);

    const observed = evidence("replay", "observed");
    expect(store.record(observed).ok).toBe(true);
    const valid = store.updateUnknown(
      update(created.value, {
        status: "resolved",
        supporting_evidence_ids: [inferred.evidence_id, observed.evidence_id],
        resolution: {
          disposition: "verified",
          rationale: "Controlled replay directly observed response.",
          evidence_ids: [observed.evidence_id],
        },
      }),
      mutation("valid-resolution"),
    );
    expect(valid.ok).toBe(true);
    if (valid.ok)
      expect(store.verifyUnknownResolution(valid.value.unknown_id)).toEqual({
        ok: true,
        value: { valid: true, truthVerified: true, unknown: valid.value },
      });
  });

  it("rejects broken references, dependency cycles, deletion, and tampering", () => {
    const store = ledger();
    const first = store.recordUnknown(input("First?"), mutation("first"));
    if (!first.ok) throw first.error;
    const second = store.recordUnknown(
      input("Second?", {
        relationships: [
          { type: "depends-on", unknown_id: first.value.unknown_id },
        ],
      }),
      mutation("second"),
    );
    if (!second.ok) throw second.error;
    const cycle = store.updateUnknown(
      update(first.value, {
        relationships: [
          { type: "depends-on", unknown_id: second.value.unknown_id },
        ],
      }),
      mutation("cycle"),
    );
    expect(cycle.ok).toBe(false);

    const bundle = store.export();
    expect(parseEvidenceBundle(bundle)).toEqual(bundle);
    expect(serializeEvidenceBundle(bundle)).toBe(
      serializeEvidenceBundle(
        createEvidenceBundle(
          [...bundle.records].reverse(),
          [...bundle.unknowns].reverse(),
        ),
      ),
    );
    expect(() =>
      parseEvidenceBundle({ ...bundle, records: bundle.records.slice(1) }),
    ).toThrow(/missing evidence/u);
    expect(() =>
      parseEvidenceBundle({
        ...bundle,
        unknowns: bundle.unknowns.map((unknown, index) =>
          index === 0 ? { ...unknown, question: "tampered" } : unknown,
        ),
      }),
    ).toThrow();
  });

  it("merges independent histories commutatively and rejects divergent heads atomically", () => {
    const left = ledger();
    const right = ledger();
    expect(left.recordUnknown(input("Left?"), mutation("left")).ok).toBe(true);
    expect(right.recordUnknown(input("Right?"), mutation("right")).ok).toBe(
      true,
    );
    const leftThenRight = ledger();
    const rightThenLeft = ledger();
    expect(leftThenRight.import(left.export()).ok).toBe(true);
    expect(leftThenRight.import(right.export()).ok).toBe(true);
    expect(rightThenLeft.import(right.export()).ok).toBe(true);
    expect(rightThenLeft.import(left.export()).ok).toBe(true);
    expect(serializeEvidenceBundle(leftThenRight.export())).toBe(
      serializeEvidenceBundle(rightThenLeft.export()),
    );

    const base = ledger();
    const created = base.recordUnknown(input("Divergent?"), mutation("base"));
    if (!created.ok) throw created.error;
    const source = withEvidenceCallerInputPath(
      evidence("shared-source"),
      "./original",
    );
    expect(base.record(source).ok).toBe(true);
    const branch = ledger();
    expect(branch.import(base.export()).ok).toBe(true);
    expect(
      branch.import(
        createEvidenceBundle([
          withEvidenceCallerInputPath(source, "./relocated"),
        ]),
      ).ok,
    ).toBe(true);
    expect(
      base.updateUnknown(update(created.value), mutation("branch-left")).ok,
    ).toBe(true);
    expect(
      branch.updateUnknown(
        update(created.value, { severity: "critical" }),
        mutation("branch-right"),
      ).ok,
    ).toBe(true);
    const before = serializeEvidenceBundle(base.export());
    const conflict = base.import(branch.export());
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error("Expected divergent history refusal");
    expectHistoryConflict(conflict.error, created.value.unknown_id);
    expect(base.get(source.evidence_id)?.caller_input_path).toBe("./original");
    expect(serializeEvidenceBundle(base.export())).toBe(before);
  });
});

describe("residual unknown imported identity", () => {
  it("rejects a rehashed wrong ID atomically and accepts valid history", () => {
    const store = ledger();
    const created = store.recordUnknown(
      input("Stable question?"),
      mutation("stable"),
    );
    if (!created.ok) throw created.error;
    const initialBundle = store.export();
    const mutationEvidenceId = created.value.mutation_evidence_ids[0];
    if (mutationEvidenceId === undefined)
      throw new Error("Missing mutation Evidence ID");
    const otherId = createResidualUnknown(
      input("Different question?"),
      mutationEvidenceId,
      created.value.scope_digest,
    ).unknown_id;
    const { revision_digest: _revisionDigest, ...revision } = created.value;
    const incorrectIdentity = { ...revision, unknown_id: otherId };
    const encoded = canonicalize(incorrectIdentity);
    if (encoded === undefined) throw new Error("Could not encode revision");
    const tampered = {
      ...incorrectIdentity,
      revision_digest: createHash("sha256").update(encoded).digest("hex"),
    };
    const invalidBundle = createEvidenceBundle(initialBundle.records, [
      tampered,
    ]);
    const before = serializeEvidenceBundle(initialBundle);

    expect(() => parseEvidenceBundle(invalidBundle)).toThrow();
    expect(store.import(invalidBundle).ok).toBe(false);
    expect(serializeEvidenceBundle(store.export())).toBe(before);

    expect(
      store.updateUnknown(update(created.value), mutation("stable-update")).ok,
    ).toBe(true);
    const validHistory = store.export();
    const imported = ledger();
    expect(imported.import(validHistory).ok).toBe(true);
    expect(imported.export()).toEqual(validHistory);
  });
});
