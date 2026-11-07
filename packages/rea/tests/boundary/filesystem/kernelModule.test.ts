import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createKernelModuleService } from "../../../src/composition/binaryDiagnostics.js";
import {
  compressedKernelModuleContainer,
  kernelModuleFixture,
} from "../../../src/native/elf/KernelModule.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("kernel module stable filesystem boundary", () => {
  it("reports non-file and malformed ELF selections as caller input errors", async () => {
    const root = await createTestTempDirectory("rea-kernel-module-files-");
    const path = join(root, "demo.ko");
    const alias = join(root, "alias");
    const malformed = join(root, "malformed");
    await writeFile(path, kernelModuleFixture());
    await writeFile(malformed, Buffer.from("not an elf"));
    await symlink(path, alias);
    const service = createKernelModuleService();
    try {
      for (const [candidate, reason] of [
        [root, "invalid_format"],
        [alias, "invalid_format"],
        [malformed, "invalid_format"],
        [join(root, "missing"), "invalid_value"],
        [join(path, "child"), "invalid_value"],
      ] as const) {
        const result = await service.inspect({ path: candidate });
        if (result.ok) throw new Error("Expected file acquisition failure");
        expect(result.error).toMatchObject({
          _tag: "AnalysisInputError",
          operation: "inspect_kernel_module",
          issues: [
            {
              path: ["path"],
              reason,
              message: expect.any(String),
            },
          ],
        });
      }
    } finally {
      await service.close();
    }
  });

  it("returns typed resource and cancellation failures", async () => {
    const root = await createTestTempDirectory("rea-kernel-module-budget-");
    const path = join(root, "demo.ko");
    await writeFile(path, kernelModuleFixture());
    const service = createKernelModuleService();
    try {
      const tooSmall = await service.inspect({ path, max_file_bytes: 64 });
      if (tooSmall.ok) throw new Error("Expected resource budget failure");
      expect(tooSmall.error._tag).toBe("AnalysisResourceConstraintError");
      const tooMany = await service.inspect({ path, max_entries: 1 });
      if (tooMany.ok) throw new Error("Expected entry budget failure");
      expect(tooMany.error._tag).toBe("AnalysisResourceConstraintError");
      const cancelled = await service.inspect(
        { path },
        { signal: AbortSignal.abort() },
      );
      if (cancelled.ok) throw new Error("Expected cancellation");
      expect(cancelled.error._tag).toBe("AnalysisCancelledError");
    } finally {
      await service.close();
    }
  });

  it("reports a gzip container as unsupported without treating it as a module", async () => {
    const root = await createTestTempDirectory("rea-kernel-module-gzip-");
    const path = join(root, "demo.ko.gz");
    await writeFile(path, compressedKernelModuleContainer("gzip"));
    const service = createKernelModuleService();
    try {
      const result = await service.inspect({ path });
      if (!result.ok) throw result.error;
      expect(result.value.subject?.format).toBe("file");
      expect(result.value.normalized_result).toMatchObject({
        applicability: "unsupported",
        compression: { codec: "gzip", status: "unsupported" },
        next_probe: { operation: "external_decompression" },
        modinfo: null,
      });
    } finally {
      await service.close();
    }
  });
});
