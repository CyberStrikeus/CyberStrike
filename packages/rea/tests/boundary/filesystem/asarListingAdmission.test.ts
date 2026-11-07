import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";

import { AsarArtifactReader } from "../../../src/artifacts/AsarArtifactReader.js";
import { readAsarListing } from "../../../src/artifacts/AsarListing.js";
import {
  asarHeaderBytes,
  nestedAsarHeader,
} from "../../fixtures/asarHeader.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { extractArtifact } from "../../../src/artifacts/extraction/ArtifactExtraction.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const archiveWith = async (bytes: Buffer) => {
  const root = await createTestTempDirectory("rea-asar-listing-");
  const path = join(root, "app.asar");
  await writeFile(path, bytes);
  return path;
};

it("interrupts expanded listing admission between traversal batches", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "listing-stop" });
  const header = {
    files: Object.fromEntries(
      Array.from({ length: 4000 }, (_, index) => [
        `f${index}`,
        { size: 0, offset: "0" },
      ]),
    ),
  };
  const listing = readAsarListing(header, controller.signal);
  await setImmediate();
  controller.abort(reason);
  const error: unknown = await listing.catch((caught: unknown) => caught);
  expect(error).toMatchObject({ reason: "cancelled" });
  expect((error as { cause?: unknown }).cause).toBe(reason);
});

it("rejects path expansion before publishing any inventory, preserving the input", async () => {
  const bytes = nestedAsarHeader(64, "d".repeat(256), 4000);
  expect(bytes.length).toBeLessThan(150_000);
  const path = await archiveWith(bytes);
  await expect(inventoryArtifact(path)).rejects.toMatchObject({
    reason: "limit",
    message: "ASAR expanded listing exceeds its 64 MiB representation budget",
  });
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

it("reads deeply nested packed metadata without recursive listing or member lookup", async () => {
  const path = await archiveWith(nestedAsarHeader(3500, "d", 1));
  const reader = new AsarArtifactReader(path);
  try {
    let count = 0;
    for await (const entry of reader.entries()) {
      count++;
      if (entry.kind === "file") {
        expect(entry.path).toBe(`${"d/".repeat(3500)}f0`);
        expect(
          Buffer.compare(
            await buffer(await reader.open(entry)),
            Buffer.alloc(0),
          ),
        ).toBe(0);
      }
    }
    expect(count).toBe(3501);
  } finally {
    await reader.close();
  }
});

it.each(["..", ".", "", "a/../b", "a/b", "a\0b"])(
  "rejects raw ASAR component %j before host normalization can alias another entry",
  async (component) => {
    const json = JSON.stringify({
      files: { [component]: { size: 0, offset: "0" } },
    });
    await expect(
      inventoryArtifact(await archiveWith(asarHeaderBytes(json))),
    ).rejects.toMatchObject({ reason: "path" });
  },
);

it("orders raw names portably and retains prototype-named entries and links", async () => {
  const path = await archiveWith(
    asarHeaderBytes(
      '{"files":{"a0":{"size":0,"offset":"0"},"__proto__":{"size":0,"offset":"0"},"a":{"files":{"b":{"link":"a0"}}},"😀":{"size":0,"offset":"0"},"\uE000":{"size":0,"offset":"0"}}}',
    ),
  );
  const reader = new AsarArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries())
      entries.push([entry.path, entry.kind]);
    expect(entries).toEqual([
      ["__proto__", "file"],
      ["a", "directory"],
      ["a/b", "symlink"],
      ["a0", "file"],
      ["\uE000", "file"],
      ["😀", "file"],
    ]);
  } finally {
    await reader.close();
  }
});

it("preserves POSIX literal backslashes and rejects Windows component separators", async () => {
  const path = await archiveWith(
    asarHeaderBytes(
      JSON.stringify({ files: { "a\\b": { size: 0, offset: "0" } } }),
    ),
  );
  const reader = new AsarArtifactReader(path);
  try {
    const list = async () => {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      return entries;
    };
    if (process.platform === "win32") {
      await expect(list()).rejects.toMatchObject({ reason: "path" });
    } else {
      const entries = await list();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe("a\\b");
      expect(
        Buffer.compare(
          await buffer(await reader.open(entries[0]!)),
          Buffer.alloc(0),
        ),
      ).toBe(0);
    }
  } finally {
    await reader.close();
  }
});

it.each([undefined, "01", "-1", "9007199254740992"])(
  "retains inventory facts for an unreadable packed offset %s",
  async (offset) => {
    const digest = "a".repeat(64);
    const bytes = asarHeaderBytes(
      JSON.stringify({
        files: {
          member: {
            size: 0,
            ...(offset === undefined ? {} : { offset }),
            executable: true,
            integrity: { algorithm: "SHA256", hash: digest },
          },
        },
      }),
    );
    const path = await archiveWith(bytes);
    const reader = new AsarArtifactReader(path);
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry).toMatchObject({
        path: "member",
        kind: "file",
        declaredSize: 0,
        executable: true,
        declaredIntegrity: { algorithm: "sha256", digest },
      });
      await expect(reader.open(entry)).rejects.toMatchObject({
        reason: "format",
      });
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    } finally {
      await reader.close();
    }
  },
);

it("preserves directory and link priority with unrecognized integrity declarations", async () => {
  const bytes = asarHeaderBytes(
    JSON.stringify({
      files: {
        directory: {
          files: {},
          link: "target",
          size: 3,
          integrity: { algorithm: "SHA512", hash: "source-digest" },
        },
        link: {
          link: "target",
          size: 4,
          offset: "invalid",
          integrity: { algorithm: "SHA256", hash: "INVALID" },
        },
      },
    }),
  );
  const path = await archiveWith(bytes);
  const reader = new AsarArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries).toMatchObject([
      {
        path: "directory",
        kind: "directory",
        declaredSize: 3,
        declaredIntegrity: null,
        limitations: [
          expect.stringContaining(
            '"algorithm":"SHA512","hash":"source-digest"',
          ),
        ],
      },
      {
        path: "link",
        kind: "symlink",
        declaredSize: 4,
        declaredIntegrity: null,
        limitations: [
          expect.stringContaining('"algorithm":"SHA256","hash":"INVALID"'),
          "ASAR symlink target was not followed or disclosed.",
        ],
      },
    ]);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  } finally {
    await reader.close();
  }
});

it("retains uninterpreted integrity declarations through packed and unpacked inventory and extraction", async () => {
  const payload = Buffer.from("observed content");
  const digest = createHash("sha256").update(payload).digest("hex");
  const unsupported = { algorithm: "SHA512", hash: 'source"\\\u0000\n雪' };
  const invalid = { algorithm: "SHA256", hash: "INVALID" };
  const metadata = { size: payload.length, offset: "0" };
  const bytes = Buffer.concat([
    asarHeaderBytes(
      JSON.stringify({
        files: {
          absent: metadata,
          valid: {
            ...metadata,
            integrity: { algorithm: "SHA256", hash: digest },
          },
          validBlocks: {
            ...metadata,
            integrity: {
              algorithm: "SHA256",
              hash: digest,
              blockSize: 4 * 1024 * 1024,
              blocks: [digest],
            },
          },
          uncheckedBlocks: {
            ...metadata,
            integrity: {
              algorithm: "SHA256",
              hash: digest,
              blockSize: 0,
              blocks: ["source-invalid-block-hash"],
            },
          },
          unsupported: { ...metadata, integrity: unsupported },
          invalid: { ...metadata, integrity: invalid },
          companion: {
            size: payload.length,
            unpacked: true,
            integrity: unsupported,
          },
        },
      }),
    ),
    payload,
  ]);
  const path = await archiveWith(bytes);
  await mkdir(`${path}.unpacked`);
  await writeFile(join(`${path}.unpacked`, "companion"), payload);
  const inventory = await inventoryArtifact(path);
  const occurrence = (name: string) => {
    const result = inventory.occurrences.find(
      (row) => row.logical_path === name,
    );
    if (result === undefined) throw new Error(`Missing ${name}`);
    return result;
  };
  expect(occurrence("absent").declared_integrity).toBeUndefined();
  expect(occurrence("absent").limitations).toEqual([]);
  expect(occurrence("valid").declared_integrity).toEqual({
    algorithm: "sha256",
    digest,
  });
  expect(occurrence("valid").limitations).toEqual([]);
  for (const name of ["validBlocks", "uncheckedBlocks"]) {
    const row = occurrence(name);
    expect(row.declared_integrity).toEqual({ algorithm: "sha256", digest });
    expect(row.hash_status).toBe("verified");
    expect(row.limitations).toEqual([
      expect.stringContaining(
        "block integrity declarations were not validated",
      ),
    ]);
    expect(row.limitations[0]).toContain(
      "does not establish block integrity or Electron runtime acceptance",
    );
  }
  for (const [name, declaration, reason] of [
    ["unsupported", unsupported, "unsupported algorithm"],
    ["invalid", invalid, "invalid digest representation"],
    ["companion", unsupported, "unsupported algorithm"],
  ] as const) {
    const row = occurrence(name);
    expect(row.hash_status).toBe("verified");
    expect(row.declared_integrity).toBeUndefined();
    expect(row.limitations).toEqual([expect.stringContaining(reason)]);
    expect(row.limitations[0]).toContain(JSON.stringify(declaration));
  }
  expect(inventory.integrity_contradictions).toEqual([]);
  for (const integrityPolicy of ["fail", "record-and-continue"] as const) {
    const resources = new ArtifactResourceScope();
    const outputRoot = `${path}.${integrityPolicy}`;
    try {
      const extracted = await extractArtifact({
        inputPath: path,
        inputFormat: "asar",
        outputRoot,
        environment: {},
        integrityPolicy,
        resourceScope: resources,
      });
      expect(extracted.integrity_contradictions).toEqual([]);
      for (const name of [
        "unsupported",
        "invalid",
        "companion",
        "validBlocks",
        "uncheckedBlocks",
      ]) {
        expect((await readFile(join(outputRoot, name))).equals(payload)).toBe(
          true,
        );
        expect(extracted.limitations).toContain(
          `${name}: ${occurrence(name).limitations[0]}`,
        );
      }
    } finally {
      await resources.close();
    }
  }
  expect((await readFile(path)).equals(bytes)).toBe(true);
});

it.each([
  { blockSize: 4 * 1024 * 1024 },
  { blocks: ["source-block"] },
  { blockSize: "uninterpreted source", blocks: { uninterpreted: true } },
])(
  "reports block declaration scope without reinterpreting partial or malformed source fields: %j",
  async (blockFields) => {
    const entries = await readAsarListing({
      files: {
        member: {
          size: 0,
          offset: "0",
          integrity: {
            algorithm: "SHA256",
            hash: "a".repeat(64),
            ...blockFields,
          },
        },
      },
    });
    expect(entries[0]?.declaredIntegrity).toEqual({
      algorithm: "sha256",
      digest: "a".repeat(64),
    });
    expect(entries[0]?.limitations).toEqual([
      expect.stringContaining(
        "block integrity declarations were not validated",
      ),
    ]);
  },
);

it("admits escaped integrity source retention before formatting its limitation", async () => {
  await expect(
    readAsarListing({
      files: {
        member: {
          size: 0,
          offset: "0",
          integrity: { algorithm: "SHA512", hash: "\u0000".repeat(6_000_000) },
        },
      },
    }),
  ).rejects.toMatchObject({
    reason: "limit",
    message: "ASAR expanded listing exceeds its 64 MiB representation budget",
  });
});
