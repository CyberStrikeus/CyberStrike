import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPeImportsService } from "../../../src/composition/binaryDiagnostics.js";
import { peImportImage } from "../../fixtures/binaryDiagnostics/peImports.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("PE import stable filesystem boundary", () => {
  it("reports non-file and malformed PE selections as caller input errors", async () => {
    const root = await createTestTempDirectory("rea-pe-imports-files-");
    const path = join(root, "app.exe");
    const alias = join(root, "alias.exe");
    const malformed = join(root, "malformed.exe");
    await writeFile(path, peImportImage());
    await writeFile(malformed, Buffer.from("not a pe"));
    await symlink(path, alias);
    const service = createPeImportsService();
    for (const [candidate, reason] of [
      [root, "invalid_format"],
      [alias, "invalid_format"],
      [malformed, "invalid_format"],
      [join(root, "missing.exe"), "invalid_value"],
      [join(path, "child.exe"), "invalid_value"],
    ] as const) {
      const result = await service.inspect({ path: candidate });
      if (result.ok) throw new Error("Expected file acquisition failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        operation: "inspect_pe_imports",
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
    const root = await createTestTempDirectory("rea-pe-imports-budget-");
    const path = join(root, "app.exe");
    await writeFile(path, peImportImage());
    const service = createPeImportsService();
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

  it("derives limit recovery from the parser's structured limit tag", async () => {
    const root = await createTestTempDirectory("rea-pe-imports-limits-");
    const twoDlls = join(root, "two.exe");
    const longNames = join(root, "names.exe");
    await writeFile(
      twoDlls,
      peImportImage({
        dlls: [
          { name: "A.dll", functions: [{ name: "a" }] },
          { name: "B.dll", functions: [{ name: "b" }] },
        ],
      }),
    );
    const name = "A".repeat(4096);
    await writeFile(
      longNames,
      peImportImage({
        sectionBytes: 0x1200000,
        dlls: [
          {
            name: "KERNEL32.dll",
            functions: Array.from({ length: 4097 }, () => ({ name })),
          },
        ],
      }),
    );
    const service = createPeImportsService();
    const dlls = await service.inspect({ path: twoDlls, max_dlls: 1 });
    if (dlls.ok) throw new Error("Expected DLL budget failure");
    expect(dlls.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: { limit: "dlls", maximum: 1 },
      remediationAction: expect.stringContaining("Raise max_dlls above 1"),
      retryable: false,
    });
    const text = await service.inspect({
      path: longNames,
      max_file_bytes: 536870912,
    });
    if (text.ok) throw new Error("Expected retained-text failure");
    expect(text.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: { limit: "retained_text", maximum: 16777216 },
      remediationAction: undefined,
      fixedAllowance: {
        name: expect.stringContaining("16777216-byte PE import retained-text"),
        kind: "bytes",
      },
      retryable: false,
    });
  });
});
