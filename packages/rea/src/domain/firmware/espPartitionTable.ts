import { createHash } from "node:crypto";

import { err, ok, type Result } from "../result.js";
import {
  cString,
  cStringBytes,
  hex,
  offsetText,
  u16,
  u32,
} from "./espImageStructures.js";

/*
 * The partition table, from ESP-IDF v6.1 `esp_flash_partitions.h`,
 * `bootloader_support/src/flash_partitions.c` (`esp_partition_table_verify`,
 * which the bootloader applies) and `partition_table/gen_esp32part.py`.
 */
export const ESP_PARTITION_TABLE_DEFAULT_OFFSET = 0x8000;
/** The table occupies one flash sector (`ESP_PARTITION_TABLE_SIZE`). */
export const ESP_PARTITION_TABLE_SECTOR_BYTES = 0x1000;
/** `ESP_PARTITION_TABLE_MAX_LEN`: 96 entries, the MD5 and the terminator included. */
export const ESP_PARTITION_TABLE_MAX_BYTES = 0xc00;
const ENTRY_BYTES = 32;
const MAX_ENTRIES = ESP_PARTITION_TABLE_MAX_BYTES / ENTRY_BYTES;
const PARTITION_MAGIC = 0x50aa;
const MD5_MAGIC = 0xebeb;
const END_MAGIC = 0xffff;
const END_TYPE = 0xff;
/** `ESP_PARTITION_MD5_OFFSET`: the digest follows 16 bytes into its entry. */
const MD5_DIGEST_OFFSET = 16;
const KNOWN_FLAGS = 0b11;

/** One `esp_partition_info_t`, as the table declares it. */
export interface EspPartition {
  /** Position among the partition entries; the MD5 entry is not counted. */
  readonly index: number;
  /** Byte offset of the entry from the start of the table. */
  readonly entryOffset: number;
  readonly type: number;
  readonly subtype: number;
  /** Flash address. */
  readonly offset: number;
  readonly size: number;
  /** The label up to its first NUL, or null when it is not UTF-8. */
  readonly label: string | null;
  /** The label's bytes up to its first NUL, in hex, when it is not UTF-8. */
  readonly labelHex: string | null;
  readonly encrypted: boolean;
  readonly readonly: boolean;
  /** Flag bits other than `encrypted` and `readonly`, which ESP-IDF ignores. */
  readonly unknownFlags: number;
}

export interface EspPartitionTableMd5 {
  readonly status: "valid" | "invalid" | "absent";
  readonly entryOffset: number | null;
  readonly stored: string | null;
  readonly computed: string | null;
}

export interface EspPartitionTable {
  readonly partitions: readonly EspPartition[];
  readonly md5: EspPartitionTableMd5;
  /** Bytes through the terminating entry. */
  readonly length: number;
  readonly limitations: readonly string[];
}

const partition = (
  entry: Uint8Array,
  index: number,
  entryOffset: number,
): EspPartition => {
  const flags = u32(entry, 28);
  const labelBytes = entry.subarray(12, 28);
  const label = cString(labelBytes);
  return {
    index,
    entryOffset,
    type: entry[2] ?? 0,
    subtype: entry[3] ?? 0,
    offset: u32(entry, 4),
    size: u32(entry, 8),
    label,
    labelHex: label === null ? hex(cStringBytes(labelBytes)) : null,
    encrypted: (flags & 1) !== 0,
    readonly: (flags & 2) !== 0,
    unknownFlags: (flags & ~KNOWN_FLAGS) >>> 0,
  };
};

/**
 * Decode a table in the entry structure ESP-IDF's bootloader verifies:
 * 32-byte entries with the `0x50AA` magic, at most one `0xEBEB` MD5 entry
 * over the entries before it, and a terminator whose magic, type and subtype
 * are all `0xFF`. A structural fault means the bytes are not a table. An MD5
 * mismatch or a second MD5 entry, which the bootloader rejects, is reported
 * as an integrity fact so that the declared entries stay visible. ESP-IDF
 * accepts a table with no partition entries, but REA requires one before
 * the terminator, so that neither erased flash nor a lone MD5 entry is read
 * as a table.
 */
export const decodeEspPartitionTable = (
  bytes: Uint8Array,
): Result<EspPartitionTable, string> => {
  const partitions: EspPartition[] = [];
  const limitations: string[] = [];
  let md5: EspPartitionTableMd5 = {
    status: "absent",
    entryOffset: null,
    stored: null,
    computed: null,
  };
  for (let slot = 0; slot < MAX_ENTRIES; slot += 1) {
    const at = slot * ENTRY_BYTES;
    const entry = bytes.subarray(at, at + ENTRY_BYTES);
    if (entry.length < ENTRY_BYTES)
      return err(
        `the bytes end at ${offsetText(at + entry.length)}, inside entry ${String(slot)}`,
      );
    const magic = u16(entry, 0);
    if (magic === PARTITION_MAGIC) {
      partitions.push(partition(entry, partitions.length, at));
      continue;
    }
    if (magic === MD5_MAGIC) {
      const computed = createHash("md5")
        .update(bytes.subarray(0, at))
        .digest("hex");
      const stored = hex(entry.subarray(MD5_DIGEST_OFFSET, ENTRY_BYTES));
      if (md5.status !== "absent") {
        limitations.push(
          `The partition table has a second MD5 entry at ${offsetText(at)}; ESP-IDF allows one and rejects the table.`,
        );
        md5 = { ...md5, status: "invalid" };
        continue;
      }
      md5 = {
        status: stored === computed ? "valid" : "invalid",
        entryOffset: at,
        stored,
        computed,
      };
      if (stored !== computed)
        limitations.push(
          `The partition table MD5 at ${offsetText(at)} does not match the entries before it; ESP-IDF's bootloader rejects the table.`,
        );
      continue;
    }
    const terminator =
      magic === END_MAGIC && entry[2] === END_TYPE && entry[3] === END_TYPE;
    // An MD5 entry is not a partition: a table declares at least one.
    if (terminator && partitions.length > 0)
      return ok({ partitions, md5, length: at + ENTRY_BYTES, limitations });
    return err(
      slot === 0 && magic === END_MAGIC
        ? "the first entry is empty"
        : terminator
          ? `entry ${String(slot)} at ${offsetText(at)} ends the table before any partition entry`
          : `entry ${String(slot)} at ${offsetText(at)} has magic ${offsetText(magic)}, not a partition, MD5 or terminating entry`,
    );
  }
  return err(
    `no terminating entry within ${String(MAX_ENTRIES)} entries (${offsetText(ESP_PARTITION_TABLE_MAX_BYTES)} bytes)`,
  );
};

/** ESP-IDF's names for partition types (`gen_esp32part.py` `TYPES`). */
const TYPE_NAMES: Readonly<Record<number, string>> = {
  0x00: "app",
  0x01: "data",
  0x02: "bootloader",
  0x03: "partition_table",
};

/** ESP-IDF's subtype names per type (`gen_esp32part.py` `SUBTYPES`). */
const SUBTYPE_NAMES: Readonly<
  Record<number, Readonly<Record<number, string>>>
> = {
  0x00: {
    0x00: "factory",
    0x20: "test",
    ...Object.fromEntries(
      Array.from({ length: 16 }, (_, slot) => [
        0x10 + slot,
        `ota_${String(slot)}`,
      ]),
    ),
    0x30: "tee_0",
    0x31: "tee_1",
  },
  0x01: {
    0x00: "ota",
    0x01: "phy",
    0x02: "nvs",
    0x03: "coredump",
    0x04: "nvs_keys",
    0x05: "efuse",
    0x06: "undefined",
    0x80: "esphttpd",
    0x81: "fat",
    0x82: "spiffs",
    0x83: "littlefs",
    0x90: "tee_ota",
  },
  0x02: { 0x00: "primary", 0x01: "ota", 0x02: "recovery" },
  0x03: { 0x00: "primary", 0x01: "ota" },
};

export const espPartitionTypeName = (type: number): string | null =>
  TYPE_NAMES[type] ?? null;

export const espPartitionSubtypeName = (
  type: number,
  subtype: number,
): string | null => SUBTYPE_NAMES[type]?.[subtype] ?? null;

const APP_TYPE = 0x00;
const OTA_DATA_SUBTYPE = 0x00;
const DATA_TYPE = 0x01;
const BOOTLOADER_TYPE = 0x02;
const PARTITION_TABLE_TYPE = 0x03;
const PRIMARY_SUBTYPE = 0x00;
const OTA_APP_SUBTYPE_FLAG = 0x10;
const OTA_APP_SUBTYPE_MASK = 0x0f;

/** The OTA slot of an app partition (`ota_0` to `ota_15`), if it has one. */
export const espOtaAppSlot = (part: EspPartition): number | null =>
  part.type === APP_TYPE &&
  (part.subtype & ~OTA_APP_SUBTYPE_MASK) === OTA_APP_SUBTYPE_FLAG
    ? part.subtype & OTA_APP_SUBTYPE_MASK
    : null;

const isEspFactoryApp = (part: EspPartition): boolean =>
  part.type === APP_TYPE && part.subtype === 0x00;

const isEspOtaData = (part: EspPartition): boolean =>
  part.type === DATA_TYPE && part.subtype === OTA_DATA_SUBTYPE;

export const isEspAppPartition = (part: EspPartition): boolean =>
  part.type === APP_TYPE;

/**
 * The region a primary `bootloader` or `partition_table` entry declares.
 * ESP-IDF 5.3 and later may declare them over the bootloader region and the
 * table sector, and `gen_esp32part.py` exempts them from its rule that
 * partitions follow the table.
 */
export const espPrimaryLayoutRole = (
  part: EspPartition,
): "bootloader" | "partition-table" | undefined => {
  if (part.subtype !== PRIMARY_SUBTYPE) return undefined;
  if (part.type === BOOTLOADER_TYPE) return "bootloader";
  return part.type === PARTITION_TABLE_TYPE ? "partition-table" : undefined;
};

/** The partitions the bootloader keeps from a table, and the OTA app count. */
export interface EspBootPartitions {
  readonly factory: EspPartition | undefined;
  readonly otadata: EspPartition | undefined;
  /** Each OTA slot's partition, indexed by subtype. */
  readonly otaSlots: ReadonlyMap<number, EspPartition>;
  /** Every OTA app entry, duplicates included, as `bs->app_count` counts. */
  readonly otaAppCount: number;
  readonly limitations: readonly string[];
}

/**
 * Read the table as `bootloader_utility_load_partition_table` does: a later
 * factory, otadata or same-subtype OTA entry replaces an earlier one, and
 * every OTA app entry adds to the app count.
 */
export const espBootPartitions = (
  partitions: readonly EspPartition[],
): EspBootPartitions => {
  let factory: EspPartition | undefined;
  let otadata: EspPartition | undefined;
  let otaAppCount = 0;
  const otaSlots = new Map<number, EspPartition>();
  const roles = new Map<string, EspPartition[]>();
  for (const part of partitions) {
    const slot = espOtaAppSlot(part);
    const role = isEspFactoryApp(part)
      ? "factory"
      : isEspOtaData(part)
        ? "otadata"
        : slot === null
          ? undefined
          : `ota_${String(slot)}`;
    if (role === undefined) continue;
    roles.set(role, [...(roles.get(role) ?? []), part]);
    if (role === "factory") factory = part;
    else if (role === "otadata") otadata = part;
    else if (slot !== null) {
      otaSlots.set(slot, part);
      otaAppCount += 1;
    }
  }
  const limitations = [...roles].flatMap(([role, parts]) =>
    parts.length < 2
      ? []
      : [
          `The table declares ${role} ${String(parts.length)} times (partitions ${parts.map(({ index }) => `#${String(index)}`).join(", ")}); ESP-IDF's bootloader uses the last.`,
        ],
  );
  return { factory, otadata, otaSlots, otaAppCount, limitations };
};
