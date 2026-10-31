import { describe, expect, it } from "vitest";

import { RECONSTRUCTION_READINESS_EXAMPLE } from "./reconstructionReadinessExample.js";
import { createReconstructionReadinessReport } from "./reconstructionReadiness.js";
import {
  reconstructionObligationLedgerClosureDigest,
  reconstructionObligationLedgerStatus,
  reconstructionObligationOwnershipGraph,
  summarizeReconstructionObligations,
} from "../../../../src/domain/reconstructionObligationLedgerIntegrity.js";
import { reconstructionObligationLedgerSchema } from "../../../../src/domain/reconstructionObligationLedgerSchemas.js";
import {
  reconstructionReadinessReportSchema,
  reconstructionReadinessInputSchema,
  type ReconstructionReadinessInput,
} from "./reconstructionReadinessSchemas.js";

const input = (
  overrides: Partial<ReconstructionReadinessInput> = {},
): ReconstructionReadinessInput => ({
  ...structuredClone(RECONSTRUCTION_READINESS_EXAMPLE),
  ...overrides,
});

describe("readiness bundle authentication", () => {
  it("authenticates each Evidence record after parsing the readiness contract", () => {
    const value = input();
    const record = value.evidence_bundle.records[0];
    if (record === undefined) throw new TypeError("Missing Evidence record");
    value.evidence_bundle.records[0] = {
      ...record,
      evidence_id: `ev_${"0".repeat(64)}`,
    };

    expect(() => createReconstructionReadinessReport(value)).toThrow(
      /Evidence semantic identifier does not match its record/u,
    );
  });

  it("rejects a noncanonical bundle manifest after readiness parsing", () => {
    const value = input();
    const provider = value.evidence_bundle.providers[0];
    if (provider === undefined)
      throw new TypeError("Missing provider manifest");
    value.evidence_bundle.providers.push(provider);

    expect(() => createReconstructionReadinessReport(value)).toThrow(
      /Evidence bundle manifests are not canonical/u,
    );
  });

  it("rejects duplicate Evidence record IDs after readiness parsing", () => {
    const value = input();
    const record = value.evidence_bundle.records[0];
    if (record === undefined) throw new TypeError("Missing Evidence record");
    value.evidence_bundle.records.push(record);

    expect(() => createReconstructionReadinessReport(value)).toThrow(
      /Evidence bundle contains duplicate record IDs/u,
    );
  });
});

describe("reconstruction readiness report", () => {
  it("accepts every caller supplied capability", () => {
    const capability = RECONSTRUCTION_READINESS_EXAMPLE.capabilities[0];
    if (capability === undefined) throw new TypeError("Missing capability");

    const parsed = reconstructionReadinessInputSchema.parse(
      input({ capabilities: Array.from({ length: 1_001 }, () => capability) }),
    );

    expect(parsed.capabilities).toHaveLength(1_001);
  });

  it("projects the complete conformance report deterministically", () => {
    const first = createReconstructionReadinessReport(input());
    const second = createReconstructionReadinessReport(input());

    expect(first.status).toBe("pass");
    expect(first.summary).toMatchObject({
      required_stages: 9,
      passed_required_stages: 9,
      findings: 0,
    });
    expect(first.report_id).toBe(second.report_id);
    expect(first.report_digest).toBe(second.report_digest);
    expect(first.metrics).toMatchObject({
      first_valid_workflow_selection_rate: 1,
      incompatible_provider_invocations: 0,
      false_equivalence_count: 0,
      unowned_obligation_count: 0,
      cleanup_leak_count: 0,
      nondeterministic_replay_count: 0,
    });
  });
});

describe("readiness obligation ledger integrity", () => {
  it("rejects a required obligation changed behind the old ledger commitment", () => {
    const value = input();
    expect(
      reconstructionObligationLedgerSchema.parse(value.obligation_ledger),
    ).toEqual(value.obligation_ledger);
    const obligation = value.obligation_ledger.obligations[0];
    if (obligation === undefined)
      throw new TypeError("Missing reconstruction obligation");
    value.obligation_ledger.obligations[0] = {
      ...obligation,
      status: "blocked",
    };

    expect(() => createReconstructionReadinessReport(value)).toThrow(
      /Ledger status does not match its obligations/u,
    );
  });

  it("rejects a recomputed commitment over a false obligation summary", () => {
    const ledger = structuredClone(input().obligation_ledger);
    ledger.summary.required_open = 1;
    ledger.closure_digest = reconstructionObligationLedgerClosureDigest(ledger);

    expect(() => reconstructionObligationLedgerSchema.parse(ledger)).toThrow(
      /Ledger summary does not match its obligations/u,
    );
  });

  it("accepts reordered summary count entries with the same keyed values", () => {
    const ledger = structuredClone(input().obligation_ledger);
    ledger.summary.by_status.reverse();
    ledger.closure_digest = reconstructionObligationLedgerClosureDigest(ledger);

    expect(reconstructionObligationLedgerSchema.parse(ledger)).toEqual(ledger);
  });

  it.each([
    [
      "reports",
      (ledger: ReconstructionReadinessInput["obligation_ledger"]) => {
        ledger.reports.missing_owner_obligation_ids.push("obl.extra");
      },
      /Ledger report does not match its obligations/u,
    ],
    [
      "ownership graph",
      (ledger: ReconstructionReadinessInput["obligation_ledger"]) => {
        const owner = ledger.ownership_graph[0];
        if (owner === undefined)
          throw new TypeError("Missing owner graph edge");
        owner.symbol = "tamperedOwner";
      },
      /Ownership graph does not match its obligations/u,
    ],
    [
      "dependency graph",
      (ledger: ReconstructionReadinessInput["obligation_ledger"]) => {
        ledger.dependency_graph.push({
          obligation_id: "obl.readiness",
          depends_on_obligation_id: "obl.extra",
        });
      },
      /Dependency graph does not match its obligations/u,
    ],
    [
      "evidence links",
      (ledger: ReconstructionReadinessInput["obligation_ledger"]) => {
        ledger.evidence_links = [];
      },
      /Evidence links omit Evidence referenced by an obligation/u,
    ],
  ] as const)(
    "rejects recomputed commitments over tampered %s",
    (_, mutate, expected) => {
      const ledger = structuredClone(input().obligation_ledger);
      mutate(ledger);
      ledger.closure_digest =
        reconstructionObligationLedgerClosureDigest(ledger);

      expect(() => reconstructionObligationLedgerSchema.parse(ledger)).toThrow(
        expected,
      );
    },
  );
});

describe("readiness stage identity", () => {
  it.each(["input", "report"] as const)(
    "rejects repeated stage IDs in the %s contract",
    (kind) => {
      const value =
        kind === "input"
          ? input()
          : createReconstructionReadinessReport(input());
      value.stages[1] = { ...value.stages[0]! };
      const schema =
        kind === "input"
          ? reconstructionReadinessInputSchema
          : reconstructionReadinessReportSchema;
      const parsed = schema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("Duplicate stage ID was accepted");
      expect(parsed.error.issues).toContainEqual({
        code: "custom",
        path: ["stages", 1, "stage_id"],
        message: "Readiness stage IDs must be unique",
      });
    },
  );
});

describe("readiness closure history", () => {
  it("rejects an earlier ready observation that still has required obligations open", () => {
    const value = input();
    value.closure_history[0]!.status = "ready";

    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("fail");
    expect(report.summary.passed_required_stages).toBe(8);
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "invalid-obligation-closure-transition",
        stage_id: "verify-reconstruction-closure",
        status: "fail",
        evidence_ids: value.closure_history[0]!.evidence_ids,
      }),
    ]);
    expect(report.snapshot.closure_history).toEqual(value.closure_history);
  });

  it.each(["open", "failed", "unknown"] as const)(
    "checks a zero-open middle observation marked %s without treating unknown as ready",
    (status) => {
      const value = input();
      const [initial, final] = value.closure_history;
      value.closure_history = [
        initial!,
        { ...final!, status, ledger_digest: "c".repeat(64) },
        { ...final!, sequence: 2, newly_verified_obligation_ids: [] },
      ];

      const report = createReconstructionReadinessReport(value);
      expect(report.status).toBe(status === "unknown" ? "pass" : "fail");
      expect(report.findings).toEqual(
        status === "unknown"
          ? []
          : [
              expect.objectContaining({
                code: "invalid-obligation-closure-transition",
                stage_id: "verify-reconstruction-closure",
                status: "fail",
                evidence_ids: value.closure_history[1]!.evidence_ids,
              }),
            ],
      );
      expect(report.snapshot.closure_history).toEqual(value.closure_history);
    },
  );

  it.each([false, true])(
    "checks distinct obligations across closure observations (repeated: %s)",
    (repeated) => {
      const value = input();
      const first = value.obligation_ledger.obligations[0]!;
      const second = structuredClone(first);
      second.obligation_id = "obl.second";
      second.binding!.obligation_id = "obl.second";
      second.binding!.verifier!.enumerated_obligation_ids = ["obl.second"];
      const obligations = [first, second];
      const ledger = {
        ...value.obligation_ledger,
        obligations,
        summary: summarizeReconstructionObligations(obligations),
        ownership_graph: reconstructionObligationOwnershipGraph(obligations),
      };
      value.obligation_ledger = {
        ...ledger,
        closure_digest: reconstructionObligationLedgerClosureDigest(ledger),
      };
      const [initial, final] = value.closure_history;
      value.closure_history = [
        { ...initial!, required_open: 2 },
        {
          ...initial!,
          sequence: 1,
          required_open: 1,
          newly_verified_obligation_ids: ["obl.readiness"],
        },
        {
          ...final!,
          sequence: 2,
          ledger_digest: value.obligation_ledger.closure_digest,
          newly_verified_obligation_ids: [
            repeated ? "obl.readiness" : "obl.second",
          ],
        },
      ];
      // History order is determined by sequence, rather than caller array order.
      value.closure_history.reverse();

      const report = createReconstructionReadinessReport(value);
      expect(report.status).toBe(repeated ? "fail" : "pass");
      expect(report.findings.map(({ code }) => code)).toEqual(
        repeated ? ["invalid-obligation-closure-transition"] : [],
      );
      expect(report.snapshot.closure_history).toEqual(value.closure_history);
    },
  );

  it("does not close a required obligation with an optional obligation's verified proof", () => {
    const value = input();
    const first = value.obligation_ledger.obligations[0]!;
    const optional = structuredClone(first);
    optional.obligation_id = "obl.optional";
    optional.required = false;
    optional.binding!.obligation_id = "obl.optional";
    optional.binding!.verifier!.enumerated_obligation_ids = ["obl.optional"];
    const obligations = [first, optional];
    const ledger = {
      ...value.obligation_ledger,
      obligations,
      summary: summarizeReconstructionObligations(obligations),
      ownership_graph: reconstructionObligationOwnershipGraph(obligations),
    };
    value.obligation_ledger = {
      ...ledger,
      closure_digest: reconstructionObligationLedgerClosureDigest(ledger),
    };
    value.closure_history[1]!.ledger_digest =
      value.obligation_ledger.closure_digest;
    value.closure_history[1]!.newly_verified_obligation_ids = ["obl.optional"];

    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("fail");
    expect(report.findings.map(({ code }) => code)).toEqual([
      "closure-obligation-proof-missing",
    ]);
  });
});

describe("readiness repeated operation outcomes", () => {
  it.each(["cli", "mcp"] as const)(
    "checks a later conflicting %s error and preserves its Evidence",
    (surface) => {
      const value = input();
      const original = value.operation_outcomes.find(
        (outcome) =>
          outcome.surface === surface && outcome.call_kind === "permission",
      )!;
      const later = {
        ...original,
        sequence: 4,
        error_code: "different-error",
        evidence_ids: [value.evidence_bundle.records[1]!.evidence_id],
      };
      value.operation_outcomes.push(later);
      const report = createReconstructionReadinessReport(value);

      expect(report.status).toBe("fail");
      expect(report.summary.passed_required_stages).toBe(8);
      expect(report.findings).toEqual([
        expect.objectContaining({
          code: "surface-semantic-drift",
          stage_id: "export-replay",
          status: "fail",
          evidence_ids: [
            ...new Set([...original.evidence_ids, ...later.evidence_ids]),
          ].sort(),
        }),
      ]);
      expect(report.snapshot.operation_outcomes).toEqual(
        value.operation_outcomes,
      );
      value.operation_outcomes.reverse();
      expect(createReconstructionReadinessReport(value).findings).toEqual(
        report.findings,
      );
    },
  );

  it("checks later success/failure drift even when each transport status is consistent", () => {
    const value = input();
    value.operation_outcomes.push({
      ...value.operation_outcomes[2]!,
      sequence: 4,
      expected_success: true,
      cli_exit_code: 0,
      error_code: null,
    });
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("fail");
    expect(report.findings.map(({ code }) => code)).toEqual([
      "surface-semantic-drift",
    ]);
  });

  it("accepts matched semantic variants without dropping or pairing repeated attempts", () => {
    const value = input();
    value.operation_outcomes.push(
      {
        ...value.operation_outcomes[2]!,
        sequence: 4,
        error_code: "different-error",
      },
      {
        ...value.operation_outcomes[3]!,
        sequence: 5,
        error_code: "different-error",
      },
      { ...value.operation_outcomes[2]!, sequence: 6 },
    );
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("pass");
    expect(report.findings).toEqual([]);
    expect(report.snapshot.operation_outcomes).toEqual(
      value.operation_outcomes,
    );
  });

  it("keeps missing Evidence on a repeated matching outcome unknown", () => {
    const value = input();
    const missing = `ev_${"0".repeat(64)}`;
    value.operation_outcomes.push({
      ...value.operation_outcomes[2]!,
      sequence: 4,
      evidence_ids: [missing],
    });
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("unknown");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "referenced-evidence-missing",
        stage_id: "export-replay",
        status: "unknown",
      }),
    ]);
    expect(report.snapshot.operation_outcomes.at(-1)?.evidence_ids).toEqual([
      missing,
    ]);
  });

  it("reports the retained Evidence for an operation missing the other surface", () => {
    const value = input();
    value.operation_outcomes = value.operation_outcomes.filter(
      (outcome) =>
        !(outcome.call_kind === "permission" && outcome.surface === "mcp"),
    );
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("fail");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "surface-parity-missing",
        evidence_ids: value.operation_outcomes[2]!.evidence_ids,
      }),
    ]);
  });
});

describe("readiness missing Evidence references", () => {
  it("reports each absent Evidence ID once per stage across stage and check references", () => {
    const value = input();
    const stage = value.stages[0]!;
    const missing = [`ev_${"0".repeat(64)}`, `ev_${"1".repeat(64)}`];
    stage.evidence_ids.push(...missing);
    for (const check of stage.checks) check.evidence_ids.push(...missing);

    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("unknown");
    expect(report.findings).toEqual(
      missing.map((id) => ({
        code: "referenced-evidence-missing",
        stage_id: stage.stage_id,
        status: "unknown",
        detail: `Referenced Evidence is absent from the bundle: ${id}.`,
        evidence_ids: [],
      })),
    );
    expect(report.summary).toMatchObject({ findings: 2, unknown_findings: 2 });
  });

  it("keeps absent references distinct across stages and preserves failed checks", () => {
    const value = input();
    const [first, second] = value.stages;
    if (first === undefined || second === undefined)
      throw new TypeError("Missing conformance stages");
    const missing = `ev_${"0".repeat(64)}`;
    first.evidence_ids.push(missing);
    second.checks[0]!.evidence_ids.push(missing);
    first.checks[0]!.status = "fail";

    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("fail");
    expect(
      report.findings
        .filter(({ code }) => code === "referenced-evidence-missing")
        .map(({ stage_id }) => stage_id)
        .sort(),
    ).toEqual([first.stage_id, second.stage_id].sort());
    expect(report.summary).toMatchObject({
      findings: 3,
      unknown_findings: 2,
      failed_findings: 1,
    });
  });

  it("checks stage Evidence even when every required check is absent", () => {
    const value = input();
    const stage = value.stages[0]!;
    stage.checks = [];
    stage.evidence_ids.push(`ev_${"0".repeat(64)}`);

    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("fail");
    expect(report.summary).toMatchObject({ unknown_findings: 1 });
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "referenced-evidence-missing" }),
    );
  });
});

describe("readiness failure semantics", () => {
  it("rejects equivalence over truncated concurrent evidence", () => {
    const value = input();
    const comparison = value.comparisons[0];
    if (comparison === undefined) throw new TypeError("Missing comparison");
    value.comparisons[0] = {
      ...comparison,
      schedule_semantics: "total-order",
      truncated: true,
    };
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("fail");
    expect(report.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "false-equivalence",
        "unsafe-concurrency-semantics",
      ]),
    );
    expect(report.metrics.false_equivalence_count).toBe(1);
  });

  it("keeps green stages unknown while one reconstruction obligation is open", () => {
    const value = input();
    const obligation = value.obligation_ledger.obligations[0];
    if (obligation === undefined)
      throw new TypeError("Missing reconstruction obligation");
    const obligations = [{ ...obligation, status: "blocked" as const }];
    const uncommitted = {
      ...value.obligation_ledger,
      obligations,
      status: reconstructionObligationLedgerStatus(obligations, []),
      summary: summarizeReconstructionObligations(obligations),
    };
    value.obligation_ledger = {
      ...uncommitted,
      closure_digest: reconstructionObligationLedgerClosureDigest(uncommitted),
    };
    const latest = value.closure_history.at(-1);
    if (latest === undefined) throw new TypeError("Missing closure history");
    value.closure_history[value.closure_history.length - 1] = {
      ...latest,
      ledger_digest: value.obligation_ledger.closure_digest,
      status: "open",
      required_open: 1,
      newly_verified_obligation_ids: [],
    };
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("unknown");
    expect(report.stages).toContainEqual(
      expect.objectContaining({
        stage_id: "verify-reconstruction-closure",
        status: "unknown",
      }),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "reconstruction-closure-open" }),
    );
  });

  it("fails typed operation outcomes that ordinary automation sees as success", () => {
    const value = input();
    const cliOutcome = value.operation_outcomes[2];
    const mcpOutcome = value.operation_outcomes[3];
    if (cliOutcome === undefined || mcpOutcome === undefined)
      throw new TypeError("Missing operation outcome pair");
    value.operation_outcomes[2] = {
      ...cliOutcome,
      cli_exit_code: 0,
    };
    value.operation_outcomes[3] = {
      ...mcpOutcome,
      mcp_status: "success",
    };
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("fail");
    expect(report.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["cli-status-mismatch", "mcp-status-mismatch"]),
    );
  });

  it("detects tampering against the exported source digest", () => {
    const baseline = createReconstructionReadinessReport(input());
    const replay = input({
      replay: {
        ...RECONSTRUCTION_READINESS_EXAMPLE.replay,
        expected_source_digest: baseline.source_digest,
      },
    });
    expect(createReconstructionReadinessReport(replay).source_digest).toBe(
      baseline.source_digest,
    );
    replay.identity.cli_version = "tampered";
    const tampered = createReconstructionReadinessReport(replay);

    expect(tampered.status).toBe("fail");
    expect(tampered.findings).toContainEqual(
      expect.objectContaining({ code: "replay-source-digest-mismatch" }),
    );
  });

  it("fails a reconstruction candidate that delegates to the authority", () => {
    const value = input();
    const check = value.delegation_checks[0];
    if (check === undefined) throw new TypeError("Missing delegation check");
    value.delegation_checks[0] = {
      ...check,
      delegates_to_authority: true,
    };
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("fail");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "candidate-delegates-to-authority" }),
    );
  });

  it("preserves an exact unsupported stage without collapsing it to pass", () => {
    const value = input();
    const stage = value.stages.find(
      ({ stage_id: stageId }) => stageId === "reactive-scenarios",
    );
    const check = stage?.checks[0];
    if (stage === undefined || check === undefined)
      throw new TypeError("Missing reactive stage");
    stage.status = "unsupported";
    check.status = "unsupported";
    stage.capability_issue = "electron-runtime-unavailable";
    stage.next_action = "Run on a host with the approved Electron runtime.";
    const report = createReconstructionReadinessReport(value);

    expect(report.status).toBe("unsupported");
    expect(report.stages).toContainEqual(
      expect.objectContaining({
        stage_id: "reactive-scenarios",
        status: "unsupported",
      }),
    );
  });
});

describe("readiness retained observation accounting", () => {
  it.each([false, true])(
    "rejects a conflicting repeated CLI outcome regardless of order (%s)",
    (reverse) => {
      const value = input();
      value.operation_outcomes.push({
        ...value.operation_outcomes[2]!,
        sequence: 4,
        error_code: "different-error",
      });
      if (reverse) value.operation_outcomes.reverse();
      const report = createReconstructionReadinessReport(value);
      expect(report.status).toBe("fail");
      expect(report.findings).toContainEqual(
        expect.objectContaining({
          code: "surface-semantic-drift",
          stage_id: "export-replay",
          detail: expect.stringContaining("4"),
        }),
      );
      expect(report.snapshot.operation_outcomes).toHaveLength(5);
    },
  );

  it("retains agreeing repeats and paired recovery outcomes", () => {
    const value = input();
    value.operation_outcomes.push({
      ...value.operation_outcomes[2]!,
      sequence: 4,
    });
    value.operation_outcomes.push({
      ...value.operation_outcomes[2]!,
      sequence: 5,
      expected_success: true,
      cli_exit_code: 0,
      error_code: null,
    });
    value.operation_outcomes.push({
      ...value.operation_outcomes[3]!,
      sequence: 6,
      expected_success: true,
      mcp_status: "success",
      error_code: null,
    });
    expect(createReconstructionReadinessReport(value).status).toBe("pass");
  });

  it("does not credit duplicate obligation IDs as distinct closure", () => {
    const value = input();
    value.closure_history[0]!.required_open = 2;
    value.closure_history[1]!.newly_verified_obligation_ids = [
      "obl.readiness",
      "obl.readiness",
    ];
    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("fail");
    expect(report.summary.passed_required_stages).toBe(8);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "invalid-obligation-closure-transition",
        stage_id: "verify-reconstruction-closure",
        status: "fail",
        evidence_ids: value.closure_history[1]!.evidence_ids,
      }),
    );
    expect(report.snapshot.closure_history).toEqual(value.closure_history);
    expect(
      report.snapshot.closure_history[1]!.newly_verified_obligation_ids,
    ).toEqual(["obl.readiness", "obl.readiness"]);
  });

  it("checks every historical count against the supplied required-obligation universe", () => {
    const value = input();
    value.closure_history.unshift({
      ...value.closure_history[0]!,
      sequence: 0,
      required_open: 2,
    });
    value.closure_history[1]!.sequence = 1;
    value.closure_history[2]!.sequence = 2;
    value.closure_history[1]!.newly_verified_obligation_ids = ["obl.readiness"];
    const report = createReconstructionReadinessReport(value);
    expect(report.status).toBe("fail");
    expect(
      report.findings.filter(
        ({ code }) => code === "invalid-obligation-closure-transition",
      ),
    ).toHaveLength(2);
  });
});
