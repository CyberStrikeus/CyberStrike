import * as rootHash from "../../../src/artifacts/inventory/hashStableRootArtifact.js";
import { readFileHandlePrefix } from "../../../src/filesystem/readFileHandlePrefix.js";
import { abortIfNeeded } from "../../../src/artifacts/ArtifactHash.js";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { inesFixture } from "../../fixtures/ines.js";
import {
  inventoryArtifact,
  scanArtifactInventory,
  materializeArtifactInventory,
} from "../../fixtures/artifactInventory.js";
import { InesArtifactReader } from "../../../src/artifacts/InesArtifactReader.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import {
  extractArtifact,
  materializeArtifactInventoryInScope as materializeInScope,
} from "../../../src/artifacts/extraction/ArtifactExtraction.js";

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const fileReadPrototype = async (
  path: string,
): Promise<Pick<FileHandle, "read">> => {
  const handle = await open(path, "r");
  try {
    return Object.getPrototypeOf(handle) as Pick<FileHandle, "read">;
  } finally {
    await handle.close();
  }
};

it("reuses scanned iNES region bytes for reconstruction without another full read", async () => {
  const root = await createTestTempDirectory("rea-ines-read-budget-");
  const path = join(root, "large-tail.nes");
  const bytes = inesFixture({ trailing: Buffer.alloc(2 * 1024 * 1024, 0x5a) });
  await writeFile(path, bytes);
  const prototype = await fileReadPrototype(path);
  const originalRead = prototype.read;
  let bytesRead = 0;
  const read = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args
  ) {
    const result = await originalRead.call(this, ...args);
    bytesRead += result.bytesRead;
    return result;
  });
  try {
    const result = await inventoryArtifact(path);
    expect(result.ines?.reconstruction).toMatchObject({
      bytes: bytes.length,
      sha256: sha256(bytes),
      verified: true,
    });
    // Initial root hash, region scan, final freshness hash, plus bounded headers.
    expect(bytesRead).toBeLessThanOrEqual(3 * bytes.length + 64 * 1024);
  } finally {
    read.mockRestore();
  }
});

it("rejects region bytes that disagree with stable whole-file hashes", async () => {
  const root = await createTestTempDirectory("rea-ines-region-digest-");
  const path = join(root, "source.nes");
  const bytes = inesFixture();
  await writeFile(path, bytes);
  const prototype = await fileReadPrototype(path);
  const originalRead = prototype.read;
  let changed = false;
  const read = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args
  ) {
    const result = await originalRead.call(this, ...args);
    const arguments_: readonly unknown[] = args;
    if (!changed && arguments_[3] === 16n && result.bytesRead === 16_384) {
      // Alter only the region observation, leaving both whole-file passes intact.
      if (!Buffer.isBuffer(result.buffer))
        throw new Error("Expected byte buffer");
      result.buffer.writeUInt8(result.buffer.readUInt8(0) ^ 0xff, 0);
      changed = true;
    }
    return result;
  });
  try {
    await expect(inventoryArtifact(path)).rejects.toMatchObject({
      reason: "integrity",
      message: "iNES reconstruction differs from the source",
    });
    expect(changed).toBe(true);
    expect((await readFile(path)).equals(bytes)).toBe(true);
  } finally {
    read.mockRestore();
  }
});

it.each(["data", "hop", "HOP"])(
  "routes iNES bytes as an archive with a .%s suffix",
  async (suffix) => {
    const root = await createTestTempDirectory("rea-ines-target-");
    const path = join(root, `cartridge.${suffix}`);
    await writeFile(path, inesFixture());
    const target = await parseBinaryTarget(path);
    if (!target.ok) throw target.error;
    expect(target.value).toMatchObject({ kind: "archive", format: "ines" });
  },
);

it("honors explicit database selection before parsing NES-signature bytes", async () => {
  const root = await createTestTempDirectory("rea-ines-database-");
  for (const bytes of [inesFixture(), Buffer.from("NES\x1a")]) {
    const path = join(root, "selected.hop");
    await writeFile(path, bytes);
    expect(
      await parseBinaryTarget(path, { targetKind: "database" }),
    ).toMatchObject({
      ok: true,
      value: { kind: "database", format: "analysis-database" },
    });
  }
});
it("inventories and reconstructs all bytes without trainer or CHR ROM", async () => {
  const root = await createTestTempDirectory("rea-ines-inventory-");
  const path = join(root, "fixture.nes");
  const bytes = inesFixture({
    chrUnits: 0,
    trailing: Buffer.from("retained tail"),
  });
  await writeFile(path, bytes);
  const inventory = await inventoryArtifact(path);
  expect(inventory.ines?.header).toMatchObject({
    header_hex: bytes.subarray(0, 16).toString("hex"),
    mapper: 19,
    trainer_present: false,
    chr_rom_units_8k: 0,
  });
  expect(inventory.ines?.reconstruction).toMatchObject({
    bytes: bytes.length,
    sha256: sha256(bytes),
    verified: true,
  });
  const children = inventory.occurrences.filter(
    ({ logical_path }) => logical_path !== ".",
  );
  const ordered = [...children].sort(
    (a, b) =>
      (a.source_location?.offset ?? 0) - (b.source_location?.offset ?? 0),
  );
  const nodes = new Map(
    inventory.nodes.map((node) => [node.artifact_id, node]),
  );
  const headerRegion = children.find(
    ({ logical_path }) => logical_path === "header.bin",
  );
  if (
    headerRegion?.artifact_id === undefined ||
    headerRegion.artifact_id === null
  )
    throw new Error("Missing header region");
  expect(nodes.get(headerRegion.artifact_id)?.format).toBe("file");
  let offset = 0;
  for (const occurrence of ordered) {
    const range = occurrence.source_location;
    if (range === null || occurrence.artifact_id === null)
      throw new Error("Missing region identity");
    expect(range.offset).toBe(offset);
    const original = bytes.subarray(range.offset, range.offset + range.length);
    expect(nodes.get(occurrence.artifact_id)).toMatchObject({
      sha256: sha256(original),
      size: range.length,
    });
    offset += range.length;
  }
  expect(offset).toBe(bytes.length);
  expect(inventory.ines?.reconstruction.region_order).toEqual(
    ordered.map(({ logical_path }) => logical_path),
  );
  expect(await inventoryArtifact(path)).toEqual(inventory);

  const scope = new ArtifactResourceScope();
  const outputRoot = join(root, "extracted");
  try {
    const extraction = await extractArtifact({
      inputPath: path,
      inputFormat: "ines",
      outputRoot,
      environment: process.env,
      integrityPolicy: "fail",
      resourceScope: scope,
    });
    expect(extraction.artifacts).toHaveLength(children.length);
    const reconstructed = Buffer.concat(
      await Promise.all(
        ordered.map(({ logical_path }) =>
          readFile(join(outputRoot, logical_path)),
        ),
      ),
    );
    expect(reconstructed.equals(bytes)).toBe(true);
  } finally {
    await scope.close();
  }
});

it.each([
  {
    name: "NES 2.0",
    bytes: () => {
      const bytes = inesFixture();
      bytes[7] = 8;
      return bytes;
    },
    reason: "nes-2.0",
  },
  { name: "UNIF", bytes: () => Buffer.from("UNIF"), reason: "unif" },
  {
    name: "truncated",
    bytes: () => inesFixture().subarray(0, 20),
    reason: "truncated iNES payload",
  },
])(
  "refuses $name explicitly through both file entry points",
  async ({ bytes, reason }) => {
    const root = await createTestTempDirectory("rea-ines-refusal-");
    const path = join(root, "invalid.nes");
    await writeFile(path, bytes());
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: false,
      error: { reason: expect.stringContaining(reason) },
    });
    await expect(inventoryArtifact(path)).rejects.toMatchObject({
      reason: "format",
      message: expect.stringContaining(reason),
    });
  },
);

it("does not select iNES from a .nes suffix", async () => {
  const root = await createTestTempDirectory("rea-ines-suffix-");
  const path = join(root, "not-a-rom.nes");
  await writeFile(path, "ordinary bytes");
  expect(await parseBinaryTarget(path)).toMatchObject({ ok: false });
});

it("rejects forged region ranges, cancellation and a changed retained source", async () => {
  const root = await createTestTempDirectory("rea-ines-reader-");
  const path = join(root, "source.nes");
  await writeFile(path, inesFixture());
  const handle = await open(path, "r");
  const reader = new InesArtifactReader(path, {
    handle,
    initial: await lstat(path),
  });
  try {
    const iterator = reader.entries()[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error("No header region");
    await expect(
      reader.open({ ...first.value, byteOffset: 16 }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await expect(
      reader.open(first.value, AbortSignal.abort()),
    ).rejects.toMatchObject({ reason: "cancelled" });
    await writeFile(
      path,
      Buffer.concat([inesFixture(), Buffer.from("changed")]),
    );
    await expect(reader.open(first.value)).rejects.toMatchObject({
      reason: "integrity",
    });
    await iterator.return?.();
    await reader.close();
    expect((await handle.stat()).size).toBeGreaterThan(0);
    await expect(reader.open(first.value)).rejects.toMatchObject({
      reason: "unavailable",
    });
  } finally {
    await reader.close();
    await handle.close();
  }
});

it.each(["before", "during"])(
  "reports source removal %s a region read as integrity failure",
  async (when) => {
    const root = await createTestTempDirectory("rea-ines-removed-source-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const handle = await open(path, "r");
    const reader = new InesArtifactReader(path, {
      handle,
      initial: await handle.stat(),
    });
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      const entry = entries[0];
      if (entry === undefined) throw new Error("No header region");
      if (when === "before") {
        await unlink(path);
        await expect(reader.open(entry)).rejects.toMatchObject({
          reason: "integrity",
          cause: { code: "ENOENT" },
        });
      } else {
        const stream = await reader.open(entry);
        await unlink(path);
        await expect(
          (async () => {
            for await (const chunk of stream)
              expect(Buffer.isBuffer(chunk)).toBe(true);
          })(),
        ).rejects.toMatchObject({
          reason: "integrity",
          cause: { code: "ENOENT" },
        });
      }
    } finally {
      await reader.close();
      await handle.close();
    }
  },
);

it.each(["truncated", "overwritten"])(
  "reports a header %s during admission as an integrity failure",
  async (change) => {
    const root = await createTestTempDirectory("rea-ines-header-race-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const handle = await open(path, "r");
    const reader = new InesArtifactReader(path, {
      handle,
      initial: await handle.stat(),
    });
    const originalRead = handle.read.bind(handle);
    // Mutate the actual file after pre-read validation, at the read boundary.
    const read = vi
      .spyOn(handle, "read")
      .mockImplementationOnce(async (...args) => {
        const changed =
          change === "truncated"
            ? Buffer.alloc(0)
            : Buffer.alloc(inesFixture().length);
        await writeFile(path, changed);
        return originalRead(...args);
      });
    try {
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        reason: "integrity",
      });
    } finally {
      read.mockRestore();
      await reader.close();
      await handle.close();
    }
  },
);

it.each(["inventory", "target"])(
  "rejects changed iNES prefixes at the %s entry point",
  async (route) => {
    const root = await createTestTempDirectory("rea-ines-classification-race-");
    const path = join(root, "source.nes");
    for (const change of ["truncated", "counts", "signature"] as const) {
      const bytes = inesFixture();
      await writeFile(path, bytes);
      const prototype = await fileReadPrototype(path);
      const originalRead = prototype.read;
      const read = vi
        .spyOn(prototype, "read")
        .mockImplementationOnce(async function (this: FileHandle, ...args) {
          read.mockRestore();
          const changed =
            change === "truncated" ? bytes.subarray(0, 16) : Buffer.from(bytes);
          if (change === "counts") changed[4] = 255;
          if (change === "signature") changed.fill(0, 0, 4);
          await writeFile(path, changed);
          return originalRead.call(this, ...args);
        });
      try {
        if (route === "inventory") {
          await expect(inventoryArtifact(path)).rejects.toMatchObject({
            reason: "integrity",
          });
        } else {
          expect(await parseBinaryTarget(path)).toMatchObject({
            ok: false,
            error: { reason: expect.stringContaining("changed") },
          });
        }
      } finally {
        read.mockRestore();
      }
    }
  },
);

it.each([1, 2])(
  "reports source loss during inventory root hash pass %i as a changed input",
  async (hashPass) => {
    const root = await createTestTempDirectory("rea-ines-hash-loss-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const originalHash = rootHash.hashStableRootArtifactHandle;
    let observedPasses = 0;
    let faultInjected = false;
    const hash = vi
      .spyOn(rootHash, "hashStableRootArtifactHandle")
      .mockImplementation(async (...args) => {
        observedPasses += 1;
        if (observedPasses !== hashPass) return originalHash(...args);
        const handle = args[1];
        const originalRead = handle.read.bind(handle);
        const read = vi
          .spyOn(handle, "read")
          .mockImplementation(async (...readArgs) => {
            const result = await originalRead(...readArgs);
            if (result.bytesRead === 0) {
              faultInjected = true;
              await unlink(path);
            }
            return result;
          });
        try {
          return await originalHash(...args);
        } finally {
          read.mockRestore();
        }
      });
    try {
      await expect(inventoryArtifact(path)).rejects.toMatchObject({
        reason: "integrity",
        cause: { code: "ENOENT" },
      });
      expect(observedPasses).toBe(hashPass);
      expect(faultInjected).toBe(true);
    } finally {
      hash.mockRestore();
    }
  },
);

it("reports source loss during target hashing as a changed input", async () => {
  const root = await createTestTempDirectory("rea-ines-target-hash-loss-");
  const path = join(root, "source.nes");
  const bytes = inesFixture();
  await writeFile(path, bytes);
  const prototype = await fileReadPrototype(path);
  const originalRead = prototype.read;
  let faultInjected = false;
  const read = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args
  ) {
    const result = await originalRead.call(this, ...args);
    const readArguments: readonly unknown[] = args;
    const [buffer, , , position] = readArguments;
    if (
      Buffer.isBuffer(buffer) &&
      buffer.byteLength === 64 * 1024 &&
      position === bytes.length &&
      result.bytesRead === 0
    ) {
      faultInjected = true;
      await unlink(path);
    }
    return result;
  });
  try {
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: false,
      error: { reason: expect.stringContaining("changed") },
    });
    expect(faultInjected).toBe(true);
  } finally {
    read.mockRestore();
  }
});

it.each(["removed", "directory", "malformed"])(
  "rejects a %s source after inventory before extraction",
  async (change) => {
    const root = await createTestTempDirectory("rea-ines-extraction-change-");
    const path = join(root, "source.nes");
    const outputRoot = join(root, "output");
    await writeFile(path, inesFixture());
    const snapshot = await scanArtifactInventory(path);
    await unlink(path);
    if (change === "directory") await mkdir(path);
    if (change === "malformed") await writeFile(path, "changed cartridge");
    await expect(
      materializeArtifactInventory(
        {
          inputPath: path,
          inputFormat: "ines",
          outputRoot,
          environment: process.env,
          integrityPolicy: "fail",
        },
        path,
        snapshot,
      ),
    ).rejects.toMatchObject({ reason: "integrity" });
    await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([
  "EISDIR",
  "ENOTFILE",
  "ESTALE",
  "EACCES",
  "cancelled",
  ...(process.platform === "win32" ? ["changed metadata"] : []),
])(
  "preserves the %s admission meaning while reopening extraction",
  async (code) => {
    const root = await createTestTempDirectory("rea-ines-reopen-error-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const snapshot = await scanArtifactInventory(path);
    const sample = await open(path, "r");
    const prototype = Object.getPrototypeOf(sample) as Pick<
      typeof sample,
      "stat"
    >;
    await sample.close();
    const originalStat = prototype.stat;
    const controller = new AbortController();
    const stat = vi
      .spyOn(prototype, "stat")
      .mockImplementationOnce(async function (this: FileHandle, ...args) {
        if (code === "changed metadata") {
          const metadata = await originalStat.call(this, ...args);
          // Change the real file between descriptor stat and admission lstat.
          await writeFile(path, "replacement cartridge");
          return metadata;
        }
        if (code !== "cancelled")
          throw Object.assign(new Error("injected admission failure"), {
            code,
          });
        const result = await originalStat.call(this, ...args);
        controller.abort();
        return result;
      });
    try {
      await expect(
        materializeArtifactInventory(
          {
            inputPath: path,
            inputFormat: "ines",
            outputRoot: join(root, "output"),
            environment: process.env,
            integrityPolicy: "fail",
          },
          path,
          snapshot,
          controller.signal,
        ),
      ).rejects.toMatchObject(
        code === "EACCES"
          ? { code }
          : { reason: code === "cancelled" ? "cancelled" : "integrity" },
      );
    } finally {
      stat.mockRestore();
    }
  },
);

it("retains a failed close after rejecting changed extraction bytes", async () => {
  const root = await createTestTempDirectory("rea-ines-reopen-cleanup-");
  const path = join(root, "source.nes");
  await writeFile(path, inesFixture());
  const snapshot = await scanArtifactInventory(path);
  await writeFile(path, "changed source");
  const scope = new ArtifactResourceScope();
  const originalClose = OwnedFileHandle.prototype.close;
  const owners: OwnedFileHandle[] = [];
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.push(this);
      if (owners.length === 1) throw new Error("injected close failure");
      await originalClose.call(this);
    });
  try {
    await expect(
      materializeInScope(
        {
          inputPath: path,
          inputFormat: "ines",
          outputRoot: join(root, "output"),
          environment: process.env,
          integrityPolicy: "fail",
          resourceScope: scope,
        },
        path,
        snapshot,
      ),
    ).rejects.toMatchObject({
      reason: "integrity",
      cleanup: { reason: expect.stringContaining("injected close failure") },
    });
    expect(owners).toHaveLength(1);
    await scope.close();
    expect(owners).toHaveLength(2);
    expect(owners[1]).toBe(owners[0]);
  } finally {
    close.mockRestore();
    await scope.close();
  }
});

it("releases an extraction-owned source descriptor on repeated close", async () => {
  const root = await createTestTempDirectory("rea-ines-owned-source-");
  const path = join(root, "source.nes");
  await writeFile(path, inesFixture());
  const handle = await open(path, "r");
  const owner = new OwnedFileHandle(handle);
  const reader = new InesArtifactReader(
    path,
    { handle, initial: await handle.stat() },
    owner,
  );
  try {
    await reader.close();
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
    await reader.close();
  } finally {
    await reader.close();
  }
});

it.each(["target", "inventory", "reader"])(
  "fills short iNES prefix reads at the %s boundary",
  async (route) => {
    const root = await createTestTempDirectory("rea-ines-short-read-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const sample = await open(path, "r");
    const initial = await sample.stat();
    const prototype = Object.getPrototypeOf(sample) as {
      read(
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | bigint,
      ): Promise<{ bytesRead: number; buffer: Buffer }>;
    };
    const originalRead = prototype.read;
    const read = vi.spyOn(prototype, "read").mockImplementation(async function (
      this: FileHandle,
      ...args
    ) {
      const [buffer, offset, length, position] = args;
      return originalRead.call(
        this,
        buffer,
        offset,
        typeof position === "number" && position < 16
          ? Math.min(length, 3)
          : length,
        position,
      );
    });
    try {
      if (route === "target") {
        expect(await parseBinaryTarget(path)).toMatchObject({
          ok: true,
          value: { format: "ines" },
        });
      } else if (route === "inventory") {
        expect(
          (await inventoryArtifact(path)).ines?.reconstruction.verified,
        ).toBe(true);
      } else {
        const reader = new InesArtifactReader(path, {
          handle: sample,
          initial,
        });
        try {
          const entries = [];
          for await (const entry of reader.entries()) entries.push(entry.path);
          expect(entries).toContain("prg/000.bin");
        } finally {
          await reader.close();
        }
      }
    } finally {
      read.mockRestore();
      await sample.close();
    }
  },
);

it.each(["eof", "cancelled", "failed-and-cancelled"])(
  "preserves %s while filling a short prefix",
  async (mode) => {
    const root = await createTestTempDirectory("rea-prefix-boundary-");
    const path = join(root, "source");
    const bytes = Buffer.from(
      mode === "eof" ? "NES\x1a" : "NES\x1a123456789012",
    );
    await writeFile(path, bytes);
    const handle = await open(path, "r");
    const prototype = Object.getPrototypeOf(handle) as {
      read(
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ): Promise<{ bytesRead: number; buffer: Buffer }>;
    };
    const original = prototype.read;
    const controller = new AbortController();
    let reads = 0;
    const read = vi.spyOn(prototype, "read").mockImplementation(async function (
      this: typeof handle,
      buffer,
      offset,
      length,
      position,
    ) {
      reads++;
      if (reads === 2 && mode === "failed-and-cancelled") {
        controller.abort();
        throw new Error("injected read failure");
      }
      const observed = await original.call(
        this,
        buffer,
        offset,
        Math.min(length, 3),
        position,
      );
      if (reads === 2 && mode === "cancelled") controller.abort();
      return observed;
    });
    try {
      const result = readFileHandlePrefix(handle, 16, () =>
        abortIfNeeded(controller.signal),
      );
      if (mode === "eof") {
        expect((await result).equals(bytes)).toBe(true);
        expect(reads).toBe(3);
      } else {
        await expect(result).rejects.toMatchObject({ reason: "cancelled" });
        expect(reads).toBe(2);
      }
    } finally {
      read.mockRestore();
      await handle.close();
    }
  },
);
