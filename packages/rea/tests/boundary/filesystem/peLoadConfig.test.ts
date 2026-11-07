import { createHash } from "node:crypto";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPeLoadConfigService } from "../../../src/composition/binaryDiagnostics.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { peLoadConfigImage } from "../../../src/native/pe/PeLoadConfig.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("PE import stable filesystem boundary", () => {
  it("reports non-file and malformed PE selections as caller input errors", async () => {
    const root = await createTestTempDirectory("rea-pe-load-config-files-");
    const path = join(root, "app.exe");
    const alias = join(root, "alias.exe");
    const malformed = join(root, "malformed.exe");
    await writeFile(path, peLoadConfigImage());
    await writeFile(malformed, Buffer.from("not a pe"));
    await symlink(path, alias);
    const service = createPeLoadConfigService();
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
        operation: "inspect_pe_load_config",
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
    const root = await createTestTempDirectory("rea-pe-load-config-budget-");
    const path = join(root, "app.exe");
    await writeFile(path, peLoadConfigImage());
    const service = createPeLoadConfigService();
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

  it.each(["control", "close-failure", "close-cancel", "close-both"] as const)(
    "retains completed PE acquisition through %s",
    async (mode) => {
      const root = await createTestTempDirectory("rea-pe-config-finalize-");
      const path = join(root, "app.exe");
      const bytes = peLoadConfigImage();
      await writeFile(path, bytes);
      const controller = new AbortController();
      const reason = { request: "cancel during PE close" };
      const closeFailure = Object.assign(new Error("controlled PE close EIO"), {
        code: "EIO",
      });
      const original = OwnedFileHandle.prototype.close;
      let owner: OwnedFileHandle | undefined;
      const close = vi
        .spyOn(OwnedFileHandle.prototype, "close")
        .mockImplementationOnce(async function (this: OwnedFileHandle) {
          owner = this;
          if (mode === "close-cancel" || mode === "close-both")
            controller.abort(reason);
          if (mode === "close-failure" || mode === "close-both")
            throw closeFailure;
          await original.call(this);
        });
      const service = createPeLoadConfigService();
      try {
        const result = await service.inspect(
          { path },
          { signal: controller.signal },
        );
        if (mode === "control") {
          if (!result.ok) throw result.error;
          expect(result.value.normalized_result).toMatchObject({
            load_config: { guard_flags: { raw: 0x500 } },
          });
        } else {
          if (result.ok) throw new Error("Expected finalization failure");
          const acquired = {
            kind: "file-snapshot-hash",
            path,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
          };
          expect(result.error.partialObservation).toEqual(acquired);
          expect(
            projectAnalysisError(result.error).details?.partial_observation,
          ).toEqual(acquired);
          const failedClose = mode === "close-failure" || mode === "close-both";
          expect(result.error.cleanupIncomplete).toBe(failedClose);
          if (failedClose) expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
          if (mode !== "close-failure") {
            const primary = result.error.cleanupPrimary ?? result.error;
            expect(primary).toMatchObject({
              _tag: "AnalysisCancelledError",
              cause: reason,
            });
          }
          close.mockRestore();
          await service.close();
          expect(result.error.cleanupIncomplete).toBe(false);
        }
        expect(owner?.handle.fd).toBe(-1);
      } finally {
        close.mockRestore();
        await service.close();
      }
    },
  );
});
