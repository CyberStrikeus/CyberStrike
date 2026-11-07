import { err, ok, type Result } from "./result.js";

/** Fixed size of a DOL header; section file data may start no earlier than this. */
export const DOL_HEADER_SIZE = 0x100;
/** Number of text (code) section slots in a DOL header. */
export const DOL_TEXT_SECTION_COUNT = 7;
/** Number of data section slots in a DOL header. */
export const DOL_DATA_SECTION_COUNT = 11;
/** Lowest load address a DOL section or BSS range may use. */
export const DOL_MEMORY_START = 0x8000_0000;
/** Exclusive end of the DOL load window (24 MiB cached RAM, GameCube and Wii MEM1). */
export const DOL_RAM_END = 0x8180_0000;

const TEXT_FILE_OFFSET_TABLE = 0x00;
const DATA_FILE_OFFSET_TABLE = 0x1c;
const TEXT_ADDRESS_TABLE = 0x48;
const DATA_ADDRESS_TABLE = 0x64;
const TEXT_SIZE_TABLE = 0x90;
const DATA_SIZE_TABLE = 0xac;
const BSS_ADDRESS_FIELD = 0xd8;
const BSS_SIZE_FIELD = 0xdc;
const ENTRY_POINT_FIELD = 0xe0;

/** One used code or data section, identified by its slot number within its kind. */
export interface DolSection {
  readonly kind: "text" | "data";
  readonly index: number;
  readonly fileOffset: number;
  readonly address: number;
  readonly size: number;
}

/** Validated DOL header: used sections in slot order, BSS, and entry point. */
export interface DolHeader {
  readonly sections: readonly DolSection[];
  readonly bss: { readonly address: number; readonly size: number };
  /** Canonical uninitialized ranges after subtracting loaded data sections. */
  readonly bssGaps: readonly DolHeader["bss"][];
  /**
   * Slot indexes of data sections whose load range BSS overlaps. Real DOLs do this
   * (.sdata/.sdata2 live inside BSS), so callers must map BSS only into the gaps
   * outside these data sections. BSS overlapping a text section is refused instead.
   */
  readonly bssOverlaps: readonly number[];
  readonly entryPoint: number;
}

interface SlotTables {
  readonly fileOffset: number;
  readonly address: number;
  readonly size: number;
}

const hex = (value: number): string => `0x${value.toString(16)}`;

const readSlots = (
  view: DataView,
  kind: DolSection["kind"],
  count: number,
  tables: SlotTables,
): DolSection[] =>
  Array.from({ length: count }, (_, index) => ({
    kind,
    index,
    fileOffset: view.getUint32(tables.fileOffset + index * 4, false),
    address: view.getUint32(tables.address + index * 4, false),
    size: view.getUint32(tables.size + index * 4, false),
  }));

const rangesOverlap = (
  startA: number,
  sizeA: number,
  startB: number,
  sizeB: number,
): boolean => startA < startB + sizeB && startB < startA + sizeA;

/**
 * Parse and validate the 256-byte DOL header; no section contents are read.
 * `bytes` may be only the leading header bytes; `fileSize` is the whole file
 * length used for section file-range bounds (defaults to `bytes.length`).
 */
export const parseDolHeader = (
  bytes: Uint8Array,
  fileSize: number = bytes.length,
): Result<DolHeader, string> => {
  if (fileSize < DOL_HEADER_SIZE)
    return err(
      `DOL header is truncated: needs ${DOL_HEADER_SIZE} bytes; the file has ${fileSize}`,
    );
  if (bytes.length < DOL_HEADER_SIZE)
    return err(
      `DOL header bytes are incomplete: needs ${DOL_HEADER_SIZE} bytes; ${bytes.length} were supplied`,
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slots = [
    ...readSlots(view, "text", DOL_TEXT_SECTION_COUNT, {
      fileOffset: TEXT_FILE_OFFSET_TABLE,
      address: TEXT_ADDRESS_TABLE,
      size: TEXT_SIZE_TABLE,
    }),
    ...readSlots(view, "data", DOL_DATA_SECTION_COUNT, {
      fileOffset: DATA_FILE_OFFSET_TABLE,
      address: DATA_ADDRESS_TABLE,
      size: DATA_SIZE_TABLE,
    }),
  ];
  // A zero-size slot is unused, so its offset and address are never checked.
  const used = slots.filter((slot) => slot.size > 0);
  const label = (slot: DolSection): string => `${slot.kind} ${slot.index}`;

  for (const slot of used) {
    const name = label(slot);
    const fileEnd = slot.fileOffset + slot.size;
    const addressEnd = slot.address + slot.size;
    if (slot.fileOffset < DOL_HEADER_SIZE)
      return err(
        `${name}: file offset ${hex(slot.fileOffset)} overlaps the ${DOL_HEADER_SIZE}-byte DOL header`,
      );
    if (fileEnd > fileSize)
      return err(
        `${name}: file range ${hex(slot.fileOffset)}..${hex(fileEnd)} exceeds the ${fileSize}-byte file`,
      );
    if (slot.address < DOL_MEMORY_START)
      return err(
        `${name}: load address ${hex(slot.address)} is below ${hex(DOL_MEMORY_START)}`,
      );
    if (addressEnd > DOL_RAM_END)
      return err(
        `${name}: load range ${hex(slot.address)}..${hex(addressEnd)} exceeds ${hex(DOL_RAM_END)}`,
      );
  }

  // Only text sections carry the 4-byte alignment rule the PowerPC core needs.
  for (const slot of used) {
    if (slot.kind !== "text") continue;
    for (const [field, value] of [
      ["file offset", slot.fileOffset],
      ["load address", slot.address],
      ["size", slot.size],
    ] as const)
      if (value % 4 !== 0)
        return err(
          `${label(slot)}: ${field} ${hex(value)} must be 4-byte aligned`,
        );
  }

  const text = used.filter((slot) => slot.kind === "text");
  if (text.length === 0) return err("DOL has no used text section");

  for (const [i, a] of used.entries()) {
    for (const b of used.slice(i + 1)) {
      if (rangesOverlap(a.address, a.size, b.address, b.size))
        return err(`${label(a)} and ${label(b)} overlap in load address range`);
      if (rangesOverlap(a.fileOffset, a.size, b.fileOffset, b.size))
        return err(`${label(a)} and ${label(b)} overlap in file range`);
    }
  }

  const entryPoint = view.getUint32(ENTRY_POINT_FIELD, false);
  if (entryPoint % 4 !== 0)
    return err(`entry point ${hex(entryPoint)} must be 4-byte aligned`);
  const inText = text.some(
    (slot) =>
      entryPoint >= slot.address && entryPoint < slot.address + slot.size,
  );
  if (!inText)
    return err(
      `entry point ${hex(entryPoint)} is outside every used text section`,
    );

  // BSS may overlap data sections (real .sdata/.sdata2 placement does), but never text.
  // Bounds are checked in plain JS numbers, so address + size cannot wrap past 2^32;
  // the RAM end check refuses anything at or above 0x81800000 first.
  const bssAddress = view.getUint32(BSS_ADDRESS_FIELD, false);
  const bssSize = view.getUint32(BSS_SIZE_FIELD, false);
  const bssOverlaps: number[] = [];
  const bssData: DolSection[] = [];
  if (bssSize > 0) {
    if (bssAddress < DOL_MEMORY_START)
      return err(
        `bss: load address ${hex(bssAddress)} is below ${hex(DOL_MEMORY_START)}`,
      );
    if (bssAddress + bssSize > DOL_RAM_END)
      return err(
        `bss: load range ${hex(bssAddress)}..${hex(bssAddress + bssSize)} exceeds ${hex(DOL_RAM_END)}`,
      );
    for (const slot of used) {
      if (!rangesOverlap(bssAddress, bssSize, slot.address, slot.size))
        continue;
      if (slot.kind === "text")
        return err(`bss and ${label(slot)} overlap in load address range`);
      bssOverlaps.push(slot.index);
      bssData.push(slot);
    }
  }

  const bssGaps: DolHeader["bss"][] = [];
  const bssEnd = bssAddress + bssSize;
  let cursor = bssAddress;
  for (const slot of bssData.sort(
    (left, right) => left.address - right.address,
  )) {
    if (cursor < slot.address)
      bssGaps.push({ address: cursor, size: slot.address - cursor });
    cursor = Math.min(bssEnd, slot.address + slot.size);
  }
  if (cursor < bssEnd) bssGaps.push({ address: cursor, size: bssEnd - cursor });

  return ok({
    sections: used.map(({ kind, index, fileOffset, address, size }) => ({
      kind,
      index,
      fileOffset,
      address,
      size,
    })),
    bss: { address: bssAddress, size: bssSize },
    bssGaps,
    bssOverlaps,
    entryPoint,
  });
};
