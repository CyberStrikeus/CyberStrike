import { describe, expect, it } from "vitest";

import {
  assessFunctionCallCoverage,
  combineFunctionRelationshipCoverage,
  isCallerOnlyIncompleteCoverage,
} from "./functionCallCoverage.js";
import type { RelationshipCoverage } from "./relationshipCoverage.js";

const unknownCallers: RelationshipCoverage = {
  status: "unknown",
  reason: "Upstream xrefs do not establish direct caller relationships.",
};
const unknownCallees: RelationshipCoverage = {
  status: "unknown",
  reason: "Upstream callees are not observed in this profile.",
};
const cappedCallees: RelationshipCoverage = {
  status: "partial",
  limitations: [
    "Upstream callees capped results at 500; additional callees remain unknown.",
  ],
};
const complete: RelationshipCoverage = { status: "complete" };

describe("isCallerOnlyIncompleteCoverage", () => {
  it("detects unknown callers beside complete callees", () => {
    const combined = combineFunctionRelationshipCoverage(
      unknownCallers,
      complete,
    );
    expect(combined.status).toBe("unknown");
    expect(isCallerOnlyIncompleteCoverage(combined)).toBe(true);
  });

  it("rejects unknown callees beside complete callers", () => {
    const combined = combineFunctionRelationshipCoverage(
      complete,
      unknownCallees,
    );
    expect(isCallerOnlyIncompleteCoverage(combined)).toBe(false);
  });

  it("rejects unknown coverage on both sides", () => {
    const combined = combineFunctionRelationshipCoverage(
      unknownCallers,
      unknownCallees,
    );
    expect(isCallerOnlyIncompleteCoverage(combined)).toBe(false);
  });

  it("rejects unknown callers beside IDA-capped callees", () => {
    const combined = combineFunctionRelationshipCoverage(
      unknownCallers,
      cappedCallees,
    );
    expect(combined.status).toBe("unknown");
    expect(isCallerOnlyIncompleteCoverage(combined)).toBe(false);
  });

  it("rejects complete coverage", () => {
    const combined = combineFunctionRelationshipCoverage(complete, complete);
    expect(isCallerOnlyIncompleteCoverage(combined)).toBe(false);
  });

  it("retains caller-only partial coverage without relying on limitation wording", () => {
    const combined = combineFunctionRelationshipCoverage(
      { status: "partial", limitations: ["Missing incoming references."] },
      complete,
    );
    expect(combined).toMatchObject({ limited_directions: ["callers"] });
    expect(isCallerOnlyIncompleteCoverage(combined)).toBe(true);
  });

  it("uses explicit directions even when explanation text contains direction labels", () => {
    expect(
      isCallerOnlyIncompleteCoverage({
        status: "unknown",
        reason: "Callers: unavailable. Callees: diagnostic text.",
        limited_directions: ["callers"],
      }),
    ).toBe(true);
    expect(
      isCallerOnlyIncompleteCoverage({
        status: "unknown",
        reason: "Callers: unavailable.",
        limited_directions: ["callees"],
      }),
    ).toBe(false);
  });
});

describe("assessFunctionCallCoverage", () => {
  it("keeps incomplete coverage and unresolved calls as equality blockers", () => {
    expect(
      assessFunctionCallCoverage(
        {
          status: "partial",
          limitations: ["Read limit reached."],
          diagnostics: ["Indirect calls are unresolved."],
        },
        {
          unresolved_calls: [{ address: "0x1004", reason: "Computed target." }],
        },
      ),
    ).toEqual({
      blockers: [
        "Read limit reached.",
        "Unresolved call at 0x1004: Computed target.",
      ],
      unresolvedCallCaveats: ["Unresolved call at 0x1004: Computed target."],
      diagnostics: ["Indirect calls are unresolved."],
    });
  });
});
