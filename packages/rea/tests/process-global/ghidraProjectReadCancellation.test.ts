import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ArtifactFileCancelled } from "../../src/artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { AnalysisCancelledError } from "../../src/domain/analysisErrorCore.js";
import { resolveGhidraProject } from "../../src/ghidra/GhidraProjectSnapshot.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const fault = vi.hoisted(() => ({ reason: undefined as unknown }));
vi.mock(
  "../../src/artifacts/ArtifactFileOperation.js",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../../src/artifacts/ArtifactFileOperation.js")
      >();
    return {
      ...original,
      withArtifactRegularFile: async () => {
        throw new ArtifactFileCancelled({
          reason: fault.reason,
          outcome: { kind: "completed", value: undefined },
        });
      },
    };
  },
);

it.each([null, "cancel file read", { source: "caller" }])(
  "preserves an owned file-read cancellation through project profile resolution: %j",
  async (reason) => {
    const root = await createTestTempDirectory("rea-ghidra-read-cancel-");
    await mkdir(join(root, "selected.rep"));
    await writeFile(join(root, "selected.gpr"), "marker");
    const resources = new ArtifactResourceScope();
    fault.reason = reason;
    try {
      let failure: unknown;
      try {
        await resolveGhidraProject(
          { path: join(root, "selected.gpr") },
          { path: join(root, "target") },
          resources,
        );
      } catch (cause) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (!(failure instanceof AnalysisCancelledError))
        throw new Error("Expected cancellation");
      expect(failure.cause).toBe(reason);
    } finally {
      await resources.close();
    }
  },
);
