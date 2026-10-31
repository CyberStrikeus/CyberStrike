import { describe, expect, it } from "vitest";

import {
  decodeEspPartitionTable,
  espBootPartitions,
  espPartitionSubtypeName,
  espPartitionTypeName,
  type EspPartition,
} from "./espPartitionTable.js";
import { decodeEspOtaRecord, selectEspBootPartition } from "./espOtaData.js";
import {
  espBootloaderProbeOffsets,
  espImageSegmentsEnd,
  locateEspBootloader,
} from "./espFlashBootloader.js";
import {
  TWO_OTA_PARTITIONS,
  otaRecord,
  partitionEntry,
  partitionTable,
} from "./espFlash.fixture.js";
import {
  ESP32C3_BOOTLOADER_SEGMENTS,
  esp8266Image,
  espImage,
} from "../../../tests/fixtures/espImage.js";

const table = (bytes: Uint8Array) => {
  const decoded = decodeEspPartitionTable(bytes);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.value;
};

describe("ESP partition tables", () => {
  it("decodes entries, flags and a verified MD5 as gen_esp32part writes them", () => {
    const decoded = table(
      partitionTable([
        ...TWO_OTA_PARTITIONS,
        {
          label: "keys",
          type: 0x01,
          subtype: 0x04,
          offset: 0x4_0000,
          size: 0x1000,
          flags: 0b11,
        },
      ]),
    );
    expect(decoded.md5.status).toBe("valid");
    expect(decoded.md5.entryOffset).toBe(7 * 32);
    expect(decoded.length).toBe(9 * 32);
    expect(decoded.limitations).toEqual([]);
    expect(decoded.partitions.map(({ label }) => label)).toEqual([
      "nvs",
      "otadata",
      "phy_init",
      "factory",
      "ota_0",
      "ota_1",
      "keys",
    ]);
    expect(decoded.partitions.at(-1)).toMatchObject({
      index: 6,
      entryOffset: 6 * 32,
      type: 0x01,
      subtype: 0x04,
      offset: 0x4_0000,
      size: 0x1000,
      encrypted: true,
      readonly: true,
      unknownFlags: 0,
    });
  });

  it("accepts a table without an MD5 entry, as the bootloader does", () => {
    const decoded = table(
      partitionTable(TWO_OTA_PARTITIONS, { md5: "absent" }),
    );
    expect(decoded.md5).toEqual({
      status: "absent",
      entryOffset: null,
      stored: null,
      computed: null,
    });
    expect(decoded.partitions).toHaveLength(6);
  });

  it("keeps the entries of a table whose MD5 does not match", () => {
    const decoded = table(
      partitionTable(TWO_OTA_PARTITIONS, { md5: "corrupt" }),
    );
    expect(decoded.md5.status).toBe("invalid");
    expect(decoded.partitions).toHaveLength(6);
    expect(decoded.limitations).toEqual([
      "The partition table MD5 at 0xc0 does not match the entries before it; ESP-IDF's bootloader rejects the table.",
    ]);
  });

  it.each([
    ["erased flash", Buffer.alloc(0xc00, 0xff), "the first entry is empty"],
    [
      "an MD5 entry alone",
      partitionTable([]),
      "entry 1 at 0x20 ends the table before any partition entry",
    ],
    [
      "a foreign entry",
      Buffer.concat([
        partitionEntry(TWO_OTA_PARTITIONS[0]!),
        Buffer.alloc(32, 0),
        Buffer.alloc(0xbc0, 0xff),
      ]),
      "entry 1 at 0x20 has magic 0x0, not a partition, MD5 or terminating entry",
    ],
    [
      "no terminator",
      Buffer.concat(
        Array.from({ length: 96 }, () =>
          partitionEntry(TWO_OTA_PARTITIONS[0]!),
        ),
      ),
      "no terminating entry within 96 entries (0xc00 bytes)",
    ],
    [
      "short bytes",
      partitionEntry(TWO_OTA_PARTITIONS[0]!),
      "the bytes end at 0x20, inside entry 1",
    ],
  ])("rejects %s as not a table", (_name, bytes, reason) => {
    expect(decodeEspPartitionTable(bytes)).toEqual({
      ok: false,
      error: reason,
    });
  });

  it("names types and subtypes as ESP-IDF does, and keeps unknown flags and labels", () => {
    expect(espPartitionTypeName(0x00)).toBe("app");
    expect(espPartitionSubtypeName(0x00, 0x1f)).toBe("ota_15");
    expect(espPartitionSubtypeName(0x01, 0x04)).toBe("nvs_keys");
    expect(espPartitionTypeName(0x40)).toBeNull();
    expect(espPartitionSubtypeName(0x40, 0x00)).toBeNull();
    const entry = partitionEntry({
      label: "x",
      type: 0x40,
      subtype: 0,
      offset: 0x1_0000,
      size: 0x1000,
      flags: 0x8000_0001,
    });
    entry.writeUInt8(0xff, 13);
    const [decoded] = table(
      Buffer.concat([entry, Buffer.alloc(0xbe0, 0xff)]),
    ).partitions;
    expect(decoded).toMatchObject({
      label: null,
      // The source bytes stay comparable when the label is not UTF-8.
      labelHex: "78ff",
      encrypted: true,
      unknownFlags: 0x8000_0000,
    });
  });

  it("keeps the partitions the bootloader keeps: the last of each role", () => {
    const [nvs, otadata, , factory, ota0] = TWO_OTA_PARTITIONS;
    const boot = espBootPartitions(
      table(
        partitionTable([
          ...TWO_OTA_PARTITIONS,
          { ...factory!, label: "factory2", offset: 0x4_0000 },
          { ...otadata!, label: "otadata2", offset: 0x5_0000 },
          { ...ota0!, label: "again", offset: 0x6_0000 },
          { ...nvs!, label: "nvs2", offset: 0x7_0000 },
        ]),
      ).partitions,
    );
    expect(boot.factory?.label).toBe("factory2");
    expect(boot.otadata?.label).toBe("otadata2");
    // A same-subtype OTA entry replaces the slot but still counts.
    expect(boot.otaSlots.get(0)?.label).toBe("again");
    expect(boot.otaAppCount).toBe(3);
    expect(boot.limitations).toEqual([
      "The table declares otadata 2 times (partitions #1, #7); ESP-IDF's bootloader uses the last.",
      "The table declares factory 2 times (partitions #3, #6); ESP-IDF's bootloader uses the last.",
      "The table declares ota_0 2 times (partitions #4, #8); ESP-IDF's bootloader uses the last.",
    ]);
  });
});

const partitions = (): readonly EspPartition[] =>
  table(partitionTable(TWO_OTA_PARTITIONS)).partitions;

const select = (
  first: Buffer,
  second: Buffer,
  parts = partitions(),
  otadataSize = 0x2000,
) =>
  selectEspBootPartition(espBootPartitions(parts), {
    offset: 0xd000,
    size: otadataSize,
    records: [decodeEspOtaRecord(first, 0), decodeEspOtaRecord(second, 1)],
  });
const erased = Buffer.alloc(32, 0xff);

describe("ESP otadata selection", () => {
  it("decodes records and checks the CRC the bootloader computes", () => {
    expect(
      decodeEspOtaRecord(otaRecord({ seq: 3, state: 2 }), 0),
    ).toMatchObject({
      index: 0,
      ota_seq: 3,
      ota_state: 2,
      state_name: "valid",
      crc_matches: true,
      valid: true,
    });
    expect(decodeEspOtaRecord(otaRecord({ seq: 3, crc: 0 }), 1)).toMatchObject({
      crc_matches: false,
      valid: false,
    });
    // The CRC otatool v5.5.2 wrote for ota_seq 1 in the real-tool lane.
    expect(
      decodeEspOtaRecord(otaRecord({ seq: 1, crc: 0x4743_989a }), 0),
    ).toMatchObject({ crc_matches: true, valid: true });
    expect(decodeEspOtaRecord(Buffer.alloc(32, 0xff), 1)).toMatchObject({
      ota_seq: 0xffff_ffff,
      state_name: "undefined",
      valid: false,
    });
  });

  it("selects the higher valid sequence and maps it onto the OTA slots", () => {
    expect(select(otaRecord({ seq: 4 }), otaRecord({ seq: 5 }))).toMatchObject({
      active_record: 1,
      slot: 0,
      partition_index: 4,
      basis: "otadata",
    });
    // An invalid state removes a record; a tie keeps record 0.
    expect(
      select(otaRecord({ seq: 6, state: 3 }), otaRecord({ seq: 5 })),
    ).toMatchObject({ active_record: 1, slot: 0 });
    expect(select(otaRecord({ seq: 2 }), otaRecord({ seq: 2 }))).toMatchObject({
      active_record: 0,
      slot: 1,
      partition_index: 5,
    });
    // ota_seq 0 is set; (0 - 1) wraps to 0xFFFFFFFF, and 0xFFFFFFFF % 2 is 1.
    expect(select(otaRecord({ seq: 0 }), erased)).toMatchObject({
      active_record: 0,
      slot: 1,
      partition_index: 5,
    });
  });

  it("falls back as the bootloader does without usable records", () => {
    expect(select(erased, erased)).toMatchObject({
      basis: "factory-fallback",
      partition_index: 3,
      slot: null,
    });
    const noFactory = partitions().filter(({ label }) => label !== "factory");
    expect(select(erased, erased, noFactory)).toMatchObject({
      basis: "ota_0-fallback",
      slot: 0,
      partition_index: 4,
    });
    // Boot index 0 stands without an ota_0 partition.
    const onlyOta1 = noFactory.filter(({ label }) => label !== "ota_0");
    expect(select(erased, erased, onlyOta1)).toMatchObject({
      basis: "ota_0-fallback",
      slot: 0,
      partition_index: null,
    });
    // A set sequence with a bad CRC is not unusable, but no record is valid:
    // the factory index, with no factory partition to name.
    expect(
      select(otaRecord({ seq: 2, crc: 1 }), erased, noFactory),
    ).toMatchObject({ basis: "factory-fallback", partition_index: null });
    expect(select(otaRecord({ seq: 2 }), erased)).toMatchObject({
      running_partition: "unknown",
    });
    expect(select(otaRecord({ seq: 2 }), erased).assumptions).toHaveLength(4);
  });

  it("indexes OTA slots by subtype, so a missing subtype selects no partition", () => {
    const gapped = partitions().filter(({ label }) => label !== "ota_0");
    // Two OTA apps would be counted, but only ota_1 exists: seq 1 selects slot 0.
    const withSecond = [
      ...gapped,
      { ...gapped.at(-1)!, index: 9, subtype: 0x12, label: "ota_2" },
    ];
    expect(select(otaRecord({ seq: 1 }), erased, withSecond)).toMatchObject({
      slot: 0,
      partition_index: null,
      basis: "otadata",
    });
  });
});

describe("ESP boot selection without a derivable slot", () => {
  it("selects the factory index for a table without otadata", () => {
    const withoutOtadata = partitions().filter(
      ({ label }) => label !== "otadata",
    );
    const selection = selectEspBootPartition(
      espBootPartitions(withoutOtadata),
      undefined,
    );
    expect(selection).toMatchObject({
      basis: "no-otadata",
      active_record: null,
      slot: null,
      partition_index: 3,
      running_partition: "unknown",
    });
    // No record is read, so the records assumption does not apply.
    expect(selection.assumptions).toHaveLength(3);
    const factoryOnly = withoutOtadata.filter(
      ({ label }) => !label?.startsWith("ota_"),
    );
    expect(
      selectEspBootPartition(espBootPartitions(factoryOnly), undefined),
    ).toMatchObject({ basis: "no-otadata", partition_index: 3 });
    // Without a factory app the bootloader still selects the factory index.
    expect(
      selectEspBootPartition(
        espBootPartitions(
          withoutOtadata.filter(({ label }) => label !== "factory"),
        ),
        undefined,
      ),
    ).toMatchObject({ basis: "no-otadata", partition_index: null });
  });

  it("selects nothing from a short otadata partition and nothing known from one record", () => {
    expect(
      select(
        otaRecord({ seq: 1 }),
        otaRecord({ seq: 2 }),
        partitions(),
        0x1000,
      ),
    ).toEqual({
      basis: "none",
      active_record: null,
      slot: null,
      partition_index: null,
      assumptions: [],
      running_partition: "unknown",
    });
    const oneRecord = {
      offset: 0xd000,
      size: 0x2000,
      records: [decodeEspOtaRecord(otaRecord({ seq: 1 }), 0)],
    };
    expect(
      selectEspBootPartition(espBootPartitions(partitions()), oneRecord),
    ).toMatchObject({
      basis: "unknown",
      partition_index: null,
      assumptions: [],
    });
    // Without an OTA app the bootloader does not need the records.
    const noOtaApps = partitions().filter(
      ({ label }) => !label?.startsWith("ota_"),
    );
    expect(
      selectEspBootPartition(espBootPartitions(noOtaApps), oneRecord),
    ).toMatchObject({ basis: "factory-fallback", partition_index: 3 });
  });

  it("selects nothing from a rejected table and treats an otadata at offset 0 as absent", () => {
    // An MD5 mismatch fails esp_partition_table_verify before any selection.
    expect(
      select(otaRecord({ seq: 1 }), erased, partitions(), 0x2000),
    ).toMatchObject({
      basis: "otadata",
    });
    expect(
      selectEspBootPartition(
        espBootPartitions(partitions()),
        {
          offset: 0xd000,
          size: 0x2000,
          records: [
            decodeEspOtaRecord(otaRecord({ seq: 1 }), 0),
            decodeEspOtaRecord(erased, 1),
          ],
        },
        true,
      ),
    ).toEqual({
      basis: "none",
      active_record: null,
      slot: null,
      partition_index: null,
      assumptions: [],
      running_partition: "unknown",
    });
    // bootloader_utility_get_selected_boot_partition takes offset 0 for no otadata.
    expect(
      selectEspBootPartition(espBootPartitions(partitions()), {
        offset: 0,
        size: 0x2000,
        records: [],
      }),
    ).toMatchObject({ basis: "no-otadata", partition_index: 3 });
  });
});

describe("ESP bootloader location", () => {
  const bootloader = espImage({
    segments: ESP32C3_BOOTLOADER_SEGMENTS,
    chipId: 0x0005,
  });
  const probe = (flashAddress: number, bytes: Uint8Array) => ({
    flashAddress,
    fileOffset: flashAddress,
    prefix: bytes.subarray(0, 32),
    available: bytes.length,
  });

  it("locates the image at its chip's ROM offset", () => {
    expect(locateEspBootloader([probe(0, bootloader)])).toMatchObject({
      location: { flashAddress: 0, fileOffset: 0, chip: { target: "esp32c3" } },
      limitations: [],
    });
  });

  it("reports an image at another chip's ROM offset instead of locating it", () => {
    const esp32 = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x0000,
    });
    expect(locateEspBootloader([probe(0, esp32)])).toEqual({
      location: undefined,
      limitations: [
        "An esp32 image is at flash 0x0, but its ROM loads the bootloader from 0x1000; the dump may not start at flash 0x0.",
      ],
      // Its chip and offset let the caller look for the origin it implies.
      misplacedImage: {
        chip: expect.objectContaining({ target: "esp32" }),
        fileOffset: 0,
      },
      esp8266: false,
    });
  });

  it("tells an unknown chip and an ESP8266 image from a misplaced origin", () => {
    const unknown = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x7777,
    });
    expect(locateEspBootloader([probe(0, unknown)])).toMatchObject({
      location: undefined,
      misplacedImage: undefined,
      esp8266: false,
    });
    expect(locateEspBootloader([probe(0, esp8266Image())])).toMatchObject({
      location: undefined,
      limitations: [],
      misplacedImage: undefined,
      esp8266: true,
    });
  });

  it("finds where a located image's segments end by their headers", async () => {
    const read = async (position: number, length: number) =>
      bootloader.subarray(position, position + length);
    const declared = ESP32C3_BOOTLOADER_SEGMENTS.reduce(
      (end, { data }) => end + 8 + data.length,
      24,
    );
    expect(await espImageSegmentsEnd(read, 0, bootloader.length)).toBe(
      declared,
    );
    // Segments that run past the file end at the file.
    expect(await espImageSegmentsEnd(read, 0, 40)).toBe(40);
  });

  it("probes only the ROM offsets the file holds after its flash offset", () => {
    expect(espBootloaderProbeOffsets(0, 0x10_0000)).toEqual([
      { flashAddress: 0, fileOffset: 0 },
      { flashAddress: 0x1000, fileOffset: 0x1000 },
      { flashAddress: 0x2000, fileOffset: 0x2000 },
    ]);
    expect(espBootloaderProbeOffsets(0x1000, 0x10_0000)).toEqual([
      { flashAddress: 0x1000, fileOffset: 0 },
      { flashAddress: 0x2000, fileOffset: 0x1000 },
    ]);
  });
});
