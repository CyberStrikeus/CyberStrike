import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it, vi } from "vitest";

import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { openRegularFile } from "../../filesystem/RegularFile.js";
import { ZipArtifactReader } from "../ZipArtifactReader.js";
import { DirectoryArtifactReader } from "../DirectoryArtifactReader.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { asarHeaderBytes } from "../../../tests/fixtures/asarHeader.js";
import { extractArtifact } from "./ArtifactExtraction.js";

const zipBytes = async (content?: string): Promise<Buffer> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  if (content !== undefined)
    await writer.add("member.txt", new TextReader(content));
  return Buffer.from(await writer.close());
};

const zipInput = (
  path: string,
  outputRoot: string,
  resourceScope: ArtifactResourceScope,
) => ({
  inputPath: path,
  inputFormat: "zip" as const,
  outputRoot,
  environment: {},
  integrityPolicy: "fail" as const,
  resourceScope,
});

/** Intercept only the exact admitted root owner, including its later retry. */
const watchZipRootClose = (
  scope: ArtifactResourceScope,
  path: string,
  close: (original: () => Promise<void>, attempt: number) => Promise<void>,
): { readonly attempts: () => number; readonly restore: () => void } => {
  const originalRelease = scope.release.bind(scope);
  let rootCloseSpy: { mockRestore(): void } | undefined;
  let attempts = 0;
  const releaseSpy = vi
    .spyOn(scope, "release")
    .mockImplementation(async (owner) => {
      if (
        owner.kind === "file-handle" &&
        owner.resource === `root artifact descriptor for ${path}`
      ) {
        const originalClose = owner.handle.close.bind(owner.handle);
        rootCloseSpy = vi
          .spyOn(owner.handle, "close")
          .mockImplementation(() => close(originalClose, ++attempts));
      }
      return originalRelease(owner);
    });
  return {
    attempts: () => attempts,
    restore: () => {
      rootCloseSpy?.mockRestore();
      releaseSpy.mockRestore();
    },
  };
};

it.each(["archive", "directory", "missing"] as const)(
  "extracts from the inventoried ZIP descriptor when its pathname becomes %s",
  async (replacement) => {
    const directory = await createTestTempDirectory(
      "rea-zip-extraction-identity-",
    );
    const path = join(directory, "source.zip");
    const original = await zipBytes("unchanged");
    await writeFile(path, original);
    const output = join(directory, "out");
    const resourceScope = new ArtifactResourceScope();
    const open = vi.mocked(openRegularFile);
    open.mockClear();
    const directoryEntries = vi.spyOn(
      DirectoryArtifactReader.prototype,
      "entries",
    );
    const originalClose = ZipArtifactReader.prototype.close;
    let closes = 0;
    const close = vi
      .spyOn(ZipArtifactReader.prototype, "close")
      .mockImplementation(async function (this: ZipArtifactReader) {
        await originalClose.call(this);
        if (++closes !== 1) return;
        await rename(path, join(directory, "original.zip"));
        if (replacement === "directory") await mkdir(path);
        if (replacement === "archive") {
          // EOCD comment changes the carrier digest while every member stays identical.
          const changed = Buffer.from(original);
          changed.writeUInt16LE(1, changed.length - 2);
          await writeFile(path, Buffer.concat([changed, Buffer.from("B")]));
        }
      });
    try {
      const outcome = await extractArtifact(
        zipInput(path, output, resourceScope),
      )
        .then((result) => ({ kind: "completed" as const, result }))
        .catch((cause: unknown) => ({ kind: "failed" as const, cause }));
      if (outcome.kind === "failed") {
        // Renaming the admitted inode can change its ctime. Refusal is valid;
        // reading the replacement carrier or directory is not.
        expect(outcome.cause).toMatchObject({ reason: "integrity" });
        await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      } else {
        expect(outcome.result.manifest.root_format).toBe("zip");
        expect(outcome.result.artifacts).toMatchObject([
          { relative_path: "member.txt" },
        ]);
        expect(await readFile(join(output, "member.txt"), "utf8")).toBe(
          "unchanged",
        );
      }
      expect(open).toHaveBeenCalledTimes(1);
      expect(directoryEntries).not.toHaveBeenCalled();
      expect(closes).toBe(2);
    } finally {
      close.mockRestore();
      directoryEntries.mockRestore();
      await resourceScope.close();
    }
  },
);

it("preserves cancellation raised during final ZIP descriptor close", async () => {
  const directory = await createTestTempDirectory("rea-zip-extraction-cancel-");
  const path = join(directory, "empty.zip");
  const bytes = await zipBytes();
  await writeFile(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const output = join(directory, "out");
  const resourceScope = new ArtifactResourceScope();
  const controller = new AbortController();
  const reason = new Error("cancel during root close");
  let readerCloses = 0;
  const originalReaderClose = ZipArtifactReader.prototype.close;
  const readerClose = vi
    .spyOn(ZipArtifactReader.prototype, "close")
    .mockImplementation(async function (this: ZipArtifactReader) {
      readerCloses += 1;
      await originalReaderClose.call(this);
    });
  let outputExistedAtRootClose = false;
  let readerClosesAtRootClose = 0;
  const rootClose = watchZipRootClose(resourceScope, path, async (original) => {
    outputExistedAtRootClose = await stat(output).then(
      () => true,
      () => false,
    );
    readerClosesAtRootClose = readerCloses;
    controller.abort(reason);
    await original();
  });
  try {
    await expect(
      extractArtifact(zipInput(path, output, resourceScope), controller.signal),
    ).rejects.toMatchObject({
      reason: "cancelled",
      cause: reason,
      partialObservation: {
        kind: "artifact-inventory",
        inventory: {
          manifest: { root_format: "zip", root_sha256: digest },
          coverage: { scope: "container-entries", status: "complete" },
        },
      },
    });
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(outputExistedAtRootClose).toBe(true);
    expect(readerClosesAtRootClose).toBe(2);
    expect(rootClose.attempts()).toBe(1);
    expect(resourceScope.hasPending).toBe(false);
  } finally {
    await resourceScope.close();
    rootClose.restore();
    readerClose.mockRestore();
  }
});

it("retains completed ZIP inventory when cancellation arrives during inventory reader close", async () => {
  const directory = await createTestTempDirectory(
    "rea-zip-inventory-close-cancel-",
  );
  const path = join(directory, "empty.zip");
  const bytes = await zipBytes();
  await writeFile(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const output = join(directory, "out");
  const resourceScope = new ArtifactResourceScope();
  const controller = new AbortController();
  const reason = new Error("cancel during inventory reader close");
  const originalReaderClose = ZipArtifactReader.prototype.close;
  let readerCloses = 0;
  const readerClose = vi
    .spyOn(ZipArtifactReader.prototype, "close")
    .mockImplementation(async function (this: ZipArtifactReader) {
      readerCloses += 1;
      await originalReaderClose.call(this);
      if (readerCloses === 1) controller.abort(reason);
    });
  const rootClose = watchZipRootClose(resourceScope, path, (original) =>
    original(),
  );
  try {
    await expect(
      extractArtifact(zipInput(path, output, resourceScope), controller.signal),
    ).rejects.toMatchObject({
      reason: "cancelled",
      cause: reason,
      partialObservation: {
        kind: "artifact-inventory",
        inventory: {
          manifest: { root_format: "zip", root_sha256: digest },
          coverage: { scope: "container-entries", status: "complete" },
        },
      },
    });
    expect(readerCloses).toBe(1);
    expect(rootClose.attempts()).toBe(1);
    expect(resourceScope.hasPending).toBe(false);
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await resourceScope.close();
    rootClose.restore();
    readerClose.mockRestore();
  }
});

it("retains and retries a failed final ZIP descriptor close", async () => {
  const directory = await createTestTempDirectory("rea-zip-extraction-close-");
  const path = join(directory, "empty.zip");
  await writeFile(path, await zipBytes());
  const output = join(directory, "out");
  const resourceScope = new ArtifactResourceScope();
  const failure = new Error("root close denied");
  const rootClose = watchZipRootClose(
    resourceScope,
    path,
    (original, attempt) =>
      attempt === 1 ? Promise.reject(failure) : original(),
  );
  try {
    await expect(
      extractArtifact(zipInput(path, output, resourceScope)),
    ).rejects.toMatchObject({ cleanup: { reason: failure.message } });
    expect(resourceScope.cleanupResources).toEqual([
      `root artifact descriptor for ${path}`,
    ]);
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    await resourceScope.close();
    expect(rootClose.attempts()).toBe(2);
    expect(resourceScope.hasPending).toBe(false);
  } finally {
    await resourceScope.close().catch(() => undefined);
    rootClose.restore();
  }
});

it("retains both failed ZIP inventory owners and retries only those owners", async () => {
  const directory = await createTestTempDirectory("rea-zip-inventory-close-");
  const path = join(directory, "empty.zip");
  await writeFile(path, await zipBytes());
  const resourceScope = new ArtifactResourceScope();
  const originalReaderClose = ZipArtifactReader.prototype.close;
  let readerAttempts = 0;
  const readerClose = vi
    .spyOn(ZipArtifactReader.prototype, "close")
    .mockImplementation(async function (this: ZipArtifactReader) {
      if (++readerAttempts === 1) throw new Error("reader close denied");
      await originalReaderClose.call(this);
    });
  const rootClose = watchZipRootClose(
    resourceScope,
    path,
    (original, attempt) =>
      attempt === 1
        ? Promise.reject(new Error("root close denied"))
        : original(),
  );
  try {
    await expect(
      extractArtifact(zipInput(path, join(directory, "out"), resourceScope)),
    ).rejects.toMatchObject({
      cleanup: {
        resources: [
          `artifact reader for ${path}`,
          `root artifact descriptor for ${path}`,
        ],
      },
    });
    expect(resourceScope.cleanupResources).toEqual([
      `artifact reader for ${path}`,
      `root artifact descriptor for ${path}`,
    ]);
    await resourceScope.close();
    expect(readerAttempts).toBe(2);
    expect(rootClose.attempts()).toBe(2);
  } finally {
    await resourceScope.close().catch(() => undefined);
    rootClose.restore();
    readerClose.mockRestore();
  }
});

it.each([false, true] as const)(
  "retains failed extraction reader cleanup when ZIP root close also fails: %s",
  async (failRootClose) => {
    const directory = await createTestTempDirectory(
      "rea-zip-extraction-mixed-close-",
    );
    const path = join(directory, "empty.zip");
    await writeFile(path, await zipBytes());
    const output = join(directory, "out");
    const resourceScope = new ArtifactResourceScope();
    const originalReaderClose = ZipArtifactReader.prototype.close;
    const readerFailure = new Error("extraction reader close denied");
    const rootFailure = new Error("root close denied");
    let readerAttempts = 0;
    const readerClose = vi
      .spyOn(ZipArtifactReader.prototype, "close")
      .mockImplementation(async function (this: ZipArtifactReader) {
        readerAttempts += 1;
        if (readerAttempts === 2) throw readerFailure;
        await originalReaderClose.call(this);
      });
    const rootClose = watchZipRootClose(
      resourceScope,
      path,
      (original, attempt) =>
        failRootClose && attempt === 1
          ? Promise.reject(rootFailure)
          : original(),
    );
    try {
      await expect(
        extractArtifact(zipInput(path, output, resourceScope)),
      ).rejects.toMatchObject({
        cleanup: {
          resources: failRootClose
            ? [
                `artifact reader for ${path}`,
                `root artifact descriptor for ${path}`,
              ]
            : [`artifact reader for ${path}`],
        },
      });
      expect(resourceScope.cleanupResources).toEqual(
        failRootClose
          ? [
              `artifact reader for ${path}`,
              `root artifact descriptor for ${path}`,
            ]
          : [`artifact reader for ${path}`],
      );
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      await resourceScope.close();
      expect(readerAttempts).toBe(3);
      expect(rootClose.attempts()).toBe(failRootClose ? 2 : 1);
      expect(resourceScope.hasPending).toBe(false);
    } finally {
      await resourceScope.close().catch(() => undefined);
      rootClose.restore();
      readerClose.mockRestore();
    }
  },
);

vi.mock("../pyinstaller/CArchiveLayout.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  observePyInstallerCookie: () =>
    Promise.reject(new ArtifactReaderFailure("format", "detection failed")),
}));

vi.mock("../../filesystem/RegularFile.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../filesystem/RegularFile.js")>();
  return { ...actual, openRegularFile: vi.fn(actual.openRegularFile) };
});

it("keeps the detection error primary and reports a failed detection close", async () => {
  const directory = await createTestTempDirectory("rea-extraction-detect-");
  const path = join(directory, "target.elf");
  await writeFile(path, Buffer.from("not an archive"));
  const resourceScope = new ArtifactResourceScope();
  const originalClose = OwnedFileHandle.prototype.close;
  const closeFailure = new Error("detection close failed");
  let attempts = 0;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      attempts += 1;
      if (attempts === 1) throw closeFailure;
      await originalClose.call(this);
    });
  try {
    await expect(
      extractArtifact({
        inputPath: path,
        inputFormat: "elf",
        outputRoot: join(directory, "out"),
        environment: process.env,
        integrityPolicy: "fail",
        resourceScope,
      }),
    ).rejects.toMatchObject({
      reason: "format",
      message: "detection failed",
      cleanup: { reason: closeFailure.message },
    });
    await resourceScope.close();
    expect(attempts).toBe(2);
  } finally {
    close.mockRestore();
    await resourceScope.close().catch(() => undefined);
  }
});

it("materializes the classified ASAR instead of repeating the adapter format hint", async () => {
  const directory = await createTestTempDirectory("rea-extraction-format-");
  const path = join(directory, "source.asar");
  const content = Buffer.from("observed member");
  await writeFile(
    path,
    Buffer.concat([
      asarHeaderBytes(
        JSON.stringify({
          files: { "member.txt": { size: content.length, offset: "0" } },
        }),
      ),
      content,
    ]),
  );
  const output = join(directory, "out");
  const resourceScope = new ArtifactResourceScope();
  try {
    const result = await extractArtifact(zipInput(path, output, resourceScope));
    expect(result.manifest.root_format).toBe("asar");
    expect(result.artifacts).toMatchObject([
      { relative_path: "member.txt", bytes_written: content.length },
    ]);
    expect((await readFile(join(output, "member.txt"))).equals(content)).toBe(
      true,
    );
  } finally {
    await resourceScope.close();
  }
});

it("refuses a classified non-container before publishing extraction output", async () => {
  const directory = await createTestTempDirectory(
    "rea-extraction-unsupported-",
  );
  const path = join(directory, "source.zip");
  await writeFile(path, "ordinary file bytes");
  const output = join(directory, "out");
  const resourceScope = new ArtifactResourceScope();
  try {
    await expect(
      extractArtifact(zipInput(path, output, resourceScope)),
    ).rejects.toMatchObject({
      operation: "extract_artifact",
      message: expect.stringContaining(
        "Artifact format has no extraction reader: file",
      ),
    });
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await resourceScope.close();
  }
});
