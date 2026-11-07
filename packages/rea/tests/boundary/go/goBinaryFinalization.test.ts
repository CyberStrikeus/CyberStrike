import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { GoBinaryProvider } from "../../../src/go/GoBinaryProvider.js";
import { GoBinaryService } from "../../../src/application/go/GoBinaryService.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createGoBinaryFixture } from "../../fixtures/go/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each(["control", "close-failure", "close-cancel", "close-both"] as const)(
  "retains completed Go acquisition through %s",
  async (mode) => {
    const root = await createTestTempDirectory("rea-go-finalization-");
    const path = join(root, "selected.elf");
    const bytes = createGoBinaryFixture().bytes;
    await writeFile(path, bytes);
    const controller = new AbortController();
    const reason = { request: "cancel during Go close" };
    const closeFailure = Object.assign(new Error("controlled Go close EIO"), {
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
    const service = new GoBinaryService(new GoBinaryProvider());
    try {
      const result = await service.inspect(
        { path },
        { signal: controller.signal },
      );
      if (mode === "control") {
        if (!result.ok) throw result.error;
        expect(result.value.normalized_result).toMatchObject({
          build_info: { go_version: "go1.26.0" },
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
