import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { EspFlashImageArtifactReader } from "./EspFlashImageArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import type {
  ArtifactEntry,
  ArtifactReaderTraversal,
} from "./ArtifactReader.js";
import { openRegularFile } from "../filesystem/RegularFile.js";
import { extractArtifact } from "./extraction/ArtifactExtraction.js";
import * as regionReads from "./EspFlashRegionReads.js";
import * as espImageDecoding from "../domain/firmware/espImage.js";
import {
  TWO_OTA_PARTITIONS,
  espFlashDump,
  otaData,
  otaRecord,
  partitionTable,
} from "../domain/firmware/espFlash.fixture.js";
import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  espImage,
  pattern,
} from "../../tests/fixtures/espImage.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../tests/fixtures/artifactInventory.js";

const INVENTORY_LIMITATION =
  "ESP flash layout inventory reads a dump's bootloader region, partition table and partitions and decodes the bootloader and app partitions as ESP images. The OTA selection is derived without app rollback or anti-rollback, and the running partition is unknown. Partitions, nvs_keys included, are extracted as ordinary data; nothing is decrypted.";

const BOOTLOADER = espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS });
const APP = espImage({ segments: ESP32C3_APP_SEGMENTS });

/** A C3 dump: factory and ota_0 hold the app, ota_1 is erased, otadata selects ota_0. */
const DUMP = espFlashDump({
  bootloader: { at: 0, bytes: BOOTLOADER },
  parts: [
    { at: 0xd000, bytes: otaData(otaRecord({ seq: 1 })) },
    { at: 0x1_0000, bytes: APP },
    { at: 0x2_0000, bytes: APP },
  ],
});

const writeDump = async (bytes: Uint8Array, name = "flash.bin") => {
  const path = join(await createTestTempDirectory("rea-esp-flash-"), name);
  await writeFile(path, bytes);
  return path;
};

const root = (
  snapshot: Awaited<ReturnType<typeof scanCanonicalArtifactInventory>>,
) =>
  snapshot.occurrences.find(({ logical_path }) => logical_path === ".")
    ?.format_metadata;

const list = async (reader: EspFlashImageArtifactReader) => {
  const entries: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) entries.push(entry);
  return entries;
};

describe("ESP flash layout inventory", () => {
  it("inventories the bootloader, table and partitions with app and otadata facts", async () => {
    const snapshot = await scanCanonicalArtifactInventory(
      await writeDump(DUMP),
    );
    expect(snapshot.manifest.root_format).toBe("esp-flash-image");
    expect(snapshot.coverage).toEqual({
      scope: "container-entries",
      status: "complete",
    });
    expect(snapshot.limitations).toEqual([INVENTORY_LIMITATION]);
    expect(
      snapshot.occurrences.map(({ logical_path }) => logical_path),
    ).toEqual([
      ".",
      "bootloader.bin",
      "partition-table.bin",
      "partitions/factory.bin",
      "partitions/nvs.bin",
      "partitions/ota_0.bin",
      "partitions/ota_1.bin",
      "partitions/otadata.bin",
      "partitions/phy_init.bin",
    ]);
    expect(root(snapshot)).toMatchObject({
      kind: "esp-flash-image",
      flash_offset: { value: 0, source: "default" },
      chip: { target: "esp32c3", isa: "riscv" },
      bootloader: {
        path: "bootloader.bin",
        flash_address: 0,
        region_size: 0x8000,
        facts: {
          status: "esp-image",
          image: { descriptor: { kind: "bootloader" } },
          coverage: "complete",
        },
      },
      partition_table: {
        flash_address: 0x8000,
        method: "default",
        partition_count: 6,
        md5: { status: "valid" },
      },
      partitions_outside_dump: [],
      otadata: { partition_index: 1 },
      boot_selection: {
        basis: "otadata",
        active_record: 0,
        slot: 0,
        partition_index: 4,
        running_partition: "unknown",
      },
      undescribed: [],
    });
    const apps = (
      root(snapshot) as {
        apps: {
          path: string;
          partition_index: number;
          facts: { status: string };
        }[];
      }
    ).apps;
    // Each image names its entry, so no lookup by index is needed.
    expect(
      apps.map(({ path, partition_index, facts }) => [
        path,
        partition_index,
        facts.status,
      ]),
    ).toEqual([
      ["partitions/factory.bin", 3, "esp-image"],
      ["partitions/ota_0.bin", 4, "esp-image"],
      ["partitions/ota_1.bin", 5, "erased"],
    ]);
    const factory = snapshot.occurrences.find(
      ({ logical_path }) => logical_path === "partitions/factory.bin",
    );
    expect(factory).toMatchObject({
      source_path: "factory",
      artifact_format: "esp-image",
      format_metadata: {
        kind: "esp-flash-partition",
        index: 3,
        label: "factory",
        type_name: "app",
        subtype_name: "factory",
        flash_address: 0x1_0000,
        size: 0x1_0000,
      },
    });
  });

  it("finds a relocated table by scanning and says the location is derived", async () => {
    const snapshot = await scanCanonicalArtifactInventory(
      await writeDump(
        espFlashDump({
          bootloader: { at: 0, bytes: BOOTLOADER },
          tableAt: 0xa000,
        }),
      ),
    );
    expect(root(snapshot)).toMatchObject({
      partition_table: { flash_address: 0xa000, method: "scan" },
    });
    expect(snapshot.limitations).toContain(
      "The partition table at 0xa000 was found by scanning 0x1000-aligned flash sectors for a table whose MD5 verifies; the dump does not record the bootloader's configured table offset.",
    );
  });
});

describe("ESP flash layout coverage and selection", () => {
  it("keeps usable partitions beside a truncated and a missing one", async () => {
    const cut = DUMP.subarray(0, 0x2_8000);
    const snapshot = await scanCanonicalArtifactInventory(await writeDump(cut));
    // The table names every partition, so the end of the file hides no entry.
    expect(snapshot.coverage.status).toBe("complete");
    const ota0 = snapshot.occurrences.find(
      ({ logical_path }) => logical_path === "partitions/ota_0.bin",
    );
    expect(ota0).toMatchObject({
      declared_size: 0x8000,
      limitations: [
        "partitions/ota_0.bin is truncated: the dump holds 32768 of its 65536 bytes.",
      ],
    });
    // ota_1 lies past the end: an entry holding none of its bytes.
    expect(root(snapshot)).toMatchObject({ partitions_outside_dump: [] });
    expect(
      snapshot.occurrences.find(
        ({ logical_path }) => logical_path === "partitions/ota_1.bin",
      ),
    ).toMatchObject({
      declared_size: 0,
      limitations: [
        "partitions/ota_1.bin lies outside the dump: the file holds none of its 65536 bytes.",
      ],
      format_metadata: {
        index: 5,
        written_offset: null,
        written_end: null,
        written_bytes: null,
      },
    });
    const { apps } = root(snapshot) as {
      apps: { partition_index: number }[];
    };
    // An app partition the file holds none of has no image facts.
    expect(apps.map(({ partition_index: index }) => index)).toEqual([3, 4]);
    expect(
      snapshot.occurrences.some(
        ({ logical_path }) => logical_path === "partitions/factory.bin",
      ),
    ).toBe(true);
  });

  it("reports written bytes in an app slot the bootloader finds empty", async () => {
    // ota_1's header is erased, but an older image sits 0x8000 into the slot.
    const dump = espFlashDump({
      bootloader: { at: 0, bytes: BOOTLOADER },
      parts: [
        { at: 0xd000, bytes: otaData(otaRecord({ seq: 1 })) },
        { at: 0x1_0000, bytes: APP },
        { at: 0x2_0000, bytes: APP },
        { at: 0x3_8000, bytes: APP },
      ],
    });
    const snapshot = await scanCanonicalArtifactInventory(
      await writeDump(dump),
    );
    const indices = [...APP.keys()].filter((index) => APP[index] !== 0xff);
    const start = 0x8000 + indices[0]!;
    const end = 0x8000 + indices.at(-1)! + 1;
    const row = (path: string) =>
      snapshot.occurrences.find(({ logical_path }) => logical_path === path)
        ?.format_metadata;
    expect(row("partitions/ota_1.bin")).toMatchObject({
      written_offset: start,
      written_end: end,
      written_bytes: indices.length,
    });
    const { apps } = root(snapshot) as {
      apps: { partition_index: number; facts: { status: string } }[];
    };
    expect(
      apps.find(({ partition_index: index }) => index === 5),
    ).toMatchObject({
      facts: { status: "erased" },
    });
    // Only the erased app slot holds bytes the bootloader does not read.
    expect(
      snapshot.limitations.filter((text) => text.includes("finds no app")),
    ).toEqual([
      `partitions/ota_1.bin begins with erased flash, so ESP-IDF's bootloader finds no app in it, but ${String(indices.length)} of its bytes from offset 0x${start.toString(16)} to 0x${end.toString(16)} are not erased flash; they are not read as an image.`,
    ]);
    // A partition erased throughout has no written bytes.
    expect(row("partitions/nvs.bin")).toMatchObject({
      written_offset: null,
      written_end: null,
      written_bytes: 0,
    });
  });

  it("reads a dump that starts at the caller's flash offset", async () => {
    const esp32 = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x0000,
    });
    const whole = espFlashDump({ bootloader: { at: 0x1000, bytes: esp32 } });
    const snapshot = await scanCanonicalArtifactInventory(
      await writeDump(whole.subarray(0x1000)),
      {
        espFlashSelection: { flashOffset: 0x1000 },
      },
    );
    expect(root(snapshot)).toMatchObject({
      flash_offset: { value: 0x1000, source: "caller" },
      chip: { target: "esp32" },
      bootloader: { flash_address: 0x1000, region_size: 0x7000 },
      partition_table: { flash_address: 0x8000, method: "default" },
    });
    const nvs = snapshot.occurrences.find(
      ({ logical_path }) => logical_path === "partitions/nvs.bin",
    );
    expect(nvs?.source_location).toEqual({ offset: 0x8000, length: 0x4000 });
  });

  it("refuses a selected dump without a readable table as not recognized", async () => {
    const reader = new EspFlashImageArtifactReader(
      await writeDump(pattern(0x2_0000, 7)),
    );
    try {
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        reason: "unavailable",
        message: expect.stringContaining(
          "ESP flash image layout is not recognized",
        ),
      });
    } finally {
      await reader.close();
    }
    // The caller's selection decides before another container's signature.
    const zipLike = await writeDump(
      Buffer.concat([Buffer.from("PK\x03\x04"), pattern(0x1_0000, 3)]),
      "dump.zip",
    );
    await expect(
      scanCanonicalArtifactInventory(zipLike, { espFlashSelection: {} }),
    ).rejects.toThrow(/ESP flash image layout is not recognized/u);
  });
});

describe("ESP flash layout reader identity", () => {
  it("rejects a changed carrier during extraction preparation", async () => {
    const reader = new EspFlashImageArtifactReader(await writeDump(DUMP));
    try {
      await expect(
        reader.prepareContainer("0".repeat(64)),
      ).rejects.toMatchObject({ reason: "integrity" });
    } finally {
      await reader.close();
    }
  });

  it("rejects forged entries and changed carrier identity, then closes idempotently", async () => {
    const path = await writeDump(DUMP);
    const reader = new EspFlashImageArtifactReader(path);
    try {
      const entry = (await list(reader)).find(
        ({ path: name }) => name === "partitions/nvs.bin",
      );
      if (entry === undefined) throw new Error("Missing nvs partition");
      await expect(
        reader.open({ ...entry, declaredSize: 1 }),
      ).rejects.toMatchObject({ reason: "integrity" });
      await expect(
        reader.open({ ...entry, byteOffset: 0 }),
      ).rejects.toMatchObject({ reason: "integrity" });
      await expect(
        reader.open({
          ...entry,
          adapterKey: "esp-flash-image:partitions/x.bin",
        }),
      ).rejects.toMatchObject({ reason: "integrity" });
      await writeFile(path, DUMP.subarray(0, 0x1_0000));
      await expect(reader.open(entry)).rejects.toMatchObject({
        reason: "integrity",
      });
    } finally {
      await reader.close();
      await reader.close();
    }
  });

  it("settles an active entry stream when closed", async () => {
    const reader = new EspFlashImageArtifactReader(await writeDump(DUMP));
    try {
      const [entry] = await list(reader);
      if (entry === undefined) throw new Error("Missing entry");
      const stream = await reader.open(entry);
      await reader.close();
      expect(stream.destroyed).toBe(true);
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      await reader.close();
    }
  });

  it("honors cancellation before admitting a file with the exact reason", async () => {
    const reader = new EspFlashImageArtifactReader(await writeDump(DUMP));
    const controller = new AbortController();
    const reason = { stage: "before admission" };
    controller.abort(reason);
    try {
      await expect(
        reader.entries(controller.signal)[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
    } finally {
      await reader.close();
    }
  });
});

describe("ESP flash layout extraction and lifecycle", () => {
  it("extracts every partition byte-exactly, nvs_keys included", async () => {
    const parts = [
      ...TWO_OTA_PARTITIONS.slice(0, 3),
      {
        label: "keys",
        type: 0x01,
        subtype: 0x04,
        offset: 0x1_0000,
        size: 0x1000,
        flags: 1,
      },
    ];
    const keys = pattern(0x1000, 3);
    const dump = espFlashDump({
      size: 0x1_1000,
      bootloader: { at: 0, bytes: BOOTLOADER },
      table: partitionTable(parts),
      parts: [{ at: 0x1_0000, bytes: keys }],
    });
    const directory = await createTestTempDirectory("rea-esp-flash-extract-");
    const path = join(directory, "flash.bin");
    await writeFile(path, dump);
    const resourceScope = new ArtifactResourceScope();
    try {
      const extracted = await extractArtifact({
        inputPath: path,
        inputFormat: "esp-flash-image",
        outputRoot: join(directory, "out"),
        environment: process.env,
        integrityPolicy: "fail",
        resourceScope,
      });
      expect(extracted.containment_verified).toBe(true);
      expect(
        extracted.artifacts.map(({ relative_path }) => relative_path).sort(),
      ).toEqual([
        "bootloader.bin",
        "partition-table.bin",
        "partitions/keys.bin",
        "partitions/nvs.bin",
        "partitions/otadata.bin",
        "partitions/phy_init.bin",
      ]);
      for (const [name, offset, length] of [
        ["bootloader.bin", 0, 0x8000],
        ["partition-table.bin", 0x8000, 0x1000],
        ["partitions/keys.bin", 0x1_0000, 0x1000],
      ] as const)
        expect(
          Buffer.compare(
            await readFile(join(extracted.output_root, name)),
            dump.subarray(offset, offset + length),
          ),
        ).toBe(0);
    } finally {
      await resourceScope.close();
    }
  });

  it.each(["cancel", "close"] as const)(
    "settles app decoding when the caller requests %s after the first decoded chunk",
    async (action) => {
      const large = espImage({
        segments: [{ address: 0x4038_0000, data: Buffer.alloc(8 << 20, 0x5a) }],
      });
      const parts = [
        {
          label: "factory",
          type: 0,
          subtype: 0,
          offset: 0x1_0000,
          size: 0x90_0000,
        },
      ];
      const reader = new EspFlashImageArtifactReader(
        await writeDump(
          espFlashDump({
            size: 0x91_0000,
            bootloader: { at: 0, bytes: BOOTLOADER },
            table: partitionTable(parts),
            parts: [{ at: 0x1_0000, bytes: large }],
          }),
        ),
      );
      const controller = new AbortController();
      const reason = { stage: "decoding" };
      let completion: Promise<void> | undefined;
      let decoded = 0;
      let acknowledge = (): void => undefined;
      const decoding = new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      const create = espImageDecoding.createEspImageDecoder;
      // The bootloader decodes in one chunk; acknowledge the app's second chunk.
      const observer = vi
        .spyOn(espImageDecoding, "createEspImageDecoder")
        .mockImplementation((size) => {
          const decoder = create(size);
          let writes = 0;
          return {
            write: (chunk) => {
              decoder.write(chunk);
              decoded += 1;
              writes += 1;
              if (size > 0x10_0000 && writes === 1) acknowledge();
            },
            get satisfied() {
              return decoder.satisfied;
            },
            finish: () => decoder.finish(),
          };
        });
      try {
        const pending = reader
          .entries(controller.signal)
          [Symbol.asyncIterator]()
          .next();
        await Promise.race([
          decoding,
          pending.then(() => {
            throw new Error("Preparation settled before app decoding began");
          }),
        ]);
        const requestedAt = decoded;
        if (action === "cancel") controller.abort(reason);
        else completion = reader.close();
        await expect(pending).rejects.toMatchObject(
          action === "cancel"
            ? { reason: "cancelled", cause: reason }
            : { reason: "unavailable" },
        );
        await completion;
        expect(decoded).toBe(requestedAt);
        await reader.close();
        await expect(
          reader.entries()[Symbol.asyncIterator]().next(),
        ).rejects.toMatchObject({
          reason: "unavailable",
        });
      } finally {
        observer.mockRestore();
        await reader.close();
      }
    },
  );
});

describe("ESP flash layout written-bytes scan lifecycle", () => {
  it.each(["cancel", "close"] as const)(
    "settles the written-bytes scan when the caller requests %s after its first chunk",
    async (action) => {
      // Only the written-bytes scan reads a data partition's bytes.
      const parts = [
        {
          label: "storage",
          type: 1,
          subtype: 0x81,
          offset: 0x1_0000,
          size: 0x90_0000,
        },
      ];
      const reader = new EspFlashImageArtifactReader(
        await writeDump(
          espFlashDump({
            size: 0x91_0000,
            bootloader: { at: 0, bytes: BOOTLOADER },
            table: partitionTable(parts),
            parts: [{ at: 0x1_0000, bytes: Buffer.alloc(0x90_0000, 0x5a) }],
          }),
        ),
      );
      const controller = new AbortController();
      const reason = { stage: "written-bytes scan" };
      let completion: Promise<void> | undefined;
      let scanned = 0;
      let acknowledge = (): void => undefined;
      const scanning = new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      const scan = regionReads.writtenExtents;
      // Count the chunks the scan examines once the reader admits them.
      const observer = vi
        .spyOn(regionReads, "writtenExtents")
        .mockImplementation((context, regions, assertOpen) =>
          scan(context, regions, () => {
            assertOpen();
            if (!regions.some(({ length }) => length >= 0x10_0000)) return;
            scanned += 1;
            if (scanned === 1) acknowledge();
          }),
        );
      try {
        const pending = reader
          .entries(controller.signal)
          [Symbol.asyncIterator]()
          .next();
        await Promise.race([
          scanning,
          pending.then(() => {
            throw new Error("Preparation settled before the scan began");
          }),
        ]);
        const requestedAt = scanned;
        if (action === "cancel") controller.abort(reason);
        else completion = reader.close();
        await expect(pending).rejects.toMatchObject(
          action === "cancel"
            ? { reason: "cancelled", cause: reason }
            : { reason: "unavailable" },
        );
        await completion;
        expect(scanned).toBe(requestedAt);
        await reader.close();
        await expect(
          reader.entries()[Symbol.asyncIterator]().next(),
        ).rejects.toMatchObject({
          reason: "unavailable",
        });
      } finally {
        observer.mockRestore();
        await reader.close();
      }
    },
  );
});

describe("ESP flash layout erased-gap scan lifecycle", () => {
  it.each(["cancel", "close"] as const)(
    "settles the erased-gap scan when the caller requests %s after its first chunk",
    async (action) => {
      // One small partition leaves the rest of a 9 MiB dump as one erased gap.
      const parts = [
        { label: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x1000 },
      ];
      const reader = new EspFlashImageArtifactReader(
        await writeDump(
          espFlashDump({
            size: 0x90_0000,
            bootloader: { at: 0, bytes: BOOTLOADER },
            table: partitionTable(parts),
          }),
        ),
      );
      const controller = new AbortController();
      const reason = { stage: "erased-gap scan" };
      let completion: Promise<void> | undefined;
      let scanned = 0;
      let acknowledge = (): void => undefined;
      const scanning = new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      const scan = regionReads.firstUnerasedInRange;
      // Count the chunks the scan examines once the reader admits them.
      const observer = vi
        .spyOn(regionReads, "firstUnerasedInRange")
        .mockImplementation((context, range, assertOpen) =>
          scan(context, range, () => {
            assertOpen();
            if (range.length < 0x10_0000) return;
            scanned += 1;
            if (scanned === 1) acknowledge();
          }),
        );
      try {
        const pending = reader
          .entries(controller.signal)
          [Symbol.asyncIterator]()
          .next();
        await Promise.race([
          scanning,
          pending.then(() => {
            throw new Error("Preparation settled before the scan began");
          }),
        ]);
        const requestedAt = scanned;
        if (action === "cancel") controller.abort(reason);
        else completion = reader.close();
        await expect(pending).rejects.toMatchObject(
          action === "cancel"
            ? { reason: "cancelled", cause: reason }
            : { reason: "unavailable" },
        );
        await completion;
        expect(scanned).toBe(requestedAt);
      } finally {
        observer.mockRestore();
        await reader.close();
      }
    },
  );
});

describe("ESP flash layout written bytes of overlapping partitions", () => {
  it("reads the bytes they cover once and keeps each partition's own facts", async () => {
    // 60 data partitions over one MiB: 40 cover all of it, 20 its first half.
    const parts = Array.from({ length: 60 }, (_, index) => ({
      label: `p${String(index)}`,
      type: 1,
      subtype: 0x81,
      offset: 0x1_0000,
      size: index < 40 ? 0x10_0000 : 0x8_0000,
    }));
    const bytes = espFlashDump({
      size: 0x11_0000,
      bootloader: { at: 0, bytes: BOOTLOADER },
      table: partitionTable(parts),
      parts: [
        { at: 0x1_0100, bytes: Buffer.alloc(0x100, 0x5a) },
        { at: 0x9_0000, bytes: Buffer.alloc(0x100, 0x5a) },
      ],
    });
    const path = await writeDump(bytes);
    const admitted = await openRegularFile(path, { symlinks: "reject" });
    const nativeRead = admitted.handle.read.bind(admitted.handle);
    let read = 0;
    const reads = vi.spyOn(admitted.handle, "read").mockImplementation((async (
      ...args: unknown[]
    ) => {
      const result = (await Reflect.apply(
        nativeRead,
        admitted.handle,
        args,
      )) as {
        bytesRead: number;
      };
      read += result.bytesRead;
      return result;
    }) as typeof admitted.handle.read);
    const reader = new EspFlashImageArtifactReader(path, admitted);
    try {
      let coverage: ArtifactReaderTraversal | undefined;
      const entries: ArtifactEntry[] = [];
      for await (const entry of reader.entries(undefined, {
        onCoverage: (value) => {
          coverage = value;
        },
      }))
        entries.push(entry);
      // Each covered byte is read once, not once per partition over it.
      expect(read).toBeLessThan(2 * bytes.length);
      expect(
        entries.flatMap(({ path: entryPath, formatMetadata }) =>
          formatMetadata?.kind === "esp-flash-partition"
            ? [[entryPath, formatMetadata]]
            : [],
        ),
      ).toEqual(
        parts.map((part, index) => [
          `partitions/${part.label}.bin`,
          expect.objectContaining({
            index,
            label: part.label,
            flash_address: 0x1_0000,
            size: part.size,
            written_offset: 0x100,
            written_end: index < 40 ? 0x8_0100 : 0x200,
            written_bytes: index < 40 ? 0x200 : 0x100,
          }),
        ]),
      );
      expect(
        coverage?.limitations.filter((text) => text.includes(" overlaps ")),
      ).toHaveLength(59);
    } finally {
      await reader.close();
      reads.mockRestore();
      await admitted.handle.close();
    }
  });
});

describe("ESP flash layout app images of overlapping partitions", () => {
  it("decodes each declared range once and keeps each partition's facts", async () => {
    // 60 app partitions over one image: 40 hold all of it, 20 cut it short.
    const image = espImage({
      segments: [{ address: 0x3c00_0020, data: Buffer.alloc(0xf_0000, 0x5a) }],
    });
    const parts = Array.from({ length: 60 }, (_, index) => ({
      label: `a${String(index)}`,
      type: 0,
      subtype: 0x10 + (index % 16),
      offset: 0x1_0000,
      size: index < 40 ? 0x10_0000 : 0x8_0000,
    }));
    const reader = new EspFlashImageArtifactReader(
      await writeDump(
        espFlashDump({
          size: 0x11_0000,
          bootloader: { at: 0, bytes: BOOTLOADER },
          table: partitionTable(parts),
          parts: [{ at: 0x1_0000, bytes: image }],
        }),
      ),
    );
    const decode = vi.spyOn(regionReads, "decodeEspFlashImage");
    try {
      await list(reader);
      // The bootloader, the whole image and the image cut at 0x80000.
      expect(decode).toHaveBeenCalledTimes(3);
      const apps = reader.formatMetadata()?.apps ?? [];
      expect(
        apps.map(({ path, partition_index: index, facts }) => [
          path,
          index,
          facts.status,
          facts.coverage,
        ]),
      ).toEqual(
        parts.map((part, index) => [
          `partitions/${part.label}.bin`,
          index,
          "esp-image",
          index < 40 ? "complete" : "unknown",
        ]),
      );
    } finally {
      decode.mockRestore();
      await reader.close();
    }
  });
});
