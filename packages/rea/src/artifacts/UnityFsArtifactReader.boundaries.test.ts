import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer, text } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { buildUnityFs } from "../../tests/fixtures/unityfs.js";
import { openRegularFile } from "../filesystem/RegularFile.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { UnityFsArtifactReader } from "./UnityFsArtifactReader.js";

const fixture = async (bytes: Buffer): Promise<string> => {
  const path = join(
    await createTestTempDirectory("rea-unity-boundary-"),
    "bundle",
  );
  await writeFile(path, bytes);
  return path;
};
const entries = async (reader: UnityFsArtifactReader) => {
  const result = [];
  for await (const entry of reader.entries()) result.push(entry);
  return result;
};

// A valid two-sequence LZ4 block: one literal, a distance-one match, five final
// literals. The decoder yields after the large match, before the last sequence.
const repeatedBlock = (data: Buffer): Buffer => {
  const extra = data.length - 6 - 19;
  const extension = [
    ...Array<number>(Math.floor(extra / 255)).fill(255),
    extra % 255,
  ];
  return Buffer.from([
    0x1f,
    data[0]!,
    1,
    0,
    ...extension,
    0x50,
    ...data.subarray(-5),
  ]);
};

describe("UnityFS allocation and malformed-input boundaries", () => {
  it.each(["encoded", "decoded"] as const)(
    "admits the %s directory budget before reading or decoding it",
    async (kind) => {
      const bytes = buildUnityFs([{ path: "data", data: "x" }]);
      bytes.writeUInt32BE(17 * 1024 * 1024, kind === "encoded" ? 40 : 44);
      if (kind === "encoded")
        bytes.writeBigUInt64BE(BigInt(17 * 1024 * 1024 + 64), 32);
      const path = await fixture(bytes);
      if (kind === "encoded") await truncate(path, 17 * 1024 * 1024 + 64);
      const admitted = await openRegularFile(path, { symlinks: "reject" });
      const reader = new UnityFsArtifactReader(path, admitted);
      const reads = vi.spyOn(admitted.handle, "read");
      try {
        await expect(entries(reader)).rejects.toMatchObject({
          reason: "limit",
          boundary: "memory",
        });
        expect(reads).toHaveBeenCalledTimes(1); // bounded header only
      } finally {
        await reader.close();
        reads.mockRestore();
        await admitted.handle.close();
      }
    },
  );

  it("reserves block-row storage before constructing a large row array", async () => {
    const bytes = buildUnityFs([], {
      blocksInfoCompression: 0,
      blockCompression: 0,
    });
    const tableSize = 20 + 300_000 * 10 + 4;
    bytes.writeUInt32BE(tableSize, 40);
    bytes.writeUInt32BE(tableSize, 44);
    const file = Buffer.alloc(64 + tableSize);
    bytes.subarray(0, 64).copy(file);
    file.writeBigUInt64BE(BigInt(file.length), 32);
    file.writeUInt32BE(300_000, 64 + 16);
    const reader = new UnityFsArtifactReader(await fixture(file));
    try {
      await expect(entries(reader)).rejects.toMatchObject({
        reason: "limit",
        boundary: "memory",
      });
    } finally {
      await reader.close();
    }
  });

  it("charges overlapping readable members, not only their unique block", async () => {
    const size = 1024 * 1024;
    const members = Array.from({ length: 257 }, (_, index) => ({
      path: `alias-${String(index)}`,
      offset: 0,
      size,
      data: index === 0 ? Buffer.alloc(size, 0x61) : Buffer.alloc(0),
    }));
    const reader = new UnityFsArtifactReader(
      await fixture(
        buildUnityFs(members, {
          blockSize: size,
          encodeBlock: repeatedBlock,
        }),
      ),
    );
    try {
      await expect(entries(reader)).rejects.toMatchObject({ reason: "limit" });
    } finally {
      await reader.close();
    }
  });

  it("types a short later node after an unterminated first node consumes its bytes", async () => {
    const bytes = buildUnityFs(
      [
        { path: "a".repeat(40), data: "" },
        { path: "b", data: "" },
      ],
      {
        blocksInfoCompression: 0,
        blockCompression: 0,
      },
    );
    // First path consumes most of the second row. The minimum total table-size
    // check alone cannot establish each subsequent fixed row's bounds.
    bytes.fill(0x61, 64 + 34 + 20, 64 + 34 + 20 + 41 + 18);
    const reader = new UnityFsArtifactReader(await fixture(bytes));
    try {
      await expect(entries(reader)).rejects.toMatchObject({ reason: "format" });
    } finally {
      await reader.close();
    }
  });

  it("translates malformed directory LZ4 into the artifact error algebra", async () => {
    const bytes = buildUnityFs([{ path: "x", data: "x" }]);
    bytes[65] = 0xff;
    const reader = new UnityFsArtifactReader(await fixture(bytes));
    try {
      await expect(entries(reader)).rejects.toMatchObject({ reason: "format" });
    } finally {
      await reader.close();
    }
  });

  it("refuses data blocks overlapping an end-positioned directory", async () => {
    const bytes = buildUnityFs([{ path: "x", data: "abc" }], {
      blocksInfoAtEnd: true,
      blocksInfoCompression: 0,
      blockCompression: 0,
    });
    const tableOffset = bytes.length - bytes.readUInt32BE(40);
    bytes.writeUInt32BE(5, tableOffset + 20);
    bytes.writeUInt32BE(5, tableOffset + 24);
    const reader = new UnityFsArtifactReader(await fixture(bytes));
    try {
      await expect(entries(reader)).rejects.toMatchObject({ reason: "format" });
    } finally {
      await reader.close();
    }
  });
});

it.each([1, 2])(
  "does no I/O for an empty block with codec %s and preserves source counts",
  async (codec) => {
    const original = buildUnityFs([{ path: "x", data: "ab" }], {
      blockSize: 1,
      blockCompression: 0,
      blocksInfoCompression: 0,
      flags: 0x40,
    });
    const tableSize = original.readUInt32BE(40);
    // Insert an empty block between two one-byte plain blocks, preserving
    // the member's two-byte virtual extent and the directory's exact bounds.
    const emptyBlock = Buffer.alloc(10);
    emptyBlock.writeUInt32BE(1, 4);
    emptyBlock.writeUInt16BE(codec, 8);
    const bytes = Buffer.concat([
      original.subarray(0, 64 + 30),
      emptyBlock,
      original.subarray(64 + 30, 64 + tableSize),
      Buffer.from([0x61, 0, 0x62]),
    ]);
    bytes.writeBigUInt64BE(BigInt(bytes.length), 32);
    bytes.writeUInt32BE(tableSize + 10, 40);
    bytes.writeUInt32BE(tableSize + 10, 44);
    bytes.writeUInt32BE(3, 64 + 16);
    const path = await fixture(bytes);
    const admitted = await openRegularFile(path, { symlinks: "reject" });
    const reader = new UnityFsArtifactReader(path, admitted);
    try {
      const [entry] = await entries(reader);
      expect(reader.formatMetadata()?.block_count).toBe(3);
      const reads = vi.spyOn(admitted.handle, "read");
      try {
        expect(await text(await reader.open(entry!))).toBe("ab");
        expect(reads).toHaveBeenCalledTimes(2);
      } finally {
        reads.mockRestore();
      }
    } finally {
      await reader.close();
      await admitted.handle.close();
    }
  },
);

describe("UnityFS stream ownership and immutable cache", () => {
  it("retains descriptor ownership after cleanup fails and permits retry", async () => {
    const reader = new UnityFsArtifactReader(
      await fixture(buildUnityFs([{ path: "x", data: "bytes" }])),
    );
    const [entry] = await entries(reader);
    const stream = await reader.open(entry!);
    const failure = new Error("descriptor close denied");
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockRejectedValueOnce(failure);
    try {
      await expect(reader.close()).rejects.toBe(failure);
      expect(stream.closed).toBe(true);
      await expect(reader.open(entry!)).rejects.toMatchObject({
        reason: "unavailable",
      });
      await reader.close();
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      close.mockRestore();
      await reader.close();
    }
  });
  it("joins an outstanding positional read before close completes", async () => {
    const path = await fixture(buildUnityFs([{ path: "x", data: "bytes" }]));
    const admitted = await openRegularFile(path, { symlinks: "reject" });
    const reader = new UnityFsArtifactReader(path, admitted);
    const reached = createDeferred<void>(),
      release = createDeferred<void>();
    const nativeRead = admitted.handle.read.bind(admitted.handle);
    const [entry] = await entries(reader);
    const reads = vi.spyOn(admitted.handle, "read").mockImplementation((async (
      ...args: unknown[]
    ) => {
      reached.resolve();
      await release.promise;
      return Reflect.apply(nativeRead, admitted.handle, args);
    }) as typeof admitted.handle.read);
    try {
      const stream = await reader.open(entry!);
      stream.read(0);
      await reached.promise;
      let closed = false;
      const closing = reader.close().then(() => {
        closed = true;
      });
      await setImmediate();
      expect(closed).toBe(false);
      release.resolve();
      await closing;
      expect(stream.closed).toBe(true);
    } finally {
      release.resolve();
      await reader.close();
      reads.mockRestore();
      await admitted.handle.close();
    }
  });

  it("preserves cancellation occurring inside the LZ4 decoder", async () => {
    const data = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const path = await fixture(
      buildUnityFs([{ path: "x", data }], {
        blockSize: data.length,
        encodeBlock: repeatedBlock,
      }),
    );
    const admitted = await openRegularFile(path, { symlinks: "reject" });
    const reader = new UnityFsArtifactReader(path, admitted);
    const controller = new AbortController();
    const reason = new Error("cancel during block decode");
    const nativeRead = admitted.handle.read.bind(admitted.handle);
    const [entry] = await entries(reader);
    const reads = vi.spyOn(admitted.handle, "read").mockImplementation((async (
      ...args: unknown[]
    ) => {
      const result = await Reflect.apply(nativeRead, admitted.handle, args);
      globalThis.setImmediate(() => {
        controller.abort(reason);
      });
      return result;
    }) as typeof admitted.handle.read);
    try {
      await expect(
        buffer(await reader.open(entry!, controller.signal)),
      ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
    } finally {
      await reader.close();
      reads.mockRestore();
      await admitted.handle.close();
    }
  });
});

describe("UnityFS stream capacity and cache ownership", () => {
  it("bounds tiny-block I/O independently of decoded byte counts", async () => {
    const size = 32;
    const members = Array.from({ length: 129 }, (_, index) => ({
      path: `alias-${String(index)}`,
      offset: 0,
      size,
      data: index === 0 ? Buffer.alloc(size, 0x61) : Buffer.alloc(0),
    }));
    const reader = new UnityFsArtifactReader(
      await fixture(buildUnityFs(members, { blockSize: 1 })),
    );
    try {
      await expect(
        (async () => {
          for (const entry of await entries(reader))
            await buffer(await reader.open(entry));
        })(),
      ).rejects.toMatchObject({ reason: "limit", boundary: "capacity" });
    } finally {
      await reader.close();
    }
  });

  it("does not let modified output chunks corrupt cached or concurrent member reads", async () => {
    const data = Buffer.alloc(1024 * 1024, 0x61);
    const reader = new UnityFsArtifactReader(
      await fixture(
        buildUnityFs([{ path: "x", data }], { blockSize: data.length }),
      ),
    );
    try {
      const [entry] = await entries(reader);
      const stream = await reader.open(entry!);
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done || !Buffer.isBuffer(first.value))
        throw new Error("expected a chunk");
      first.value.fill(0);
      stream.destroy();
      expect((await buffer(await reader.open(entry!))).equals(data)).toBe(true);
      const controller = new AbortController();
      const cancelled = await reader.open(entry!, controller.signal);
      await cancelled[Symbol.asyncIterator]().next();
      const peer = buffer(await reader.open(entry!));
      controller.abort();
      expect((await peer).equals(data)).toBe(true);
    } finally {
      await reader.close();
    }
  });

  it("validates freshness before reusing a decoded block", async () => {
    const bytes = buildUnityFs([{ path: "x", data: "before" }]);
    const path = await fixture(bytes);
    const reader = new UnityFsArtifactReader(path);
    try {
      const [entry] = await entries(reader);
      expect(await text(await reader.open(entry!))).toBe("before");
      await writeFile(path, Buffer.concat([bytes, Buffer.from([0])]));
      await expect(reader.open(entry!)).rejects.toMatchObject({
        reason: "integrity",
      });
    } finally {
      await reader.close();
    }
  });

  it("bounds active streams and releases capacity after abandonment", async () => {
    const reader = new UnityFsArtifactReader(
      await fixture(buildUnityFs([{ path: "x", data: "bytes" }])),
    );
    try {
      const [entry] = await entries(reader);
      const streams = await Promise.all(
        Array.from({ length: 4 }, () => reader.open(entry!)),
      );
      await expect(reader.open(entry!)).rejects.toMatchObject({
        reason: "limit",
        boundary: "capacity",
      });
      const closed = new Promise<void>((resolve) => {
        streams[0]!.once("close", resolve);
      });
      streams[0]!.destroy();
      await closed;
      expect(await text(await reader.open(entry!))).toBe("bytes");
    } finally {
      await reader.close();
    }
  });

  it("does not turn a paused inventory into complete coverage when closed", async () => {
    const reader = new UnityFsArtifactReader(
      await fixture(
        buildUnityFs([
          { path: "x", data: "bytes" },
          { path: "y", data: "bytes" },
        ]),
      ),
    );
    const iterator = reader.entries()[Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).done).toBe(false);
      await reader.close();
      await expect(iterator.next()).rejects.toMatchObject({
        reason: "unavailable",
      });
    } finally {
      await reader.close();
    }
  });
});
