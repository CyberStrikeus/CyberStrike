import { describe, expect, it } from "vitest";

import {
  createEvidenceCompletionLedger,
  evidenceCompletionLedgerSchema,
  type EvidenceCompletionStatus,
} from "./evidenceCompletionLedger.js";

const evidenceId = (digit: string): string => `ev_${digit.repeat(64)}`;

const record = (
  claimId: string,
  status: EvidenceCompletionStatus,
  evidenceIds: readonly string[] = [evidenceId("1")],
) => ({ claim_id: claimId, status, evidence_ids: evidenceIds });

describe("Evidence completion ledger", () => {
  it("marks only an all-pass ledger complete", () => {
    const ledger = createEvidenceCompletionLedger([
      record("scenario.launch", "pass"),
      record("scenario.shutdown", "pass", [evidenceId("2")]),
    ]);

    expect(ledger.summary).toEqual({
      total: 2,
      pass: 2,
      fail: 0,
      unsupported: 0,
      truncated: 0,
      unknown: 0,
      complete: true,
    });
  });

  it.each(["fail", "unsupported", "truncated", "unknown"] as const)(
    "does not count %s as pass",
    (status) => {
      const ledger = createEvidenceCompletionLedger([
        record("scenario.pass", "pass"),
        record(`scenario.${status}`, status, [evidenceId("2")]),
      ]);

      expect(ledger.summary).toMatchObject({ pass: 1, complete: false });
      expect(ledger.summary[status]).toBe(1);
    },
  );

  it("canonicalizes claim and Evidence ID ordering", () => {
    const left = createEvidenceCompletionLedger([
      record("scenario.z", "pass", [evidenceId("2"), evidenceId("1")]),
      record("scenario.a", "unknown", [evidenceId("3")]),
    ]);
    const right = createEvidenceCompletionLedger([
      record("scenario.a", "unknown", [evidenceId("3")]),
      record("scenario.z", "pass", [evidenceId("1"), evidenceId("2")]),
    ]);

    expect(left).toEqual(right);
    expect(left.records).toEqual([
      record("scenario.a", "unknown", [evidenceId("3")]),
      record("scenario.z", "pass", [evidenceId("1"), evidenceId("2")]),
    ]);
    expect(left.ledger_id).toMatch(/^ecl_[a-f0-9]{64}$/u);
  });

  it("accepts every Evidence ID supplied for one claim", () => {
    const evidenceIds = Array.from(
      { length: 101 },
      (_, index) => `ev_${index.toString(16).padStart(64, "0")}`,
    );

    expect(
      createEvidenceCompletionLedger([
        record(
          "scenario.many-evidence-items",
          "pass",
          [...evidenceIds].reverse(),
        ),
      ]).records[0]?.evidence_ids,
    ).toEqual(evidenceIds);
  });

  it("rejects missing, malformed, and duplicate Evidence IDs", () => {
    expect(() =>
      createEvidenceCompletionLedger([record("scenario.empty", "pass", [])]),
    ).toThrow();
    expect(() =>
      createEvidenceCompletionLedger([
        record("scenario.bad", "pass", ["ev_not-a-digest"]),
      ]),
    ).toThrow();
    expect(() =>
      createEvidenceCompletionLedger([
        record("scenario.duplicate", "pass", [
          evidenceId("1"),
          evidenceId("1"),
        ]),
      ]),
    ).toThrow("unique");
  });

  it("rejects duplicate claims and tampered derived fields", () => {
    expect(() =>
      createEvidenceCompletionLedger([
        record("scenario.same", "pass"),
        record("scenario.same", "unknown", [evidenceId("2")]),
      ]),
    ).toThrow("unique");

    const ledger = createEvidenceCompletionLedger([
      record("scenario.valid", "pass"),
    ]);
    expect(() =>
      evidenceCompletionLedgerSchema.parse({
        ...ledger,
        summary: { ...ledger.summary, complete: false },
      }),
    ).toThrow();
    expect(() =>
      evidenceCompletionLedgerSchema.parse({
        ...ledger,
        ledger_id: `ecl_${"0".repeat(64)}`,
      }),
    ).toThrow();
  });

  it("rejects path-bearing fields and emits path-independent output", () => {
    const ledger = createEvidenceCompletionLedger([
      record("scenario.path-free", "pass"),
    ]);
    expect(() =>
      evidenceCompletionLedgerSchema.parse({
        ...ledger,
        records: [
          {
            ...record("scenario.path-free", "pass"),
            local_path: "/private/operator/input.bin",
          },
        ],
      }),
    ).toThrow();

    expect(JSON.stringify(ledger)).not.toContain("/private/operator");
  });
});
