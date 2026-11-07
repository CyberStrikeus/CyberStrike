import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { ok as resultOk } from "../../../src/domain/result.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import {
  completeReconstructionCoverageData,
  reconstructionCoverageEvidenceId,
  reconstructionCoverageDataFixture,
} from "../../../src/domain/reconstructionCoverage.fixture.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createServer } from "../../../src/server/createServer.js";
import { observed } from "../../fixtures/analysisExecution.js";

describe("reconstruction coverage inline Evidence", () => {
  it("evaluates inline fail-closed coverage without retaining request Evidence", async () => {
    await withCoverageMcp(async ({ client, session }) => {
      const coverage = currentFixtureCoverage();
      const result = await evaluate(client, coverage);

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: "ready",
        boundary_id: "replacement.cli",
        summary: { reasons: 0 },
      });
      expect(session.exportEvidenceBundle().records).toEqual([]);
    });
  });

  it("keeps weak verifier authority unknown and cites its inline Evidence", async () => {
    await withCoverageMcp(async ({ client }) => {
      const coverage = currentFixtureCoverage();
      const latest = coverage.verifier_results[0];
      if (latest === undefined)
        throw new Error("Expected fixture verifier result");
      const inference = createEvidence(
        undefined,
        { id: "weak-proof", name: "Weak proof fixture", version: "1" },
        {
          operation: "infer",
          parameters: {},
          result: { status: "unknown", note: "No replay was performed" },
          authority: "analyst-inference",
          confidence: "inferred",
        },
      );
      const weakCoverage = reconstructionCoverageDataFixture({
        ...coverage,
        evidence_bundle: createEvidenceBundle([
          ...coverage.evidence_bundle.records,
          inference,
        ]),
        verifier_results: [
          { ...latest, evidence_ids: [inference.evidence_id] },
        ],
      });

      const weak = await evaluate(client, weakCoverage);

      expect(weak.isError).not.toBe(true);
      expect(weak.structuredContent).toMatchObject({
        status: "unknown",
        reasons: [
          expect.objectContaining({ code: "verifier-result-incompatible" }),
        ],
        evidence_ids: expect.arrayContaining([inference.evidence_id]),
      });
    });
  });

  it("reports tampered Evidence as an integrity mismatch", async () => {
    await withCoverageMcp(async ({ client }) => {
      const coverage = currentFixtureCoverage();
      const inference = createEvidence(
        undefined,
        { id: "tampered-proof", name: "Tampered proof fixture", version: "1" },
        {
          operation: "infer",
          parameters: {},
          result: { status: "unknown", note: "No replay was performed" },
          authority: "analyst-inference",
          confidence: "inferred",
        },
      );
      const weakCoverage = reconstructionCoverageDataFixture({
        ...coverage,
        evidence_bundle: createEvidenceBundle([
          ...coverage.evidence_bundle.records,
          inference,
        ]),
      });
      const tampered = await client.callTool({
        name: "evaluate_reconstruction_coverage",
        arguments: {
          boundary_id: "replacement.cli",
          coverage: {
            ...weakCoverage,
            evidence_bundle: {
              ...weakCoverage.evidence_bundle,
              records: weakCoverage.evidence_bundle.records.map((record) =>
                record.evidence_id === inference.evidence_id
                  ? {
                      ...record,
                      authority: "controlled-replay",
                      confidence: "observed",
                    }
                  : record,
              ),
            },
          },
        },
      });

      expect(tampered.isError).toBe(true);
      expect(parseMcpToolError(tampered)).toMatchObject({
        error: { code: "evidence_integrity_mismatch" },
      });
    });
  });
});

describe("reconstruction coverage selection", () => {
  it.each([
    {
      label: "unknown root argument",
      selection: { boundary_id: "replacement.cli", unexpected: true },
      path: ["unexpected"],
      reason: "unknown_argument",
    },
    {
      label: "missing boundary",
      selection: {},
      path: ["boundary_id"],
      reason: "missing_argument",
    },
  ])(
    "rejects $label through the shared owner",
    async ({ selection, path, reason }) => {
      await withCoverageMcp(async ({ client, session }) => {
        const result = await client.callTool({
          name: "evaluate_reconstruction_coverage",
          arguments: { coverage: currentFixtureCoverage(), ...selection },
        });
        expect(result.isError).toBe(true);
        expect(parseMcpToolError(result)).toMatchObject({
          error: {
            code: "invalid_request",
            details: {
              operation: "evaluate_reconstruction_coverage",
              issues: [{ path, reason }],
            },
          },
        });
        expect(session.exportEvidenceBundle().records).toEqual([]);
      });
    },
  );

  it("reports ambiguity when multiple verifier results cover one claim", async () => {
    await withCoverageMcp(async ({ client }) => {
      const coverage = currentFixtureCoverage();
      const latest = coverage.verifier_results[0];
      if (latest === undefined)
        throw new Error("Expected fixture verifier result");
      const ambiguousCoverage = reconstructionCoverageDataFixture({
        ...coverage,
        verifier_results: [
          latest,
          {
            ...latest,
            status: "fail",
            evidence_ids: [reconstructionCoverageEvidenceId("1")],
          },
        ],
      });

      const ambiguous = await evaluate(client, ambiguousCoverage);

      expect(ambiguous.isError).not.toBe(true);
      expect(ambiguous.structuredContent).toMatchObject({
        status: "unknown",
        boundary_id: "replacement.cli",
        reasons: [
          expect.objectContaining({
            code: "verifier-result-ambiguous",
            subject_id: "claim.cli.help",
          }),
        ],
        evidence_ids: expect.arrayContaining([
          reconstructionCoverageEvidenceId("3"),
          reconstructionCoverageEvidenceId("1"),
        ]),
      });
    });
  });

  it("projects an unknown boundary as an input issue at boundary_id", async () => {
    await withCoverageMcp(async ({ client }) => {
      const unknown = await client.callTool({
        name: "evaluate_reconstruction_coverage",
        arguments: {
          coverage: currentFixtureCoverage(),
          boundary_id: "replacement.missing",
        },
      });

      expect(unknown.isError).toBe(true);
      expect(parseMcpToolError(unknown)).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["boundary_id"],
                reason: "invalid_value",
                message: "Unknown reconstruction boundary: replacement.missing",
              },
            ],
          },
        },
      });
    });
  });

  it("projects a duplicate workspace surface ID at the duplicate surface", async () => {
    await withCoverageMcp(async ({ client }) => {
      const coverage = currentFixtureCoverage();
      const surface = coverage.surfaces[0];
      if (surface === undefined) throw new Error("Expected fixture surface");
      const duplicateSurface = await client.callTool({
        name: "evaluate_reconstruction_coverage",
        arguments: {
          boundary_id: "replacement.cli",
          coverage: {
            ...coverage,
            surfaces: [...coverage.surfaces, { ...surface }],
          },
        },
      });

      expect(duplicateSurface.isError).toBe(true);
      expect(parseMcpToolError(duplicateSurface)).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["coverage", "surfaces", 1, "surface_id"],
                reason: "invalid_value",
              },
            ],
          },
        },
      });
    });
  });
});

const evaluate = (
  client: Client,
  coverage: ReturnType<typeof currentFixtureCoverage>,
) =>
  client.callTool({
    name: "evaluate_reconstruction_coverage",
    arguments: { coverage, boundary_id: "replacement.cli" },
  });

const withCoverageMcp = async <T>(
  run: (fixture: {
    readonly client: Client;
    readonly session: ReturnType<typeof createTestBinarySession>;
  }) => Promise<T>,
): Promise<T> => {
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "coverage-mcp-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await run({ client, session });
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
};

const currentFixtureCoverage = () => {
  const coverage = completeReconstructionCoverageData();
  return reconstructionCoverageDataFixture({
    ...coverage,
    verifier_results: coverage.verifier_results.map((result) => ({
      ...result,
      observed_at: new Date().toISOString(),
    })),
  });
};
