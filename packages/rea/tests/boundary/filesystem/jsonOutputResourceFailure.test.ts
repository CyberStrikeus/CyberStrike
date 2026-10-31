import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const failure = vi.hoisted(() => ({ code: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    mkdtemp: async (...args: Parameters<typeof filesystem.mkdtemp>) => {
      if (failure.code !== "")
        throw Object.assign(new Error("controlled staging refusal"), {
          code: failure.code,
        });
      return filesystem.mkdtemp(...args);
    },
  };
});
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { writeTextParts } from "../../../src/application/JsonFiles.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { redactExplicitFailure } from "../../../src/domain/explicitSensitiveFailure.js";

it.each([
  ["EFBIG", "file-size allowance"],
  ["ENOSPC", "space or quota"],
  ["EDQUOT", "space or quota"],
] as const)(
  "preserves the %s host resource refusal through redaction",
  async (code, guidance) => {
    const root = await createTestTempDirectory("rea-write-resource-");
    const resources = new ArtifactResourceScope();
    onTestFinished(() => resources.close());
    failure.code = code;
    try {
      const result = await writeTextParts(
        ["bytes"],
        join(root, "out.json"),
        false,
        resources,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const projected = projectAnalysisError(
          redactExplicitFailure(result.error, ["unrelated-secret"]),
        );
        expect(projected).toMatchObject({
          code: "resource_constraint",
          category: "resource_constraint",
          retryable: false,
          details: {
            operation: "write",
            reason: "storage-limit",
            system_code: code,
            path: join(root, "out.json"),
          },
        });
        expect(projected.remediation.action).toContain(guidance);
        const excluded = projectAnalysisError(
          redactExplicitFailure(result.error, [code]),
        );
        expect(excluded.details).not.toHaveProperty("system_code");
        expect(excluded.remediation.action).toContain("file-size allowance");
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      failure.code = "";
    }
  },
);

/** Fail after the first staged part has been written, before publication. */
function* limitedParts(): Generator<string> {
  yield "staged bytes";
  throw Object.assign(new Error("file size limit"), { code: "EFBIG" });
}

it.each([false, true])(
  "retains a staged EFBIG and cleans or retries its owner (cleanup fails: %s)",
  async (cleanupFails) => {
    const root = await createTestTempDirectory("rea-staged-resource-");
    const output = join(root, "out.json");
    const resources = new ArtifactResourceScope();
    const { OwnedStagedOutput } =
      await import("../../../src/filesystem/OwnedStagedOutput.js");
    const close = vi.spyOn(OwnedStagedOutput.prototype, "close");
    if (cleanupFails)
      close.mockRejectedValueOnce(new Error("controlled cleanup refusal"));
    try {
      const result = await writeTextParts(
        limitedParts(),
        output,
        false,
        resources,
      );
      if (result.ok) throw new Error("Expected resource refusal");
      const redacted = redactExplicitFailure(result.error, [
        "unrelated-secret",
      ]);
      const projected = projectAnalysisError(redacted);
      expect(projected).toMatchObject({
        code: cleanupFails ? "cleanup_incomplete" : "resource_constraint",
        details: {
          reason: "storage-limit",
          system_code: "EFBIG",
          path: output,
        },
      });
      const staging = (await readdir(root)).filter((name) =>
        name.startsWith(".rea-write-"),
      );
      expect(staging).toHaveLength(cleanupFails ? 1 : 0);
      expect((await readdir(root)).includes("out.json")).toBe(false);
      if (cleanupFails) {
        expect(resources.hasPending).toBe(true);
        expect(redacted.cleanupResources).toContain(join(root, staging[0]!));
        await resources.retryCleanup();
        expect(resources.hasPending).toBe(false);
        expect(redacted.cleanupIncomplete).toBe(false);
        expect(projectAnalysisError(redacted)).toMatchObject({
          code: "resource_constraint",
          details: {
            reason: "storage-limit",
            system_code: "EFBIG",
            path: output,
          },
        });
        expect(await readdir(root)).toEqual([]);
      }
    } finally {
      close.mockRestore();
      await resources.close();
    }
  },
);
