import {
  appendFile,
  mkdir,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { renameOpenParent } from "../../../tests/fixtures/renameOpenParent.js";
import { buildGodotPck } from "../../../tests/fixtures/godotPck.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { GodotPckArtifactReader } from "../GodotPckArtifactReader.js";
import { NodeSeaArtifactReader } from "../NodeSeaArtifactReader.js";
import { PyInstallerArtifactReader } from "../PyInstallerArtifactReader.js";
import { cArchiveExecutable } from "../pyinstaller/CArchive.fixture.js";
import { nodeSeaElf } from "../nodeSea/NodeSea.fixture.js";
import * as cArchive from "../pyinstaller/CArchiveLayout.js";
import * as nodeSea from "../nodeSea/NodeSeaBlob.js";
import * as godot from "../GodotPckLocation.js";
import { extractArtifact } from "./ArtifactExtraction.js";

const cases = [
  {
    format: "pyinstaller" as const,
    inputFormat: "pe" as const,
    reader: PyInstallerArtifactReader as {
      prototype: { close(): Promise<void> };
    },
    bytes: () =>
      cArchiveExecutable({
        carrier: "pe",
        layout: "2.1",
        pythonVersion: 314,
        members: [
          {
            name: String.raw`pkg\payload.txt`,
            typeCode: "x",
            payload: Buffer.from("fixture"),
            compress: false,
          },
        ],
      }),
    member: "pkg/payload.txt",
    observe: () => vi.spyOn(cArchive, "observePyInstallerCookie"),
  },
  {
    format: "node-sea" as const,
    inputFormat: "elf" as const,
    reader: NodeSeaArtifactReader as { prototype: { close(): Promise<void> } },
    bytes: () => nodeSeaElf({ codePath: "payload.js", main: "fixture" }),
    member: "payload.js",
    observe: () => vi.spyOn(nodeSea, "decodeNodeSeaBlob"),
  },
  {
    format: "godot-pck" as const,
    inputFormat: "godot-pck" as const,
    reader: GodotPckArtifactReader as { prototype: { close(): Promise<void> } },
    bytes: () => buildGodotPck(3, [{ path: "payload.txt", data: "fixture" }]),
    member: "payload.txt",
    observe: () => vi.spyOn(godot, "locateGodotPck"),
  },
];

it.each(cases)(
  "extracts $format using the inventory admission once",
  async ({ format, inputFormat, reader, bytes, member, observe }) => {
    const directory = await createTestTempDirectory("rea-embedded-extraction-");
    const path = join(directory, "source");
    const output = join(directory, "out");
    const carrier = bytes();
    await writeFile(path, carrier);
    const scope = new ArtifactResourceScope();
    const observation = observe();
    const close = vi.spyOn(reader.prototype, "close");
    const release = vi.spyOn(scope, "release");
    try {
      const result = await extractArtifact({
        inputPath: path,
        inputFormat,
        outputRoot: output,
        environment: {},
        integrityPolicy: "fail",
        resourceScope: scope,
        expectedRootSha256: createHash("sha256").update(carrier).digest("hex"),
        selectedPath: path,
      });
      expect(result.manifest.root_format).toBe(format);
      expect(await readFile(join(output, member), "utf8")).toBe("fixture");
      expect(observation).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(2);
      const rootRelease = release.mock.calls.findIndex(
        ([owner]) =>
          owner.kind === "file-handle" &&
          owner.resource === `root artifact descriptor for ${path}`,
      );
      expect(rootRelease).toBeGreaterThanOrEqual(0);
      expect(
        release.mock.calls
          .slice(0, rootRelease)
          .filter(([owner]) => owner.kind === "reader"),
      ).toHaveLength(2);
      expect(scope.hasPending).toBe(false);
    } finally {
      await scope.close();
      observation.mockRestore();
      close.mockRestore();
      release.mockRestore();
    }
  },
);

it.each(cases)(
  "rejects changed $format bytes before materializing admitted facts",
  async ({ inputFormat, reader, bytes }) => {
    const directory = await createTestTempDirectory(
      "rea-embedded-extraction-stale-",
    );
    const path = join(directory, "source");
    const output = join(directory, "out");
    await writeFile(path, bytes());
    const scope = new ArtifactResourceScope();
    const original = reader.prototype.close;
    let closes = 0;
    const close = vi
      .spyOn(reader.prototype, "close")
      .mockImplementation(async function (this: { close(): Promise<void> }) {
        await original.call(this);
        if (++closes === 1) await appendFile(path, "changed");
      });
    try {
      await expect(
        extractArtifact({
          inputPath: path,
          inputFormat,
          outputRoot: output,
          environment: {},
          integrityPolicy: "fail",
          resourceScope: scope,
        }),
      ).rejects.toMatchObject({ reason: "integrity" });
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      expect(scope.hasPending).toBe(false);
    } finally {
      await scope.close();
      close.mockRestore();
    }
  },
);

it.each(
  cases.flatMap((fixture) =>
    ["cancel", "retry", "mixed"].map((mode) => ({ ...fixture, mode })),
  ),
)(
  "retains $format finalization semantics during $mode",
  async ({ inputFormat, reader, bytes, mode }) => {
    const directory = await createTestTempDirectory(
      "rea-embedded-extraction-cleanup-",
    );
    const path = join(directory, "source");
    const output = join(directory, "out");
    await writeFile(path, bytes());
    const scope = new ArtifactResourceScope();
    const controller = new AbortController();
    const failure = new Error("root close denied");
    const originalReaderClose = reader.prototype.close;
    let readerAttempts = 0;
    const readerClose = vi
      .spyOn(reader.prototype, "close")
      .mockImplementation(async function (this: { close(): Promise<void> }) {
        if (++readerAttempts === 2 && mode === "mixed")
          throw new Error("reader close denied");
        await originalReaderClose.call(this);
      });
    const originalRelease = scope.release.bind(scope);
    let rootAttempts = 0;
    let rootClose: { mockRestore(): void } | undefined;
    const release = vi
      .spyOn(scope, "release")
      .mockImplementation(async (owner) => {
        if (
          owner.kind === "file-handle" &&
          owner.resource === `root artifact descriptor for ${path}`
        ) {
          const originalClose = owner.handle.close.bind(owner.handle);
          rootClose = vi
            .spyOn(owner.handle, "close")
            .mockImplementation(async () => {
              rootAttempts++;
              expect(readerAttempts).toBeGreaterThanOrEqual(2);
              if (rootAttempts === 1) {
                if (mode === "cancel") controller.abort(failure);
                else throw failure;
              }
              await originalClose();
            });
        }
        return originalRelease(owner);
      });
    try {
      const execution = extractArtifact(
        {
          inputPath: path,
          inputFormat,
          outputRoot: output,
          environment: {},
          integrityPolicy: "fail",
          resourceScope: scope,
        },
        controller.signal,
      );
      if (mode === "cancel")
        await expect(execution).rejects.toMatchObject({
          reason: "cancelled",
          cause: failure,
        });
      else
        await expect(execution).rejects.toMatchObject({
          cleanup: {
            resources: expect.arrayContaining([
              `root artifact descriptor for ${path}`,
            ]),
          },
        });
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      if (mode === "mixed")
        expect(scope.cleanupResources).toEqual([
          `artifact reader for ${path}`,
          `root artifact descriptor for ${path}`,
        ]);
      else if (mode === "retry")
        expect(scope.cleanupResources).toEqual([
          `root artifact descriptor for ${path}`,
        ]);
      await scope.close();
      expect(rootAttempts).toBe(mode === "cancel" ? 1 : 2);
      expect(readerAttempts).toBe(mode === "mixed" ? 3 : 2);
      expect(scope.hasPending).toBe(false);
    } finally {
      await scope.close().catch(() => undefined);
      rootClose?.mockRestore();
      release.mockRestore();
      readerClose.mockRestore();
    }
  },
);

it.each(cases)(
  "rejects a retargeted selected path before publishing $format extraction",
  async ({ inputFormat, reader, bytes }) => {
    const directory = await createTestTempDirectory(
      "rea-embedded-extraction-selection-",
    );
    const path = join(directory, "source");
    const selectedPath = join(directory, "selected");
    const replacement = join(directory, "replacement");
    const output = join(directory, "out");
    const carrier = bytes();
    await writeFile(path, carrier);
    await writeFile(replacement, carrier);
    await symlink(path, selectedPath);
    const scope = new ArtifactResourceScope();
    const originalClose = reader.prototype.close;
    let closes = 0;
    const close = vi
      .spyOn(reader.prototype, "close")
      .mockImplementation(async function (this: { close(): Promise<void> }) {
        await originalClose.call(this);
        if (++closes === 2) {
          await unlink(selectedPath);
          await symlink(replacement, selectedPath);
        }
      });
    try {
      await expect(
        extractArtifact({
          inputPath: path,
          selectedPath,
          expectedRootSha256: createHash("sha256")
            .update(carrier)
            .digest("hex"),
          inputFormat,
          outputRoot: output,
          environment: {},
          integrityPolicy: "fail",
          resourceScope: scope,
        }),
      ).rejects.toMatchObject({ reason: "integrity" });
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      expect(closes).toBe(2);
      expect(scope.hasPending).toBe(false);
    } finally {
      await scope.close();
      close.mockRestore();
    }
  },
);

it.each(
  cases.flatMap((item) => [
    { ...item, simulateWindowsRefusal: false },
    { ...item, simulateWindowsRefusal: true },
  ]),
)(
  "handles attempted replacement at the admitted $format pathname (simulated refusal: $simulateWindowsRefusal)",
  async ({ inputFormat, reader, bytes, simulateWindowsRefusal }) => {
    const directory = await createTestTempDirectory(
      "rea-embedded-extraction-replacement-",
    );
    const selectedDirectory = join(directory, "selected");
    await mkdir(selectedDirectory);
    const path = join(selectedDirectory, "source");
    const output = join(directory, "out");
    const originalBytes = bytes();
    await writeFile(path, originalBytes);
    const scope = new ArtifactResourceScope();
    const originalClose = reader.prototype.close;
    let closes = 0;
    let deniedRename: unknown;
    const close = vi
      .spyOn(reader.prototype, "close")
      .mockImplementation(async function (this: { close(): Promise<void> }) {
        await originalClose.call(this);
        if (++closes === 1) {
          // Moving the parent leaves the admitted regular file's metadata intact.
          const swap = await renameOpenParent(
            selectedDirectory,
            join(directory, "admitted"),
            simulateWindowsRefusal
              ? {
                  platform: "win32",
                  rename: async () => {
                    throw Object.assign(new Error("injected EPERM"), {
                      code: "EPERM",
                    });
                  },
                }
              : {},
          );
          if (swap.kind === "blocked") {
            deniedRename = swap.cause;
            throw swap.cause;
          }
          await mkdir(selectedDirectory);
          await writeFile(path, Buffer.from("replacement"));
        }
      });
    try {
      const failure = await extractArtifact({
        inputPath: path,
        inputFormat,
        outputRoot: output,
        environment: {},
        integrityPolicy: "fail",
        resourceScope: scope,
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      if (deniedRename === undefined)
        expect(failure).toMatchObject({ reason: "integrity" });
      else
        expect(failure).toMatchObject({
          reason: "io",
          message: expect.stringContaining("EPERM"),
        });
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      expect(closes).toBe(1);
      if (deniedRename !== undefined) {
        expect((await readFile(path)).equals(originalBytes)).toBe(true);
        expect(scope.hasPending).toBe(true);
        await scope.close();
      }
      expect(scope.hasPending).toBe(false);
    } finally {
      await scope.close();
      close.mockRestore();
    }
  },
);
