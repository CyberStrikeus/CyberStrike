import { createHash } from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import * as rootHash from "../../../../src/artifacts/inventory/hashStableRootArtifact.js";
import * as pckLocation from "../../../../src/artifacts/GodotPckLocation.js";
import * as seaLocation from "../../../../src/artifacts/nodeSea/NodeSeaLocation.js";
import * as pyInstallerLocation from "../../../../src/artifacts/pyinstaller/CArchiveLayout.js";
import { nodeSeaElf } from "../../../../src/artifacts/nodeSea/NodeSea.fixture.js";
import { cArchiveExecutable } from "../../../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { artifactExtractionResultSchema } from "../../../../src/domain/artifactGraph.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { withArtifactClient } from "../../../support/artifactClientScope.js";
import { buildGodotPck, embedGodotPck } from "../../../fixtures/godotPck.js";

it("refuses an unsupported source without hashing its bytes", async () => {
  const root = await createTestTempDirectory("rea-extraction-admission-");
  const source = join(root, "unsupported.dmg");
  const output = join(root, "output");
  await writeFile(source, "not a supported extraction container");
  const hash = vi.spyOn(rootHash, "hashStableRootArtifactHandle");
  try {
    await withArtifactClient(
      {
        path: source,
        sourcePath: source,
        sha256: createHash("sha256")
          .update(await readFile(source))
          .digest("hex"),
        kind: "archive",
        format: "dmg",
      },
      async (client) => {
        expect(
          await client.execute("extract_artifact", { output_root: output }),
        ).toMatchObject({
          ok: false,
          error: { _tag: "AnalysisUnsupportedTargetError", path: source },
        });
        expect(hash).not.toHaveBeenCalled();
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  } finally {
    hash.mockRestore();
  }
});

it("preserves cancellation arriving during the detection descriptor's final close", async () => {
  const root = await createTestTempDirectory("rea-extraction-admission-close-");
  const source = join(root, "unsupported.dmg");
  const output = join(root, "output");
  await writeFile(source, "not a supported extraction container");
  const controller = new AbortController();
  const reason = new Error("cancel detection finalization");
  const close = OwnedFileHandle.prototype.close;
  const closeSpy = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementationOnce(async function (this: OwnedFileHandle) {
      await close.call(this);
      controller.abort(reason);
    });
  const hash = vi.spyOn(rootHash, "hashStableRootArtifactHandle");
  try {
    await withArtifactClient(
      {
        path: source,
        sourcePath: source,
        sha256: createHash("sha256")
          .update(await readFile(source))
          .digest("hex"),
        kind: "archive",
        format: "dmg",
      },
      async (client) => {
        const result = await client.execute(
          "extract_artifact",
          { output_root: output },
          { signal: controller.signal },
        );
        expect(result).toMatchObject({
          ok: false,
          error: { _tag: "ArtifactOperationError", reason: "cancelled" },
        });
        if (result.ok) throw new Error("Expected detection cancellation");
        expect(result.error.cause).toBe(reason);
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(hash).not.toHaveBeenCalled();
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  } finally {
    closeSpy.mockRestore();
    hash.mockRestore();
  }
});

it("keeps detection I/O failure distinct from unsupported format and closes its source", async () => {
  const root = await createTestTempDirectory("rea-extraction-admission-read-");
  const source = join(root, "unsupported.dmg");
  const output = join(root, "output");
  await writeFile(source, "not a supported extraction container");
  const failure = Object.assign(new Error("detection read failed"), {
    code: "EIO",
  });
  const detect = vi
    .spyOn(pckLocation, "locateGodotPck")
    .mockRejectedValueOnce(failure);
  const close = vi.spyOn(OwnedFileHandle.prototype, "close");
  const hash = vi.spyOn(rootHash, "hashStableRootArtifactHandle");
  try {
    await withArtifactClient(
      {
        path: source,
        sourcePath: source,
        sha256: createHash("sha256")
          .update(await readFile(source))
          .digest("hex"),
        kind: "archive",
        format: "dmg",
      },
      async (client) => {
        const result = await client.execute("extract_artifact", {
          output_root: output,
        });
        expect(result).toMatchObject({
          ok: false,
          error: { _tag: "ArtifactOperationError", reason: "io" },
        });
        expect(hash).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
        if (result.ok) throw new Error("Expected detection I/O failure");
        expect(result.error.cause).toBe(failure);
        expect(result.error.cleanupIncomplete).toBe(false);
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  } finally {
    detect.mockRestore();
    close.mockRestore();
    hash.mockRestore();
  }
});

it.each([
  "replacement inode",
  "changed same inode",
  "directory replacement",
] as const)(
  "refuses to reuse completed detection facts after %s before inventory output",
  async (change) => {
    const root = await createTestTempDirectory(
      "rea-extraction-admission-identity-",
    );
    const source = join(root, "game");
    const output = join(root, "output");
    const bytes = embedGodotPck(
      buildGodotPck(3, [{ path: "res://main.gd", data: "extends Node\n" }]),
    );
    await writeFile(source, bytes);
    let hashesAtMutation: number | undefined;
    const close = OwnedFileHandle.prototype.close;
    const closeSpy = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementationOnce(async function (this: OwnedFileHandle) {
        await close.call(this);
        hashesAtMutation = hash.mock.calls.length;
        if (change === "changed same inode")
          await appendFile(source, "changed");
        else if (change === "directory replacement") {
          await rm(source);
          await mkdir(source);
        } else {
          // Equal bytes do not establish that this is the admitted source.
          await rename(source, join(root, "original"));
          await writeFile(source, bytes);
        }
      });
    const hash = vi.spyOn(rootHash, "hashStableRootArtifactHandle");
    try {
      await withArtifactClient(
        {
          path: source,
          sourcePath: source,
          sha256: createHash("sha256")
            .update(await readFile(source))
            .digest("hex"),
          kind: "executable",
          format: "elf",
          architecture: "x86_64",
          availableArchitectures: ["x86_64"],
        },
        async (client) => {
          const result = await client.execute("extract_artifact", {
            output_root: output,
          });
          expect(result).toMatchObject({
            ok: false,
            error: { _tag: "ArtifactOperationError", reason: "integrity" },
          });
          expect(hashesAtMutation).toBeDefined();
          // Initial admission may hash; facts known stale after close must not.
          expect(hash).toHaveBeenCalledTimes(hashesAtMutation!);
          await expect(access(output)).rejects.toMatchObject({
            code: "ENOENT",
          });
        },
      );
    } finally {
      closeSpy.mockRestore();
      hash.mockRestore();
    }
  },
);

it.each([
  {
    format: "godot-pck",
    bytes: () =>
      embedGodotPck(
        buildGodotPck(3, [{ path: "res://main.gd", data: "extends Node\n" }]),
      ),
    probes: [1, 0, 0],
  },
  {
    format: "node-sea",
    bytes: () => nodeSeaElf({ main: "console.log('fixture')\n" }),
    probes: [1, 1, 0],
  },
  {
    format: "pyinstaller",
    bytes: () =>
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 314,
        pythonLibrary: "libpython3.14.so",
        members: [
          {
            name: "payload",
            typeCode: "x",
            payload: Buffer.from("fixture\n"),
            compress: false,
          },
        ],
      }),
    probes: [1, 1, 1],
  },
])(
  "reuses completed $format detection facts while classifying observed bytes independently of the caller carrier",
  async ({ format, bytes, probes }) => {
    const root = await createTestTempDirectory(
      "rea-extraction-admission-reuse-",
    );
    const source = join(root, "game");
    await writeFile(source, bytes());
    const pck = vi.spyOn(pckLocation, "locateGodotPck");
    const sea = vi.spyOn(seaLocation, "locateNodeSea");
    const pyInstaller = vi.spyOn(
      pyInstallerLocation,
      "observePyInstallerCookie",
    );
    const hashRoot = rootHash.hashStableRootArtifactHandle;
    let probesBeforeHash: number[] | undefined;
    const hash = vi
      .spyOn(rootHash, "hashStableRootArtifactHandle")
      .mockImplementation((...arguments_) => {
        // Observe the completed preflight plus classification work before reader
        // materialization can perform its own independent source validation.
        probesBeforeHash ??= [
          pck.mock.calls.length,
          sea.mock.calls.length,
          pyInstaller.mock.calls.length,
        ];
        return hashRoot(...arguments_);
      });
    try {
      await withArtifactClient(
        {
          path: source,
          sourcePath: source,
          sha256: createHash("sha256")
            .update(await readFile(source))
            .digest("hex"),
          kind: "executable",
          format: "pe",
          executableRole: "application",
          managed: false,
          architecture: "x86_64",
          availableArchitectures: ["x86_64"],
        },
        async (client) => {
          const result = await client.execute("extract_artifact", {
            output_root: join(root, "output"),
          });
          if (!result.ok) throw result.error;
          const extracted = artifactExtractionResultSchema.parse(
            result.value.result,
          );
          expect(extracted.manifest.root_format).toBe(format);
          expect(extracted.artifacts.length).toBeGreaterThan(0);
          expect(probesBeforeHash).toEqual(probes);
          // Preflight's cookie supplies inventory and the transferred extraction
          // admission; descriptor/path and digest checks still validate freshness.
          if (format === "pyinstaller")
            expect(pyInstaller).toHaveBeenCalledTimes(1);
        },
      );
    } finally {
      pck.mockRestore();
      sea.mockRestore();
      pyInstaller.mockRestore();
      hash.mockRestore();
    }
  },
);

it("refuses an incomplete PyInstaller detection tail without reporting unsupported format", async () => {
  const root = await createTestTempDirectory(
    "rea-extraction-pyinstaller-tail-",
  );
  const source = join(root, "app");
  const output = join(root, "output");
  const bytes = cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 314,
    members: [],
  });
  await writeFile(source, bytes);
  const observe = pyInstallerLocation.observePyInstallerCookie;
  const detect = vi
    .spyOn(pyInstallerLocation, "observePyInstallerCookie")
    .mockImplementation(async (...arguments_) => {
      // The admitted size is now larger than the bytes the descriptor can read.
      await truncate(source, 64);
      return observe(...arguments_);
    });
  const close = vi.spyOn(OwnedFileHandle.prototype, "close");
  const hash = vi.spyOn(rootHash, "hashStableRootArtifactHandle");
  try {
    await withArtifactClient(
      {
        path: source,
        sourcePath: source,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind: "executable",
        format: "elf",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      },
      async (client) => {
        expect(
          await client.execute("extract_artifact", { output_root: output }),
        ).toMatchObject({
          ok: false,
          error: {
            _tag: "ArtifactOperationError",
            reason: "format",
            detail: "CArchive tail is truncated",
          },
        });
        expect(detect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalled();
        expect(hash).not.toHaveBeenCalled();
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  } finally {
    detect.mockRestore();
    close.mockRestore();
    hash.mockRestore();
  }
});

it("keeps incidental rejected cookie signatures unsupported during native extraction", async () => {
  const root = await createTestTempDirectory(
    "rea-extraction-pyinstaller-candidate-",
  );
  const source = join(root, "app");
  const output = join(root, "output");
  const bytes = Buffer.concat([
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      members: [],
    }).subarray(0, 64),
    pyInstallerLocation.PYINSTALLER_COOKIE_MAGIC,
    Buffer.alloc(88),
  ]);
  await writeFile(source, bytes);
  const hash = vi.spyOn(rootHash, "hashStableRootArtifactHandle");
  try {
    await withArtifactClient(
      {
        path: source,
        sourcePath: source,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind: "executable",
        format: "elf",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      },
      async (client) => {
        expect(
          await client.execute("extract_artifact", { output_root: output }),
        ).toMatchObject({
          ok: false,
          error: { _tag: "AnalysisUnsupportedTargetError", path: source },
        });
        expect(hash).not.toHaveBeenCalled();
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  } finally {
    hash.mockRestore();
  }
});
