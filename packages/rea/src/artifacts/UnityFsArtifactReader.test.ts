import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { text } from "node:stream/consumers";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  buildUnityFs,
  type UnityFsMember,
} from "../../tests/fixtures/unityfs.js";

import type { ArtifactEntry } from "./ArtifactReader.js";
import { UnityFsArtifactReader } from "./UnityFsArtifactReader.js";

const writeBundle = async (bytes: Buffer): Promise<string> => {
  const path = join(
    await createTestTempDirectory("rea-unityfs-"),
    "content.bundle",
  );
  await writeFile(path, bytes);
  return path;
};

const list = async (
  reader: UnityFsArtifactReader,
): Promise<ArtifactEntry[]> => {
  const entries: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) entries.push(entry);
  return entries;
};

const withReader = async <T>(
  bytes: Buffer,
  use: (reader: UnityFsArtifactReader) => Promise<T>,
): Promise<T> => {
  const reader = new UnityFsArtifactReader(await writeBundle(bytes));
  try {
    return await use(reader);
  } finally {
    await reader.close();
  }
};

const members: readonly UnityFsMember[] = [
  { path: "CAB-b0b0e3d3930da9dc163f811e1cd9c0c2", data: "serialized" },
  { path: "main.resS", data: "resource bytes" },
  { path: "empty.sharedAssets", data: "" },
];

describe("UnityFsArtifactReader", () => {
  it("preserves a directory node as a directory rather than declaring encryption", async () => {
    await withReader(
      buildUnityFs([
        { path: "assets", data: "", flags: 1 },
        { path: "assets/data.bin", data: "bytes", flags: 4 },
      ]),
      async (reader) => {
        const entries = await list(reader);
        expect(entries).toEqual([
          expect.objectContaining({
            path: "assets",
            kind: "directory",
            encrypted: false,
          }),
          expect.objectContaining({
            path: "assets/data.bin",
            kind: "file",
            encrypted: false,
          }),
        ]);
        expect(await text(await reader.open(entries[1]!))).toBe("bytes");
      },
    );
  });

  it("accepts consecutive dots within a safe filename", async () => {
    await withReader(
      buildUnityFs([{ path: "data..bin", data: "bytes" }]),
      async (reader) => {
        const [entry] = await list(reader);
        expect(entry?.path).toBe("data..bin");
        expect(await text(await reader.open(entry!))).toBe("bytes");
      },
    );
  });

  it("retains unknown directory facts instead of reporting zero blocks or offsets", async () => {
    await withReader(
      buildUnityFs(members, { flags: 0x1400 | 0x43 }),
      async (reader) => {
        await list(reader);
        expect(reader.formatMetadata()).toMatchObject({
          directory_status: "encrypted",
          block_count: null,
          data_start: null,
        });
      },
    );
  });

  it("does not interpret a legacy encryption declaration as modern padding", async () => {
    await withReader(
      buildUnityFs(members, { engineVersion: "2019.4.20f1", flags: 0x243 }),
      async (reader) => {
        expect(await list(reader)).toEqual([]);
        expect(reader.formatMetadata()).toMatchObject({
          directory_status: "encrypted",
        });
      },
    );
  });

  it("leaves ambiguous producer flag semantics unknown", async () => {
    await withReader(
      buildUnityFs(members, { engineVersion: "0.0.0", flags: 0x243 }),
      async (reader) => {
        expect(await list(reader)).toEqual([]);
        expect(reader.formatMetadata()).toMatchObject({
          directory_status: "unsupported-layout",
        });
      },
    );
  });
});

describe("UnityFS payloads and malformed declarations", () => {
  it.each([
    ["lz4hc table and blocks", {}],
    [
      "uncompressed table and blocks",
      { blocksInfoCompression: 0, blockCompression: 0 },
    ],
    ["uncompressed blocks", { blockCompression: 0 }],
    ["blocks-info at the end", { blocksInfoAtEnd: true }],
    ["aligned header without data padding", { flags: 0x43 }],
    ["format 6 without padding alignment", { formatVersion: 6, flags: 3 }],
  ] as const)("lists and reads every member with %s", async (_, options) => {
    await withReader(buildUnityFs(members, options), async (reader) => {
      const entries = await list(reader);
      expect(entries.map(({ path }) => path)).toEqual(
        members.map(({ path }) => path),
      );
      expect(entries.every(({ byteOffset }) => byteOffset === null)).toBe(true);
      expect(reader.formatMetadata()).toMatchObject({
        kind: "unityfs",
        format_version: "formatVersion" in options ? options.formatVersion : 8,
        engine_version: "2021.3.32f1c1",
        directory_status: "available",
      });
      const contents = await Promise.all(
        entries.map(async (entry) => text(await reader.open(entry))),
      );
      expect(contents).toEqual(members.map(({ data }) => data));
    });
  });

  it("reads a member spanning multiple compressed blocks", async () => {
    const big = Buffer.alloc(131072 * 2 + 500, 0x61);
    await withReader(
      buildUnityFs([{ path: "big.resS", data: big }]),
      async (reader) => {
        const [entry] = await list(reader);
        if (entry === undefined) throw new Error("expected one entry");
        const stream = await reader.open(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).equals(big)).toBe(true);
      },
    );
  });

  it("preserves format and node metadata facts", async () => {
    await withReader(buildUnityFs(members), async (reader) => {
      const entries = await list(reader);
      const metadata = reader.formatMetadata();
      expect(metadata).toMatchObject({
        signature: "UnityFS",
        player_version: "5.x.x",
        block_count: 1,
        blocks_info_at_end: false,
      });
      expect(metadata?.data_hash).toMatch(/^[0-9a-f]{32}$/u);
      expect(entries[0]?.formatMetadata).toMatchObject({
        kind: "unityfs-entry",
        index: 0,
        source_path: members[0]?.path,
        declared_offset: 0,
      });
      const first = members[0];
      if (first === undefined || typeof first.data !== "string")
        throw new Error("expected a string fixture member");
      expect(entries[1]?.formatMetadata).toMatchObject({
        declared_offset: first.data.length,
      });
    });
  });
});

describe("UnityFS unavailable and malformed directories", () => {
  it("reports an encrypted directory as unknown coverage without entries", async () => {
    await withReader(
      buildUnityFs(members, { flags: 0x1400 | 0x43 }),
      async (reader) => {
        const coverage: unknown[] = [];
        const entries: ArtifactEntry[] = [];
        for await (const entry of reader.entries(undefined, {
          onCoverage: (value) => coverage.push(value),
        }))
          entries.push(entry);
        expect(entries).toEqual([]);
        expect(reader.formatMetadata()).toMatchObject({
          directory_status: "encrypted",
        });
        expect(coverage).toEqual([
          expect.objectContaining({ status: "unknown" }),
        ]);
      },
    );
  });

  it("reports an LZMA blocks-info table as unknown coverage", async () => {
    await withReader(
      buildUnityFs(members, { blocksInfoCompression: 1 }),
      async (reader) => {
        const entries: ArtifactEntry[] = [];
        const coverage: unknown[] = [];
        for await (const entry of reader.entries(undefined, {
          onCoverage: (value) => coverage.push(value),
        }))
          entries.push(entry);
        expect(entries).toEqual([]);
        expect(reader.formatMetadata()).toMatchObject({
          directory_status: "unsupported-compression",
        });
        expect(coverage).toEqual([
          expect.objectContaining({ status: "unknown" }),
        ]);
      },
    );
  });

  it("refuses an LZMA-compressed member block while retaining the directory", async () => {
    await withReader(
      buildUnityFs(members, { blockCompression: 1 }),
      async (reader) => {
        const [entry] = await list(reader);
        if (entry === undefined) throw new Error("expected one entry");
        await expect(reader.open(entry)).rejects.toMatchObject({
          reason: "unavailable",
        });
      },
    );
  });

  it.each([
    [
      "format 9 with a different block row layout",
      buildUnityFs(members, { formatVersion: 9 }),
      "unavailable",
    ],
    [
      "an unsupported format version",
      buildUnityFs(members, { formatVersion: 0x40 }),
      "unavailable",
    ],
    [
      "a declared size beyond the file",
      (() => {
        const bytes = buildUnityFs(members);
        bytes.writeBigUInt64BE(1n << 40n, 32);
        return bytes;
      })(),
      "format",
    ],
    [
      "a node count that cannot fit",
      buildUnityFs(members, { declaredNodeCount: 0xffff_ffff }),
      "format",
    ],
    ["bytes without a bundle", Buffer.from("not a unity bundle"), "format"],
  ])("refuses %s", async (_, bytes, reason) => {
    await withReader(bytes, async (reader) => {
      await expect(list(reader)).rejects.toMatchObject({ reason });
    });
  });
});

describe("UnityFsArtifactReader member streams", () => {
  it("types cancellation during a member read instead of crashing", async () => {
    const data = Buffer.alloc(4 * 1024 * 1024, 0x62);
    await withReader(
      buildUnityFs([{ path: "big.resS", data }]),
      async (reader) => {
        const [entry] = await list(reader);
        if (entry === undefined) throw new Error("expected one entry");
        const controller = new AbortController();
        const stream = await reader.open(entry, controller.signal);
        const chunks = stream[Symbol.asyncIterator]();
        await chunks.next();
        controller.abort();
        await expect(chunks.next()).rejects.toMatchObject({
          reason: "cancelled",
        });
      },
    );
  });

  it("keeps the reader usable after a consumer abandons a member", async () => {
    const data = Buffer.alloc(1024 * 1024, 0x63);
    await withReader(
      buildUnityFs([{ path: "big.resS", data }]),
      async (reader) => {
        const [entry] = await list(reader);
        if (entry === undefined) throw new Error("expected one entry");
        const abandoned = await reader.open(entry);
        await abandoned[Symbol.asyncIterator]().next();
        abandoned.destroy();
        expect((await text(await reader.open(entry))).length).toBe(data.length);
      },
    );
  });

  it("refuses an entry that did not come from this reader", async () => {
    await withReader(buildUnityFs(members), async (reader) => {
      const [entry] = await list(reader);
      if (entry === undefined) throw new Error("expected one entry");
      await expect(
        reader.open({ ...entry, adapterKey: "unityfs-entry:99" }),
      ).rejects.toMatchObject({ reason: "integrity" });
    });
  });
});
