import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { describe, expect, it, vi } from "vitest";

import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../ArtifactReader.js";
import {
  DirectoryArtifactEntryAccessDenied,
  DirectoryArtifactReader,
  DirectoryArtifactRootFailure,
} from "../DirectoryArtifactReader.js";
import { inspectBundleKeyedArchive } from "./KeyedArchiveReader.js";
import { AnalysisAccessDeniedError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";

const archive = build({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: ["$null", "leaf"],
  $top: { root: { CF$UID: 1 } },
});
const selectedPath = "Contents/Resources/Model.plist";

const bundle = async () => {
  const root = await createTestTempDirectory("rea-keyed-access-denied-");
  await mkdir(join(root, "Contents", "Resources"), { recursive: true });
  await writeFile(
    join(root, "Contents", "Resources", "Model.plist"),
    Buffer.from(archive),
  );
  return root;
};

const inspect = (bundlePath: string) =>
  inspectBundleKeyedArchive({
    bundlePath,
    targetSha256: "a".repeat(64),
    parameters: { path: selectedPath },
    platform: "darwin",
  });

/** Replace the selected entry's real open with the refusal under test. */
const refuseSelectedOpen = (refusal: (entry: ArtifactEntry) => Error) => {
  const open = DirectoryArtifactReader.prototype.open;
  return vi
    .spyOn(DirectoryArtifactReader.prototype, "open")
    .mockImplementation(function (
      this: DirectoryArtifactReader,
      entry: ArtifactEntry,
      signal?: AbortSignal,
    ) {
      if (entry.path === selectedPath) return Promise.reject(refusal(entry));
      return open.call(this, entry, signal);
    });
};

it.each(["EACCES", "EPERM"] as const)(
  "reports a refused selected archive open as host access denial (%s)",
  async (systemCode) => {
    const root = await bundle();
    const spy = refuseSelectedOpen(
      (entry) =>
        new DirectoryArtifactEntryAccessDenied(
          systemCode,
          entry.path,
          `Could not open entry at ${entry.adapterKey} (${systemCode}): permission denied`,
        ),
    );
    try {
      const rejected = await inspect(root).catch((cause: unknown) => cause);
      expect(rejected).toBeInstanceOf(AnalysisAccessDeniedError);
      if (!(rejected instanceof AnalysisAccessDeniedError))
        throw new Error("expected a host access denial");
      expect(rejected.operation).toBe("inspect_keyed_archive");
      expect(rejected.path).toBe(join(root, selectedPath));
      expect(rejected.systemCode).toBe(systemCode);

      const projected = projectAnalysisError(rejected);
      expect(projected).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        retryable: false,
        details: {
          path: join(root, selectedPath),
          system_code: systemCode,
          boundary: "filesystem-read",
        },
      });
      expect(projected.remediation.action).toContain("read access");
    } finally {
      spy.mockRestore();
    }
  },
);

it("keeps a non-permission reader failure classified as an artifact failure", async () => {
  const root = await bundle();
  const spy = refuseSelectedOpen(
    () =>
      new ArtifactReaderFailure(
        "io",
        "Could not open entry (EIO): device error",
      ),
  );
  try {
    const rejected = await inspect(root).catch((cause: unknown) => cause);
    expect(rejected).not.toBeInstanceOf(AnalysisAccessDeniedError);
    expect(rejected).toBeInstanceOf(ArtifactReaderFailure);
    expect(rejected).toMatchObject({ reason: "io" });
  } finally {
    spy.mockRestore();
  }
});

it("leaves a refused bundle root to the reader's own caller", async () => {
  const root = await bundle();
  const spy = refuseSelectedOpen(
    () =>
      new DirectoryArtifactRootFailure(
        "path",
        "Artifact root must be a directory",
      ),
  );
  try {
    const rejected = await inspect(root).catch((cause: unknown) => cause);
    expect(rejected).toBeInstanceOf(DirectoryArtifactRootFailure);
  } finally {
    spy.mockRestore();
  }
});

it("still reads a permitted archive through the production reader", async () => {
  const root = await bundle();
  const result = await inspect(root);
  expect(result.archive_path).toBe(selectedPath);
  expect(result.objects).toContainEqual(
    expect.objectContaining({ kind: "scalar", value: "leaf" }),
  );
});

describe("directory reader entry refusal", () => {
  it("retains the host system code and the selected entry path", () => {
    const failure = new DirectoryArtifactEntryAccessDenied(
      "EPERM",
      selectedPath,
      "Could not open entry",
    );
    expect(failure).toBeInstanceOf(ArtifactReaderFailure);
    expect(failure.reason).toBe("io");
    expect(failure.systemCode).toBe("EPERM");
    expect(failure.entryPath).toBe(selectedPath);
  });

  it("carries an unresolved cleanup owner into the typed denial", async () => {
    const root = await bundle();
    const cleanup = {
      reason: "close failed after the refused open",
      resources: [join(root, selectedPath)],
    };
    const spy = refuseSelectedOpen(
      (entry) =>
        new DirectoryArtifactEntryAccessDenied(
          "EACCES",
          entry.path,
          "Could not open entry (EACCES): permission denied",
          { cleanup },
        ),
    );
    try {
      const rejected = await inspect(root).catch((cause: unknown) => cause);
      expect(rejected).toBeInstanceOf(AnalysisAccessDeniedError);
      if (!(rejected instanceof AnalysisAccessDeniedError))
        throw new Error("expected a host access denial");
      // A denial that left a resource owned must not project as fully cleaned.
      expect(rejected.cleanupIncomplete).toBe(true);
      expect(rejected.cleanupResources).toContain(join(root, selectedPath));
    } finally {
      spy.mockRestore();
    }
  });
});
