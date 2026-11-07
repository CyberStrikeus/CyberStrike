import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  open as openFile,
  rename,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import {
  classifyAndHashRoot,
  inventoryArtifact,
} from "../../fixtures/artifactInventory.js";
import { asarHeaderBytes } from "../../fixtures/asarHeader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { readWithoutFifoWriter } from "../../fixtures/fifoInput.js";
import { DEFAULT_ASAR_MAX_HEADER_BYTES } from "../../../src/domain/analysisResourceLimits.js";
import {
  CPU,
  arArchive,
  fatImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";

it.skipIf(process.platform === "win32").each(["file", "directory"])(
  "rejects invalid native traversal before canonicalizing a %s inventory root",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-inventory-native-selection-",
    );
    await writeFile(join(root, "blocker"), "regular file");
    const path = join(root, "target");
    if (kind === "directory") await mkdir(path);
    else await writeFile(path, "target bytes");
    await expect(
      inventoryArtifact(`${root}/blocker/../target`),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
    const valid = await inventoryArtifact(path);
    expect(valid.manifest.root_format).toBe(kind);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a FIFO artifact root without waiting for a writer",
  async () => {
    const root = await createTestTempDirectory("rea-artifact-root-fifo-");
    const fifoPath = join(root, "input.asar");
    await promisify(execFile)("mkfifo", [fifoPath]);

    const outcome = await readWithoutFifoWriter(fifoPath, () =>
      inventoryArtifact(fifoPath).then(
        () => undefined,
        (cause: unknown) => cause,
      ),
    );
    expect(outcome.state).toBe("completed");
    if (outcome.state !== "completed")
      throw new Error("Artifact inventory waited for a FIFO writer");
    expect(outcome.result).toMatchObject({
      reason: "format",
      message: `Artifact root is not a regular file: ${fifoPath}`,
    });
  },
);

it("rejects a root path replaced between its initial stat and open", async () => {
  const root = await createTestTempDirectory("rea-artifact-root-replaced-");
  const path = join(root, "input.bin");
  const replacement = join(root, "replacement.bin");
  await writeFile(path, "first bytes\n");
  const expectedMetadata = await lstat(path);
  await writeFile(replacement, "different bytes\n");
  await rm(path);
  await rename(replacement, path);

  await expect(
    classifyAndHashRoot(path, false, expectedMetadata),
  ).rejects.toMatchObject({
    reason: "integrity",
    message: `Root artifact changed before inventory: ${path}`,
  });
});

it("keeps unavailable container traversal distinct from observed root bytes", async () => {
  const root = await createTestTempDirectory("rea-artifact-root-scope-");
  const path = join(root, "fixture.pkg");
  // The recognized XAR prefix selects PKG inventory; no child decoder is installed.
  await writeFile(path, Buffer.from("xar!fixture"));
  const inventory = await inventoryArtifact(path);
  expect(inventory.manifest).toMatchObject({
    root_format: "pkg",
    node_count: 1,
    occurrence_count: 1,
    edge_count: 0,
  });
  expect(inventory.occurrences[0]?.hash_status).toBe("verified");
  expect(inventory.coverage).toEqual({
    scope: "container-entries",
    status: "unknown",
  });
});

it("retains root identity without asserting absent children for an unclassified FAT archive", async () => {
  const root = await createTestTempDirectory("rea-fat-archive-root-scope-");
  const path = join(root, "libfat.a");
  const archive = arArchive();
  const bytes = fatImage([
    { cpu: CPU.x86_64, bytes: archive },
    { cpu: CPU.arm64, bytes: archive },
  ]);
  await writeFile(path, bytes);

  const inventory = await inventoryArtifact(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(inventory.manifest).toMatchObject({
    root_format: "unknown",
    root_sha256: sha256,
    node_count: 1,
    occurrence_count: 1,
    edge_count: 0,
  });
  expect(inventory.nodes).toEqual([
    expect.objectContaining({ format: "unknown", sha256, size: bytes.length }),
  ]);
  expect(inventory.occurrences).toEqual([
    expect.objectContaining({
      artifact_format: "unknown",
      hash_status: "verified",
    }),
  ]);
  expect(inventory.coverage).toEqual({ scope: "root", status: "complete" });
  expect(inventory.limitations).toEqual([
    "Inventory covers root bytes only; child container entries were not examined.",
  ]);
});

it("admits a FAT root when a valid slice header starts at the prefix boundary", async () => {
  const root = await createTestTempDirectory("rea-fat-root-header-boundary-");
  const path = join(root, "universal");
  const bytes = Buffer.alloc(8_224);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(2, 4);
  const slices = [
    { cpu: 0x01000007, subtype: 3, offset: 4_096 },
    { cpu: 0x0100000c, subtype: 0, offset: 8_192 },
  ];
  for (const [index, slice] of slices.entries()) {
    const entry = 8 + index * 20;
    bytes.writeUInt32BE(slice.cpu, entry);
    bytes.writeUInt32BE(slice.subtype, entry + 4);
    bytes.writeUInt32BE(slice.offset, entry + 8);
    bytes.writeUInt32BE(32, entry + 12);
    bytes.writeUInt32BE(12, entry + 16);
    bytes.writeUInt32LE(0xfeedfacf, slice.offset);
    bytes.writeUInt32LE(slice.cpu, slice.offset + 4);
    bytes.writeUInt32LE(slice.subtype, slice.offset + 8);
    bytes.writeUInt32LE(2, slice.offset + 12);
  }
  await writeFile(path, bytes);

  const classified = await classifyAndHashRoot(path, false, await lstat(path));
  expect(classified.format).toBe("mach-o-universal");
});

it("recognizes a root ASAR when its exact JSON extent has legal surrounding whitespace", async () => {
  const root = await createTestTempDirectory("rea-asar-root-whitespace-");
  const path = join(root, "app.asar");
  const json = ` \t\r\n${JSON.stringify({
    files: { "main.js": { size: 0, offset: "0" } },
  })}\r\n `;
  const bytes = asarHeaderBytes(json);
  await writeFile(path, bytes);

  const inventory = await inventoryArtifact(path);
  expect(inventory.manifest.root_format).toBe("asar");
  const rootNode = inventory.nodes.find(
    ({ artifact_id }) => artifact_id === inventory.manifest.root_artifact_id,
  );
  expect(rootNode?.sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(
    inventory.occurrences.map(({ logical_path }) => logical_path),
  ).toContain("main.js");
});

it("reports the bounded probe limit for an oversized ASAR candidate without penalizing opaque files", async () => {
  const root = await createTestTempDirectory("rea-asar-probe-limit-");
  const candidatePath = join(root, "large.asar");
  const opaquePath = join(root, "opaque.bin");
  const jsonObject = Buffer.from('{"files":{}}');
  const signatureOffset = DEFAULT_ASAR_MAX_HEADER_BYTES + 9;
  const whitespaceBytes = signatureOffset - 16;
  const jsonBytes = whitespaceBytes + jsonObject.length;
  const headerBytes = 8 + Math.ceil(jsonBytes / 4) * 4;
  const archiveBytes = 8 + headerBytes;
  const fixed = Buffer.alloc(16);
  fixed.writeUInt32LE(4, 0);
  fixed.writeUInt32LE(headerBytes, 4);
  fixed.writeUInt32LE(headerBytes - 4, 8);
  fixed.writeUInt32LE(jsonBytes, 12);

  const handle = await openFile(candidatePath, "w");
  try {
    const writeAt = async (bytes: Buffer, start: number): Promise<void> => {
      let written = 0;
      while (written < bytes.length) {
        const result = await handle.write(
          bytes,
          written,
          bytes.length - written,
          start + written,
        );
        if (result.bytesWritten === 0)
          throw new Error("Could not write ASAR signature fixture");
        written += result.bytesWritten;
      }
    };
    await writeAt(fixed, 0);
    const spaces = Buffer.alloc(64 * 1024, 0x20);
    let position = 16;
    while (position < signatureOffset) {
      const count = Math.min(spaces.length, signatureOffset - position);
      await writeAt(spaces.subarray(0, count), position);
      position += count;
    }
    await writeAt(jsonObject, signatureOffset);
    await handle.truncate(archiveBytes);
  } finally {
    await handle.close();
  }

  await writeFile(opaquePath, "ordinary opaque bytes");
  await expect(inventoryArtifact(candidatePath)).rejects.toMatchObject({
    reason: "limit",
  });
  expect((await inventoryArtifact(opaquePath)).manifest.root_format).toBe(
    "file",
  );
});
