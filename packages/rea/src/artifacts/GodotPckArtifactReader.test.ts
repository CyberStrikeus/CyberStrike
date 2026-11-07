import {
  buildGodotPck,
  buildGodotPck1,
  buildAliasedGodotPck,
  embedGodotPck,
  pckU32,
  pckU64,
  type GodotPckMember,
} from "../../tests/fixtures/godotPck.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { renameOpenParent } from "../../tests/fixtures/renameOpenParent.js";
import { openRegularFile } from "../filesystem/RegularFile.js";

import type { ArtifactEntry } from "./ArtifactReader.js";
import { ArtifactEmbeddedFormatProbes } from "./ArtifactEmbeddedFormatProbes.js";
import { GodotPckArtifactReader } from "./GodotPckArtifactReader.js";

const writePck = async (bytes: Buffer): Promise<string> => {
  const path = join(await createTestTempDirectory("rea-godot-pck-"), "game");
  await writeFile(path, bytes);
  return path;
};

const list = async (
  reader: GodotPckArtifactReader,
): Promise<ArtifactEntry[]> => {
  const entries: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) entries.push(entry);
  return entries;
};

const withReader = async <T>(
  bytes: Buffer,
  use: (reader: GodotPckArtifactReader) => Promise<T>,
): Promise<T> => {
  const reader = new GodotPckArtifactReader(await writePck(bytes));
  try {
    return await use(reader);
  } finally {
    await reader.close();
  }
};

const members: readonly GodotPckMember[] = [
  { path: "res://scenes/main.gd", data: "extends Node\n" },
  { path: "project.binary", data: "" },
  { path: "data/é.json", data: '{"session":"Session1"}' },
];

describe("GodotPckArtifactReader format 1", () => {
  it.each([false, true])(
    "reads Godot 3 format 1 directory and absolute member offsets (embedded=%s)",
    async (embedded) => {
      const carrier = embedded
        ? Buffer.from("old Godot engine")
        : Buffer.alloc(0);
      const pack = buildGodotPck1(members, { carrierBytes: carrier.length });
      const bytes = embedded
        ? Buffer.concat([
            carrier,
            pack,
            pckU64(pack.length),
            Buffer.from("GDPC"),
          ])
        : pack;
      await withReader(bytes, async (reader) => {
        const entries = await list(reader);
        expect(entries.map(({ sourcePath }) => sourcePath)).toEqual(
          members.map(({ path }) => path),
        );
        expect(entries.map(({ path }) => path)).toEqual([
          "scenes/main.gd",
          "project.binary",
          "data/é.json",
        ]);
        expect(reader.formatMetadata()).toMatchObject({
          format_version: 1,
          engine_major: 3,
          engine_minor: 5,
          embedded,
          pack_start: carrier.length,
          directory_start: carrier.length + 84,
          file_base: 0,
          pack_flags: 0,
          declared_file_count: members.length,
        });
        for (const [index, entry] of entries.entries()) {
          expect(entry.encrypted).toBe(false);
          expect(entry.formatMetadata).toMatchObject({ flags: 0 });
          expect(await text(await reader.open(entry))).toBe(
            members[index]?.data,
          );
        }
      });
    },
  );

  it("keeps a valid empty Godot 3 format 1 inventory complete", async () => {
    await withReader(buildGodotPck1([]), async (reader) => {
      expect(await list(reader)).toEqual([]);
      expect(reader.formatMetadata()).toMatchObject({
        format_version: 1,
        directory_status: "available",
        declared_file_count: 0,
      });
    });
  });

  it.each([
    [
      "zero-offset removal",
      { path: "gone.gd", data: "", offset: 0n },
      "unavailable",
    ],
    [
      "out-of-pack data",
      { path: "bad.bin", data: "x", offset: 1n << 40n },
      "format",
    ],
    [
      "oversized data",
      { path: "bad.bin", data: "x", size: 1n << 40n },
      "format",
    ],
  ] as const)("refuses Godot 3 format 1 %s", async (_, member, reason) => {
    await withReader(buildGodotPck1([member]), async (reader) => {
      await expect(list(reader)).rejects.toMatchObject({ reason });
    });
  });

  it("rejects a truncated Godot 3 format 1 directory", async () => {
    const pack = buildGodotPck1([{ path: "a.gd", data: "x" }]);
    await withReader(pack.subarray(0, 110), async (reader) => {
      await expect(list(reader)).rejects.toMatchObject({ reason: "format" });
    });
  });
});

describe("GodotPckArtifactReader", () => {
  it.each([
    ["format 4 standalone", buildGodotPck(4, members), false],
    ["format 4 embedded", embedGodotPck(buildGodotPck(4, members)), true],
    ["format 3 standalone", buildGodotPck(3, members), false],
    ["format 2 standalone", buildGodotPck(2, members), false],
    ["format 3 embedded", embedGodotPck(buildGodotPck(3, members)), true],
    [
      "format 2 embedded with relative file base",
      embedGodotPck(buildGodotPck(2, members, { packFlags: 2 })),
      true,
    ],
  ])(
    "lists and reads every member of a %s pack",
    async (_, bytes, embedded) => {
      await withReader(bytes, async (reader) => {
        const entries = await list(reader);
        expect(entries.map(({ path }) => path)).toEqual([
          "scenes/main.gd",
          "project.binary",
          "data/é.json",
        ]);
        expect(entries.map(({ sourcePath }) => sourcePath)).toEqual(
          members.map(({ path }) => path),
        );
        expect(reader.formatMetadata()).toMatchObject({
          embedded,
          engine_major: 4,
          engine_minor: 6,
          engine_patch: 1,
          declared_file_count: 3,
        });
        const contents = await Promise.all(
          entries.map(async (entry) => text(await reader.open(entry))),
        );
        expect(contents).toEqual(members.map(({ data }) => data));
        expect(entries[1]?.limitations).toEqual([]);
      });
    },
  );

  it("preserves declared MD5 for the shared inventory integrity verifier", async () => {
    const bytes = buildGodotPck(3, [
      { path: "a.gd", data: "real", md5: Buffer.alloc(16, 1) },
    ]);
    await withReader(bytes, async (reader) => {
      const [entry] = await list(reader);
      if (entry === undefined) throw new Error("expected one entry");
      expect(entry.declaredIntegrity).toEqual({
        algorithm: "md5",
        digest: "01".repeat(16),
      });
      expect(await text(await reader.open(entry))).toBe("real");
    });
  });

  it("reports encrypted members without reading them", async () => {
    const bytes = buildGodotPck(3, [
      { path: "secret.gd", data: "x", flags: 1 },
    ]);
    await withReader(bytes, async (reader) => {
      const [entry] = await list(reader);
      if (entry === undefined) throw new Error("expected one entry");
      expect(entry.encrypted).toBe(true);
      await expect(reader.open(entry)).rejects.toMatchObject({
        reason: "unavailable",
      });
    });
  });

  it.each([
    ["encrypted", 3],
    ["sparse-bundle", 6],
  ] as const)(
    "preserves %s header facts with unknown directory coverage",
    async (status, flags) => {
      await withReader(
        buildGodotPck(4, members, { packFlags: flags }),
        async (reader) => {
          const coverage: unknown[] = [];
          const entries: ArtifactEntry[] = [];
          for await (const entry of reader.entries(undefined, {
            onCoverage: (value) => coverage.push(value),
          }))
            entries.push(entry);
          expect(entries).toEqual([]);
          expect(reader.formatMetadata()).toMatchObject({
            directory_status: status,
            declared_file_count: 3,
            format_version: 4,
          });
          expect(coverage).toEqual([
            expect.objectContaining({ status: "unknown" }),
          ]);
        },
      );
    },
  );

  it("admits a bounded virtual path independently of the host PATH_MAX", async () => {
    const path = "a".repeat(4097);
    await withReader(buildGodotPck(4, [{ path, data: "" }]), async (reader) => {
      expect((await list(reader))[0]?.path).toBe(path);
    });
  });

  it("rejects oversized encoded path metadata before allocating its declared bytes", async () => {
    const bytes = buildGodotPck(2, members);
    bytes.writeUInt32LE(0xffff_ffff, 100);
    await withReader(bytes, async (reader) => {
      await expect(list(reader)).rejects.toMatchObject({
        reason: "limit",
        boundary: "memory",
      });
    });
  });

  it.each([
    [
      "a patch removal entry",
      buildGodotPck(3, [{ path: "gone.gd", data: "", flags: 2 }]),
      "unavailable",
    ],
    [
      "a member count that cannot fit",
      buildGodotPck(3, members, { fileCount: 0xffff_ffff }),
      "format",
    ],
    [
      "member data beyond the pack",
      buildGodotPck(3, [{ path: "big.bin", data: "x", size: 1n << 40n }]),
      "format",
    ],
    [
      "an unknown format 5 pack",
      Buffer.concat([Buffer.from("GDPC"), pckU32(5), Buffer.alloc(120)]),
      "unavailable",
    ],
    ["bytes without a pack", Buffer.from("not a godot pack at all"), "format"],
    [
      "a trailer pointing outside the file",
      Buffer.concat([
        Buffer.from("engine"),
        pckU64(1n << 40n),
        Buffer.from("GDPC"),
      ]),
      "format",
    ],
  ])("refuses %s", async (_, bytes, reason) => {
    await withReader(bytes, async (reader) => {
      await expect(list(reader)).rejects.toMatchObject({ reason });
    });
  });
});

describe("GodotPckArtifactReader member streams", () => {
  it.each([8, 128 * 1024])(
    "retires an unread %i-byte member when its reader closes",
    async (size) => {
      await withReader(
        buildGodotPck(4, [{ path: "member.bin", data: Buffer.alloc(size) }]),
        async (reader) => {
          const entries = await list(reader);
          const stream = await reader.open(entries[0]!);
          const produced = size === 8 ? once(stream, "finish") : undefined;
          await once(stream, "readable");
          if (produced !== undefined) await produced;
          expect(stream.destroyed).toBe(false);
          await reader.close();
          expect(stream.destroyed).toBe(true);
          expect(stream.closed).toBe(true);
          await reader.close();
        },
      );
    },
  );

  it("types cancellation during a member read instead of crashing", async () => {
    const data = "x".repeat(4 * 1024 * 1024);
    await withReader(
      buildGodotPck(3, [{ path: "big.bin", data }]),
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
    const data = "x".repeat(4 * 1024 * 1024);
    await withReader(
      buildGodotPck(3, [{ path: "big.bin", data }]),
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

  it("rejects stale located facts after the admitted carrier changes", async () => {
    const path = await writePck(buildGodotPck(3, members));
    const descriptor = await openRegularFile(path, { symlinks: "reject" });
    try {
      const location = await new ArtifactEmbeddedFormatProbes(
        path,
        descriptor,
      ).godotPck();
      if (location === undefined) throw new Error("expected a pack location");
      const reader = new GodotPckArtifactReader(path, {
        kind: "godot-pck",
        source: descriptor,
        location,
      });
      try {
        await writeFile(path, Buffer.from("replaced carrier"));
        await expect(list(reader)).rejects.toMatchObject({
          reason: "integrity",
        });
      } finally {
        await reader.close();
      }
    } finally {
      await descriptor.handle.close();
    }
  });

  it.each([false, true])(
    "reads located pack facts from the admitted descriptor after an attempted path replacement (embedded: %s)",
    async (embedded) => {
      const root = await createTestTempDirectory("rea-godot-borrowed-source-");
      const selected = join(root, "selected");
      await mkdir(selected);
      const path = join(selected, "game");
      const bytes = buildGodotPck(3, members);
      await writeFile(path, embedded ? embedGodotPck(bytes) : bytes);
      const descriptor = await openRegularFile(path, { symlinks: "reject" });
      const { handle } = descriptor;
      try {
        const location = await new ArtifactEmbeddedFormatProbes(
          path,
          descriptor,
        ).godotPck();
        if (location === undefined) throw new Error("expected a pack location");
        // Replace the selected directory without changing the admitted inode's
        // metadata. Moving the file itself would change its validated ctime.
        const swap = await renameOpenParent(selected, join(root, "original"));
        if (swap.kind === "renamed") {
          await mkdir(selected);
          await writeFile(
            path,
            buildGodotPck(3, [{ path: "other.gd", data: "" }]),
          );
        }
        const reader = new GodotPckArtifactReader(path, {
          kind: "godot-pck",
          source: descriptor,
          location,
        });
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(
          reader.entries(cancelled.signal)[Symbol.asyncIterator]().next(),
        ).rejects.toMatchObject({
          reason: "cancelled",
        });
        const entries = await list(reader);
        expect(reader.formatMetadata()?.embedded).toBe(embedded);
        expect(entries.map(({ path: member }) => member)).toEqual([
          "scenes/main.gd",
          "project.binary",
          "data/é.json",
        ]);
        await reader.close();
      } finally {
        await handle.close();
      }
    },
  );
});

describe("Godot PCK logical-byte admission", () => {
  it.each([2, 3, 4] as const)(
    "rejects total repeated plaintext work before yielding format %s members",
    async (version) => {
      await withReader(buildAliasedGodotPck(version, 1100), async (reader) => {
        let emitted = 0;
        let failure: unknown;
        try {
          for await (const _entry of reader.entries()) emitted++;
        } catch (cause) {
          failure = cause;
        }
        expect(failure).toMatchObject({ reason: "limit" });
        expect(emitted).toBe(0);
      });
    },
  );
  it("uses the actual pack span rather than granting budget for an embedded carrier", async () => {
    const pack = buildAliasedGodotPck(4, 1100);
    const carrier = Buffer.alloc(1024 * 1024);
    await withReader(
      Buffer.concat([carrier, pack, pckU64(pack.length), Buffer.from("GDPC")]),
      async (reader) => {
        let failure: unknown;
        try {
          await list(reader);
        } catch (cause) {
          failure = cause;
        }
        expect(failure).toMatchObject({ reason: "limit" });
      },
    );
  });
  it("allows bounded aliases and never charges encrypted content that it will not read", async () => {
    await withReader(buildAliasedGodotPck(4, 2, 4), async (reader) => {
      const entries = await list(reader);
      expect(await text(await reader.open(entries[0]!))).toBe("xxxx");
      expect(await text(await reader.open(entries[1]!))).toBe("xxxx");
    });
    await withReader(
      buildAliasedGodotPck(4, 1100, 256 * 1024, 1),
      async (reader) => {
        const entries = await list(reader);
        expect(entries).toHaveLength(1100);
        expect(entries.every((entry) => entry.encrypted)).toBe(true);
      },
    );
  });
});
