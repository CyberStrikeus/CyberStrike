import { reconstructionProofApplicabilityCases } from "../../fixtures/reconstructionProofApplicability.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { reconstructionObligationLedgerSchema } from "../../../src/domain/reconstructionObligationLedgerSchemas.js";

import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import {
  MIXED_AUTHORITY_SUMMARY,
  mixedAuthorityRequest,
  readyProcessLedgerRequest,
  readyReviewedLedgerRequest,
} from "../../../src/application/ReconstructionObligationLedger.fixture.js";

const execute = promisify(execFile);

describe("reconstruction obligation ledger CLI parity", () => {
  it("withholds readiness for an optional obligation's missing Evidence", async () => {
    const input = readyReviewedLedgerRequest();
    const binding = input.manifest.bindings[0]!;
    const absent = `ev_${"c".repeat(64)}`;
    const extra = {
      fixture_id: "fixture.extra",
      case_kind: "malformed" as const,
      authority: "unit" as const,
      evidence_ids: [absent],
    };
    for (const evidenceId of [absent, binding.verifier!.result_evidence_id]) {
      const variant = {
        ...input,
        reviewed_obligations: [
          { ...input.reviewed_obligations[0]!, required: false },
        ],
        manifest: {
          ...input.manifest,
          bindings: [
            {
              ...binding,
              fixtures: [
                ...binding.fixtures,
                { ...extra, evidence_ids: [evidenceId] },
              ],
            },
          ],
        },
      };
      const { stdout } = await execute(
        process.execPath,
        [
          "scripts/rea.mjs",
          "build-reconstruction-obligation-ledger",
          JSON.stringify(variant),
          "--json",
        ],
        { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
      );
      const ledger = reconstructionObligationLedgerSchema.parse(
        JSON.parse(stdout).normalized_result,
      );
      expect(ledger.status).toBe(evidenceId === absent ? "unknown" : "ready");
      if (evidenceId === absent) {
        expect(ledger.evidence_links).toContain(absent);
        expect(ledger.obligations[0]?.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "missing-case",
            detail: expect.stringContaining(absent),
          }),
        );
      }
    }
  }, 20_000);
});

describe("reconstruction obligation ledger CLI bundle validation", () => {
  it("reports non-canonical authenticated bundles as caller input", async () => {
    const records = ["first", "second"].map((label) =>
      createEvidence(
        undefined,
        { id: "fixture", name: "Fixture", version: "1" },
        {
          operation: "observe",
          parameters: { label },
          result: { label },
        },
      ),
    );
    const canonical = createEvidenceBundle(records);
    const input = {
      evidence_bundle: canonical,
      reviewed_obligations: [],
      manifest: { bindings: [], contradictions: [] },
    };
    const accepted = await execute(
      process.execPath,
      [
        "scripts/rea.mjs",
        "build-reconstruction-obligation-ledger",
        JSON.stringify(input),
        "--json",
      ],
      { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
    );
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      normalized_result: { status: "unknown", summary: { total: 0 } },
    });
    input.evidence_bundle = {
      ...canonical,
      records: [...canonical.records].reverse(),
    };
    let stdout: string;
    try {
      await execute(
        process.execPath,
        [
          "scripts/rea.mjs",
          "build-reconstruction-obligation-ledger",
          JSON.stringify(input),
          "--json",
        ],
        { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
      );
      throw new Error("Expected non-canonical bundle input to fail");
    } catch (cause: unknown) {
      if (
        !(cause instanceof Error) ||
        !("stdout" in cause) ||
        typeof cause.stdout !== "string"
      )
        throw cause;
      stdout = cause.stdout;
    }
    expect(JSON.parse(stdout)).toMatchObject({
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
      retryable: false,
      details: {
        reason: expect.stringContaining(
          "Evidence bundle manifests are not canonical",
        ),
      },
    });
  }, 20_000);

  it("builds the same Evidence-backed empty ledger through the CLI", async () => {
    const input = {
      evidence_bundle: createEvidenceBundle([]),
      reviewed_obligations: [],
      manifest: {
        bindings: [],
        contradictions: [],
      },
    };
    const { stdout } = await execute(
      process.execPath,
      [
        "scripts/rea.mjs",
        "build-reconstruction-obligation-ledger",
        JSON.stringify(input),
        "--json",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 16 * 1_024 * 1_024,
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      operation: "build_reconstruction_obligation_ledger",
      predicate_type: "rea.reconstruction-obligation-ledger",
      normalized_result: {
        schema: "ReconstructionObligationLedger",
        status: "unknown",
        summary: { total: 0 },
      },
    });
  }, 20_000);

  it("summarizes obligations by their cited Evidence authorities", async () => {
    const { stdout } = await execute(
      process.execPath,
      [
        "scripts/rea.mjs",
        "build-reconstruction-obligation-ledger",
        JSON.stringify(mixedAuthorityRequest()),
        "--json",
      ],
      { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
    );
    const ledger = JSON.parse(stdout).normalized_result;
    expect(ledger.summary).toMatchObject(MIXED_AUTHORITY_SUMMARY);
    expect(
      ledger.obligations.map(
        (obligation: {
          readonly obligation_id: string;
          readonly authority_references: readonly {
            readonly authority: string;
            readonly state: string;
          }[];
        }) => [
          obligation.obligation_id,
          obligation.authority_references.map(
            ({ authority, state }) => `${authority}/${state}`,
          ),
        ],
      ),
    ).toEqual([
      [
        "review.mixed",
        expect.arrayContaining([
          "shipped-artifact/candidate",
          "controlled-replay/reviewed",
        ]),
      ],
      ["review.shipped", ["shipped-artifact/candidate"]],
    ]);
  }, 20_000);
});

describe("reconstruction obligation ledger CLI contradictions", () => {
  it("keeps a complete contradiction beside an entry naming absent Evidence", async () => {
    const input = readyProcessLedgerRequest();
    const obligationId = input.manifest.bindings[0]?.obligation_id;
    const [present, other] = input.evidence_bundle.records.map(
      ({ evidence_id: id }) => id,
    );
    if (
      obligationId === undefined ||
      present === undefined ||
      other === undefined
    )
      throw new Error("Expected a bound obligation and two Evidence records");
    const absent = `ev_${"f".repeat(64)}`;
    const complete = {
      obligation_id: obligationId,
      evidence_ids: [present, other],
    };
    const incomplete = {
      obligation_id: obligationId,
      evidence_ids: [present, absent],
    };
    // Each entry is its own claim; entry order must not decide the outcome.
    for (const contradictions of [
      [complete, incomplete],
      [incomplete, complete],
    ]) {
      const { stdout } = await execute(
        process.execPath,
        [
          "scripts/rea.mjs",
          "build-reconstruction-obligation-ledger",
          JSON.stringify({
            ...input,
            manifest: { ...input.manifest, contradictions },
          }),
          "--json",
        ],
        { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
      );
      const ledger = JSON.parse(stdout).normalized_result;
      expect(ledger).toMatchObject({
        status: "failed",
        reports: { contradicted_obligation_ids: [obligationId] },
        obligations: [
          {
            status: "contradicted",
            diagnostics: [
              {
                code: "contradiction-evidence-missing",
                detail: `Contradiction references missing Evidence: ${absent}.`,
              },
              { code: "contradiction" },
            ],
          },
        ],
      });
    }
  }, 20_000);
});

cliTest(
  "retains authentic dynamic-event uncertainty through analysis and ledger CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ledger-semantic-");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "sample-app", version: "1.0.0", main: "main.js" }),
    );
    await writeFile(
      join(root, "main.js"),
      [
        "const events = require('node:events');",
        "const bus = new events.EventEmitter();",
        "bus.on(process.argv[2], () => console.log('done'));",
      ].join("\n"),
    );
    const analyzed = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(analyzed.exitCode).toBe(0);
    const application = parseEvidence(analyzed.json);
    const source = javascriptApplicationAnalysisResultSchema.parse(
      application.normalized_result,
    );
    expect(source.graph.coverage.status).toBe("complete");
    expect(source.semantic_graph.coverage.status).toBe("unknown");
    const eventUnknown = source.semantic_graph.unknowns.find(
      ({ family }) => family === "event",
    );
    expect(eventUnknown?.detail).toBe(
      "Dynamic on event name remains unresolved.",
    );
    if (eventUnknown === undefined)
      throw new Error("Missing analyzer event frontier");
    const requestPath = join(root, "ledger-request.json");
    await writeFile(
      requestPath,
      JSON.stringify({
        evidence_bundle: createEvidenceBundle([application]),
        reviewed_obligations: [],
        manifest: { bindings: [], contradictions: [] },
      }),
    );
    const built = await cli.run({
      arguments: [
        "build-reconstruction-obligation-ledger",
        requestPath,
        "--json",
      ],
    });
    expect(built.exitCode).toBe(0);
    const ledger = reconstructionObligationLedgerSchema.parse(
      parseEvidence(built.json).normalized_result,
    );
    const event = ledger.obligations.find(
      ({ target }) => target.semantic_node_id === eventUnknown.node_id,
    );
    expect(event).toMatchObject({
      family: "event",
      residual_unknown_ids: [eventUnknown.unknown_id],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "residual-unknown" }),
      ]),
    });
    expect(
      ledger.obligations.some(({ family }) => family === "package-lifecycle"),
    ).toBe(true);
    expect(ledger.reports.residual_unknown_ids).toContain(
      eventUnknown.unknown_id,
    );
    expect(ledger.coverage.status).toBe("partial");
    expect(ledger.status).not.toBe("ready");
    for (const unknown of source.semantic_graph.unknowns)
      expect(
        ledger.limitations.some(
          (limitation) =>
            limitation.includes(unknown.unknown_id) &&
            limitation.includes(unknown.detail),
        ),
      ).toBe(true);
  },
);

describe("reconstruction proof applicability through CLI", () => {
  for (const {
    name,
    input,
    status,
    reason,
    codes,
  } of reconstructionProofApplicabilityCases())
    cliTest(
      name,
      async ({ cli }) => {
        const invocation = {
          arguments: [
            "build-reconstruction-obligation-ledger",
            JSON.stringify(input),
            "--json",
          ],
        };
        const result =
          name === "matching implementation and revision"
            ? await cli.run(invocation)
            : await runFileCli(cli, invocation);
        expect(result.exitCode, result.stderr).toBe(0);
        const ledger = reconstructionObligationLedgerSchema.parse(
          (result.json as { normalized_result: unknown }).normalized_result,
        );
        expect(ledger.status).toBe(status);
        const obligation = ledger.obligations[0]!;
        expect(obligation.status).toBe(
          status === "ready" ? "verified" : "implemented",
        );
        expect(obligation.diagnostics.map(({ code }) => code).sort()).toEqual(
          [...codes].sort(),
        );
        expect(ledger.summary.required_open).toBe(status === "ready" ? 0 : 1);
        for (const fixture of input.manifest.bindings[0]!.fixtures)
          for (const evidenceId of fixture.evidence_ids)
            expect(ledger.evidence_links).toContain(evidenceId);
        if (reason === null) expect(obligation.diagnostics).toEqual([]);
        else
          expect(
            obligation.diagnostics.some(({ detail }) =>
              detail.includes(reason),
            ),
          ).toBe(true);
      },
      20_000,
    );
});
