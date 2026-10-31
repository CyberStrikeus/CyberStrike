import { expect, it, vi } from "vitest";

import { writeEnvironmentServeFiles } from "../../../tests/fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { ArtifactFileCleanupFailure } from "../../artifacts/ArtifactFileOperation.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { readEnvironmentExportInputs } from "./environmentExport.js";

it.each([false, true])(
  "retries a failed input close and retains persistent cleanup authority: %s",
  async (persistent) => {
    const root = await createTestTempDirectory("rea-environment-input-close-");
    const files = await writeEnvironmentServeFiles(root);
    const original = OwnedFileHandle.prototype.close;
    let owner: OwnedFileHandle | undefined;
    let attempts = 0;
    let released = false;
    const firstOwner = (value: OwnedFileHandle): OwnedFileHandle => {
      owner ??= value;
      return owner;
    };
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(function (this: OwnedFileHandle) {
        if (this === firstOwner(this)) {
          attempts += 1;
          if (!released && (persistent || attempts === 1))
            return Promise.reject(
              Object.assign(new Error("controlled input close failure"), {
                code: "EIO",
              }),
            );
        }
        return original.call(this);
      });
    try {
      const result = await readEnvironmentExportInputs(
        files.manifestPath,
        files.capturePath,
      );
      if (!persistent) {
        expect(result.ok).toBe(true);
        expect(attempts).toBe(2);
      } else {
        if (result.ok) throw new Error("Expected cleanup refusal");
        expect(result.error).toMatchObject({
          _tag: "AnalysisOutputError",
          operation: "environment-export",
          cleanupIncomplete: true,
        });
        const failure = result.error.cause;
        expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
        if (!(failure instanceof ArtifactFileCleanupFailure))
          throw new Error("Missing exact cleanup owner");
        released = true;
        await failure.cleanupLease.release();
        expect(result.error.cleanupIncomplete).toBe(false);
      }
    } finally {
      released = true;
      close.mockRestore();
      if (owner !== undefined) await original.call(owner);
    }
  },
);
