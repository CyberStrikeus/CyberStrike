import type { FileHandle } from "node:fs/promises";
import { open, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { analyzeJavaScriptApplication } from "../../src/application/javascript/JavaScriptApplicationService.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import { DirectoryArtifactReader } from "../../src/artifacts/DirectoryArtifactReader.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const injected = vi.hoisted(() => ({
  opened: undefined as ((path: unknown, file: FileHandle) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      injected.opened?.(args[0], file);
      return file;
    },
  };
});

const causesOf = (error: unknown): unknown[] => {
  if (!(error instanceof Error)) return [error];
  return [
    error,
    ...causesOf(error.cause),
    ...(error instanceof AggregateError ? error.errors.flatMap(causesOf) : []),
  ];
};

it.each(
  ["addon.node", "unselected.js"].flatMap((filename) =>
    [
      "physical failure",
      "failed cleanup",
      "completed cleanup",
      "abort only",
      "changed bytes",
      "completed mismatch cancellation",
      "completed matching cancellation",
    ].map((outcome) => ({ filename, outcome })),
  ),
)(
  "preserves $filename verifier provenance through $outcome",
  async ({ filename, outcome }) => {
    const root = await realpath(
      await createTestTempDirectory("rea-js-verifier-failure-"),
    );
    const path = join(root, filename);
    await writeFile(path, "original payload");
    await writeFile(join(root, "main.js"), "module.exports = 42;\n");
    const scope = new ArtifactResourceScope();
    const controller = new AbortController();
    const reason = { source: "artifact source acquisition" };
    const physical = Object.assign(
      new Error("physical acquisition read denied"),
      { code: "EIO", errno: -5, syscall: "read" },
    );
    let acquisition = false;
    let blocked =
      outcome === "failed cleanup" || outcome === "completed cleanup";
    let independentBlocked = false;
    let descriptor: FileHandle | undefined;
    const openEntry = DirectoryArtifactReader.prototype.open;
    vi.spyOn(DirectoryArtifactReader.prototype, "open").mockImplementation(
      async function (this: DirectoryArtifactReader, entry, signal) {
        const stream = await openEntry.call(this, entry, signal);
        if (
          acquisition &&
          entry.adapterKey === path &&
          outcome.startsWith("completed ") &&
          outcome !== "completed cleanup"
        )
          stream.once("end", () => controller.abort(reason));
        return stream;
      },
    );
    injected.opened = (candidate, file) => {
      if (!acquisition || String(candidate) !== path) return;
      descriptor = file;
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => {
        if (blocked) throw new Error("acquisition descriptor close denied");
        await close();
      });
      if (outcome === "abort only") controller.abort(reason);
      if (outcome === "physical failure" || outcome === "failed cleanup")
        vi.spyOn(file, "read").mockImplementationOnce(async () => {
          controller.abort(reason);
          throw physical;
        });
    };
    onTestFinished(async () => {
      injected.opened = undefined;
      blocked = false;
      independentBlocked = false;
      await scope.close();
      vi.restoreAllMocks();
    });
    const result = await analyzeJavaScriptApplication(
      { input_path: root, source_paths: ["main.js"] },
      scope,
      {
        signal: controller.signal,
        progress: {
          report: async (update) => {
            if (update.phase !== "read_javascript_artifacts") return;
            acquisition = true;
            if (
              outcome === "changed bytes" ||
              outcome === "completed mismatch cancellation"
            )
              await writeFile(path, "modified payload");
          },
        },
      },
    );
    if (result.ok) throw new Error("Expected acquisition failure");
    if (
      outcome === "abort only" ||
      outcome === "completed matching cancellation"
    )
      expect(result.error).toMatchObject({
        reason: "cancelled",
        cause: reason,
      });
    else if (
      outcome === "changed bytes" ||
      outcome === "completed mismatch cancellation"
    )
      expect(result.error).toMatchObject({ reason: "integrity" });
    else {
      expect(result.error).toMatchObject({ reason: "io" });
      if (outcome !== "completed cleanup")
        expect(causesOf(result.error)).toContain(physical);
    }
    expect(descriptor).toBeDefined();
    if (blocked) {
      const independentPath = join(root, "independent-owner");
      await writeFile(independentPath, "separately retained bytes");
      const independent = await open(independentPath);
      const closeIndependent = independent.close.bind(independent);
      independentBlocked = true;
      vi.spyOn(independent, "close").mockImplementation(async () => {
        if (independentBlocked)
          throw new Error("independent owner close denied");
        await closeIndependent();
      });
      scope.retain({
        kind: "file-handle",
        resource: independentPath,
        handle: new OwnedFileHandle(independent),
      });
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.partialObservation).toMatchObject({
        kind: "artifact-inventory",
      });
      await expect(scope.close()).rejects.toBeDefined();
      expect(descriptor!.fd).toBeGreaterThanOrEqual(0);
      blocked = false;
      await expect(scope.close()).rejects.toBeDefined();
      expect(descriptor!.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(independent.fd).toBeGreaterThanOrEqual(0);
      independentBlocked = false;
      await scope.close();
      expect(independent.fd).toBe(-1);
    }
    await scope.close();
    expect(descriptor!.fd).toBe(-1);
    expect(result.error.cleanupIncomplete).toBe(false);
  },
);
