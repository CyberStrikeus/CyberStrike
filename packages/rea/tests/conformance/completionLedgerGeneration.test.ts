import { describe, expect, it } from "vitest";

import {
  completionVerifierReportSchema,
  completionManifestSchema,
  createCompletionLedgerArtifacts,
  type CompletionVerifierReport,
} from "../../scripts/lib/completion-ledger-generation.mjs";
import { evidenceCompletionLedgerSchema } from "../../src/domain/evidenceCompletionLedger.js";

const digest = (digit: string): string => digit.repeat(64);
const evidenceId = (digit: string): string => `ev_${digest(digit)}`;

const report = (): CompletionVerifierReport => ({
  verifier: { id: "managed-conformance", version: "1" },
  verifier_run: {
    run_id: "11111111-1111-4111-8111-111111111111",
    verifier_pid: 100,
    parent_pid: 1,
    process_lineage: {
      status: "verified",
      observed_at: "2026-07-22T10:00:00.000Z",
      launcher_pid: 100,
      launcher_parent_pid: 1,
      process_group_id: 100,
      descendants: [{ pid: 101, parent_pid: 100, process_group_id: 100 }],
    },
  },
  environment: {
    platform: "linux",
    architecture: "x64",
    runtime: "node",
    runtime_version: "24",
  },
  claims: [
    {
      claim_id: "scenario.inspect",
      scenario: { id: "inspect-managed", version: 1 },
      artifact_sha256s: [digest("1")],
      provider: { id: "managed-static", version: "2" },
      status: "pass",
      evidence_ids: [evidenceId("1")],
    },
    {
      claim_id: "scenario.oracle",
      scenario: { id: "external-oracle", version: 1 },
      artifact_sha256s: [],
      provider: { id: "managed-static", version: "2" },
      status: "unsupported",
      evidence_ids: [evidenceId("2")],
    },
  ],
});

const generate = (input: unknown = report(), skillSha256 = digest("a")) =>
  createCompletionLedgerArtifacts(input, [
    { skill_id: "reverse-engineer-anything", sha256: skillSha256 },
  ]);

const firstClaim = (input: CompletionVerifierReport) => {
  const claim = input.claims[0];
  if (claim === undefined) throw new TypeError("Expected fixture claim");
  return claim;
};

describe("completion ledger generation", () => {
  it.each(["verified", "unavailable"] as const)(
    "preserves minute-precision UTC in %s verifier lineage",
    (status) => {
      const input = report();
      const observedAt = "2026-10-09T04:00Z";
      const processLineage =
        status === "verified"
          ? {
              ...input.verifier_run.process_lineage,
              status: "verified" as const,
              observed_at: observedAt,
              descendants: [],
            }
          : {
              status: "unavailable" as const,
              observed_at: observedAt,
              launcher_pid: input.verifier_run.verifier_pid,
              launcher_parent_pid: input.verifier_run.parent_pid,
              process_group_id: null,
              reason: "Lineage observation unavailable",
            };
      const preserved = {
        ...input,
        verifier_run: {
          ...input.verifier_run,
          process_lineage: processLineage,
        },
      };

      expect(
        completionVerifierReportSchema.parse(preserved).verifier_run
          .process_lineage.observed_at,
      ).toBe(observedAt);
      expect(generate(preserved)).toEqual(generate(input));
    },
  );

  it("separates verifier outcomes while preserving immutable commitments", () => {
    const generated = generate();

    expect(generated.ledger.summary).toEqual({
      total: 2,
      pass: 1,
      fail: 0,
      unsupported: 1,
      truncated: 0,
      unknown: 0,
      complete: false,
    });
    expect(generated.manifest.claims[0]).toMatchObject({
      claim_id: "scenario.inspect",
      artifact_sha256s: [digest("1")],
      scenario: { id: "inspect-managed", version: 1 },
      provider: { id: "managed-static", version: "2" },
    });
    expect(generated.manifest.claims[0]).not.toHaveProperty("status");
    expect(generated.manifest.claims[0]).not.toHaveProperty("evidence_ids");
  });

  it("is deterministic regardless of verifier claim ordering", () => {
    const input = report();
    const reversed = { ...input, claims: [...input.claims].reverse() };

    expect(generate(reversed)).toEqual(generate(input));
  });

  it("keeps ephemeral verifier run identity out of generated commitments", () => {
    const first = report();
    const second = {
      ...first,
      verifier_run: {
        ...first.verifier_run,
        run_id: "22222222-2222-4222-8222-222222222222",
        verifier_pid: 200,
        process_lineage: {
          status: "unavailable" as const,
          observed_at: "2026-07-22T11:00:00.000Z",
          launcher_pid: 200,
          launcher_parent_pid: 1,
          process_group_id: null,
          reason: "Windows verifier lineage ownership is unavailable",
        },
      },
    };

    expect(generate(second)).toEqual(generate(first));
  });
});

describe("completion verifier report validation", () => {
  it("requires a typed verifier-process identity", () => {
    const input = report();
    expect(
      completionVerifierReportSchema.safeParse({
        ...input,
        verifier_run: { ...input.verifier_run, run_id: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed verified descendant lineage", () => {
    const input = report();
    expect(
      completionVerifierReportSchema.safeParse({
        ...input,
        verifier_run: {
          ...input.verifier_run,
          process_lineage: {
            status: "verified",
            observed_at: "2026-07-22T10:00:00.000Z",
            launcher_pid: 100,
            launcher_parent_pid: 1,
            process_group_id: 100,
            descendants: [
              { pid: 101, parent_pid: 100, process_group_id: null },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe("completion ledger commitment drift", () => {
  it.each([
    [
      "artifact",
      (input: CompletionVerifierReport) => {
        firstClaim(input).artifact_sha256s = [digest("3")];
      },
    ],
    [
      "scenario",
      (input: CompletionVerifierReport) => {
        firstClaim(input).scenario.version = 2;
      },
    ],
    [
      "provider",
      (input: CompletionVerifierReport) => {
        firstClaim(input).provider.version = "3";
      },
    ],
    [
      "environment",
      (input: CompletionVerifierReport) => {
        input.environment.runtime_version = "25";
      },
    ],
  ])("changes the manifest identity on %s drift", (_label, mutate) => {
    const baseline = report();
    const changed = structuredClone(baseline);
    mutate(changed);

    expect(generate(changed).manifest.manifest_id).not.toBe(
      generate(baseline).manifest.manifest_id,
    );
  });

  it("detects claim deletion and stale skill content", () => {
    const baseline = generate();
    const input = report();
    input.claims.pop();
    const deleted = generate(input);
    const staleSkill = generate(report(), digest("b"));

    expect(deleted.ledger.summary.total).toBe(1);
    expect(deleted.manifest.manifest_id).not.toBe(
      baseline.manifest.manifest_id,
    );
    expect(staleSkill.manifest.manifest_id).not.toBe(
      baseline.manifest.manifest_id,
    );
  });
});

describe("completion ledger identity validation", () => {
  it("rejects duplicate claim, artifact, Evidence, and skill identities", () => {
    const duplicateClaim = report();
    duplicateClaim.claims.push(structuredClone(firstClaim(duplicateClaim)));
    expect(() => generate(duplicateClaim)).toThrow("claim IDs");

    const duplicateArtifact = report();
    firstClaim(duplicateArtifact).artifact_sha256s = [digest("1"), digest("1")];
    expect(() => generate(duplicateArtifact)).toThrow("Artifact digests");

    const duplicateEvidence = report();
    firstClaim(duplicateEvidence).evidence_ids = [
      evidenceId("1"),
      evidenceId("1"),
    ];
    expect(() => generate(duplicateEvidence)).toThrow("Evidence IDs");

    expect(() =>
      createCompletionLedgerArtifacts(report(), [
        { skill_id: "same", sha256: digest("1") },
        { skill_id: "same", sha256: digest("2") },
      ]),
    ).toThrow("skill IDs");
  });

  it("rejects a passing claim without immutable artifact identity", () => {
    const input = report();
    firstClaim(input).artifact_sha256s = [];

    expect(() => generate(input)).toThrow("artifact digest");
  });

  it("rejects report paths and tampered generated metadata", () => {
    const input = report();
    expect(() =>
      completionVerifierReportSchema.parse({
        ...input,
        local_path: "/private/operator/app.exe",
      }),
    ).toThrow();

    const generated = generate();
    expect(() =>
      completionManifestSchema.parse({
        ...generated.manifest,
        manifest_id: `ecm_${digest("0")}`,
      }),
    ).toThrow();
    expect(() =>
      evidenceCompletionLedgerSchema.parse({
        ...generated.ledger,
        records: generated.ledger.records.slice(1),
      }),
    ).toThrow();
  });
});
