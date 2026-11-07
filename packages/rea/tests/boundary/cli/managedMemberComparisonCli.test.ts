import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import * as comparison from "../../../src/application/managed/ManagedMemberComparisonService.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { registerManagedCommands } from "../../../src/cli/managedCommands.js";
import { CLI_COMMANDS } from "../../../src/cliCommandNames.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { managedMemberInspectionSchema } from "../../../src/domain/managed/managedArtifact.js";
import { managedMemberComparisonResultSchema } from "../../../src/domain/managed/managedMemberComparison.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "attributes malformed managed comparison input to its selected argument and retains completed peer Evidence",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-managed-malformed-cli-",
    );
    const good = join(directory, "good.dll");
    const bad = join(directory, "bad.dll");
    const bytes = buildManagedPeFixture();
    await writeFile(good, bytes);
    bytes.writeUInt16LE(0, bytes.readUInt32LE(0x3c) + 6);
    await writeFile(bad, bytes);

    const healthy = await cli.run({
      arguments: ["compare-managed-members", good, good, "--json"],
    });
    expect(healthy.exitCode, healthy.stderr).toBe(0);
    expect(healthy.json).toMatchObject({
      operation: "compare_managed_members",
      parameters: { left_path: good, right_path: good },
    });

    for (const field of ["leftPath", "rightPath"] as const) {
      const result = await cli.run({
        arguments: [
          "compare-managed-members",
          field === "leftPath" ? bad : good,
          field === "rightPath" ? bad : good,
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        retryable: false,
        details: {
          issues: [
            {
              path: [field],
              reason: "invalid_format",
              message: `Selected artifact ${bad}: PE section count must be positive`,
            },
          ],
        },
      });
      if (field === "rightPath")
        expect(result.json).toMatchObject({
          details: {
            partial_observation: {
              operation: "inspect_managed_members",
              subject: { local_path: good },
            },
          },
        });
      else
        expect(result.json).not.toHaveProperty("details.partial_observation");
    }

    const inspection = await cli.run({
      arguments: ["inspect-managed-members", bad, "--json"],
    });
    expect(inspection.exitCode, inspection.stderr).toBe(1);
    expect(inspection.json).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        issues: [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `Selected artifact ${bad}: PE section count must be positive`,
          },
        ],
      },
    });
  },
);

cliTest(
  "keeps malformed signatures unknown through CLI and stdio MCP comparison while a valid control stays unchanged",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-managed-signature-cli-",
    );
    const call = await cli.sharedMcpCall!();
    for (const malformed of [true, false]) {
      const name = malformed ? "truncated" : "control";
      const path = join(directory, `${name}.dll`);
      const peerPath = join(directory, `${name}-peer.dll`);
      const bytes = buildManagedPeFixture({
        methodSignature: Buffer.from(
          malformed ? [0x00, 0x80] : [0x00, 0x00, 0x01],
        ),
        ilBody: Buffer.from([0x06, 0x2a]),
      });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(path, bytes);
      await writeFile(peerPath, bytes);
      const inspected = await cli.sharedCliRun!({
        arguments: ["inspect-managed-members", path, "--json"],
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const cliEvidence = parseEvidence(inspected.json);
      const mcpInspected = await call("inspect_managed_members", {
        path: peerPath,
      });
      expect(mcpInspected.isError, JSON.stringify(mcpInspected)).not.toBe(true);
      const mcpEvidence = parseEvidence(mcpInspected.structuredContent);
      for (const [evidence, sourcePath] of [
        [cliEvidence, path],
        [mcpEvidence, peerPath],
      ] as const) {
        const report = managedMemberInspectionSchema.parse(
          evidence.normalized_result,
        );
        expect(report.artifact).toMatchObject({ path: sourcePath, sha256 });
        expect(report.coverage.state).toBe(malformed ? "partial" : "complete");
        expect(report.methods[0]?.signature).toMatchObject({
          parse_status: malformed ? "malformed" : "decoded",
          ...(malformed
            ? { issue: "truncated compressed integer", resolved_sha256: null }
            : {}),
        });
      }
      const compared = await cli.sharedCliRun!({
        arguments: ["compare-managed-members", path, path, "--json"],
      });
      expect(compared.exitCode, compared.stderr).toBe(0);
      // Identical bytes under separate paths provide distinct authenticated
      // observations for MCP, whose Evidence inputs must have different IDs.
      const mcpCompared = await call("compare_managed_members", {
        left: cliEvidence,
        right: mcpEvidence,
      });
      expect(mcpCompared.isError, JSON.stringify(mcpCompared)).not.toBe(true);
      for (const evidence of [
        parseEvidence(compared.json),
        parseEvidence(mcpCompared.structuredContent),
      ]) {
        const report = managedMemberComparisonResultSchema.parse(
          evidence.normalized_result,
        );
        expect(report.left.artifact_sha256).toBe(sha256);
        expect(report.right.artifact_sha256).toBe(sha256);
        expect(report.coverage.status).toBe(
          malformed ? "partial" : "complete-within-inputs",
        );
        expect(report.summary).toEqual({
          unchanged: malformed ? 1 : 2,
          changed: 0,
          added: 0,
          removed: 0,
          unknown: malformed ? 1 : 0,
        });
        expect(report.methods).toEqual([
          expect.objectContaining({
            status: malformed ? "unknown" : "unchanged",
            match: expect.objectContaining({
              status: "matched",
              basis: "exact-il-signature",
              confidence: "exact",
            }),
            limitations: malformed
              ? [expect.stringMatching(/^signature-malformed:/)]
              : [],
          }),
        ]);
        expect(report.fields[0]?.status).toBe("unchanged");
      }
    }
  },
);

const managedComparisonEvidence = async () => {
  const directory = await createTestTempDirectory("rea-managed-finalization-");
  const path = join(directory, "comparison.dll");
  await writeFile(path, buildManagedPeFixture());
  const result = await comparison.compareManagedMemberPaths({
    leftPath: path,
    rightPath: path,
  });
  if (!result.ok) throw result.error;
  return result.value;
};

const registeredComparisonCommand = () => {
  const commands = new Map<string, { run(input: unknown): Promise<unknown> }>();
  const cli = {
    command: (
      name: string,
      definition: { run(input: unknown): Promise<unknown> },
    ) => {
      commands.set(name, definition);
      return cli;
    },
  } as unknown as Parameters<typeof registerManagedCommands>[0];
  registerManagedCommands(cli, silentLogger, async () => ({
    ok: false,
    error: null,
  }));
  return commands.get(CLI_COMMANDS.compareManagedMembers)!;
};

it.each([true, false])(
  "retains the comparison outcome when final cleanup fails (success: %s)",
  async (success) => {
    const evidence = await managedComparisonEvidence();
    const run = vi
      .spyOn(comparison, "compareManagedMemberPaths")
      .mockResolvedValue(
        success
          ? ok(evidence)
          : err(
              new AnalysisOutputError(
                "compare_managed_members",
                "primary comparison failure",
                {
                  partialObservation: evidence,
                },
              ),
            ),
      );
    const close = vi
      .spyOn(ArtifactResourceScope.prototype, "close")
      .mockRejectedValue(new Error("comparison close denied"));
    try {
      const result = await registeredComparisonCommand().run({
        args: { leftPath: "left.dll", rightPath: "right.dll" },
      });
      expect(result).toMatchObject({
        error: "Managed member comparison failed",
        code: "cleanup_incomplete",
        details: {
          partial_observation: { evidence_id: evidence.evidence_id },
        },
      });
      expect(result).toMatchObject({
        details: {
          diagnostics: success
            ? { reason: "comparison close denied" }
            : {
                primary_error: {
                  code: "unreadable_output",
                  details: { reason: "primary comparison failure" },
                },
                cleanup_error: {
                  code: "cleanup_incomplete",
                  details: {
                    diagnostics: { reason: "comparison close denied" },
                  },
                },
              },
        },
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      run.mockRestore();
      close.mockRestore();
    }
  },
);

it("retains completed comparison Evidence when interrupted during final cleanup", async () => {
  const evidence = await managedComparisonEvidence();
  const run = vi
    .spyOn(comparison, "compareManagedMemberPaths")
    .mockResolvedValue(ok(evidence));
  const close = vi
    .spyOn(ArtifactResourceScope.prototype, "close")
    .mockImplementation(async () => {
      process.emit("SIGINT");
    });
  const previousExitCode = process.exitCode;
  try {
    const result = await registeredComparisonCommand().run({
      args: { leftPath: "left.dll", rightPath: "right.dll" },
    });
    expect(result).toMatchObject({
      error: "Managed member comparison failed",
      code: "cancelled",
      details: { partial_observation: { evidence_id: evidence.evidence_id } },
    });
    expect(process.exitCode).toBe(130);
  } finally {
    process.exitCode = previousExitCode;
    run.mockRestore();
    close.mockRestore();
  }
});
