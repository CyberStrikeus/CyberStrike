/**
 * UF2 family IDs that REA names, copied from Microsoft's registry
 * `utils/uf2families.json` at microsoft/uf2
 * `cf3bd7f9c274b949528f8cd6a19eef2502a687d2` (2026-01-26, MIT licence; file
 * SHA-256 `9d8f561e050507c5909063005cd6f5b157e6fe6db1e8d25b5d9027d57064c194`).
 *
 * The subset covers the families named by REA's embedded work. The Espressif
 * IDs equal esptool v4.12.0 and v5.6.0 `UF2_FAMILY_ID` values. Any other ID is
 * reported by value only; a missing name never means an unknown family is
 * invalid.
 */
/** The registry revision the names below come from, recorded with each inventory. */
export const UF2_FAMILY_REGISTRY =
  "microsoft/uf2 cf3bd7f9 utils/uf2families.json";

const UF2_FAMILY_NAMES: ReadonlyMap<number, string> = new Map([
  [0x1c5f_21b0, "ESP32"],
  [0xbfdd_4eee, "ESP32S2"],
  [0xc47e_5767, "ESP32S3"],
  [0x3101_f7c1, "ESP32S31"],
  [0x2b88_d29c, "ESP32C2"],
  [0xd42b_a06c, "ESP32C3"],
  [0xf71c_0343, "ESP32C5"],
  [0x540d_df62, "ESP32C6"],
  [0x77d8_50c4, "ESP32C61"],
  [0x3327_26f6, "ESP32H2"],
  [0xb6dd_00af, "ESP32H21"],
  [0x9e0b_aa8a, "ESP32H4"],
  [0x3d30_8e94, "ESP32P4"],
  [0x7eab_61ed, "ESP8266"],
  [0xe48b_ff56, "RP2040"],
  [0xe48b_ff57, "RP2XXX_ABSOLUTE"],
  [0xe48b_ff58, "RP2XXX_DATA"],
  [0xe48b_ff59, "RP2350_ARM_S"],
  [0xe48b_ff5a, "RP2350_RISCV"],
  [0xe48b_ff5b, "RP2350_ARM_NS"],
  [0x5775_5a57, "STM32F4"],
  [0xada5_2840, "NRF52840"],
  [0x68ed_2b88, "SAMD21"],
  [0x5511_4460, "SAMD51"],
  [0x9fff_d543, "RTL8710A"],
  [0x22e0_d6fc, "RTL8710B"],
  [0xe08f_7564, "RTL8720C"],
  [0x3379_cfe2, "RTL8720D"],
  [0x675a_40b0, "BK7231U"],
  [0x7b3e_f230, "BK7231N"],
  [0x6a82_cc42, "BK7251"],
  [0xde12_70b7, "BL602"],
]);

/** The registry short name for a family ID, or null when REA does not name it. */
export const uf2FamilyName = (familyId: number): string | null =>
  UF2_FAMILY_NAMES.get(familyId) ?? null;
