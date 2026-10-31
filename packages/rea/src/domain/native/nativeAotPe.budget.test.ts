import { describe, expect, it } from "vitest";
import type { NativeAotParserLimits } from "./nativeAotPe.js";
import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import {
  NATIVE_AOT_MAX_REPORT_BYTES,
  parseNativeAotPe,
} from "./nativeAotPe.js";
import {
  nativeAotPeDigest,
  nativeAotPeFixture,
} from "../../../tests/fixtures/nativeaotPe.js";

const REPORT_BUDGET = NATIVE_AOT_MAX_REPORT_BYTES;

describe("NativeAOT parser resource budgets", () => {
  it("reports source-cap rejection without hashing or inventing omitted-byte coverage", () => {
    const bytes = nativeAotPeFixture();
    const sha = nativeAotPeDigest(bytes);
    const limits: NativeAotParserLimits = {
      sourceBytes: bytes.length - 1,
      workUnits: 1024,
      workingMemoryBytes: 1024,
    };
    const report = parseNativeAotPe(
      bytes,
      sha,
      REPORT_BUDGET,
      undefined,
      limits,
    ).summary;
    expect(report).toMatchObject({
      status: "partial",
      reason: {
        code: "source_byte_budget",
        limit_bytes: bytes.length - 1,
        observed_bytes: bytes.length,
        runtime_override: false,
      },
      analysis_artifact_sha256: sha,
      header_address: null,
      diagnostics: ["source_byte_budget"],
      coverage: {
        source_bytes_examined: 0,
        source_byte_budget_bytes: bytes.length - 1,
        truncation_reason: "source-byte-budget",
      },
    });
    expect(report.coverage.source_bytes_omitted).toBeUndefined();
  });
});

it.each([8, 1024, 1272])(
  "retains every eligible section in RTR omission coverage after %s work units",
  (workUnits) => {
    const bytes = Buffer.alloc(0xc00);
    nativeAotPeFixture().copy(bytes);
    bytes.writeUInt16LE(4, 0x86);
    bytes.writeUInt32LE(0x5000, 0x98 + 56);
    bytes.writeUInt32LE(0, 0x600); // Scan every candidate rather than stop at a header.
    for (let index = 0; index < 2; index += 1) {
      const row = 0x98 + 0xf0 + (index + 2) * 40;
      bytes.writeUInt32LE(0x100, row + 8);
      bytes.writeUInt32LE(0x3000 + index * 0x1000, row + 12);
      bytes.writeUInt32LE(0x100, row + 16);
      bytes.writeUInt32LE(0xa00 + index * 0x100, row + 20);
      bytes.writeUInt32LE(0x40000040, row + 36);
    }
    const summary = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      REPORT_BUDGET,
      undefined,
      { sourceBytes: bytes.length, workingMemoryBytes: 64 * 1024, workUnits },
    ).summary;
    // 127 aligned candidates in .rdata, then 31 in each authored extra section.
    expect(summary.coverage.rtr_signature_scan_bytes_examined).toBe(workUnits);
    expect(summary.coverage.rtr_signature_scan_bytes_omitted).toBe(
      1512 - workUnits,
    );
  },
);

describe("NativeAOT parser report admission", () => {
  it("never returns an over-budget report from early exits", () => {
    const bytes = nativeAotPeFixture();
    const sha = nativeAotPeDigest(bytes);
    const expectReportBudget = (run: () => void): void => {
      let caught: unknown;
      try {
        run();
      } catch (cause: unknown) {
        caught = cause;
      }
      expect(caught).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        resource: "capacity",
        retryable: false,
        diagnostics: { code: "report_budget_too_small" },
        reportedLimits: { maximum_summary_bytes: 0 },
      });
    };
    expectReportBudget(() => {
      parseNativeAotPe(bytes, sha, 0, undefined, {
        sourceBytes: bytes.length - 1,
        workUnits: 1024,
        workingMemoryBytes: 1024,
      });
    });
    const nonPe = Buffer.from("not a PE image");
    expectReportBudget(() => {
      parseNativeAotPe(nonPe, nativeAotPeDigest(nonPe), 0);
    });
  });

  it("does not claim a missing RTR header when signature coverage hits the work limit", () => {
    const bytes = nativeAotPeFixture();
    const limits: NativeAotParserLimits = {
      sourceBytes: bytes.length,
      workUnits: 8,
      workingMemoryBytes: 1024,
    };
    const report = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      REPORT_BUDGET,
      undefined,
      limits,
    ).summary;
    expect(report).toMatchObject({
      status: "partial",
      header_address: null,
      truncated: true,
      coverage: {
        rtr_signature_scan_bytes_examined: 8,
        rtr_signature_scan_bytes_omitted: expect.any(Number),
        truncation_reason: "work-unit-budget",
      },
    });
    expect(report.reason).toEqual({
      code: "rtr_scan_budget",
      runtime_override: false,
    });
  });

  it("does not claim a missing root when table discovery is incomplete", () => {
    const bytes = nativeAotPeFixture();
    const report = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      REPORT_BUDGET,
      undefined,
      {
        sourceBytes: bytes.length,
        workUnits: 10_000,
        workingMemoryBytes: 1024,
      },
    ).summary;
    expect(report.truncated).toBe(true);
    expect(report.reason).toMatchObject({
      code: "system_object_root_unproven",
      runtime_override: false,
    });
  });

  it("explains a hydration work budget on the partial report", () => {
    const bytes = nativeAotPeFixture();
    // Extend DEHYDRATED_DATA with a zero-fill larger than the work left after
    // the directory is found, so hydrate throws into the partial report.
    const end = bytes.readBigUInt64LE(0x620);
    bytes.writeBigUInt64LE(end + 3n, 0x620);
    bytes.writeUInt8(0xf9, 0x704);
    Buffer.from([0x3c, 0x42, 0x0f]).copy(bytes, 0x705);
    const summary = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      REPORT_BUDGET,
      undefined,
      {
        sourceBytes: bytes.length,
        workUnits: 5000,
        workingMemoryBytes: 1024 * 1024,
      },
    ).summary;
    expect(summary.status).toBe("partial");
    expect(summary.reason).toEqual({
      code: "system_object_root_unproven",
      runtime_override: false,
      hydration: { detail: "work_budget", runtime_override: false },
    });
    expect(summary.diagnostics).toEqual(["work_budget"]);
  });
});

describe("NativeAOT detail and summary byte accounting", () => {
  it("admits serialized MethodTable memory descriptors before emitting them", () => {
    const bytes = nativeAotPeFixture();
    const sha = nativeAotPeDigest(bytes);
    const detail = (budget: number) =>
      parseNativeAotPe(bytes, sha, REPORT_BUDGET).readTypeDetail(
        "0x140002280",
        budget,
      );
    const complete = detail(REPORT_BUDGET);
    expect(complete?.derived_memory).toEqual(expect.any(Object));
    let low = 0;
    let high = Buffer.byteLength(JSON.stringify(complete));
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (detail(middle)?.derived_memory != null) high = middle;
      else low = middle + 1;
    }
    const atBoundary = detail(low);
    const belowBoundary = detail(low - 1);
    expect(atBoundary?.derived_memory).toEqual(expect.any(Object));
    expect(Buffer.byteLength(JSON.stringify(atBoundary))).toBeLessThanOrEqual(
      low,
    );
    expect(belowBoundary?.derived_memory ?? null).toBeNull();
    expect(belowBoundary?.diagnostics).toContain("detail_rows_omitted");
    expect(
      belowBoundary === undefined
        ? 0
        : Buffer.byteLength(JSON.stringify(belowBoundary)),
    ).toBeLessThanOrEqual(low - 1);
  });

  it("truncates report rows before exceeding its JSON byte budget", () => {
    const bytes = nativeAotPeFixture();
    const sha = nativeAotPeDigest(bytes);
    const complete = parseNativeAotPe(bytes, sha, REPORT_BUDGET);
    const fullBytes = Buffer.byteLength(JSON.stringify(complete.summary));
    let budget = fullBytes - 1;
    let summary: ReturnType<typeof parseNativeAotPe>["summary"] | undefined;
    while (budget > 0) {
      try {
        const candidate = parseNativeAotPe(bytes, sha, budget);
        if (candidate.summary.truncated) {
          summary = candidate.summary;
          break;
        }
      } catch (cause: unknown) {
        // Budgets below the fixed report header cannot carry an honest summary.
        expect(cause).toBeInstanceOf(AnalysisResourceConstraintError);
        expect(cause).toMatchObject({
          diagnostics: { code: "summary_exceeds_budget" },
          retryable: false,
        });
      }
      budget--;
    }
    if (summary === undefined)
      throw new Error("No partial summary budget found");
    expect(summary.truncated).toBe(true);
    expect(
      (summary.types_omitted ?? 0) +
        (summary.frozen_strings_omitted ?? 0) +
        (summary.coverage.scan_bytes_omitted ?? 0) +
        (summary.coverage.frozen_scan_bytes_omitted ?? 0),
    ).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(
      budget,
    );
  });
});
