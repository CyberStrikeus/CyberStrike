import { expect, it } from "vitest";
import { buildManagedPeFixture } from "../../../../scripts/fixtures/managed/pe.mjs";
import { managedPeFixtureTarget } from "../../../../src/dotnet/ManagedPe.fixture.js";
import { inspectManagedMembersBytes } from "../../../../src/dotnet/ManagedMemberInspector.js";
import { createEvidence } from "../../../../src/domain/evidence.js";
import { comparisonLimitations } from "../../../../src/domain/managed/managedMemberComparisonCoverage.js";
import { executeManagedMemberComparison } from "../../../../src/application/managed/ManagedMemberComparisonService.js";
import { managedMemberComparisonResultSchema } from "../../../../src/domain/managed/managedMemberComparison.js";

it("keeps field comparison policy and delivers its owning limitation for changed defaults", () => {
  const observe = (hex: string, hasDefault = true, moduleByte = 0) => {
    const bytes = buildManagedPeFixture({
      mvid: Buffer.alloc(16, moduleByte),
      fields: [{ name: "Default", flags: hasDefault ? 0x8056 : 0x56 }],
      constants: hasDefault
        ? [{ typeCode: 8, value: Buffer.from(hex, "hex") }]
        : [],
    });
    const target = managedPeFixtureTarget(bytes);
    const report = inspectManagedMembersBytes(bytes, target);
    return {
      report,
      evidence: createEvidence(
        target,
        { id: "constant-fixture", name: "Constant fixture", version: "1" },
        {
          operation: "inspect_managed_members",
          parameters: {},
          result: report,
          confidence: "observed",
          authority: "shipped-artifact",
        },
      ),
    };
  };
  const left = observe("01000000");
  const right = observe("02000000");
  expect(left.report.fields[0]?.constant?.value).toBe(1);
  expect(right.report.fields[0]?.constant?.value).toBe(2);
  const result = executeManagedMemberComparison({
    left: left.evidence,
    right: right.evidence,
  });
  if (!result.ok) throw result.error;
  const comparison = managedMemberComparisonResultSchema.parse(
    result.value.evidence.normalized_result,
  );
  expect(comparison.fields).toEqual([
    expect.objectContaining({
      status: "unchanged",
      match: {
        status: "matched",
        basis: "field-signature",
        confidence: "exact",
        candidate_left_tokens: [],
        candidate_right_tokens: [],
      },
    }),
  ]);
  expect(comparison.limitations).toEqual(
    expect.arrayContaining(comparisonLimitations(left.report, right.report)),
  );
  const ordinary = observe("", false, 1);
  const otherOrdinary = observe("", false, 2);
  expect(ordinary.report.fields[0]?.constant).toBeNull();
  const baseline = executeManagedMemberComparison({
    left: ordinary.evidence,
    right: otherOrdinary.evidence,
  });
  if (!baseline.ok) throw baseline.error;
  const baselineComparison = managedMemberComparisonResultSchema.parse(
    baseline.value.evidence.normalized_result,
  );
  expect(
    comparison.limitations.filter(
      (limitation) => !baselineComparison.limitations.includes(limitation),
    ),
  ).toHaveLength(1);
});
