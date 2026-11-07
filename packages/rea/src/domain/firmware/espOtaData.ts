import { crc32 } from "node:zlib";

import { hex, u32 } from "./espImageStructures.js";
import type { EspBootPartitions } from "./espPartitionTable.js";

/*
 * OTA data, from ESP-IDF v6.1 `esp_flash_partitions.h`
 * (`esp_ota_select_entry_t`, `esp_ota_img_states_t`),
 * `bootloader_common_loader.c` and `bootloader_utility.c`
 * (`bootloader_utility_get_selected_boot_partition`), and `otatool.py`.
 */
/** The otadata partition holds one record at the start of each of two sectors. */
export const ESP_OTA_DATA_SECTOR_BYTES = 0x1000;
/** `read_otadata` refuses a smaller otadata partition. */
export const ESP_OTA_DATA_MIN_BYTES = 2 * ESP_OTA_DATA_SECTOR_BYTES;
export const ESP_OTA_SELECT_ENTRY_BYTES = 32;
const UNSET = 0xffff_ffff;

export type EspOtaStateName =
  | "new"
  | "pending-verify"
  | "valid"
  | "invalid"
  | "aborted"
  | "undefined";

const STATE_NAMES: Readonly<Record<number, EspOtaStateName>> = {
  0x0: "new",
  0x1: "pending-verify",
  0x2: "valid",
  0x3: "invalid",
  0x4: "aborted",
  [UNSET]: "undefined",
};

/** One `esp_ota_select_entry_t`, observed as written. */
export interface EspOtaRecord {
  readonly index: 0 | 1;
  readonly ota_seq: number;
  readonly seq_label: string;
  readonly ota_state: number;
  readonly state_name: EspOtaStateName | null;
  readonly crc: number;
  /** CRC-32 of `ota_seq`, seeded with `0xFFFFFFFF`, as the bootloader computes it. */
  readonly crc_matches: boolean;
  /** `bootloader_common_ota_select_valid`: set sequence, usable state, matching CRC. */
  readonly valid: boolean;
}

export const decodeEspOtaRecord = (
  bytes: Uint8Array,
  index: 0 | 1,
): EspOtaRecord => {
  const sequence = bytes.subarray(0, 4);
  const otaSeq = u32(bytes, 0);
  const state = u32(bytes, 24);
  const crc = u32(bytes, 28);
  const crcMatches = crc32(sequence, UNSET) >>> 0 === crc;
  return {
    index,
    ota_seq: otaSeq,
    seq_label: hex(bytes.subarray(4, 24)),
    ota_state: state,
    state_name: STATE_NAMES[state] ?? null,
    crc,
    crc_matches: crcMatches,
    valid: otaSeq !== UNSET && state !== 0x3 && state !== 0x4 && crcMatches,
  };
};

const RECORDS_ASSUMPTION =
  "Records are used as written: the bootloader may first mark a pending-verify record aborted when app rollback is enabled.";
/** What a derived selection leaves out, whatever selected it. */
const BOOT_ASSUMPTIONS = [
  "Anti-rollback, which compares the app's secure_version with eFuse, is not applied.",
  "The selected app is not checked for a loadable image; the bootloader falls back to other partitions when it fails to load or is not declared.",
  "Factory-reset and test-app GPIO holds and a wake from deep sleep, which can override the selection, are not applied.",
] as const;

/**
 * The branch of `bootloader_utility_get_selected_boot_partition` that
 * selects the app: `no-otadata` for a table without an otadata partition,
 * `none` for its INVALID_INDEX, after which the bootloader resets, and
 * `unknown` when the dump lacks a record the bootloader reads.
 */
export type EspBootSelectionBasis =
  | "otadata"
  | "factory-fallback"
  | "ota_0-fallback"
  | "no-otadata"
  | "none"
  | "unknown";

export interface EspBootSelection {
  readonly basis: EspBootSelectionBasis;
  /** The record the bootloader reads as active: the higher valid `ota_seq`. */
  readonly active_record: 0 | 1 | null;
  /** `(ota_seq - 1) % ota_app_count`, the bootloader's slot arithmetic. */
  readonly slot: number | null;
  /** The table index of the selected app; null when none is declared. */
  readonly partition_index: number | null;
  /** What the derivation leaves out; empty when nothing is selected. */
  readonly assumptions: readonly string[];
  /** Rollback, anti-rollback and load fallback decide it at boot. */
  readonly running_partition: "unknown";
}

/** `bootloader_common_ota_select_invalid`, which does not check the CRC. */
const unusable = ({ ota_seq, ota_state }: EspOtaRecord): boolean =>
  ota_seq === UNSET || ota_state === 0x3 || ota_state === 0x4;

/**
 * Derive the app partition the bootloader would select, as
 * `select_partition_number` and `bootloader_utility_get_selected_boot_partition`
 * do without app rollback or anti-rollback:
 * - a table `esp_partition_table_verify` rejects (an MD5 mismatch or a
 *   second MD5 entry): none, because loading it fails and the bootloader
 *   resets;
 * - no otadata partition, or one at offset 0: the factory index
 *   (`no-otadata`), whether or not a factory app is declared;
 * - an otadata partition smaller than two sectors: none, because
 *   `read_otadata` fails;
 * - no OTA app, or both records unusable: the factory app when one is
 *   declared, else boot index 0 (`ota_0`); without an OTA app the records
 *   do not matter;
 * - otherwise the valid record with the higher `ota_seq` (record 0 on a
 *   tie), whose slot is `(ota_seq - 1) % ota_app_count`;
 * - no valid record, as after a CRC mismatch: the factory index, whether
 *   or not a factory app is declared.
 * `unknown` when the dump lacks a record the bootloader would read.
 */
export const selectEspBootPartition = (
  boot: EspBootPartitions,
  otadata:
    | {
        readonly offset: number;
        readonly size: number;
        readonly records: readonly EspOtaRecord[];
      }
    | undefined,
  tableRejected = false,
): EspBootSelection => {
  const selection = (
    basis: EspBootSelectionBasis,
    fields: Partial<
      Pick<EspBootSelection, "active_record" | "slot" | "partition_index">
    > = {},
  ): EspBootSelection => ({
    basis,
    active_record: null,
    slot: null,
    partition_index: null,
    ...fields,
    assumptions:
      basis === "none" || basis === "unknown"
        ? []
        : basis === "no-otadata"
          ? [...BOOT_ASSUMPTIONS]
          : [RECORDS_ASSUMPTION, ...BOOT_ASSUMPTIONS],
    running_partition: "unknown",
  });
  const factoryIndex = { partition_index: boot.factory?.index ?? null };
  if (tableRejected) return selection("none");
  // The bootloader takes an otadata partition at offset 0 for none.
  if (otadata === undefined || otadata.offset === 0)
    return selection("no-otadata", factoryIndex);
  const { records, size } = otadata;
  if (size < ESP_OTA_DATA_MIN_BYTES) return selection("none");
  const factory = selection("factory-fallback", factoryIndex);
  const fallback =
    boot.factory !== undefined
      ? factory
      : selection("ota_0-fallback", {
          slot: 0,
          partition_index: boot.otaSlots.get(0)?.index ?? null,
        });
  if (boot.otaAppCount === 0) return fallback;
  if (records.length < 2) return selection("unknown");
  if (records.every(unusable)) return fallback;
  const valid = records.filter(({ valid }) => valid);
  const [first, second] = valid;
  const active =
    first !== undefined &&
    second !== undefined &&
    second.ota_seq > first.ota_seq
      ? second
      : first;
  if (active === undefined) return factory;
  const slot = ((active.ota_seq - 1) >>> 0) % boot.otaAppCount;
  return selection("otadata", {
    active_record: active.index,
    slot,
    // A gap in the OTA subtypes selects a slot with no partition.
    partition_index: boot.otaSlots.get(slot)?.index ?? null,
  });
};
