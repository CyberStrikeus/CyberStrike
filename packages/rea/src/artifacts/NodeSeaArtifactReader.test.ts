import { createHash } from "node:crypto";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { buffer } from "node:stream/consumers";
import { createReader } from "./inventory/reader.js";
import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers";

import { expect, it, vi } from "vitest";

import * as artifactPaths from "./ArtifactPaths.js";

import { NodeSeaArtifactReader } from "./NodeSeaArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { extractArtifact } from "./extraction/ArtifactExtraction.js";
import {
  NODE_SEA_BAD_MAGIC,
  NODE_SEA_DUPLICATE_BLOB,
  NODE_SEA_FUSE_CONFLICT,
  NODE_SEA_FUSE_ABSENT,
  NODE_SEA_FUSE_UNSET,
  NODE_SEA_MAGIC,
  NODE_SEA_TRUNCATED,
  NODE_SEA_UNKNOWN_FLAGS,
} from "./nodeSea/NodeSeaBlob.js";
import {
  NODE_SEA_FUSE_HASH,
  buildNodeSeaBlob,
  nodeSeaElf,
  nodeSeaMachO,
  nodeSeaPe,
  nodeSeaUniversal,
} from "./nodeSea/NodeSea.fixture.js";
import { elfNoteFixture } from "../native/elf/ElfNotes.fixture.js";
import { peResourceFixture } from "../native/pe/PeResources.fixture.js";
import { locateNodeSea } from "./nodeSea/NodeSeaLocation.js";
import { MAX_INSPECT_PE_FILE_BYTES } from "../domain/native/peResources.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../tests/fixtures/artifactInventory.js";

const writeCarrier = async (name: string, bytes: Buffer): Promise<string> => {
  const directory = await createTestTempDirectory("rea-node-sea-");
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
};

const script = 'console.log("rea-node-sea")\n';
const populated = {
  codePath: "app/main.js",
  main: script,
  codeCache: Buffer.from("cache"),
  assets: [{ name: "assets/message.txt", body: "hello" }],
  execArgv: ["--no-warnings"],
  disableExperimentalSeaWarning: true,
  fuse: "set" as const,
};

it.each([
  ["mach-o", nodeSeaMachO(populated)],
  ["elf", nodeSeaElf(populated)],
  ["pe", nodeSeaPe(populated)],
] as const)("inventories a %s Node SEA carrier", async (carrier, bytes) => {
  const path = await writeCarrier(`sea-${carrier}`, bytes);
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(snapshot.manifest.root_format).toBe("node-sea");
  expect(snapshot.coverage.status).toBe("complete");
  expect(snapshot.limitations).toContain(
    "Node SEA inventory establishes the injected blob, flags, fuse sentinel, main script, optional code cache, snapshot, and assets. V8 snapshots and code cache are not deserialized, and the application is not executed.",
  );
  expect(snapshot.limitations).not.toContain(NODE_SEA_FUSE_UNSET);
  const root = snapshot.occurrences.find((row) => row.logical_path === ".");
  expect(root).toMatchObject({ artifact_kind: "container" });
  expect(root?.format_metadata).toMatchObject({
    kind: "node-sea",
    magic: NODE_SEA_MAGIC,
    carrier,
    code_path: "app/main.js",
    disable_experimental_sea_warning: true,
    use_snapshot: false,
    use_code_cache: true,
    include_assets: true,
    include_exec_argv: true,
    exec_argv: ["--no-warnings"],
    exec_argv_extension: "env",
    fuse_state: "set",
    fuse_sentinel: `NODE_SEA_FUSE_${NODE_SEA_FUSE_HASH}:1`,
    fuse_contradiction: null,
  });
  expect(
    snapshot.occurrences.find((row) => row.logical_path === "app/main.js"),
  ).toMatchObject({
    artifact_kind: "javascript",
    artifact_format: "javascript-bundle",
    format_metadata: { kind: "node-sea-entry", role: "main-script" },
  });
  expect(
    snapshot.occurrences.find(
      (row) => row.logical_path === "__node_sea__/code-cache",
    ),
  ).toMatchObject({
    artifact_format: "file",
    format_metadata: { role: "code-cache" },
  });
  expect(
    snapshot.occurrences.find(
      (row) => row.logical_path === "assets/message.txt",
    ),
  ).toMatchObject({ format_metadata: { role: "asset" } });
  const scriptNode = snapshot.nodes.find(
    (node) => node.size === Buffer.byteLength(script),
  );
  expect(scriptNode).toBeDefined();
  const direct = new NodeSeaArtifactReader(path);
  try {
    for await (const entry of direct.entries()) {
      const occurrence = snapshot.occurrences.find(
        (row) => row.logical_path === entry.path,
      );
      expect(occurrence?.format_metadata).toEqual(entry.formatMetadata);
      const member = await buffer(await direct.open(entry));
      expect(
        snapshot.nodes.find(
          (node) => node.artifact_id === occurrence?.artifact_id,
        ),
      ).toMatchObject({
        sha256: createHash("sha256").update(member).digest("hex"),
        size: member.length,
      });
    }
    expect(direct.formatMetadata()).toEqual(root?.format_metadata);
  } finally {
    await direct.close();
  }
});

it("accepts the __NODE_SEA segment spelling and a universal Mach-O slice", async () => {
  const underscored = await scanCanonicalArtifactInventory(
    await writeCarrier(
      "underscored",
      nodeSeaMachO({ ...populated, segmentName: "__NODE_SEA" }),
    ),
  );
  expect(underscored.manifest.root_format).toBe("node-sea");
  const universal = await scanCanonicalArtifactInventory(
    await writeCarrier("universal", nodeSeaUniversal(populated)),
  );
  expect(universal.manifest.root_format).toBe("node-sea");
  expect(
    universal.occurrences.find((row) => row.logical_path === ".")
      ?.format_metadata,
  ).toMatchObject({ carrier: "mach-o", fuse_state: "set" });
});

it("reads a 32-bit and a big-endian Mach-O section", async () => {
  for (const bytes of [
    nodeSeaMachO({ ...populated, bits: 32 }),
    nodeSeaMachO({ ...populated, littleEndian: false }),
  ]) {
    const snapshot = await scanCanonicalArtifactInventory(
      await writeCarrier("macho-variant", bytes),
    );
    expect(snapshot.manifest.root_format).toBe("node-sea");
    expect(
      snapshot.occurrences.find((row) => row.logical_path === "app/main.js"),
    ).toMatchObject({ artifact_format: "javascript-bundle" });
  }
});

it("classifies a main script without a JavaScript suffix as javascript-bundle", async () => {
  const snapshot = await scanCanonicalArtifactInventory(
    await writeCarrier(
      "plain-name",
      nodeSeaElf({ codePath: "main", main: script, fuse: "set" }),
    ),
  );
  expect(
    snapshot.occurrences.find((row) => row.logical_path === "main"),
  ).toMatchObject({
    artifact_kind: "javascript",
    artifact_format: "javascript-bundle",
  });
});

it("keeps a snapshot body opaque and retains the code path", async () => {
  const snapshot = await scanCanonicalArtifactInventory(
    await writeCarrier(
      "snapshot",
      nodeSeaElf({
        codePath: "sea.js",
        snapshot: Buffer.from("snap-bytes"),
        fuse: "set",
      }),
    ),
  );
  const root = snapshot.occurrences.find((row) => row.logical_path === ".");
  expect(root?.format_metadata).toMatchObject({
    use_snapshot: true,
    code_path: "sea.js",
  });
  expect(
    snapshot.occurrences.find((row) => row.logical_path === "sea.js"),
  ).toBeUndefined();
  expect(
    snapshot.occurrences.find(
      (row) => row.logical_path === "__node_sea__/snapshot",
    ),
  ).toMatchObject({
    artifact_format: "file",
    format_metadata: { role: "snapshot" },
  });
});

it.each([
  ["absent", undefined, "absent", null],
  ["unset", "unset", "unset", `NODE_SEA_FUSE_${NODE_SEA_FUSE_HASH}:0`],
] as const)(
  "reports a %s fuse as a contradiction",
  async (_label, fuse, state, sentinel) => {
    const reason =
      state === "absent" ? NODE_SEA_FUSE_ABSENT : NODE_SEA_FUSE_UNSET;
    const snapshot = await scanCanonicalArtifactInventory(
      await writeCarrier(
        "fuse",
        nodeSeaElf({ ...(fuse === undefined ? {} : { fuse }), main: script }),
      ),
    );
    expect(
      snapshot.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      fuse_state: state,
      fuse_sentinel: sentinel,
      fuse_contradiction: reason,
    });
    expect(snapshot.limitations).toContain(reason);
    expect(snapshot.coverage.status).toBe("complete");
  },
);

it("reports disagreeing fuse sentinels", async () => {
  const snapshot = await scanCanonicalArtifactInventory(
    await writeCarrier("conflict", nodeSeaPe({ fuse: "conflicting" })),
  );
  expect(
    snapshot.occurrences.find((row) => row.logical_path === ".")
      ?.format_metadata,
  ).toMatchObject({
    fuse_state: "conflicting",
    fuse_sentinel: null,
    fuse_contradiction: NODE_SEA_FUSE_CONFLICT,
  });
  expect(snapshot.limitations).toContain(NODE_SEA_FUSE_CONFLICT);
});

it("leaves a Mach-O, ELF, or PE without a SEA slot in its native format", async () => {
  const mach = await scanCanonicalArtifactInventory(
    await writeCarrier(
      "plain-macho",
      nodeSeaMachO({
        segmentName: "__TEXT",
        sectionName: "__text",
        blob: Buffer.from("text"),
      }),
    ),
  );
  expect(mach.manifest.root_format).toBe("mach-o");
  const elf = await scanCanonicalArtifactInventory(
    await writeCarrier("plain-elf", elfNoteFixture({ type: 2 })),
  );
  expect(elf.manifest.root_format).toBe("elf");
  const pe = await scanCanonicalArtifactInventory(
    await writeCarrier("plain-pe", peResourceFixture(true).bytes),
  );
  expect(pe.manifest.root_format).toBe("pe");
});

it.each([false, true])(
  "scopes the large PE admission limit to SEA resources (PE32+: %s)",
  async (plus) => {
    for (const sea of [false, true]) {
      const bytes = peResourceFixture(plus, [
        {
          type: sea ? 10 : 11,
          name: "NODE_SEA_BLOB",
          language: 1033,
          payload: buildNodeSeaBlob(populated),
        },
        {
          type: 10,
          name: "OTHER_RESOURCE",
          language: 1033,
          payload: Buffer.from("other"),
        },
      ]).bytes;
      const path = await writeCarrier("large-pe", bytes);
      const handle = await open(path, "r+");
      try {
        if (!sea)
          await expect(
            locateNodeSea(handle, bytes.length),
          ).resolves.toBeUndefined();
        await handle.truncate(MAX_INSPECT_PE_FILE_BYTES + 1);
        const located = locateNodeSea(handle, MAX_INSPECT_PE_FILE_BYTES + 1);
        if (sea)
          await expect(located).rejects.toMatchObject({
            reason: "limit",
            message:
              "Node SEA PE inspection exceeds the 512 MiB PE parser input ceiling",
          });
        else await expect(located).resolves.toBeUndefined();
      } finally {
        await handle.close();
      }
    }
  },
);

it("trusts the PT_NOTE blob over a stale SHT_NOTE entry", async () => {
  const bytes = nodeSeaElf({ ...populated, ownership: "both" });
  // ELF64: the note section header follows one 56-byte program header.
  const noteOffsetField = 64 + 56 + 64 + 24;
  const noteOffset = bytes.readBigUInt64LE(noteOffsetField);
  bytes.writeBigUInt64LE(noteOffset + 20n, noteOffsetField);
  const inventory = await scanCanonicalArtifactInventory(
    await writeCarrier("stale-section-note", bytes),
  );
  expect(inventory.manifest.root_format).toBe("node-sea");
});

it("leaves a non-SEA PE with a cyclic resource tree to native classification", async () => {
  const fixture = peResourceFixture(true);
  fixture.bytes.writeUInt32LE(0x80000000, (fixture.entryOffsets[0] ?? 0) + 4);
  const path = await writeCarrier("cyclic-pe", fixture.bytes);
  const handle = await open(path, "r");
  try {
    await expect(
      locateNodeSea(handle, fixture.bytes.length),
    ).resolves.toBeUndefined();
  } finally {
    await handle.close();
  }
  const inventory = await scanCanonicalArtifactInventory(path);
  expect(inventory.manifest.root_format).not.toBe("node-sea");
});

it("fails closed when the located blob is truncated, has a bad magic, or unknown flags", async () => {
  await expect(
    scanCanonicalArtifactInventory(
      await writeCarrier(
        "truncated",
        nodeSeaElf({ blob: Buffer.from([0x20, 0xda, 0x43]) }),
      ),
    ),
  ).rejects.toMatchObject({ reason: "format", message: NODE_SEA_TRUNCATED });
  await expect(
    scanCanonicalArtifactInventory(
      await writeCarrier("bad-magic", nodeSeaMachO({ blob: Buffer.alloc(16) })),
    ),
  ).rejects.toMatchObject({ reason: "format", message: NODE_SEA_BAD_MAGIC });
  const unknown = Buffer.alloc(9);
  unknown.writeUInt32LE(NODE_SEA_MAGIC, 0);
  unknown.writeUInt32LE(1 << 5, 4);
  unknown[8] = 1;
  await expect(
    scanCanonicalArtifactInventory(
      await writeCarrier("unknown-flags", nodeSeaPe({ blob: unknown })),
    ),
  ).rejects.toMatchObject({
    reason: "format",
    message: NODE_SEA_UNKNOWN_FLAGS,
  });
});

it("fails closed when two different blobs are declared", async () => {
  await expect(
    scanCanonicalArtifactInventory(
      await writeCarrier(
        "dup-elf",
        nodeSeaElf({
          extraBlobs: [buildNodeSeaBlob({ main: "other\n" })],
        }),
      ),
    ),
  ).rejects.toMatchObject({
    reason: "format",
    message: NODE_SEA_DUPLICATE_BLOB,
  });
  await expect(
    scanCanonicalArtifactInventory(
      await writeCarrier(
        "dup-macho",
        nodeSeaMachO({
          extraBlobs: [buildNodeSeaBlob({ codePath: "other.js", main: "x" })],
        }),
      ),
    ),
  ).rejects.toMatchObject({ message: NODE_SEA_DUPLICATE_BLOB });
});

it("keeps one blob when the same bytes are declared twice", async () => {
  const blob = buildNodeSeaBlob({ main: script, codePath: "sea.js" });
  const snapshot = await scanCanonicalArtifactInventory(
    await writeCarrier(
      "same",
      nodeSeaElf({ blob, extraBlobs: [blob], fuse: "set" }),
    ),
  );
  expect(snapshot.manifest.root_format).toBe("node-sea");
  expect(
    snapshot.occurrences.filter((row) => row.logical_path === "sea.js"),
  ).toHaveLength(1);
});

it("extracts the main script and assets without executing them", async () => {
  const directory = await createTestTempDirectory("rea-node-sea-extract-");
  const path = join(directory, "sea.elf");
  await writeFile(path, nodeSeaElf(populated));
  const resourceScope = new ArtifactResourceScope();
  try {
    const extracted = await extractArtifact({
      inputPath: path,
      inputFormat: "elf",
      outputRoot: join(directory, "out"),
      environment: process.env,
      integrityPolicy: "fail",
      resourceScope,
    });
    expect(
      await readFile(join(extracted.output_root, "app/main.js"), "utf8"),
    ).toBe(script);
    expect(
      await readFile(join(extracted.output_root, "assets/message.txt"), "utf8"),
    ).toBe("hello");
    expect(
      Buffer.compare(
        await readFile(join(extracted.output_root, "__node_sea__/code-cache")),
        Buffer.from("cache"),
      ),
    ).toBe(0);
    const extractedInventory = await scanCanonicalArtifactInventory(
      extracted.output_root,
    );
    expect(extractedInventory.manifest.root_format).toBe("directory");
    expect(
      extractedInventory.occurrences.find(
        (row) => row.logical_path === "app/main.js",
      )?.artifact_format,
    ).toBe("javascript-bundle");
  } finally {
    await resourceScope.close();
  }
});

it("rejects duplicate raw asset keys", async () => {
  const path = await writeCarrier(
    "duplicate-assets",
    nodeSeaElf({
      assets: [
        { name: "data.txt", body: "a" },
        { name: "data.txt", body: "b" },
      ],
    }),
  );
  await expect(scanCanonicalArtifactInventory(path)).rejects.toThrow();
});

it("maps an unsafe main path and opaque asset keys without losing their sources", async () => {
  const path = await writeCarrier(
    "opaque-names",
    nodeSeaElf({
      codePath: "/absolute/main.js",
      main: script,
      assets: [
        { name: "", body: "empty" },
        { name: "__node_sea__/snapshot", body: "reserved" },
        { name: "a/café.txt", body: "composed" },
        { name: "a/cafe\u0301.txt", body: "decomposed" },
        { name: "tree", body: "parent" },
        { name: "tree/child", body: "child" },
        { name: "__node_sea__", body: "namespace" },
      ],
    }),
  );
  const graph = await scanCanonicalArtifactInventory(path);
  const rows = graph.occurrences.filter(
    (row) => row.format_metadata?.kind === "node-sea-entry",
  );
  expect(
    rows
      .map((row) => [
        row.logical_path,
        row.format_metadata?.kind === "node-sea-entry"
          ? row.format_metadata.source_path
          : null,
      ])
      .sort(),
  ).toEqual(
    [
      ["__node_sea__/main.cjs", "/absolute/main.js"],
      ["__node_sea__/assets/0", ""],
      ["__node_sea__/assets/1", "__node_sea__/snapshot"],
      ["a/café.txt", "a/café.txt"],
      ["__node_sea__/assets/3", "a/cafe\u0301.txt"],
      ["tree", "tree"],
      ["__node_sea__/assets/5", "tree/child"],
      ["__node_sea__/assets/6", "__node_sea__"],
    ].sort(),
  );
  expect(rows.map((row) => row.source_path).sort()).toEqual(
    [
      "/absolute/main.js",
      "",
      "__node_sea__/snapshot",
      "a/café.txt",
      "a/cafe\u0301.txt",
      "tree",
      "tree/child",
      "__node_sea__",
    ].sort(),
  );
});

it("maps a script collision and later file-prefix asset collision", async () => {
  const graph = await scanCanonicalArtifactInventory(
    await writeCarrier(
      "collisions",
      nodeSeaElf({
        codePath: "main.js",
        assets: [
          { name: "main.js", body: "same destination" },
          { name: "folder/item", body: "first" },
          { name: "folder", body: "later prefix" },
        ],
      }),
    ),
  );
  const rows = graph.occurrences.filter(
    (row) => row.format_metadata?.kind === "node-sea-entry",
  );
  expect(
    rows
      .map((row) => [
        row.logical_path,
        row.format_metadata?.kind === "node-sea-entry"
          ? row.format_metadata.source_path
          : null,
      ])
      .sort(),
  ).toEqual(
    [
      ["main.js", "main.js"],
      ["__node_sea__/assets/0", "main.js"],
      ["folder/item", "folder/item"],
      ["__node_sea__/assets/2", "folder"],
    ].sort(),
  );
});

it("retains source asset spelling separately from normalized graph paths", async () => {
  const path = await writeCarrier(
    "source-path",
    nodeSeaElf({ assets: [{ name: "data/cafe\u0301.txt", body: "asset" }] }),
  );
  const graph = await scanCanonicalArtifactInventory(path);
  expect(
    graph.occurrences.find((row) => row.logical_path === "data/café.txt")
      ?.format_metadata,
  ).toMatchObject({ role: "asset", source_path: "data/cafe\u0301.txt" });
});

it("leaves Mach-O carriers with unreadable command framing unrecognized", async () => {
  for (const littleEndian of [true, false]) {
    const bytes = nodeSeaMachO({ littleEndian });
    if (littleEndian) bytes.writeUInt32LE(bytes.length, 20);
    else bytes.writeUInt32BE(bytes.length, 20);
    const handle = await open(
      await writeCarrier("command-framing", bytes),
      "r",
    );
    try {
      expect(await locateNodeSea(handle, bytes.length)).toBeUndefined();
    } finally {
      await handle.close();
    }
  }
});

it("rejects missing Mach-O load commands after a confirmed SEA section", async () => {
  const bytes = nodeSeaMachO();
  bytes.writeUInt32LE(2, 16);
  await expect(
    scanCanonicalArtifactInventory(await writeCarrier("commands", bytes)),
  ).rejects.toMatchObject({
    reason: "format",
    message: "Node SEA Mach-O load commands are truncated",
  });
});

it("rejects forged entries and changed carrier identity, then closes idempotently", async () => {
  const path = await writeCarrier("identity", nodeSeaElf());
  const reader = new NodeSeaArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0];
    if (entry === undefined) throw new Error("Missing main script");
    await expect(
      reader.open({ ...entry, byteOffset: 0 }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await writeFile(path, nodeSeaElf({ main: "changed bytes" }));
    await expect(reader.open(entry)).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await reader.close();
    await reader.close();
  }
});

it.each([8, 1024 * 1024])(
  "retires an unread %i-byte member through the shared reader factory",
  async (size) => {
    const path = await writeCarrier(
      "close",
      nodeSeaElf({ main: Buffer.alloc(size, 65) }),
    );
    const reader = createReader(path, "node-sea", {});
    if (reader === undefined) throw new Error("Missing Node SEA reader");
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      const entry = entries[0];
      if (entry === undefined) throw new Error("Missing main script");
      const stream = await reader.open(entry);
      const produced = size === 8 ? once(stream, "finish") : undefined;
      await once(stream, "readable");
      if (produced !== undefined) await produced;
      expect(stream.destroyed).toBe(false);
      await reader.close();
      expect(stream.destroyed).toBe(true);
      expect(stream.closed).toBe(true);
      await expect(buffer(stream)).rejects.toMatchObject({
        reason: "unavailable",
      });
      await reader.close();
    } finally {
      await reader.close();
    }
  },
);

it("honors cancellation before admitting a carrier", async () => {
  const path = await writeCarrier("cancel", nodeSeaElf());
  const reader = new NodeSeaArtifactReader(path);
  const controller = new AbortController();
  controller.abort("test cancellation");
  try {
    await expect(
      reader.entries(controller.signal)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ reason: "cancelled" });
  } finally {
    await reader.close();
  }
});

it.each(["cancel", "close"] as const)(
  "settles preparation when the caller requests %s during inventory construction",
  async (action) => {
    const path = await writeCarrier(
      "large-table",
      nodeSeaElf({
        assets: [
          ...Array.from({ length: 1024 }, (_, index) => ({
            name: `asset-${String(index)}`,
            body: "",
          })),
          { name: "../unsafe", body: "" },
        ],
      }),
    );
    const reader = new NodeSeaArtifactReader(path);
    const controller = new AbortController();
    const reason = { stage: "building inventory" };
    let completion: Promise<void> | undefined;
    const normalize = artifactPaths.normalizeArtifactPath;
    // Schedule the request from a real consumer boundary after construction
    // has begun. A synchronous whole-table pass reaches the unsafe tail first.
    const observer = vi
      .spyOn(artifactPaths, "normalizeArtifactPath")
      .mockImplementation((name) => {
        if (name === "asset-10")
          setImmediate(() => {
            if (action === "cancel") controller.abort(reason);
            else completion = reader.close();
          });
        return normalize(name);
      });
    try {
      await expect(
        reader.entries(controller.signal)[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject(
        action === "cancel"
          ? { reason: "cancelled", cause: reason }
          : { reason: "unavailable" },
      );
      await completion;
      await reader.close();
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      observer.mockRestore();
      await reader.close();
    }
  },
);

it.each(["__TEXT", "NODE_SEA"])(
  "keeps an incomplete %s segment unrecognized before SEA admission",
  async (name) => {
    const bytes = Buffer.alloc(32 + 24);
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(0x0100000c, 4);
    bytes.writeUInt32LE(1, 16);
    bytes.writeUInt32LE(24, 20);
    bytes.writeUInt32LE(0x19, 32);
    bytes.writeUInt32LE(24, 36);
    bytes.write(name, 40, "latin1");
    const handle = await open(
      await writeCarrier("incomplete-segment", bytes),
      "r",
    );
    try {
      expect(await locateNodeSea(handle, bytes.length)).toBeUndefined();
    } finally {
      await handle.close();
    }
  },
);

it("retains SEA admission for a complete segment with a nonaligned command size", async () => {
  const original = nodeSeaMachO();
  const commandSize = original.readUInt32LE(20);
  const payloadAt = 32 + commandSize;
  const bytes = Buffer.concat([
    original.subarray(0, payloadAt),
    Buffer.alloc(1),
    original.subarray(payloadAt),
  ]);
  bytes.writeUInt32LE(commandSize + 1, 20);
  bytes.writeUInt32LE(commandSize + 1, 32 + 4);
  bytes.writeBigUInt64LE(BigInt(payloadAt + 1), 32 + 40);
  bytes.writeUInt32LE(payloadAt + 1, 32 + 72 + 48);
  const handle = await open(
    await writeCarrier("unaligned-command", bytes),
    "r",
  );
  try {
    expect(await locateNodeSea(handle, bytes.length)).toEqual({
      carrier: "mach-o",
      blobOffset: payloadAt + 1,
      blobLength: Number(original.readBigUInt64LE(32 + 72 + 40)),
    });
  } finally {
    await handle.close();
  }
});

it.each([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe])(
  "classifies four-byte thin magic %i without admitting a truncated SEA carrier",
  async (magic) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(magic);
    const path = await writeCarrier("thin-prefix", bytes);
    const inventory = await scanCanonicalArtifactInventory(path);
    expect(inventory.manifest.root_format).toBe("mach-o");
    const handle = await open(path, "r");
    try {
      expect(await locateNodeSea(handle, bytes.length)).toBeUndefined();
    } finally {
      await handle.close();
    }
  },
);

it("confirms SEA naming before rejecting an unrelated cyclic PE resource branch", async () => {
  const fixture = peResourceFixture(true, [
    { type: 3, name: 1, language: 1033, payload: Buffer.from("other") },
    {
      type: 10,
      name: "NODE_SEA_BLOB",
      language: 1033,
      payload: buildNodeSeaBlob(populated),
    },
  ]);
  const other = fixture.entryOffsets.find(
    (at) => fixture.bytes.readUInt32LE(at) === 3,
  );
  if (other === undefined) throw new Error("Expected unrelated resource type");
  fixture.bytes.writeUInt32LE(0x80000000, other + 4);
  const handle = await open(
    await writeCarrier("sea-with-unrelated-cycle", fixture.bytes),
    "r",
  );
  try {
    await expect(
      locateNodeSea(handle, fixture.bytes.length),
    ).rejects.toMatchObject({ reason: "format" });
  } finally {
    await handle.close();
  }
});

it.each(["valid replacement", "malformed blob"] as const)(
  "rejects post-classification carrier mutation before publishing Node SEA facts: %s",
  async (mode) => {
    const blob = buildNodeSeaBlob(populated);
    const original = nodeSeaElf({ blob, fuse: "set" });
    const changed =
      mode === "valid replacement"
        ? buildNodeSeaBlob({ ...populated, main: script.toUpperCase() })
        : Buffer.from(blob);
    if (mode === "malformed blob") changed[0] = (changed[0] ?? 0) ^ 0xff;
    const replacement = nodeSeaElf({ blob: changed, fuse: "set" });
    expect(replacement.length).toBe(original.length);
    const path = await writeCarrier("classification-mutation", original);
    let created: NodeSeaArtifactReader | undefined;
    await expect(
      scanCanonicalArtifactInventory(path, {}, (...args) => {
        expect(args[1]).toBe("node-sea");
        writeFileSync(args[0], replacement);
        const reader = createReader(...args);
        if (reader instanceof NodeSeaArtifactReader) created = reader;
        return reader;
      }),
    ).rejects.toMatchObject({ reason: "integrity" });
    expect(created).toBeInstanceOf(NodeSeaArtifactReader);
    expect(created?.formatMetadata()).toBeUndefined();
  },
);
