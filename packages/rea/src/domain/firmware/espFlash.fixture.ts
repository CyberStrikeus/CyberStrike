import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

/** One `esp_partition_info_t` as `gen_esp32part.py` writes it. */
export interface EspPartitionFixture {
  readonly label: string;
  readonly type: number;
  readonly subtype: number;
  readonly offset: number;
  readonly size: number;
  readonly flags?: number;
}

export const partitionEntry = (part: EspPartitionFixture): Buffer => {
  const entry = Buffer.alloc(32);
  entry.writeUInt16LE(0x50aa, 0);
  entry.writeUInt8(part.type, 2);
  entry.writeUInt8(part.subtype, 3);
  entry.writeUInt32LE(part.offset, 4);
  entry.writeUInt32LE(part.size, 8);
  entry.write(part.label, 12, 16, "utf8");
  entry.writeUInt32LE(part.flags ?? 0, 28);
  return entry;
};

/** The entries, an MD5 entry unless omitted, the terminator and 0xFF fill. */
export const partitionTable = (
  parts: readonly EspPartitionFixture[],
  { md5 = "valid" }: { readonly md5?: "valid" | "corrupt" | "absent" } = {},
): Buffer => {
  const entries = Buffer.concat(parts.map(partitionEntry));
  const digest = createHash("md5").update(entries).digest();
  if (md5 === "corrupt") digest.writeUInt8(digest.readUInt8(0) ^ 0xff, 0);
  const md5Entry =
    md5 === "absent"
      ? Buffer.alloc(0)
      : Buffer.concat([
          Buffer.from([0xeb, 0xeb]),
          Buffer.alloc(14, 0xff),
          digest,
        ]);
  const table = Buffer.concat([entries, md5Entry]);
  return Buffer.concat([table, Buffer.alloc(0xc00 - table.length, 0xff)]);
};

/** The layout `idf.py` builds for two OTA apps, from `partitions_two_ota.csv`. */
export const TWO_OTA_PARTITIONS: readonly EspPartitionFixture[] = [
  { label: "nvs", type: 0x01, subtype: 0x02, offset: 0x9000, size: 0x4000 },
  { label: "otadata", type: 0x01, subtype: 0x00, offset: 0xd000, size: 0x2000 },
  {
    label: "phy_init",
    type: 0x01,
    subtype: 0x01,
    offset: 0xf000,
    size: 0x1000,
  },
  {
    label: "factory",
    type: 0x00,
    subtype: 0x00,
    offset: 0x1_0000,
    size: 0x1_0000,
  },
  {
    label: "ota_0",
    type: 0x00,
    subtype: 0x10,
    offset: 0x2_0000,
    size: 0x1_0000,
  },
  {
    label: "ota_1",
    type: 0x00,
    subtype: 0x11,
    offset: 0x3_0000,
    size: 0x1_0000,
  },
];

/** One `esp_ota_select_entry_t`; the CRC is computed unless given. */
export const otaRecord = ({
  seq,
  state = 0xffff_ffff,
  crc,
}: {
  readonly seq: number;
  readonly state?: number;
  readonly crc?: number;
}): Buffer => {
  const record = Buffer.alloc(32, 0xff);
  record.writeUInt32LE(seq >>> 0, 0);
  record.writeUInt32LE(state >>> 0, 24);
  const computed = crc32(record.subarray(0, 4), 0xffff_ffff) >>> 0;
  record.writeUInt32LE((crc ?? computed) >>> 0, 28);
  return record;
};

/** Two 4 KiB sectors with one record at the start of each; omitted is erased. */
export const otaData = (first?: Buffer, second?: Buffer): Buffer => {
  const data = Buffer.alloc(0x2000, 0xff);
  first?.copy(data, 0);
  second?.copy(data, 0x1000);
  return data;
};

/** A flash dump of `size` bytes of erased flash with the given contents. */
export const flashImage = (
  size: number,
  contents: readonly { readonly at: number; readonly bytes: Uint8Array }[],
): Buffer => {
  const image = Buffer.alloc(size, 0xff);
  for (const { at, bytes } of contents) Buffer.from(bytes).copy(image, at);
  return image;
};

/** Where a synthetic dump places each part, by flash address. */
export interface EspFlashDumpOptions {
  readonly size?: number;
  readonly bootloader?: { readonly at: number; readonly bytes: Uint8Array };
  readonly tableAt?: number;
  readonly table?: Uint8Array;
  readonly parts?: readonly {
    readonly at: number;
    readonly bytes: Uint8Array;
  }[];
}

/** A whole-flash dump: erased flash with a bootloader, a table and contents. */
export const espFlashDump = ({
  size = 0x4_0000,
  bootloader,
  tableAt = 0x8000,
  table = partitionTable(TWO_OTA_PARTITIONS),
  parts = [],
}: EspFlashDumpOptions = {}): Buffer =>
  flashImage(size, [
    ...(bootloader === undefined ? [] : [bootloader]),
    { at: tableAt, bytes: table },
    ...parts,
  ]);
