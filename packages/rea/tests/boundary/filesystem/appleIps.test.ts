import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAppleIpsService } from "../../../src/composition/binaryDiagnostics.js";
import {
  appleIpsBytes,
  appleIpsMetadataLine,
} from "../../fixtures/binaryDiagnostics/appleIps.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("Apple IPS stable filesystem boundary", () => {
  it("reports non-file and malformed IPS selections as caller input errors", async () => {
    const root = await createTestTempDirectory("rea-apple-ips-files-");
    const path = join(root, "report.ips");
    const alias = join(root, "alias.ips");
    const malformed = join(root, "malformed.ips");
    await writeFile(path, appleIpsBytes());
    await writeFile(malformed, Buffer.from("not an ips report"));
    await symlink(path, alias);
    const service = createAppleIpsService();
    for (const [candidate, reason] of [
      [root, "invalid_format"],
      [alias, "invalid_format"],
      [malformed, "invalid_format"],
      [join(root, "missing.ips"), "invalid_value"],
      [join(path, "child.ips"), "invalid_value"],
    ] as const) {
      const result = await service.inspect({ path: candidate });
      if (result.ok) throw new Error("Expected file acquisition failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        operation: "inspect_apple_ips",
        issues: [
          {
            path: ["path"],
            reason,
            message: expect.any(String),
          },
        ],
      });
    }
  });

  it("returns typed resource and cancellation failures", async () => {
    const root = await createTestTempDirectory("rea-apple-ips-budget-");
    const path = join(root, "report.ips");
    await writeFile(path, appleIpsBytes());
    const service = createAppleIpsService();
    const tooSmall = await service.inspect({ path, max_file_bytes: 64 });
    if (tooSmall.ok) throw new Error("Expected resource budget failure");
    expect(tooSmall.error._tag).toBe("AnalysisResourceConstraintError");
    const cancelled = await service.inspect(
      { path },
      { signal: AbortSignal.abort() },
    );
    if (cancelled.ok) throw new Error("Expected cancellation");
    expect(cancelled.error._tag).toBe("AnalysisCancelledError");
  });

  it("maps register, fixed structural and UTF-8 refusals to typed errors", async () => {
    const root = await createTestTempDirectory("rea-apple-ips-shape-");
    const report = join(root, "report.ips");
    const deep = join(root, "deep.ips");
    const corrupt = join(root, "corrupt.ips");
    await writeFile(report, appleIpsBytes());
    await writeFile(
      deep,
      `${appleIpsMetadataLine()}\n{"vmSummary":${"[".repeat(100)}${"]".repeat(100)}}`,
    );
    const bytes = appleIpsBytes();
    bytes[bytes.indexOf(Buffer.from("rea-crash-fixture"))] = 0xc3;
    await writeFile(corrupt, bytes);
    const service = createAppleIpsService();

    const registers = await service.inspect({ path: report, max_registers: 2 });
    if (registers.ok) throw new Error("Expected register budget failure");
    expect(registers.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "capacity",
      reportedLimits: { boundary: "registers", maximum: 2 },
      retryable: false,
      remediationAction: expect.stringContaining("max_registers"),
    });

    const nesting = await service.inspect({ path: deep });
    if (nesting.ok) throw new Error("Expected nesting allowance failure");
    expect(nesting.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: { boundary: "nesting", maximum: 64 },
      retryable: false,
      fixedAllowance: { kind: "parser" },
    });

    const invalid = await service.inspect({ path: corrupt });
    if (invalid.ok) throw new Error("Expected invalid UTF-8 failure");
    expect(invalid.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["path"],
          reason: "invalid_format",
          message: expect.stringContaining("UTF-8"),
        },
      ],
    });

    const complete = await service.inspect({ path: report });
    if (!complete.ok) throw complete.error;
    expect(complete.value.normalized_result).toMatchObject({
      coverage: { status: "complete", registers: 6, type_mismatches: [] },
    });
  });
});
