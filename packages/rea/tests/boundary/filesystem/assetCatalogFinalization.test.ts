import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import * as processOutput from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform !== "darwin").each([
  ["success", false, false],
  ["integrity", false, false],
  ["timeout", false, false],
  ["success", true, false],
  ["integrity", true, false],
  ["timeout", true, false],
  ["integrity", true, true],
] as const)(
  "preserves asset catalog %s with reader cleanup failure %s and join cleanup %s",
  async (primary, failCleanup, failJoinCleanup) => {
    const bundle = await createTestTempDirectory("rea-asset-finalization-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    const catalog = join(resources, "Assets.car");
    await writeFile(catalog, "inert catalog bytes");
    let catalogReader: DirectoryArtifactReader | undefined;
    let denyCleanup = failCleanup;
    let closeAttempts = 0;
    const failedReaders = new Set<DirectoryArtifactReader>();
    const originalOpen = DirectoryArtifactReader.prototype.open;
    const open = vi
      .spyOn(DirectoryArtifactReader.prototype, "open")
      .mockImplementation(function (
        this: DirectoryArtifactReader,
        entry,
        signal,
      ) {
        if (entry.path.endsWith("/Assets.car") || entry.path === "Assets.car")
          catalogReader = this;
        return originalOpen.call(this, entry, signal);
      });
    const originalClose = DirectoryArtifactReader.prototype.close;
    const close = vi
      .spyOn(DirectoryArtifactReader.prototype, "close")
      .mockImplementation(async function (this: DirectoryArtifactReader) {
        if (this === catalogReader || failJoinCleanup) {
          closeAttempts++;
          if (denyCleanup) {
            failedReaders.add(this);
            throw new ArtifactReaderFailure(
              "io",
              "controlled catalog reader close",
              {
                cleanup: {
                  reason: "controlled catalog reader close",
                  resources: [resources],
                },
              },
            );
          }
        }
        await originalClose.call(this);
      });
    const utility = vi
      .spyOn(processOutput, "execFileOutput")
      .mockImplementationOnce(async () => {
        if (primary === "integrity")
          await writeFile(
            catalog,
            "changed catalog bytes with a different length",
          );
        if (primary === "timeout")
          throw Object.assign(new Error("controlled assetutil deadline"), {
            code: "ETIMEDOUT",
            stdout: "",
            stderr: "assetutil timeout detail",
            signal: "SIGTERM",
          });
        return { stdout: "[]", stderr: "", stdoutBytes: 2, stderrBytes: 0 };
      });
    const client = new ArtifactProvider(
      {},
      "darwin",
    ).createBundleResourceClient({
      callerPath: bundle,
      canonicalPath: bundle,
      infoPlistPath: join(bundle, "Contents", "Info.plist"),
      layout: "contents",
      executableSha256: null,
    });
    try {
      const result = await client.execute("inspect_asset_catalog", {});
      if (primary === "success" && !failCleanup) {
        expect(result.ok).toBe(true);
        return;
      }
      if (result.ok) throw new Error("Expected catalog failure");
      const projected = projectAnalysisError(result.error);
      expect(result.error.cleanupIncomplete).toBe(failCleanup);
      if (primary === "integrity")
        expect(projected).toMatchObject({
          category: "integrity_mismatch",
          details: {
            reason: "integrity",
            detail: expect.stringContaining("Asset catalog changed"),
          },
        });
      if (primary === "timeout")
        expect(projected).toMatchObject({
          category: "timeout",
          details: { operation: "inspect_asset_catalog", timeout_ms: 60000 },
        });
      if (failCleanup) {
        expect(projected.code).toBe("cleanup_incomplete");
        expect(result.error.cleanupResources).toContain(resources);
        expect((await client.close()).ok).toBe(false);
        expect(result.error.cleanupIncomplete).toBe(true);
        denyCleanup = false;
        expect((await client.close()).ok).toBe(true);
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(closeAttempts).toBeGreaterThanOrEqual(3);
        if (failJoinCleanup) expect(failedReaders.size).toBe(2);
      }
    } finally {
      denyCleanup = false;
      await client.close();
      utility.mockRestore();
      close.mockRestore();
      open.mockRestore();
    }
  },
);

it.each(["decode_interface_builder", "inspect_keyed_archive"] as const)(
  "retains the %s primary failure and its exact reader until cleanup succeeds",
  async (operation) => {
    const bundle = await createTestTempDirectory(
      "rea-apple-reader-finalization-",
    );
    let denyCleanup = true;
    const originalClose = DirectoryArtifactReader.prototype.close;
    const close = vi
      .spyOn(DirectoryArtifactReader.prototype, "close")
      .mockImplementation(async function (this: DirectoryArtifactReader) {
        if (denyCleanup)
          throw new ArtifactReaderFailure(
            "io",
            "controlled bundle reader close",
            {
              cleanup: {
                reason: "controlled bundle reader close",
                resources: [bundle],
              },
            },
          );
        await originalClose.call(this);
      });
    const entries =
      operation === "decode_interface_builder"
        ? vi
            .spyOn(DirectoryArtifactReader.prototype, "entries")
            .mockImplementationOnce(async function* () {
              throw new ArtifactReaderFailure(
                "integrity",
                "controlled Interface Builder source change",
              );
            })
        : undefined;
    const client = new ArtifactProvider(
      {},
      process.platform,
    ).createBundleResourceClient({
      callerPath: bundle,
      canonicalPath: bundle,
      infoPlistPath: join(bundle, "Info.plist"),
      layout: "root",
      executableSha256: null,
    });
    try {
      const result = await client.execute(
        operation,
        operation === "inspect_keyed_archive" ? { path: "Missing.plist" } : {},
      );
      if (result.ok)
        throw new Error("Expected source/selection and cleanup failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
        category:
          operation === "decode_interface_builder"
            ? "integrity_mismatch"
            : "invalid_input",
      });
      expect(result.error.cleanupResources).toContain(bundle);
      expect((await client.close()).ok).toBe(false);
      expect(result.error.cleanupIncomplete).toBe(true);
      denyCleanup = false;
      expect((await client.close()).ok).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      denyCleanup = false;
      await client.close();
      entries?.mockRestore();
      close.mockRestore();
    }
  },
);
