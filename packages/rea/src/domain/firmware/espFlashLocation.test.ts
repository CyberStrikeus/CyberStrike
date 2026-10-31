import { describe, expect, it } from "vitest";

import { espChipForId } from "./espChips.js";
import {
  espFlashDumpOrigin,
  locateEspFlashLayout,
  type EspFlashSelection,
} from "./espFlashLocation.js";
import { ESP8266_REFUSAL } from "./espImage.js";
import {
  TWO_OTA_PARTITIONS,
  flashImage,
  partitionTable,
} from "./espFlash.fixture.js";
import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  esp8266Image,
  espImage,
} from "../../../tests/fixtures/espImage.js";

const c3Bootloader = espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS });
const esp32Bootloader = espImage({
  segments: ESP32C3_BOOTLOADER_SEGMENTS,
  chipId: 0x0000,
});

const locate = (
  bytes: Uint8Array,
  selection: EspFlashSelection = {},
  explicit = false,
  reads: [number, number][] = [],
) =>
  locateEspFlashLayout(
    bytes.length,
    async (position, length) => {
      reads.push([position, length]);
      return bytes.subarray(
        Math.max(0, position),
        Math.max(0, position) + length,
      );
    },
    selection,
    { explicit },
  );

const dump = (
  tableAt: number,
  {
    bootloader = c3Bootloader,
    bootloaderAt = 0,
    md5 = "valid",
  }: {
    readonly bootloader?: Uint8Array;
    readonly bootloaderAt?: number;
    readonly md5?: "valid" | "corrupt" | "absent";
  } = {},
) =>
  flashImage(0x2_0000, [
    { at: bootloaderAt, bytes: bootloader },
    { at: tableAt, bytes: partitionTable(TWO_OTA_PARTITIONS, { md5 }) },
  ]);

/** An ESP32 dump read from flash 0x1000: its bootloader is the file's first byte. */
const fromSecondSector = (tableAt: number) =>
  dump(tableAt, { bootloader: esp32Bootloader, bootloaderAt: 0x1000 }).subarray(
    0x1000,
  );

const UNCONFIRMED =
  "No bootloader at a ROM offset confirms that the dump starts at flash 0x0; each partition's file offset assumes it. Pass flash_offset if the dump starts elsewhere.";

describe("ESP flash layout location", () => {
  it("finds the bootloader and the table at their default offsets", async () => {
    const located = await locate(dump(0x8000));
    expect(located.ok && located.value).toMatchObject({
      origin: { value: 0, source: "default" },
      bootloader: { flashAddress: 0, chip: { target: "esp32c3" } },
      tableAddress: 0x8000,
      tableMethod: "default",
      table: { md5: { status: "valid" } },
      limitations: [],
    });
  });

  it("locates a bootloader at the 0x2000 ROM offset of the chips that use it", async () => {
    const c5 = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x17,
    });
    const located = await locate(
      dump(0x8000, { bootloader: c5, bootloaderAt: 0x2000 }),
    );
    expect(located.ok && located.value).toMatchObject({
      bootloader: { flashAddress: 0x2000, chip: { target: "esp32c5" } },
      tableMethod: "default",
    });
  });

  it("scans for a relocated table only when its MD5 verifies", async () => {
    const located = await locate(dump(0xa000));
    expect(located.ok && located.value).toMatchObject({
      tableAddress: 0xa000,
      tableMethod: "scan",
    });
    expect(await locate(dump(0xa000, { md5: "absent" }))).toEqual({
      ok: false,
      error:
        "no partition table at 0x8000 or in any 0x1000-aligned flash sector after the bootloader image with a verified MD5; flash encryption is one cause",
    });
  });

  it.each([0x1_0000, 0x1_1000])(
    "scans across read chunks to a table at %s",
    async (tableAt) => {
      const located = await locate(dump(tableAt));
      expect(located.ok && located.value).toMatchObject({
        tableAddress: tableAt,
        tableMethod: "scan",
      });
    },
  );

  it("scans the sectors of a dump whose origin is not sector-aligned", async () => {
    // Flash 0x9000 is file offset 0x8800 when the dump starts at flash 0x800.
    const bytes = flashImage(0x2_0000, [
      { at: 0x8800, bytes: partitionTable(TWO_OTA_PARTITIONS) },
    ]);
    const located = await locate(bytes, { flashOffset: 0x800 }, true);
    expect(located.ok && located.value).toMatchObject({
      origin: { value: 0x800, source: "caller" },
      tableAddress: 0x9000,
      tableMethod: "scan",
      limitations: [],
    });
  });

  it("does not look for a table inside a single app image", async () => {
    const app = espImage({
      segments: [
        ...ESP32C3_APP_SEGMENTS,
        { address: 0x4038_0000, data: Buffer.alloc(0x2_0000, 0x5a) },
      ],
    });
    const reads: [number, number][] = [];
    expect((await locate(app, {}, false, reads)).ok).toBe(false);
    // Probes and segment headers only: no table read, no scan chunk.
    expect(reads.every(([, length]) => length <= 32)).toBe(true);
  });

  it("uses the caller's table offset and does not scan", async () => {
    const located = await locate(dump(0xa000), {
      partitionTableOffset: 0xa000,
    });
    expect(located.ok && located.value).toMatchObject({
      tableAddress: 0xa000,
      tableMethod: "caller",
    });
    expect(
      await locate(dump(0xa000), { partitionTableOffset: 0x9000 }),
    ).toEqual({
      ok: false,
      error:
        "no partition table at the given offset 0x9000: the first entry is empty",
    });
  });

  it("does not read a lone MD5 entry as a table", async () => {
    const md5Only = flashImage(0x2_0000, [
      { at: 0, bytes: c3Bootloader },
      { at: 0x8000, bytes: partitionTable([]) },
    ]);
    expect((await locate(md5Only)).ok).toBe(false);
    expect(await locate(md5Only, { partitionTableOffset: 0x8000 })).toEqual({
      ok: false,
      error:
        "no partition table at the given offset 0x8000: entry 1 at 0x20 ends the table before any partition entry",
    });
  });

  it("rejects a table offset outside the dump", async () => {
    expect(
      await locate(dump(0x8000), { partitionTableOffset: 0x10_0000 }),
    ).toEqual({
      ok: false,
      error:
        "the partition table offset 0x100000 is outside the dump, which holds flash 0x0-0x20000",
    });
  });
});

describe("ESP flash layout origins", () => {
  it("reads a dump that starts after flash address 0 at the caller's origin", async () => {
    const located = await locate(fromSecondSector(0x8000), {
      flashOffset: 0x1000,
    });
    expect(located.ok && located.value).toMatchObject({
      origin: { value: 0x1000, source: "caller" },
      bootloader: {
        flashAddress: 0x1000,
        fileOffset: 0,
        chip: { target: "esp32" },
      },
      tableAddress: 0x8000,
      tableMethod: "default",
      limitations: [],
    });
  });

  it.each([
    ["omitted", {}],
    ["given as 0x0", { flashOffset: 0 }],
  ] as const)(
    "refuses an origin the bootloader contradicts when it is %s",
    async (_name, selection) => {
      // The table sits at flash 0x9000, so the default 0x8000 would find it
      // at file 0x8000 and misplace every partition by 0x1000.
      const refused = await locate(fromSecondSector(0x9000), selection);
      expect(refused).toEqual({
        ok: false,
        error:
          "An esp32 image is at flash 0x0, but its ROM loads the bootloader from 0x1000; the dump may not start at flash 0x0. Pass the flash_offset where the dump starts, or partition_table_offset",
      });
    },
  );

  it("names the origin a misplaced bootloader and the table at its 0x8000 show", async () => {
    // Read from 0x1000: the bootloader at file 0, the table at file 0x7000.
    const dump = fromSecondSector(0x8000);
    const reader = (bytes: Uint8Array) => async (at: number, length: number) =>
      bytes.subarray(at, at + length);
    const esp32 = espChipForId(0x0000)!;
    const image = { chip: esp32, fileOffset: 0, end: esp32Bootloader.length };
    expect(await espFlashDumpOrigin(reader(dump), dump.length, image)).toEqual({
      flashOffset: 0x1000,
      tableFileOffset: 0x7000,
    });
    expect(await locate(dump)).toEqual({
      ok: false,
      error:
        "An esp32 image is at flash 0x0, but its ROM loads the bootloader from 0x1000; the dump may not start at flash 0x0. A partition table at file offset 0x7000 shows the dump was read from flash 0x1000; pass flash_offset 0x1000",
    });
    // No table there, a table the image holds, or a chip whose ROM loads
    // from 0x0 shows no origin.
    const relocated = fromSecondSector(0x9000);
    expect(
      await espFlashDumpOrigin(reader(relocated), relocated.length, image),
    ).toBeUndefined();
    expect(
      await espFlashDumpOrigin(reader(dump), dump.length, {
        ...image,
        end: 0x7001,
      }),
    ).toBeUndefined();
    expect(
      await espFlashDumpOrigin(reader(dump), dump.length, {
        ...image,
        chip: espChipForId(0x0005)!,
      }),
    ).toBeUndefined();
  });

  it("names no origin from a table inside the misplaced image's segments", async () => {
    // The table bytes at file 0x7000 are segment data, not flash 0x8000.
    const data = Buffer.alloc(0x7400);
    partitionTable(TWO_OTA_PARTITIONS).copy(data, 0x7000 - 0x20);
    const spanning = espImage({
      segments: [{ address: 0x3ffe_0000, data }],
      chipId: 0x0000,
    });
    expect(
      await locate(flashImage(0x1_0000, [{ at: 0, bytes: spanning }])),
    ).toEqual({
      ok: false,
      error:
        "An esp32 image is at flash 0x0, but its ROM loads the bootloader from 0x1000; the dump may not start at flash 0x0. Pass the flash_offset where the dump starts, or partition_table_offset",
    });
  });

  it("finds the table after the bootloader once the origin is right", async () => {
    const located = await locate(fromSecondSector(0x9000), {
      flashOffset: 0x1000,
    });
    expect(located.ok && located.value).toMatchObject({
      tableAddress: 0x9000,
      tableMethod: "scan",
    });
  });

  it("does not scan arbitrary files without a bootloader unless the format was selected", async () => {
    const bare = flashImage(0x2_0000, [
      { at: 0xa000, bytes: partitionTable(TWO_OTA_PARTITIONS) },
    ]);
    expect(await locate(bare)).toEqual({
      ok: false,
      error: "no partition table at 0x8000 and no bootloader at a ROM offset",
    });
    const explicit = await locate(bare, {}, true);
    expect(explicit.ok && explicit.value).toMatchObject({
      bootloader: undefined,
      tableAddress: 0xa000,
      tableMethod: "scan",
      limitations: [UNCONFIRMED],
    });
  });

  it("reads an unknown chip's dump at its default table without calling it misplaced", async () => {
    const unknown = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x7777,
    });
    const located = await locate(dump(0x8000, { bootloader: unknown }));
    expect(located.ok && located.value).toMatchObject({
      bootloader: undefined,
      tableMethod: "default",
      limitations: [
        "An ESP image at flash 0x0 has chip_id 0x7777, which is not in the chip table; it is not read as the bootloader.",
        UNCONFIRMED,
      ],
    });
  });

  it("refuses an ESP8266 dump as the ESP image reader does", async () => {
    const esp8266 = flashImage(0x2_0000, [
      { at: 0, bytes: esp8266Image() },
      { at: 0x8000, bytes: partitionTable(TWO_OTA_PARTITIONS) },
    ]);
    expect(await locate(esp8266)).toEqual({
      ok: false,
      error: ESP8266_REFUSAL,
    });
    expect(await locate(esp8266, {}, true)).toEqual({
      ok: false,
      error: ESP8266_REFUSAL,
    });
  });
});
