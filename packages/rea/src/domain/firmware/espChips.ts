/**
 * ESP chip identities and flash-mapped address ranges from ESP-IDF v6.1:
 * - `chip_id` values: `components/bootloader_support/include/esp_app_format.h`
 *   (`esp_chip_id_t`) and `Kconfig` (`IDF_FIRMWARE_CHIP_ID`);
 * - ISA: `Kconfig`, where each `IDF_TARGET_*` selects `IDF_TARGET_ARCH_XTENSA`
 *   or `IDF_TARGET_ARCH_RISCV`;
 * - mapped ranges: `SOC_IROM_*`, `SOC_DROM_*` and, where `soc_caps.h` sets
 *   `SOC_MMU_PER_EXT_MEM_TARGET`, `SOC_EXTRAM_*` in
 *   `components/soc/<target>/include/soc/soc.h`;
 * - page sizes: `SOC_MMU_PAGE_SIZE_8KB_SUPPORTED` in `soc_caps.h` and
 *   `components/soc/<target>/Kconfig.mmu`;
 * - bootloader flash offset: `ESP_ROM_BOOTLOADER_OFFSET_FLASH` in
 *   `components/esp_rom/<target>/esp_rom_caps.h`, which the ROM fixes;
 * - segment length limit: `SOC_SPI_MEM_SUPPORT_CACHE_32BIT_ADDR_MAP` in
 *   `soc_caps.h`, which sets `ESP_IMAGE_MAX_FLASH_ADDR_SIZE` in
 *   `components/bootloader_support/src/esp_image_format.c`.
 *
 * Every value is a derivation from the observed `chip_id`, not a fact the
 * image records.
 */
export const ESP_CHIP_TABLE_SOURCE = "ESP-IDF v6.1";

export type EspChipIsa = "xtensa" | "riscv";

/** Half-open `[low, high)` address range. */
interface EspAddressRange {
  readonly low: number;
  readonly high: number;
}

export interface EspChip {
  readonly chipId: number;
  /** ESP-IDF `IDF_TARGET` name, as `esptool --chip` also spells it. */
  readonly target: string;
  readonly isa: EspChipIsa;
  /** Where the ROM loads the second-stage bootloader from flash. */
  readonly romBootloaderOffset: number;
  /** `SOC_SPI_MEM_SUPPORT_CACHE_32BIT_ADDR_MAP`, which lifts the 16 MiB segment limit. */
  readonly cache32BitAddressMap: boolean;
  /** `should_map` ranges with fixed bounds. */
  readonly mapped: readonly EspAddressRange[];
  /**
   * Shared IROM/DROM range ending at `low + (SOC_MMU_PAGE_SIZE << 8)`. The
   * page size is the bootloader build's `CONFIG_MMU_PAGE_SIZE`, which no
   * image records, so only bounds common to every page size are known.
   */
  readonly pageSizedMapping?: {
    readonly low: number;
    readonly pageSizes: readonly number[];
  };
}

const range = (low: number, high: number): EspAddressRange => ({ low, high });

/** 8 KiB is a hardware page size esptool builds for; Kconfig selects 16-64. */
const C6_H2_PAGE_SIZES = [0x2000, 0x4000, 0x8000, 0x1_0000] as const;

const CHIPS: readonly EspChip[] = [
  {
    chipId: 0x0000,
    target: "esp32",
    isa: "xtensa",
    romBootloaderOffset: 0x1000,
    cache32BitAddressMap: false,
    mapped: [range(0x400d_0000, 0x4040_0000), range(0x3f40_0000, 0x3f80_0000)],
  },
  {
    chipId: 0x0002,
    target: "esp32s2",
    isa: "xtensa",
    romBootloaderOffset: 0x1000,
    cache32BitAddressMap: false,
    mapped: [range(0x4008_0000, 0x4080_0000), range(0x3f00_0000, 0x3ff8_0000)],
  },
  {
    chipId: 0x0005,
    target: "esp32c3",
    isa: "riscv",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: false,
    mapped: [range(0x4200_0000, 0x4280_0000), range(0x3c00_0000, 0x3c80_0000)],
  },
  {
    chipId: 0x0009,
    target: "esp32s3",
    isa: "xtensa",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: true,
    mapped: [range(0x4200_0000, 0x4400_0000), range(0x3c00_0000, 0x3e00_0000)],
  },
  {
    chipId: 0x000c,
    target: "esp32c2",
    isa: "riscv",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: false,
    mapped: [range(0x4200_0000, 0x4240_0000), range(0x3c00_0000, 0x3c40_0000)],
  },
  {
    chipId: 0x000d,
    target: "esp32c6",
    isa: "riscv",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: false,
    mapped: [],
    pageSizedMapping: { low: 0x4200_0000, pageSizes: C6_H2_PAGE_SIZES },
  },
  {
    chipId: 0x0010,
    target: "esp32h2",
    isa: "riscv",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: false,
    mapped: [],
    pageSizedMapping: { low: 0x4200_0000, pageSizes: C6_H2_PAGE_SIZES },
  },
  {
    chipId: 0x0012,
    target: "esp32p4",
    isa: "riscv",
    romBootloaderOffset: 0x2000,
    cache32BitAddressMap: true,
    mapped: [range(0x4000_0000, 0x4400_0000), range(0x4800_0000, 0x4c00_0000)],
  },
  {
    chipId: 0x0014,
    target: "esp32c61",
    isa: "riscv",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: true,
    mapped: [range(0x4200_0000, 0x4400_0000)],
  },
  {
    chipId: 0x0017,
    target: "esp32c5",
    isa: "riscv",
    romBootloaderOffset: 0x2000,
    cache32BitAddressMap: true,
    mapped: [range(0x4200_0000, 0x4400_0000)],
  },
  {
    chipId: 0x0019,
    target: "esp32h21",
    isa: "riscv",
    romBootloaderOffset: 0x0,
    cache32BitAddressMap: false,
    mapped: [range(0x4200_0000, 0x4300_0000)],
  },
  {
    chipId: 0x001c,
    target: "esp32h4",
    isa: "riscv",
    romBootloaderOffset: 0x2000,
    cache32BitAddressMap: true,
    mapped: [range(0x4200_0000, 0x4400_0000)],
  },
  {
    chipId: 0x0020,
    target: "esp32s31",
    isa: "riscv",
    romBootloaderOffset: 0x2000,
    cache32BitAddressMap: true,
    mapped: [range(0x4000_0000, 0x4400_0000), range(0x5000_0000, 0x5400_0000)],
  },
];

const BY_ID = new Map(CHIPS.map((chip) => [chip.chipId, chip]));

export const espChipForId = (chipId: number): EspChip | undefined =>
  BY_ID.get(chipId);

/** Every flash offset a ROM loads a bootloader from, lowest first. */
export const ESP_ROM_BOOTLOADER_OFFSETS: readonly number[] = [
  ...new Set(CHIPS.map(({ romBootloaderOffset }) => romBootloaderOffset)),
].sort((left, right) => left - right);

const SIXTEEN_MIB = 0x100_0000;

/**
 * The segment length ESP-IDF's `verify_segment_header` rejects at or above,
 * `ESP_IMAGE_MAX_FLASH_ADDR_SIZE`. With 32-bit cache addresses the limit is
 * `UINT32_MAX`, which the 4-byte alignment rule already excludes.
 */
export const espSegmentLengthLimit = (chip: EspChip): number | undefined =>
  chip.cache32BitAddressMap ? undefined : SIXTEEN_MIB;

/** `should_load` treats every address below this as reserved (padding, MD5). */
const RESERVED_ADDRESS_LIMIT = 0x1000_0000;

/**
 * How ESP-IDF's bootloader treats a segment on a cold boot
 * (`esp_image_format.c` `should_map` and `should_load`). `loaded` means
 * `should_load` selects the segment, not that the bootloader accepts it:
 * `verify_load_addresses` then rejects a segment outside the chip's DRAM,
 * IRAM, RTC memory or SPM, or over the bootloader's own stack, data or loader
 * code. No RAM ranges are modelled here.
 */
export type EspSegmentClassification =
  | "mapped"
  | "loaded"
  | "not-loaded"
  | "unknown";

/** Classify one load address; a mapping that depends on the page size stays unknown. */
export const classifyEspSegment = (
  chip: EspChip | undefined,
  address: number,
): EspSegmentClassification => {
  if (chip === undefined) return "unknown";
  const mapped = isMapped(chip, address);
  if (mapped === undefined) return "unknown";
  if (mapped) return "mapped";
  return address < RESERVED_ADDRESS_LIMIT ? "not-loaded" : "loaded";
};

/** Addresses whose mapping depends on the bootloader's MMU page size. */
export const espPageSizedMappingAmbiguity = (
  chip: EspChip,
): EspAddressRange | undefined => {
  const paged = chip.pageSizedMapping;
  return paged === undefined
    ? undefined
    : range(
        pageSizedHigh(paged.low, Math.min(...paged.pageSizes)),
        pageSizedHigh(paged.low, Math.max(...paged.pageSizes)),
      );
};

const isMapped = (chip: EspChip, address: number): boolean | undefined => {
  if (chip.mapped.some(({ low, high }) => address >= low && address < high))
    return true;
  const paged = chip.pageSizedMapping;
  if (paged === undefined || address < paged.low) return false;
  if (address < pageSizedHigh(paged.low, Math.min(...paged.pageSizes)))
    return true;
  return address < pageSizedHigh(paged.low, Math.max(...paged.pageSizes))
    ? undefined
    : false;
};

/** `SOC_IROM_HIGH = SOC_IROM_LOW + (SOC_MMU_PAGE_SIZE << 8)`. */
const pageSizedHigh = (low: number, pageSize: number): number =>
  low + pageSize * 256;
