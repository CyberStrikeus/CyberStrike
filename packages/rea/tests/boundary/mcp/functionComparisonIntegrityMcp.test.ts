import { expect, it, onTestFinished } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import {
  FUNCTION_COMPARISON_EVIDENCE,
  INVESTIGATION_EXAMPLES,
  PROCESS_CAPTURE_REFERENCE,
  PROCESS_CAPTURE_RECONSTRUCTION,
  PROCESS_COMPARISON_EVIDENCE,
} from "../../../src/contracts/investigationExamples.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import {
  functionComparisonResultSchema,
  type FunctionComparisonResult,
} from "../../../src/domain/functionComparisonSchemas.js";
import { summarize } from "../../../src/domain/functionComparisonResults.js";

import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const conflictingDimensions = (result: FunctionComparisonResult) => {
  const changed = result.dimensions.find(
    (dimension) => dimension.dimension === "pseudocode",
  );
  if (changed?.status !== "changed")
    throw new Error("Fixture requires a known pseudocode change");
  const dimensions = result.dimensions.map((dimension) =>
    dimension.dimension === "pseudocode"
      ? {
          ...changed,
          status: "unchanged" as const,
          conclusion_kind: "derived_relationship" as const,
        }
      : dimension.dimension === "cfg"
        ? changed
        : dimension,
  );
  return {
    ...result,
    dimensions,
    summary: summarize(dimensions),
    changes: dimensions.filter(({ status }) => status !== "unchanged"),
  };
};

const unknownDimension = (result: FunctionComparisonResult) => {
  const dimensions = result.dimensions.map((dimension) =>
    dimension.dimension === "cfg"
      ? {
          ...dimension,
          status: "unknown" as const,
          left_digest: null,
          right_digest: null,
          text_delta: null,
          conclusion_kind: "unresolved_branch" as const,
        }
      : dimension,
  );
  return {
    ...result,
    dimensions,
    summary: summarize(dimensions),
    changes: dimensions.filter(({ status }) => status !== "unchanged"),
  };
};

it.each([
  {
    name: "canonical",
    valid: true,
    result: (value: FunctionComparisonResult) => value,
  },
  {
    name: "reordered canonical",
    valid: true,
    result: (value: FunctionComparisonResult) => ({
      ...value,
      dimensions: [...value.dimensions].reverse(),
      changes: [...value.changes].reverse(),
    }),
  },
  {
    name: "unknown dimension with complete changes",
    valid: true,
    result: unknownDimension,
  },
  {
    name: "omitted unknown dimension with known changes retained",
    valid: false,
    result: (value: FunctionComparisonResult) => {
      const unknown = unknownDimension(value);
      return {
        ...unknown,
        changes: unknown.changes.filter(({ dimension }) => dimension !== "cfg"),
      };
    },
  },
  {
    name: "conflicting dimensions",
    valid: false,
    result: conflictingDimensions,
  },
  {
    name: "reversed conflicting dimensions",
    valid: false,
    result: (value: FunctionComparisonResult) => {
      const malformed = conflictingDimensions(value);
      return {
        ...malformed,
        dimensions: [...malformed.dimensions].reverse(),
        changes: [...malformed.changes].reverse(),
      };
    },
  },
  {
    name: "incorrect summary counts with the correct total",
    valid: false,
    result: (value: FunctionComparisonResult) => ({
      ...value,
      summary: {
        ...value.summary,
        changed: value.summary.changed - 1,
        unchanged: value.summary.unchanged + 1,
      },
    }),
  },
  {
    name: "missing changes",
    valid: false,
    result: (value: FunctionComparisonResult) => ({ ...value, changes: [] }),
  },
  {
    name: "altered change provenance",
    valid: false,
    result: (value: FunctionComparisonResult) => ({
      ...value,
      changes: value.changes.map((dimension, index) =>
        index === 0
          ? {
              ...dimension,
              limitations: [
                ...dimension.limitations,
                "Unattributed change description.",
              ],
            }
          : dimension,
      ),
    }),
  },
  {
    name: "duplicate changes",
    valid: false,
    result: (value: FunctionComparisonResult) => ({
      ...value,
      changes: [...value.changes, ...value.changes],
    }),
  },
])(
  "validates $name function comparisons before investigation publication",
  async (scenario) => {
    const base = FUNCTION_COMPARISON_EVIDENCE;
    const result = functionComparisonResultSchema.parse(base.normalized_result);
    const comparison = createEvidence(undefined, base.provider, {
      predicateType: base.predicate_type,
      operation: base.operation,
      parameters: base.parameters,
      result: scenario.result(result),
      confidence: base.confidence,
      authority: base.authority,
      limitations: base.limitations,
      evidenceLinks: base.evidence_links,
    });
    let providerLaunches = 0;
    const session = createTestBinarySession(() => {
      providerLaunches += 1;
      throw new Error(
        "Retained comparison inspection must not launch a provider",
      );
    });
    const harness = await createApplicationMcpHarness({ session });
    onTestFinished(harness.close);
    for (const record of [
      FUNCTION_COMPARISON_EXAMPLE.left,
      FUNCTION_COMPARISON_EXAMPLE.right,
      PROCESS_CAPTURE_REFERENCE,
      PROCESS_CAPTURE_RECONSTRUCTION,
      PROCESS_COMPARISON_EVIDENCE,
      comparison,
    ])
      expect(session.recordEvidence(record).ok).toBe(true);
    const recordCount = session.exportEvidenceBundle().records.length;
    const correlation = INVESTIGATION_EXAMPLES.correlate_static_and_runtime;
    const calls = [
      {
        name: "find_changed_behavior",
        arguments: { comparisons: [comparison] },
      },
      {
        name: "correlate_static_and_runtime",
        arguments: {
          ...correlation,
          static_comparisons: [comparison],
          mappings: correlation.mappings.map((mapping) => ({
            ...mapping,
            static: {
              ...mapping.static,
              comparison_evidence_id: comparison.evidence_id,
            },
          })),
        },
      },
      {
        name: "verify_reconstruction",
        arguments: {
          specification: {
            name: "Function comparison consistency",
            claims: [
              {
                kind: "structural-function",
                claim_id: "pseudocode",
                title: "Selected pseudocode remains equivalent",
                comparison_evidence_id: comparison.evidence_id,
                dimension: "pseudocode",
              },
            ],
          },
        },
      },
    ];
    const responses = [];
    for (const call of calls)
      responses.push({ call, response: await harness.client.callTool(call) });
    expect(
      Object.fromEntries(
        responses.map(({ call, response }) => [
          call.name,
          response.isError === true,
        ]),
      ),
    ).toEqual(
      Object.fromEntries(calls.map(({ name }) => [name, !scenario.valid])),
    );
    for (const { call, response } of responses) {
      if (scenario.valid)
        expect(parseEvidence(response.structuredContent).operation).toBe(
          call.name,
        );
      else
        expect(parseMcpToolError(response)).toMatchObject({
          error: {
            code: "evidence_integrity_mismatch",
            category: "integrity_mismatch",
          },
        });
    }
    if (!scenario.valid)
      expect(session.exportEvidenceBundle().records).toHaveLength(recordCount);
    expect(session.evidenceById(comparison.evidence_id)).toEqual(comparison);
    expect(providerLaunches).toBe(0);
  },
);
