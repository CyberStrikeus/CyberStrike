import { describe, expect, it } from "vitest";

import { espChipForId } from "./espChips.js";
import {
  espFlashPartitionFacts,
  finishEspFlashLayout,
  planEspFlashLayout,
  type EspFlashPlanInput,
} from "./espFlashLayout.js";
import {
  decodeEspPartitionTable,
  type EspPartitionTable,
} from "./espPartitionTable.js";
import {
  TWO_OTA_PARTITIONS,
  otaRecord,
  partitionTable,
  type EspPartitionFixture,
} from "./espFlash.fixture.js";

const table = (parts: readonly EspPartitionFixture[]): EspPartitionTable => {
  const decoded = decodeEspPartitionTable(partitionTable(parts));
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.value;
};

const c3 = espChipForId(0x0005)!;

const input = (fields: Partial<EspFlashPlanInput> = {}): EspFlashPlanInput => ({
  fileSize: 0x4_0000,
  origin: { value: 0, source: "default" },
  bootloader: { flashAddress: 0, fileOffset: 0, chip: c3 },
  tableAddress: 0x8000,
  tableMethod: "default",
  table: table(TWO_OTA_PARTITIONS),
  ...fields,
});

const erasedGaps = (count: number) =>
  Array.from({ length: count }, () => undefined);

describe("ESP flash layout plans", () => {
  it("describes the bootloader region, the table sector and every partition", () => {
    const plan = planEspFlashLayout(input());
    expect(
      plan.regions.map(({ path, flashAddress, length, available }) => [
        path,
        flashAddress,
        length,
        available,
      ]),
    ).toEqual([
      ["bootloader.bin", 0, 0x8000, 0x8000],
      ["partition-table.bin", 0x8000, 0x1000, 0x1000],
      ["partitions/nvs.bin", 0x9000, 0x4000, 0x4000],
      ["partitions/otadata.bin", 0xd000, 0x2000, 0x2000],
      ["partitions/phy_init.bin", 0xf000, 0x1000, 0x1000],
      ["partitions/factory.bin", 0x1_0000, 0x1_0000, 0x1_0000],
      ["partitions/ota_0.bin", 0x2_0000, 0x1_0000, 0x1_0000],
      ["partitions/ota_1.bin", 0x3_0000, 0x1_0000, 0x1_0000],
    ]);
    expect(plan.gaps).toEqual([]);
    expect(plan.otadata?.records).toEqual([
      { index: 0, fileOffset: 0xd000, available: true },
      { index: 1, fileOffset: 0xe000, available: true },
    ]);
    expect(plan.limitations).toEqual([]);
  });

  it("falls back to the index for unsafe or repeated labels", () => {
    const parts: EspPartitionFixture[] = [
      { label: "../x", type: 1, subtype: 2, offset: 0x9000, size: 0x1000 },
      { label: "dup", type: 1, subtype: 2, offset: 0xa000, size: 0x1000 },
      { label: "dup", type: 1, subtype: 2, offset: 0xb000, size: 0x1000 },
      { label: "7", type: 1, subtype: 2, offset: 0xc000, size: 0x1000 },
      // Case-insensitive file systems would extract these to one file.
      { label: "Data", type: 1, subtype: 2, offset: 0xd000, size: 0x1000 },
      { label: "data", type: 1, subtype: 2, offset: 0xe000, size: 0x1000 },
    ];
    expect(
      planEspFlashLayout(input({ table: table(parts) }))
        .regions.map(({ path }) => path)
        .slice(2),
    ).toEqual([
      "partitions/0.bin",
      "partitions/1.bin",
      "partitions/2.bin",
      "partitions/3.bin",
      "partitions/4.bin",
      "partitions/5.bin",
    ]);
  });

  it("accepts the primary bootloader and table entries ESP-IDF 5.3 declares", () => {
    const plan = planEspFlashLayout(
      input({
        table: table([
          {
            label: "PrimaryBTLDR",
            type: 2,
            subtype: 0,
            offset: 0,
            size: 0x8000,
          },
          {
            label: "PrimaryPrtTable",
            type: 3,
            subtype: 0,
            offset: 0x8000,
            size: 0x1000,
          },
          ...TWO_OTA_PARTITIONS,
        ]),
      }),
    );
    expect(plan.limitations).toEqual([]);
    expect(plan.regions.map(({ path }) => path).slice(0, 4)).toEqual([
      "bootloader.bin",
      "partition-table.bin",
      "partitions/PrimaryBTLDR.bin",
      "partitions/PrimaryPrtTable.bin",
    ]);
  });

  it("keeps a usable partition beside truncated, missing and early ones", () => {
    const plan = planEspFlashLayout(
      input({
        fileSize: 0x3_8000,
        origin: { value: 0x1000, source: "caller" },
        bootloader: undefined,
        table: table([
          { label: "early", type: 1, subtype: 2, offset: 0x0, size: 0x1000 },
          {
            label: "app",
            type: 0,
            subtype: 0,
            offset: 0x1_0000,
            size: 0x1_0000,
          },
          {
            label: "cut",
            type: 0,
            subtype: 0x10,
            offset: 0x3_0000,
            size: 0x1_0000,
          },
          {
            label: "gone",
            type: 1,
            subtype: 0x82,
            offset: 0x10_0000,
            size: 0x1000,
          },
        ]),
      }),
    );
    expect(
      plan.regions.map(({ path, fileOffset, available }) => [
        path,
        fileOffset,
        available,
      ]),
    ).toEqual([
      ["partition-table.bin", 0x7000, 0x1000],
      ["partitions/app.bin", 0xf000, 0x1_0000],
      ["partitions/cut.bin", 0x2_f000, 0x9000],
      // Past the end of the file: an entry holding none of its bytes.
      ["partitions/gone.bin", 0xf_f000, 0],
    ]);
    expect(plan.limitations).toEqual([
      "Partition early at 0x0 starts before the end of the partition table at 0x9000; gen_esp32part.py rejects such a table.",
      "Partition early at 0x0 begins before the dump's first byte at flash 0x1000; it is not read.",
      "Partition cut at 0x30000-0x40000 is truncated: the dump holds 36864 of its 65536 bytes.",
      "Partition gone at 0x100000-0x101000 lies outside the dump, which ends at flash 0x39000.",
    ]);
  });

  it("reports every region inside a longer one", () => {
    const plan = planEspFlashLayout(
      input({
        table: table([
          { label: "a", type: 1, subtype: 2, offset: 0x9000, size: 0x8000 },
          { label: "b", type: 1, subtype: 2, offset: 0xa000, size: 0x1000 },
          { label: "c", type: 1, subtype: 2, offset: 0xc000, size: 0x1000 },
        ]),
      }),
    );
    expect(plan.limitations).toEqual([
      "partitions/b.bin at 0xa000 overlaps partitions/a.bin, which ends at 0x11000.",
      "partitions/c.bin at 0xc000 overlaps partitions/a.bin, which ends at 0x11000.",
    ]);
  });
});

describe("ESP flash layout partition paths", () => {
  it("falls back to the index for Windows device names and keeps the label", () => {
    const labels = [
      "NUL",
      "con",
      "Com1",
      "lpt9",
      "aux.cfg",
      "prn.",
      // Names that only begin like a device name stay names.
      "console",
      "com10",
      "nul_data",
    ];
    const parts = labels.map((label, index): EspPartitionFixture => ({
      label,
      type: 1,
      subtype: 2,
      offset: 0x9000 + index * 0x1000,
      size: 0x1000,
    }));
    const regions = planEspFlashLayout(
      input({ table: table(parts) }),
    ).regions.slice(2);
    expect(regions.map(({ path }) => path)).toEqual([
      "partitions/0.bin",
      "partitions/1.bin",
      "partitions/2.bin",
      "partitions/3.bin",
      "partitions/4.bin",
      "partitions/5.bin",
      "partitions/console.bin",
      "partitions/com10.bin",
      "partitions/nul_data.bin",
    ]);
    expect(regions.map(({ partition }) => partition?.label)).toEqual(labels);
  });
});

describe("ESP flash layout coverage", () => {
  it("keeps coverage complete for partitions the end of the file cuts short or leaves out", () => {
    const cut = planEspFlashLayout(input({ fileSize: 0x2_8000 }));
    const reads = (plan: typeof cut) => ({
      otadataRecords: [],
      gapFirstUnerased: erasedGaps(plan.gaps.length),
    });
    // ota_0 is cut short and ota_1 lies past the end; both are entries.
    expect(
      cut.regions.slice(-2).map(({ path, available }) => [path, available]),
    ).toEqual([
      ["partitions/ota_0.bin", 0x8000],
      ["partitions/ota_1.bin", 0],
    ]);
    expect(finishEspFlashLayout(cut, reads(cut)).coverage).toBe("complete");
    // A partition before the dump's first byte has no entry, so coverage is
    // unknown even with the bootloader located.
    const later = planEspFlashLayout(
      input({
        fileSize: 0x3_f000,
        origin: { value: 0x1000, source: "caller" },
        bootloader: {
          flashAddress: 0x1000,
          fileOffset: 0,
          chip: espChipForId(0x0000)!,
        },
        table: table([
          { label: "early", type: 1, subtype: 2, offset: 0x0, size: 0x1000 },
          ...TWO_OTA_PARTITIONS,
        ]),
      }),
    );
    expect(finishEspFlashLayout(later, reads(later)).coverage).toBe("unknown");
  });
});

describe("ESP flash layout otadata", () => {
  const [, otadata] = TWO_OTA_PARTITIONS;

  it("reads the otadata partition the bootloader uses: the last declared", () => {
    const plan = planEspFlashLayout(
      input({
        table: table([
          ...TWO_OTA_PARTITIONS,
          { ...otadata!, label: "otadata2", offset: 0x3_0000 + 0x1_0000 },
        ]),
        fileSize: 0x5_0000,
      }),
    );
    expect(plan.otadata?.partition.label).toBe("otadata2");
    expect(plan.otadata?.records.map(({ fileOffset }) => fileOffset)).toEqual([
      0x4_0000, 0x4_1000,
    ]);
    expect(plan.limitations).toContain(
      "The table declares otadata 2 times (partitions #1, #6); ESP-IDF's bootloader uses the last.",
    );
  });

  it("does not read a record past a short otadata partition and selects none", () => {
    const short = TWO_OTA_PARTITIONS.map((part) =>
      part.label === "otadata" ? { ...part, size: 0x1000 } : part,
    );
    const plan = planEspFlashLayout(input({ table: table(short) }));
    expect(plan.otadata?.records).toEqual([
      { index: 0, fileOffset: 0xd000, available: true },
    ]);
    expect(plan.limitations).toContain(
      "The otadata partition otadata is 0x1000 bytes, smaller than the two 4 KiB sectors ESP-IDF's bootloader reads; the bootloader resets without selecting an app.",
    );
    const facts = finishEspFlashLayout(plan, {
      otadataRecords: [otaRecord({ seq: 1 })],
      gapFirstUnerased: erasedGaps(plan.gaps.length),
    });
    expect(facts.otadata).toMatchObject({
      records: [{ index: 0, ota_seq: 1 }],
    });
    expect(facts.boot_selection).toMatchObject({
      basis: "none",
      partition_index: null,
    });
  });

  it("selects nothing from a table whose MD5 the bootloader rejects", () => {
    const decoded = decodeEspPartitionTable(
      partitionTable(TWO_OTA_PARTITIONS, { md5: "corrupt" }),
    );
    if (!decoded.ok) throw new Error(decoded.error);
    const plan = planEspFlashLayout(input({ table: decoded.value }));
    const facts = finishEspFlashLayout(plan, {
      otadataRecords: [otaRecord({ seq: 1 }), Buffer.alloc(32, 0xff)],
      gapFirstUnerased: erasedGaps(plan.gaps.length),
    });
    expect(facts.boot_selection).toMatchObject({
      basis: "none",
      partition_index: null,
      assumptions: [],
    });
    expect(facts.limitations).toContain(
      "The partition table MD5 at 0xc0 does not match the entries before it; ESP-IDF's bootloader rejects the table.",
    );
  });

  it("keeps the record a dump holds when it ends between the two", () => {
    const plan = planEspFlashLayout(input({ fileSize: 0xe000 }));
    expect(plan.otadata?.records).toEqual([
      { index: 0, fileOffset: 0xd000, available: true },
      { index: 1, fileOffset: 0xe000, available: false },
    ]);
    expect(plan.limitations).toContain(
      "otadata record 1 of partition otadata at flash 0xe000 is outside the dump; the OTA selection is unknown.",
    );
    const facts = finishEspFlashLayout(plan, {
      otadataRecords: [otaRecord({ seq: 3 }), undefined],
      gapFirstUnerased: erasedGaps(plan.gaps.length),
    });
    expect(facts.otadata).toEqual({
      partition_index: 1,
      records: [expect.objectContaining({ index: 0, ota_seq: 3, valid: true })],
    });
    expect(facts.boot_selection).toMatchObject({
      basis: "unknown",
      running_partition: "unknown",
    });
  });
});

describe("ESP flash layout facts", () => {
  it("describes erased gaps and reports the rest as undescribed", () => {
    const plan = planEspFlashLayout(
      input({
        table: table(TWO_OTA_PARTITIONS.slice(0, 3)),
        fileSize: 0x2_0000,
      }),
    );
    expect(plan.gaps).toEqual([{ offset: 0x1_0000, length: 0x1_0000 }]);
    const erased = finishEspFlashLayout(plan, {
      otadataRecords: [],
      gapFirstUnerased: [undefined],
    });
    expect(erased).toMatchObject({ coverage: "complete", undescribed: [] });
    const written = finishEspFlashLayout(plan, {
      otadataRecords: [],
      gapFirstUnerased: [0x1_8000],
    });
    expect(written.undescribed).toEqual([{ offset: 0x1_8000, length: 0x8000 }]);
    expect(written.coverage).toBe("unknown");
    expect(written.limitations.at(-1)).toBe(
      "1 range(s) of the dump, 32768 bytes in all, lie outside the bootloader region, the partition table and every partition and are not described; each runs from a byte that is not erased flash to the end of its gap.",
    );
  });

  it("derives the selected app from the otadata records and leaves the running one unknown", () => {
    const plan = planEspFlashLayout(input());
    const facts = finishEspFlashLayout(plan, {
      otadataRecords: [otaRecord({ seq: 2 }), Buffer.alloc(32, 0xff)],
      gapFirstUnerased: [],
    });
    expect(facts.otadata).toMatchObject({
      partition_index: 1,
      records: [{ ota_seq: 2, valid: true }, { valid: false }],
    });
    expect(facts.boot_selection).toMatchObject({
      basis: "otadata",
      active_record: 0,
      slot: 1,
      partition_index: 5,
      running_partition: "unknown",
    });
    expect(facts.coverage).toBe("complete");
    // A factory-only table selects its factory app without otadata.
    const withoutOtadata = planEspFlashLayout(
      input({
        table: table(
          TWO_OTA_PARTITIONS.filter(({ label }) =>
            ["nvs", "phy_init", "factory"].includes(label),
          ),
        ),
      }),
    );
    expect(
      finishEspFlashLayout(withoutOtadata, {
        otadataRecords: [],
        gapFirstUnerased: erasedGaps(withoutOtadata.gaps.length),
      }),
    ).toMatchObject({
      otadata: null,
      boot_selection: { basis: "no-otadata", partition_index: 2 },
    });
  });

  it("projects a partition's declaration with ESP-IDF names and where it is written", () => {
    const [nvs] = table(TWO_OTA_PARTITIONS).partitions;
    // A partition the dump holds none of has no observed bytes.
    expect(espFlashPartitionFacts(nvs!)).toEqual({
      kind: "esp-flash-partition",
      index: 0,
      label: "nvs",
      label_hex: null,
      type: 1,
      subtype: 2,
      type_name: "data",
      subtype_name: "nvs",
      flash_address: 0x9000,
      size: 0x4000,
      encrypted: false,
      readonly: false,
      unknown_flags: 0,
      written_offset: null,
      written_end: null,
      written_bytes: null,
    });
    expect(
      espFlashPartitionFacts(nvs!, { offset: 0x40, end: 0x1000, bytes: 9 }),
    ).toMatchObject({
      written_offset: 0x40,
      written_end: 0x1000,
      written_bytes: 9,
    });
    expect(
      espFlashPartitionFacts(nvs!, { offset: null, end: null, bytes: 0 }),
    ).toMatchObject({
      written_offset: null,
      written_end: null,
      written_bytes: 0,
    });
  });
});
