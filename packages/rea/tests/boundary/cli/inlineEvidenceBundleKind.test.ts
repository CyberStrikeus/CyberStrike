import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createEvidence } from "../../../src/domain/evidence.js";
import { completeReconstructionCoverageData } from "../../../src/domain/reconstructionCoverage.fixture.js";
import { readyProcessLedgerRequest } from "../../../src/application/ReconstructionObligationLedger.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "inline reconstruction distinguishes an authenticated record from a corrupt bundle",
  async ({ cli }) => {
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: {},
        result: { observed: true },
      },
    );
    const root = await createTestTempDirectory("rea-inline-bundle-kind-");
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected MCP session");
    const cases = [
      {
        command: "build-reconstruction-obligation-ledger",
        tool: "build_reconstruction_obligation_ledger",
        path: ["evidence_bundle"],
        input: { ...readyProcessLedgerRequest(), evidence_bundle: record },
      },
      {
        command: "evaluate-reconstruction-coverage",
        tool: "evaluate_reconstruction_coverage",
        path: ["coverage", "evidence_bundle"],
        input: {
          coverage: {
            ...completeReconstructionCoverageData(),
            evidence_bundle: record,
          },
          boundary_id: "replacement.cli",
        },
      },
    ];
    for (const scenario of cases) {
      const request = join(root, `${scenario.command}.json`);
      await writeFile(request, JSON.stringify(scenario.input));
      const result = await cli.run({
        arguments: [scenario.command, request, "--json"],
        cwd: root,
      });
      const response = await call(scenario.tool, scenario.input);
      expect(result.exitCode).toBe(1);
      const expected = {
        code: "invalid_request",
        category: "invalid_input",
        details: {
          issues: [
            {
              path: scenario.path,
              reason: "invalid_value",
              message: expect.stringContaining("one Evidence record"),
            },
          ],
        },
        remediation: {
          action: expect.stringContaining("export_evidence_bundle"),
        },
      };
      expect(result.json).toMatchObject(expected);
      expect(response.isError).toBe(true);
      // The advertised MCP schema rejects the wrong shape before the domain reader.
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
      });
    }

    // A record with a changed payload is not authenticated as a standalone record.
    const altered = { ...record, normalized_result: { observed: false } };
    const malformed = {
      ...readyProcessLedgerRequest(),
      evidence_bundle: altered,
    };
    const request = join(root, "altered.json");
    await writeFile(request, JSON.stringify(malformed));
    const result = await cli.run({
      arguments: ["build-reconstruction-obligation-ledger", request, "--json"],
      cwd: root,
    });
    const response = await call(
      "build_reconstruction_obligation_ledger",
      malformed,
    );
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
    });
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "invalid_request",
    });
  },
);
