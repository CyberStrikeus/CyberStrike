import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { expect, it } from "vitest";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { UImageArtifactReader } from "./UImageArtifactReader.js";
import { buildMultiPayload, buildUImage } from "../../tests/fixtures/uimage.js";
import {
  parseMultiImageTable,
  parseUImageHeaderFields,
  UIMAGE_HEADER_SIZE,
  UIMAGE_MAGIC,
} from "../domain/uimageFormat.js";
import { classifyArtifactBytesAtPath } from "../../tests/fixtures/artifactClassification.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../tests/fixtures/artifactInventory.js";

const collect = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const writeCarrier = async (name: string, bytes: Buffer): Promise<string> => {
  const directory = await createTestTempDirectory("rea-uimage-");
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
};

it("parses header facts with raw and named fields", () => {
  const bytes = buildUImage({
    arch: 2,
    os: 5,
    type: 2,
    compression: 0,
    loadAddress: 0x8000,
    entryPoint: 0x8000,
    timestamp: 1700000000,
    name: "test-kernel",
    payload: Buffer.from("kernel-bytes"),
  });
  const parsed = parseUImageHeaderFields(bytes.subarray(0, UIMAGE_HEADER_SIZE));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toMatchObject({
    magic: UIMAGE_MAGIC,
    arch: 2,
    archName: "arm",
    os: 5,
    osName: "linux",
    type: 2,
    typeName: "kernel",
    compression: 0,
    compressionName: "none",
    loadAddress: 0x8000,
    entryPoint: 0x8000,
    timestamp: 1700000000,
    timestampIso: "2023-11-14T22:13:20.000Z",
    payloadSize: "kernel-bytes".length,
    name: "test-kernel",
  });
});

it("names unknown enum values as unknown instead of failing", () => {
  const bytes = buildUImage({
    arch: 250,
    os: 250,
    type: 250,
    compression: 250,
  });
  const parsed = parseUImageHeaderFields(bytes.subarray(0, UIMAGE_HEADER_SIZE));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toMatchObject({
    archName: "unknown",
    osName: "unknown",
    typeName: "unknown",
    compressionName: "unknown",
  });
});

it.each([
  [14, "kernel_noload"],
  [22, "loadable"],
  [45, "tfa-bl31"],
  [47, "amlimage"],
  [48, "unknown"],
])("names image type %i as %s", (type, typeName) => {
  const bytes = buildUImage({ type });
  const parsed = parseUImageHeaderFields(bytes.subarray(0, UIMAGE_HEADER_SIZE));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toMatchObject({ type, typeName });
});

it("rejects a bad magic and a bad header CRC", () => {
  const good = buildUImage();
  const badMagic = Buffer.from(good);
  badMagic.writeUInt32BE(0xdeadbeef, 0);
  expect(
    parseUImageHeaderFields(badMagic.subarray(0, UIMAGE_HEADER_SIZE)).ok,
  ).toBe(false);
  const badCrc = buildUImage({ corruptHeaderCrc: true });
  const parsed = parseUImageHeaderFields(
    badCrc.subarray(0, UIMAGE_HEADER_SIZE),
  );
  expect(parsed.ok).toBe(false);
  if (!parsed.ok)
    expect(parsed.error.message).toContain("header CRC32 mismatch");
});

it("splits a multi-image size table and rejects malformed tables", () => {
  const parts = [Buffer.from("aaa"), Buffer.from("bbbbb")];
  const payload = buildMultiPayload(parts);
  const parsed = parseMultiImageTable(payload, payload.length);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual([
    {
      index: 0,
      byteOffset: UIMAGE_HEADER_SIZE + 12,
      declaredSize: 3,
    },
    {
      index: 1,
      byteOffset: UIMAGE_HEADER_SIZE + 16,
      declaredSize: 5,
    },
  ]);
  const noTerminator = Buffer.from([0, 0, 0, 3, 0x61, 0x62, 0x63]);
  expect(parseMultiImageTable(noTerminator, noTerminator.length).ok).toBe(
    false,
  );
  const overrun = Buffer.concat([
    Buffer.from([0, 0, 0, 99, 0, 0, 0, 0]),
    Buffer.from("short"),
  ]);
  expect(parseMultiImageTable(overrun, overrun.length).ok).toBe(false);
});

it("classifies uImage bytes as a container by content, not by suffix", () => {
  const bytes = buildUImage();
  expect(classifyArtifactBytesAtPath("firmware.bin", bytes)).toEqual({
    kind: "container",
    format: "uimage",
  });
  expect(
    classifyArtifactBytesAtPath("firmware.bin", Buffer.from("nope")),
  ).toEqual({
    kind: "resource",
    format: "file",
  });
});

it("inventories a kernel image with its stored payload", async () => {
  const payload = Buffer.from("kernel-bytes");
  const path = await writeCarrier(
    "uimage-kernel",
    buildUImage({
      arch: 22,
      os: 5,
      type: 2,
      compression: 0,
      loadAddress: 0x40080000,
      entryPoint: 0x40080000,
      name: "arm64-kernel",
      payload,
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(snapshot.manifest.root_format).toBe("uimage");
  expect(snapshot.coverage.status).toBe("complete");
  expect(snapshot.limitations.join(" ")).toContain("not decompressed");
  const root = snapshot.occurrences.find((row) => row.logical_path === ".");
  expect(root).toMatchObject({ artifact_kind: "container" });
  expect(root?.format_metadata).toMatchObject({
    kind: "uimage",
    magic: UIMAGE_MAGIC,
    arch: 22,
    arch_name: "arm64",
    os_name: "linux",
    type_name: "kernel",
    compression_name: "none",
    load_address: 0x40080000,
    entry_point: 0x40080000,
    name: "arm64-kernel",
    crc_verified: true,
    sub_image_count: 0,
  });
  const entry = snapshot.occurrences.find(
    (row) => row.logical_path === "payload.bin",
  );
  expect(entry).toMatchObject({
    declared_size: payload.length,
    artifact_format: "file",
  });
  const reader = new UImageArtifactReader(path);
  try {
    const entries = [];
    for await (const item of reader.entries()) entries.push(item);
    expect(entries).toHaveLength(1);
    expect(
      (await collect(await reader.open(entries[0]!))).equals(payload),
    ).toBe(true);
  } finally {
    await reader.close();
  }
});

it("splits multi images and keeps compressed payloads as stored", async () => {
  const partA = Buffer.from("first-part");
  const partB = Buffer.from("second-part-longer");
  const multi = await writeCarrier(
    "uimage-multi",
    buildUImage({
      type: 4,
      name: "multi",
      payload: buildMultiPayload([partA, partB]),
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(multi);
  expect(snapshot.manifest.root_format).toBe("uimage");
  const root = snapshot.occurrences.find((row) => row.logical_path === ".");
  expect(root?.format_metadata).toMatchObject({
    type_name: "multi",
    sub_image_count: 2,
  });
  expect(snapshot.limitations.join(" ")).toContain("size table");
  const reader = new UImageArtifactReader(multi);
  try {
    const entries = [];
    for await (const item of reader.entries()) entries.push(item);
    expect(entries.map((item) => item.path).sort()).toEqual([
      "image-0.bin",
      "image-1.bin",
      "payload.bin",
    ]);
    const byPath = new Map(entries.map((item) => [item.path, item]));
    expect(
      (await collect(await reader.open(byPath.get("image-0.bin")!))).equals(
        partA,
      ),
    ).toBe(true);
    expect(
      (await collect(await reader.open(byPath.get("image-1.bin")!))).equals(
        partB,
      ),
    ).toBe(true);
    expect(
      (await collect(await reader.open(byPath.get("payload.bin")!))).equals(
        buildMultiPayload([partA, partB]),
      ),
    ).toBe(true);
  } finally {
    await reader.close();
  }

  const gzipPayload = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3]);
  const gzip = await writeCarrier(
    "uimage-gzip",
    buildUImage({ type: 2, compression: 1, payload: gzipPayload }),
  );
  const gzipSnapshot = await scanCanonicalArtifactInventory(gzip);
  expect(
    gzipSnapshot.occurrences.find((row) => row.logical_path === ".")
      ?.format_metadata,
  ).toMatchObject({ compression_name: "gzip" });
  const gzipReader = new UImageArtifactReader(gzip);
  try {
    const entries = [];
    for await (const item of gzipReader.entries()) entries.push(item);
    expect(
      (await collect(await gzipReader.open(entries[0]!))).equals(gzipPayload),
    ).toBe(true);
  } finally {
    await gzipReader.close();
  }
});

it("splits a script image's size table like a multi image", async () => {
  // mkimage writes the multi-file size table for scripts too, and U-Boot's
  // `source` skips it: "scripts are just multi-image files with one component".
  const script = Buffer.from("setenv bootargs console=ttyS0\nbootz\n");
  const payload = buildMultiPayload([script]);
  const path = await writeCarrier(
    "uimage-script",
    buildUImage({ type: 6, name: "boot script", payload }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const root = snapshot.occurrences.find((row) => row.logical_path === ".");
  expect(root?.format_metadata).toMatchObject({
    type_name: "script",
    sub_image_count: 1,
  });
  expect(snapshot.limitations.join(" ")).toContain("size table");
  const reader = new UImageArtifactReader(path);
  try {
    const entries = [];
    for await (const item of reader.entries()) entries.push(item);
    const byPath = new Map(entries.map((item) => [item.path, item]));
    expect([...byPath.keys()].sort()).toEqual(["image-0.bin", "payload.bin"]);
    expect(
      (await collect(await reader.open(byPath.get("image-0.bin")!))).equals(
        script,
      ),
    ).toBe(true);
    expect(
      (await collect(await reader.open(byPath.get("payload.bin")!))).equals(
        payload,
      ),
    ).toBe(true);
  } finally {
    await reader.close();
  }
});

it("fails closed on corrupt CRCs, truncation, and bad size tables", async () => {
  const cases: [string, Buffer, RegExp][] = [
    ["data CRC", buildUImage({ corruptDataCrc: true }), /data CRC32 mismatch/u],
    [
      "header CRC",
      buildUImage({ corruptHeaderCrc: true }),
      /header CRC32 mismatch/u,
    ],
    [
      "truncated payload",
      buildUImage({ payload: Buffer.from("twelve-bytes") }).subarray(0, 70),
      /truncated/u,
    ],
    [
      "multi table without terminator",
      buildUImage({
        type: 4,
        payload: Buffer.from([0, 0, 0, 3, 0x61, 0x62, 0x63]),
      }),
      /no zero terminator/u,
    ],
    [
      "script without size table",
      buildUImage({ type: 6, payload: Buffer.from("echo hi\n") }),
      /no zero terminator/u,
    ],
  ];
  for (const [label, bytes, pattern] of cases) {
    const path = await writeCarrier(
      `uimage-bad-${label.replaceAll(" ", "-")}`,
      bytes,
    );
    await expect(scanCanonicalArtifactInventory(path)).rejects.toThrow(pattern);
  }
});

it("rejects an entry that does not match its owning inventory", async () => {
  const path = await writeCarrier("uimage-mismatch", buildUImage());
  const reader = new UImageArtifactReader(path);
  try {
    const entries = [];
    for await (const item of reader.entries()) entries.push(item);
    const forged = { ...entries[0]!, declaredSize: 999 };
    await expect(reader.open(forged)).rejects.toBeInstanceOf(
      ArtifactReaderFailure,
    );
  } finally {
    await reader.close();
  }
});
