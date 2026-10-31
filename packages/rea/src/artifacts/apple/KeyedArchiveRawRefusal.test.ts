import { writeFile, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect, it, vi } from "vitest";

import { AnalysisAccessDeniedError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { translateArtifactFailure } from "../ArtifactOperationFailure.js";
import { DirectoryArtifactEntryAccessDenied } from "../DirectoryArtifactReader.js";
import { inspectBundleKeyedArchive } from "./KeyedArchiveReader.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";

/**
 * The reader still opens real descriptors; only the host result for the
 * selected entry is replaced, so the raw-error classification runs for real.
 */
const { mockOpen } = vi.hoisted(() => ({ mockOpen: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  open: mockOpen,
}));

const archive = build({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: ["$null", "leaf"],
  $top: { root: { CF$UID: 1 } },
});
const selectedPath = "Contents/Resources/Model.plist";

const bundle = async () => {
  const root = await createTestTempDirectory("rea-keyed-raw-denial-");
  await mkdir(join(root, "Contents", "Resources"), { recursive: true });
  const path = join(root, "Contents", "Resources", "Model.plist");
  await writeFile(path, Buffer.from(archive));
  return { root, path };
};

const inspect = (bundlePath: string) =>
  inspectBundleKeyedArchive({
    bundlePath,
    targetSha256: "a".repeat(64),
    parameters: { path: selectedPath },
    platform: "darwin",
  });

/** Reject the selected entry's open with the host error under test. */
const hostOpenRefusal = async (systemCode: string) => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const { root, path } = await bundle();
  mockOpen.mockImplementation(
    async (file: Parameters<typeof actual.open>[0], ...rest: never[]) => {
      if (String(file) === path) {
        throw Object.assign(new Error(`${systemCode}: permission denied`), {
          code: systemCode,
        });
      }
      return actual.open(file, ...rest) as Promise<FileHandle>;
    },
  );
  return root;
};

it.each(["EACCES", "EPERM"] as const)(
  "classifies the reader's raw %s refusal as a typed host access denial",
  async (systemCode) => {
    const root = await hostOpenRefusal(systemCode);
    try {
      const rejected = await inspect(root).catch((cause: unknown) => cause);
      expect(rejected).toBeInstanceOf(AnalysisAccessDeniedError);
      if (!(rejected instanceof AnalysisAccessDeniedError))
        throw new Error("expected a host access denial");
      expect(rejected.systemCode).toBe(systemCode);
      expect(rejected.path).toBe(join(root, selectedPath));
      expect(projectAnalysisError(rejected)).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        details: { system_code: systemCode, boundary: "filesystem-read" },
      });
    } finally {
      mockOpen.mockReset();
    }
  },
);

it("keeps the reader's raw EIO refusal an artifact failure", async () => {
  const root = await hostOpenRefusal("EIO");
  try {
    const rejected = await inspect(root).catch((cause: unknown) => cause);
    expect(rejected).not.toBeInstanceOf(AnalysisAccessDeniedError);
    expect(rejected).toBeInstanceOf(ArtifactReaderFailure);
    if (!(rejected instanceof ArtifactReaderFailure))
      throw new Error("expected a reader failure");
    expect(rejected.reason).toBe("io");
    expect(
      projectAnalysisError(
        translateArtifactFailure("inspect_keyed_archive", rejected),
      ),
    ).toMatchObject({
      code: "artifact_operation_failed",
      details: { reason: "io" },
    });
  } finally {
    mockOpen.mockReset();
  }
});
