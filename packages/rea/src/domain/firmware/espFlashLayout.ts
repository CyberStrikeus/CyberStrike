import { offsetText } from "./espImageStructures.js";
import type { EspBootloaderLocation } from "./espFlashBootloader.js";
import {
  ESP_PARTITION_TABLE_SECTOR_BYTES,
  espBootPartitions,
  espPartitionSubtypeName,
  espPartitionTypeName,
  espPrimaryLayoutRole,
  type EspBootPartitions,
  type EspPartition,
  type EspPartitionTable,
} from "./espPartitionTable.js";
import {
  ESP_OTA_DATA_MIN_BYTES,
  ESP_OTA_DATA_SECTOR_BYTES,
  ESP_OTA_SELECT_ENTRY_BYTES,
  decodeEspOtaRecord,
  selectEspBootPartition,
  type EspBootSelection,
  type EspOtaRecord,
} from "./espOtaData.js";

/** Where the file's first byte sits in flash, and who said so. */
export interface EspFlashOrigin {
  readonly value: number;
  readonly source: "default" | "caller";
}

export type EspPartitionTableMethod = "default" | "caller" | "scan";

/** One described byte range of the dump, in flash and in the file. */
export interface EspFlashRegion {
  readonly path: string;
  readonly role: "bootloader" | "partition-table" | "partition";
  readonly flashAddress: number;
  /** Length the layout gives the region. */
  readonly length: number;
  readonly fileOffset: number;
  /** Bytes of the region the file holds, from `fileOffset`. */
  readonly available: number;
  readonly partition: EspPartition | undefined;
}

export interface EspFlashPlanInput {
  readonly fileSize: number;
  readonly origin: EspFlashOrigin;
  readonly bootloader: EspBootloaderLocation | undefined;
  readonly tableAddress: number;
  readonly tableMethod: EspPartitionTableMethod;
  readonly table: EspPartitionTable;
}

/** One otadata record within its partition, and whether the file holds it. */
export interface EspOtaRecordPlan {
  readonly index: 0 | 1;
  readonly fileOffset: number;
  readonly available: boolean;
}

/** Regions to inventory and the byte ranges the adapter must still read. */
export interface EspFlashPlan {
  readonly input: EspFlashPlanInput;
  readonly regions: readonly EspFlashRegion[];
  /** File ranges no region describes; erased flash there is described. */
  readonly gaps: readonly {
    readonly offset: number;
    readonly length: number;
  }[];
  /** The partitions the bootloader keeps from the table. */
  readonly boot: EspBootPartitions;
  /** The otadata partition the bootloader uses and its records. */
  readonly otadata:
    | {
        readonly partition: EspPartition;
        readonly records: readonly EspOtaRecordPlan[];
      }
    | undefined;
  readonly limitations: readonly string[];
}

const SAFE_LABEL = /^(?=.*[A-Za-z_])[A-Za-z0-9_][A-Za-z0-9._-]{0,15}$/u;

/** Windows reserves these device names, alone or before any extension. */
const WINDOWS_DEVICE_NAME =
  /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu;

/**
 * Partition paths use the label when it is a safe path segment with a
 * letter or underscore that is not a Windows device name and that no other
 * label repeats, ignoring case as some file systems do; else the table
 * index, which cannot collide with a label.
 */
const partitionPaths = (
  partitions: readonly EspPartition[],
): ReadonlyMap<number, string> => {
  const counts = new Map<string, number>();
  for (const { label } of partitions)
    if (label !== null) {
      const folded = label.toLowerCase();
      counts.set(folded, (counts.get(folded) ?? 0) + 1);
    }
  return new Map(
    partitions.map((part) => {
      const label = part.label;
      const named =
        label !== null &&
        SAFE_LABEL.test(label) &&
        !WINDOWS_DEVICE_NAME.test(label) &&
        counts.get(label.toLowerCase()) === 1;
      return [
        part.index,
        `partitions/${named ? label : String(part.index)}.bin`,
      ];
    }),
  );
};

const region = (
  input: EspFlashPlanInput,
  fields: Omit<EspFlashRegion, "fileOffset" | "available">,
): EspFlashRegion => {
  const fileOffset = fields.flashAddress - input.origin.value;
  const start = Math.max(0, fileOffset);
  const end = Math.min(input.fileSize, fileOffset + fields.length);
  return { ...fields, fileOffset, available: Math.max(0, end - start) };
};

const rangeText = (address: number, length: number): string =>
  `${offsetText(address)}-${offsetText(address + length)}`;

const partitionName = (part: EspPartition): string =>
  part.label ?? `#${String(part.index)}`;

/** The records the otadata partition holds, each where the file holds it. */
const otadataPlan = (
  input: EspFlashPlanInput,
  partition: EspPartition,
  limitations: string[],
): NonNullable<EspFlashPlan["otadata"]> => {
  const name = partitionName(partition);
  const small = partition.size < ESP_OTA_DATA_MIN_BYTES;
  if (small)
    limitations.push(
      `The otadata partition ${name} is ${offsetText(partition.size)} bytes, smaller than the two 4 KiB sectors ESP-IDF's bootloader reads; the bootloader resets without selecting an app.`,
    );
  const records: EspOtaRecordPlan[] = [];
  for (const index of [0, 1] as const) {
    const within = index * ESP_OTA_DATA_SECTOR_BYTES;
    // A record past the declared size belongs to whatever follows.
    if (within + ESP_OTA_SELECT_ENTRY_BYTES > partition.size) continue;
    const fileOffset = partition.offset + within - input.origin.value;
    const available =
      fileOffset >= 0 &&
      fileOffset + ESP_OTA_SELECT_ENTRY_BYTES <= input.fileSize;
    if (!available)
      limitations.push(
        `otadata record ${String(index)} of partition ${name} at flash ${offsetText(partition.offset + within)} is outside the dump${small ? "." : "; the OTA selection is unknown."}`,
      );
    records.push({ index, fileOffset, available });
  }
  return { partition, records };
};

/** Lay the bootloader, table and partitions over the dump. */
export const planEspFlashLayout = (input: EspFlashPlanInput): EspFlashPlan => {
  const limitations: string[] = [...input.table.limitations];
  const regions: EspFlashRegion[] = [];
  const tableEnd = input.tableAddress + ESP_PARTITION_TABLE_SECTOR_BYTES;
  const { bootloader } = input;
  if (bootloader !== undefined) {
    if (bootloader.flashAddress < input.tableAddress)
      regions.push(
        region(input, {
          path: "bootloader.bin",
          role: "bootloader",
          // ESP_BOOTLOADER_SIZE: from the bootloader to the partition table.
          flashAddress: bootloader.flashAddress,
          length: input.tableAddress - bootloader.flashAddress,
          partition: undefined,
        }),
      );
    else
      limitations.push(
        `The partition table at ${offsetText(input.tableAddress)} does not follow the bootloader at ${offsetText(bootloader.flashAddress)}; the bootloader region is not described.`,
      );
  }
  regions.push(
    region(input, {
      path: "partition-table.bin",
      role: "partition-table",
      flashAddress: input.tableAddress,
      length: ESP_PARTITION_TABLE_SECTOR_BYTES,
      partition: undefined,
    }),
  );
  const paths = partitionPaths(input.table.partitions);
  for (const part of input.table.partitions) {
    const placed = region(input, {
      path: paths.get(part.index) ?? `partitions/${String(part.index)}.bin`,
      role: "partition",
      flashAddress: part.offset,
      length: part.size,
      partition: part,
    });
    const name = partitionName(part);
    if (part.offset < tableEnd && espPrimaryLayoutRole(part) === undefined)
      limitations.push(
        `Partition ${name} at ${offsetText(part.offset)} starts before the end of the partition table at ${offsetText(tableEnd)}; gen_esp32part.py rejects such a table.`,
      );
    if (placed.fileOffset < 0)
      limitations.push(
        `Partition ${name} at ${offsetText(part.offset)} begins before the dump's first byte at flash ${offsetText(input.origin.value)}; it is not read.`,
      );
    else if (placed.available === 0)
      limitations.push(
        `Partition ${name} at ${rangeText(part.offset, part.size)} lies outside the dump, which ends at flash ${offsetText(input.origin.value + input.fileSize)}.`,
      );
    else if (placed.available < part.size)
      limitations.push(
        `Partition ${name} at ${rangeText(part.offset, part.size)} is truncated: the dump holds ${String(placed.available)} of its ${String(part.size)} bytes.`,
      );
    // Every partition from the dump's first byte on is an entry holding the
    // bytes the file has, none when it lies past the end, so comparison sees
    // what the file lacks instead of a missing path.
    if (placed.fileOffset >= 0) regions.push(placed);
  }
  limitations.push(...overlaps(regions));
  const boot = espBootPartitions(input.table.partitions);
  limitations.push(...boot.limitations);
  return {
    input,
    regions,
    gaps: gapsBetween(regions, input.fileSize),
    boot,
    otadata:
      boot.otadata === undefined
        ? undefined
        : otadataPlan(input, boot.otadata, limitations),
    limitations,
  };
};

const regionEnd = ({ flashAddress, length }: EspFlashRegion): number =>
  flashAddress + length;

/** A primary bootloader or table entry declared over exactly its region. */
const declaresRegion = (
  first: EspFlashRegion,
  second: EspFlashRegion,
): boolean => {
  const [region, entry] =
    first.partition === undefined ? [first, second] : [second, first];
  return (
    region.partition === undefined &&
    entry.partition !== undefined &&
    espPrimaryLayoutRole(entry.partition) === region.role &&
    region.flashAddress === entry.flashAddress &&
    region.length === entry.length
  );
};

/** Regions that share bytes, which gen_esp32part.py rejects for partitions. */
const overlaps = (regions: readonly EspFlashRegion[]): string[] => {
  const ordered = [...regions].sort(
    (left, right) => left.flashAddress - right.flashAddress,
  );
  const found: string[] = [];
  // The region reaching furthest so far, so a long one shows every overlap.
  let furthest: EspFlashRegion | undefined;
  for (const current of ordered) {
    if (
      furthest !== undefined &&
      current.flashAddress < regionEnd(furthest) &&
      !declaresRegion(furthest, current)
    )
      found.push(
        `${current.path} at ${offsetText(current.flashAddress)} overlaps ${furthest.path}, which ends at ${offsetText(regionEnd(furthest))}.`,
      );
    if (furthest === undefined || regionEnd(current) > regionEnd(furthest))
      furthest = current;
  }
  return found;
};

/** File ranges outside every region, in order. */
const gapsBetween = (
  regions: readonly EspFlashRegion[],
  fileSize: number,
): { offset: number; length: number }[] => {
  const covered = regions
    .map(({ fileOffset, available }) => ({
      start: Math.max(0, fileOffset),
      end: Math.max(0, fileOffset) + available,
    }))
    .filter(({ end, start }) => end > start)
    .sort((left, right) => left.start - right.start);
  const gaps: { offset: number; length: number }[] = [];
  let cursor = 0;
  for (const { start, end } of covered) {
    if (start > cursor) gaps.push({ offset: cursor, length: start - cursor });
    cursor = Math.max(cursor, end);
  }
  if (fileSize > cursor)
    gaps.push({ offset: cursor, length: fileSize - cursor });
  return gaps;
};

export interface EspFlashOtaFacts {
  readonly partition_index: number;
  /** The records the dump holds, each with its index. */
  readonly records: readonly EspOtaRecord[];
}

/** Facts the adapter read for the plan: the otadata records and the gaps. */
export interface EspFlashReads {
  /** The bytes of each planned otadata record the file holds, in plan order. */
  readonly otadataRecords: readonly (Uint8Array | undefined)[];
  /** The first non-erased file offset in each gap, in plan order. */
  readonly gapFirstUnerased: readonly (number | undefined)[];
}

export interface EspFlashLayoutFacts {
  readonly otadata: EspFlashOtaFacts | null;
  /** Derived for every table, with or without otadata; see its basis. */
  readonly boot_selection: EspBootSelection;
  readonly undescribed: readonly { offset: number; length: number }[];
  readonly coverage: "complete" | "unknown";
  readonly limitations: readonly string[];
}

/** Complete the plan with the bytes the adapter read. */
export const finishEspFlashLayout = (
  plan: EspFlashPlan,
  reads: EspFlashReads,
): EspFlashLayoutFacts => {
  const limitations = [...plan.limitations];
  const undescribed: { offset: number; length: number }[] = [];
  plan.gaps.forEach((gap, index) => {
    const first = reads.gapFirstUnerased[index];
    if (first !== undefined)
      undescribed.push({
        offset: first,
        length: gap.offset + gap.length - first,
      });
  });
  const total = undescribed.reduce((sum, { length }) => sum + length, 0);
  if (undescribed.length > 0)
    limitations.push(
      `${String(undescribed.length)} range(s) of the dump, ${String(total)} bytes in all, lie outside the bootloader region, the partition table and every partition and are not described; each runs from a byte that is not erased flash to the end of its gap.`,
    );
  const otadata =
    plan.otadata === undefined
      ? null
      : otaFacts(plan.otadata, reads.otadataRecords);
  // Every partition from the dump's first byte on has an entry holding the
  // bytes the file has; only one that begins before it has none.
  const unplaced = plan.input.table.partitions.some(
    (part) => !plan.regions.some(({ partition }) => partition === part),
  );
  return {
    otadata,
    boot_selection: selectEspBootPartition(
      plan.boot,
      plan.otadata === undefined || otadata === null
        ? undefined
        : {
            offset: plan.otadata.partition.offset,
            size: plan.otadata.partition.size,
            records: otadata.records,
          },
      plan.input.table.md5.status === "invalid",
    ),
    undescribed,
    coverage:
      undescribed.length > 0 || plan.input.bootloader === undefined || unplaced
        ? "unknown"
        : "complete",
    limitations,
  };
};

const otaFacts = (
  otadata: NonNullable<EspFlashPlan["otadata"]>,
  bytes: readonly (Uint8Array | undefined)[],
): EspFlashOtaFacts => ({
  partition_index: otadata.partition.index,
  records: otadata.records.flatMap(({ index, available }, position) => {
    const read = bytes[position];
    return available &&
      read !== undefined &&
      read.length >= ESP_OTA_SELECT_ENTRY_BYTES
      ? [decodeEspOtaRecord(read, index)]
      : [];
  }),
});

/**
 * Where the bytes of a partition the dump holds are not erased flash,
 * relative to the partition's start: one range from the first such byte to
 * just past the last, and how many such bytes there are.
 */
export interface EspFlashWrittenExtent {
  /** The first byte that is not 0xFF, or null when every byte is. */
  readonly offset: number | null;
  /** Just past the last byte that is not 0xFF, or null. */
  readonly end: number | null;
  /** How many of the bytes are not 0xFF. */
  readonly bytes: number;
}

/**
 * Flat entry metadata for one partition: what the table declares, and where
 * the bytes the dump holds are written. `written` is undefined for a
 * partition the dump holds none of.
 */
export const espFlashPartitionFacts = (
  part: EspPartition,
  written?: EspFlashWrittenExtent,
) => ({
  kind: "esp-flash-partition" as const,
  index: part.index,
  label: part.label,
  label_hex: part.labelHex,
  type: part.type,
  subtype: part.subtype,
  type_name: espPartitionTypeName(part.type),
  subtype_name: espPartitionSubtypeName(part.type, part.subtype),
  flash_address: part.offset,
  size: part.size,
  encrypted: part.encrypted,
  readonly: part.readonly,
  unknown_flags: part.unknownFlags,
  written_offset: written?.offset ?? null,
  written_end: written?.end ?? null,
  written_bytes: written?.bytes ?? null,
});

/**
 * An app slot whose header bytes are erased holds no image for the
 * bootloader, which then treats the slot as empty; bytes written later in
 * it, such as an older image, are reported but not read as an image.
 */
export const espErasedSlotLimitation = (
  path: string,
  written: EspFlashWrittenExtent,
): string | undefined =>
  written.offset === null || written.end === null
    ? undefined
    : `${path} begins with erased flash, so ESP-IDF's bootloader finds no app in it, but ${String(written.bytes)} of its bytes from offset ${offsetText(written.offset)} to ${offsetText(written.end)} are not erased flash; they are not read as an image.`;
