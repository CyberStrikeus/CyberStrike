import { reconstructionClosureResultSchema } from "../../../src/domain/reconstructionCoverage.js";
import { reconstructionCoverageScopeCases } from "../../../src/domain/reconstructionCoverageScope.fixture.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { completeReconstructionCoverageData } from "../../../src/domain/reconstructionCoverage.fixture.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const currentCoverage = () => {
  const coverage = completeReconstructionCoverageData();
  return {
    ...coverage,
    verifier_results: coverage.verifier_results.map((result) => ({
      ...result,
      observed_at: new Date().toISOString(),
    })),
  };
};

const evaluate = async (cli: TestCli, coverage: unknown) => {
  const root = await createTestTempDirectory("rea-coverage-cli-");
  const input = join(root, "request.json");
  await writeFile(
    input,
    JSON.stringify({ coverage, boundary_id: "replacement.cli" }),
  );
  return cli.run({
    arguments: ["evaluate-reconstruction-coverage", input, "--json"],
    cwd: root,
  });
};

cliTest(
  "evaluates complete inline coverage through the compiled CLI",
  async ({ cli }) => {
    const result = await evaluate(cli, currentCoverage());
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      boundary_id: "replacement.cli",
      status: "ready",
      summary: { reasons: 0 },
    });
  },
);

cliTest(
  "reports a tampered coverage record as an integrity failure",
  async ({ cli }) => {
    const coverage = currentCoverage();
    const result = await evaluate(cli, {
      ...coverage,
      evidence_bundle: {
        ...coverage.evidence_bundle,
        records: coverage.evidence_bundle.records.map((record, index) =>
          index === 0
            ? { ...record, normalized_result: { tampered: true } }
            : record,
        ),
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
    });
  },
);

cliTest(
  "preserves shared integrity diagnostics for malformed source Evidence",
  async ({ cli }) => {
    const coverage = currentCoverage();
    const malformed = {
      ...coverage,
      evidence_bundle: {
        ...coverage.evidence_bundle,
        records: coverage.evidence_bundle.records.map((record, index) =>
          index === 0
            ? { ...record, provider: { ...record.provider, name: 3 } }
            : record,
        ),
      },
    };
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected file MCP session");
    const mcp = await call("evaluate_reconstruction_coverage", {
      coverage: malformed,
      boundary_id: "replacement.cli",
    });
    expect(mcp.isError).toBe(true);
    expect(parseMcpToolError(mcp)).toMatchObject({
      error: { code: "evidence_integrity_mismatch" },
    });
    const result = await evaluate(cli, malformed);
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
    });
  },
);

cliTest(
  "locates malformed coverage through its shared workflow owner",
  async ({ cli }) => {
    const result = await evaluate(cli, { ...currentCoverage(), owners: 3 });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "evaluate_reconstruction_coverage",
        issues: [{ path: ["coverage", "owners"], reason: "invalid_type" }],
      },
    });
  },
);

cliTest(
  "accounts for effective scope and conflicting proofs through CLI and MCP",
  async ({ cli }) => {
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected shared file MCP session");
    for (const {
      label,
      coverage,
      status,
      codes,
      surfaces,
      evidenceIds,
    } of reconstructionCoverageScopeCases()) {
      coverage.verifier_results[0]!.observed_at = new Date().toISOString();
      const cliResult = await evaluate(cli, coverage);
      expect(cliResult.exitCode, label).toBe(0);
      const mcpResult = await call("evaluate_reconstruction_coverage", {
        coverage,
        boundary_id: "replacement.cli",
      });
      expect(mcpResult.isError, label).not.toBe(true);
      for (const output of [cliResult.json, mcpResult.structuredContent]) {
        const result = reconstructionClosureResultSchema.parse(output);
        expect(result.status, label).toBe(status);
        expect(result.summary.required_surfaces, label).toBe(surfaces);
        expect(result.reasons.map(({ code }) => code).sort(), label).toEqual(
          [...codes].sort(),
        );
        expect(result.evidence_ids, label).toEqual(
          expect.arrayContaining([...evidenceIds]),
        );
      }
    }
  },
);
