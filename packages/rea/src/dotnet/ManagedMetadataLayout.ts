import {
  attachManagedDecodeBudget,
  ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import {
  managedFailure,
  ManagedReaderFailure,
} from "./ManagedReaderFailure.js";
import {
  computeRowSize,
  type RowSizeContext,
} from "./ManagedMetadataRowSizes.js";

export const METADATA_TABLE_NAMES = [
  "Module",
  "TypeRef",
  "TypeDef",
  "FieldPtr",
  "Field",
  "MethodPtr",
  "MethodDef",
  "ParamPtr",
  "Param",
  "InterfaceImpl",
  "MemberRef",
  "Constant",
  "CustomAttribute",
  "FieldMarshal",
  "DeclSecurity",
  "ClassLayout",
  "FieldLayout",
  "StandAloneSig",
  "EventMap",
  "EventPtr",
  "Event",
  "PropertyMap",
  "PropertyPtr",
  "Property",
  "MethodSemantics",
  "MethodImpl",
  "ModuleRef",
  "TypeSpec",
  "ImplMap",
  "FieldRVA",
  "ENCLog",
  "ENCMap",
  "Assembly",
  "AssemblyProcessor",
  "AssemblyOS",
  "AssemblyRef",
  "AssemblyRefProcessor",
  "AssemblyRefOS",
  "File",
  "ExportedType",
  "ManifestResource",
  "NestedClass",
  "GenericParam",
  "MethodSpec",
  "GenericParamConstraint",
] as const;

interface MetadataStream {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

export interface MetadataTableLayout {
  readonly index: number;
  readonly name: string;
  readonly rowCount: number;
  readonly rowSize: number;
  readonly offset: number;
}

export interface ManagedMetadataLayout {
  readonly rootOffset: number;
  readonly size: number;
  readonly version: string;
  readonly streamNames: readonly string[];
  readonly strings: MetadataStream;
  readonly guid: MetadataStream;
  /** Empty blob heaps may omit the stream; index zero remains the empty blob. */
  readonly blob: MetadataStream | null;
  /** Optional: assemblies without `ldstr` literals may omit #US. */
  readonly userStrings: MetadataStream | null;
  readonly tables: ReadonlyMap<number, MetadataTableLayout>;
  readonly rowCounts: readonly number[];
  readonly stringIndexSize: 2 | 4;
  readonly guidIndexSize: 2 | 4;
  readonly blobIndexSize: 2 | 4;
  table(index: number): MetadataTableLayout | undefined;
  tableIndexSize(index: number): 2 | 4;
  codedIndexSize(name: CodedIndexName): 2 | 4;
}

export type CodedIndexName = keyof typeof MANAGED_CODED_INDEXES;

/** ECMA-335 coded-index tag positions, shared by width and coordinate interpretation. */
export const MANAGED_CODED_INDEXES = {
  TypeDefOrRef: { bits: 2, tables: [2, 1, 27] },
  HasConstant: { bits: 2, tables: [4, 8, 23] },
  HasCustomAttribute: {
    bits: 5,
    tables: [
      6, 4, 1, 2, 8, 9, 10, 0, 14, 23, 20, 17, 26, 27, 32, 35, 38, 39, 40, 42,
      44, 43,
    ],
  },
  HasFieldMarshal: { bits: 1, tables: [4, 8] },
  HasDeclSecurity: { bits: 2, tables: [2, 6, 32] },
  MemberRefParent: { bits: 3, tables: [2, 1, 26, 6, 27] },
  HasSemantics: { bits: 1, tables: [20, 23] },
  MethodDefOrRef: { bits: 1, tables: [6, 10] },
  MemberForwarded: { bits: 1, tables: [4, 6] },
  Implementation: { bits: 2, tables: [38, 35, 39] },
  CustomAttributeType: { bits: 3, tables: [undefined, undefined, 6, 10] },
  ResolutionScope: { bits: 2, tables: [0, 26, 35, 1] },
  TypeOrMethodDef: { bits: 1, tables: [2, 6] },
} as const;

const SUPPORTED_TABLE_MASK = (1n << BigInt(METADATA_TABLE_NAMES.length)) - 1n;

/** Check a range within `bytes`, which start at artifact file offset `base`. */
const requireRange = (
  bytes: Buffer,
  base: number,
  offset: number,
  length: number,
  scope: string,
): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length - length
  )
    throw managedFailure(
      "invalid-metadata-root",
      scope,
      `${scope} leaves the metadata byte range`,
      Number.isSafeInteger(base + offset) && offset >= 0 ? base + offset : null,
    );
};

const align4 = (value: number): number => Math.ceil(value / 4) * 4;

/** Read within the metadata root; report failures at artifact file offsets. */
const readStreamName = (
  bytes: Buffer,
  rootOffset: number,
  offset: number,
): { readonly name: string; readonly next: number } => {
  const endLimit = Math.min(bytes.length, offset + 32);
  let end = offset;
  while (end < endLimit && bytes[end] !== 0) end += 1;
  if (end === endLimit)
    throw managedFailure(
      "invalid-stream",
      "metadata.stream-name",
      "Metadata stream name is missing a bounded terminator",
      rootOffset + offset,
    );
  const nameBytes = bytes.subarray(offset, end);
  if (nameBytes.some((byte) => byte < 0x20 || byte > 0x7e))
    throw managedFailure(
      "invalid-stream",
      "metadata.stream-name",
      "Metadata stream name is not printable ASCII",
      rootOffset + offset,
    );
  return {
    name: nameBytes.toString("ascii"),
    next: align4(end + 1),
  };
};

const streamByName = (
  streams: ReadonlyMap<string, MetadataStream>,
  names: readonly string[],
): MetadataStream | undefined => {
  for (const name of names) {
    const stream = streams.get(name);
    if (stream !== undefined) return stream;
  }
  return undefined;
};

const requireStream = (
  streams: ReadonlyMap<string, MetadataStream>,
  name: string,
): MetadataStream => {
  const stream = streams.get(name);
  if (stream === undefined)
    throw managedFailure(
      "missing-stream",
      `metadata.${name}`,
      `Required metadata stream ${name} is absent`,
    );
  return stream;
};

const codedSize = (
  name: CodedIndexName,
  rowCounts: readonly number[],
): 2 | 4 => {
  const descriptor = MANAGED_CODED_INDEXES[name];
  let maximum = 0;
  for (const table of descriptor.tables) {
    if (table === undefined) continue;
    maximum = Math.max(maximum, rowCounts[table] ?? 0);
  }
  return maximum < 2 ** (16 - descriptor.bits) ? 2 : 4;
};

const tableSize = (index: number, rows: readonly number[]): 2 | 4 =>
  (rows[index] ?? 0) < 0x1_0000 ? 2 : 4;

interface ParsedStreams {
  readonly streams: ReadonlyMap<string, MetadataStream>;
  readonly version: string;
  readonly minimalDeltaOffset: number | null;
}

const readMetadataStreams = (
  bytes: Buffer,
  rootOffset: number,
  budget: ManagedDecodeBudget,
): ParsedStreams => {
  if (bytes.readUInt32LE(0) !== 0x424a_5342)
    throw managedFailure(
      "invalid-metadata-root",
      "metadata.signature",
      "CLI metadata signature is not BSJB",
      rootOffset,
    );
  const versionLength = bytes.readUInt32LE(12);
  requireRange(bytes, rootOffset, 16, versionLength, "metadata.version");
  const versionBytes = bytes.subarray(16, 16 + versionLength);
  const zero = versionBytes.indexOf(0);
  const decodedVersionLength = zero < 0 ? versionBytes.length : zero;
  budget.reserveString(decodedVersionLength, rootOffset + 16);
  const version = versionBytes
    .subarray(0, decodedVersionLength)
    .toString("utf8");
  let cursor = align4(16 + versionLength);
  requireRange(bytes, rootOffset, cursor, 4, "metadata.stream-count");
  const streamCount = bytes.readUInt16LE(cursor + 2);
  if (streamCount === 0 || streamCount > 64)
    throw managedFailure(
      "invalid-stream",
      "metadata.stream-count",
      "Metadata stream count is outside the admitted range",
      rootOffset + cursor + 2,
    );
  cursor += 4;
  const streams = new Map<string, MetadataStream>();
  let minimalDeltaOffset: number | null = null;
  for (let index = 0; index < streamCount; index += 1) {
    requireRange(bytes, rootOffset, cursor, 8, "metadata.stream-header");
    const relativeOffset = bytes.readUInt32LE(cursor);
    const streamSize = bytes.readUInt32LE(cursor + 4);
    const named = readStreamName(bytes, rootOffset, cursor + 8);
    if (streams.has(named.name))
      throw managedFailure(
        "invalid-stream",
        "metadata.stream-header",
        `Duplicate metadata stream ${named.name}`,
        rootOffset + cursor,
      );
    requireRange(
      bytes,
      rootOffset,
      relativeOffset,
      streamSize,
      `metadata.${named.name}`,
    );
    streams.set(named.name, {
      name: named.name,
      offset: rootOffset + relativeOffset,
      size: streamSize,
    });
    if (named.name === "#JTD") minimalDeltaOffset = rootOffset + cursor;
    cursor = named.next;
  }
  return { streams, version, minimalDeltaOffset };
};

interface HeapSizes {
  readonly string: 2 | 4;
  readonly guid: 2 | 4;
  readonly blob: 2 | 4;
}

interface ParsedTablesHeader {
  readonly tableBytes: Buffer;
  readonly tablesOffset: number;
  readonly heaps: HeapSizes;
  readonly valid: bigint;
}

const readTablesHeader = (
  bytes: Buffer,
  streams: ReadonlyMap<string, MetadataStream>,
): ParsedTablesHeader => {
  const tablesStream = streamByName(streams, ["#~", "#-"]);
  if (tablesStream === undefined)
    throw managedFailure(
      "missing-stream",
      "metadata.tables",
      "Required metadata table stream #~ or #- is absent",
    );
  const tableBytes = bytes.subarray(
    tablesStream.offset,
    tablesStream.offset + tablesStream.size,
  );
  requireRange(
    tableBytes,
    tablesStream.offset,
    0,
    24,
    "metadata.tables-header",
  );
  const heapSizes = tableBytes[6] ?? 0;
  const heaps = {
    string: (heapSizes & 0x01) === 0 ? (2 as const) : (4 as const),
    guid: (heapSizes & 0x02) === 0 ? (2 as const) : (4 as const),
    blob: (heapSizes & 0x04) === 0 ? (2 as const) : (4 as const),
  };
  const valid = tableBytes.readBigUInt64LE(8);
  if ((valid & ~SUPPORTED_TABLE_MASK) !== 0n)
    throw managedFailure(
      "invalid-tables",
      "metadata.valid-mask",
      "Metadata valid mask names unsupported tables outside the admitted ECMA-335 range",
      tablesStream.offset + 8,
    );
  return { tableBytes, tablesOffset: tablesStream.offset, heaps, valid };
};

const readRowCounts = (
  tableBytes: Buffer,
  tablesOffset: number,
  valid: bigint,
): readonly number[] => {
  const rowCounts = Array<number>(METADATA_TABLE_NAMES.length).fill(0);
  let tableCursor = 24;
  for (let index = 0; index < METADATA_TABLE_NAMES.length; index += 1) {
    if ((valid & (1n << BigInt(index))) === 0n) continue;
    requireRange(
      tableBytes,
      tablesOffset,
      tableCursor,
      4,
      "metadata.table-row-count",
    );
    const count = tableBytes.readUInt32LE(tableCursor);
    rowCounts[index] = count;
    tableCursor += 4;
  }
  return rowCounts;
};

const buildRowSizeContext = (
  rowCounts: readonly number[],
  heaps: HeapSizes,
): RowSizeContext => ({
  tableSize: (index) => tableSize(index, rowCounts),
  codedSize: (name) => codedSize(name, rowCounts),
  stringSize: heaps.string,
  guidSize: heaps.guid,
  blobSize: heaps.blob,
});

const buildMetadataTables = ({
  tableBytes,
  rowCounts,
  heaps,
  valid,
  tablesOffset,
}: {
  readonly tableBytes: Buffer;
  readonly rowCounts: readonly number[];
  readonly heaps: HeapSizes;
  readonly valid: bigint;
  readonly tablesOffset: number;
}): ReadonlyMap<number, MetadataTableLayout> => {
  const tables = new Map<number, MetadataTableLayout>();
  const context = buildRowSizeContext(rowCounts, heaps);
  let tableCursor = 24;
  for (let index = 0; index < METADATA_TABLE_NAMES.length; index += 1) {
    if ((valid & (1n << BigInt(index))) === 0n) continue;
    tableCursor += 4;
  }
  // CLR readers honor an optional extra-data word after the row counts.
  // Its value is opaque; it is not a length or part of the first table row.
  if (((tableBytes[6] ?? 0) & 0x40) !== 0) {
    if (tableCursor > tableBytes.length - 4)
      throw managedFailure(
        "invalid-metadata-root",
        "metadata.tables-extra-data",
        "Metadata tables extra-data word is truncated",
        tablesOffset + tableCursor,
      );
    tableCursor += 4;
  }
  for (let index = 0; index < METADATA_TABLE_NAMES.length; index += 1) {
    const count = rowCounts[index] ?? 0;
    if ((valid & (1n << BigInt(index))) === 0n) continue;
    const sizeOfRow = computeRowSize(index, context);
    const byteLength = count * sizeOfRow;
    if (!Number.isSafeInteger(byteLength))
      throw managedFailure(
        "invalid-tables",
        "metadata.tables",
        "Metadata table byte size overflowed",
        tablesOffset + tableCursor,
      );
    requireRange(
      tableBytes,
      tablesOffset,
      tableCursor,
      byteLength,
      "metadata.table-data",
    );
    tables.set(index, {
      index,
      name: METADATA_TABLE_NAMES[index] ?? `Table${String(index)}`,
      rowCount: count,
      rowSize: sizeOfRow,
      offset: tablesOffset + tableCursor,
    });
    tableCursor += byteLength;
  }
  return tables;
};

/** Parse ECMA-335 stream and table layout with checked byte extents. */
export const readManagedMetadataLayout = (
  artifact: Buffer,
  rootOffset: number,
  size: number,
): ManagedMetadataLayout => {
  if (size < 20 || rootOffset < 0 || rootOffset > artifact.length - size)
    throw managedFailure(
      "invalid-metadata-root",
      "metadata.root",
      "CLI metadata directory leaves the artifact byte range",
      rootOffset,
    );
  const bytes = artifact.subarray(rootOffset, rootOffset + size);
  const budget = new ManagedDecodeBudget();
  const { streams, version, minimalDeltaOffset } = readMetadataStreams(
    bytes,
    rootOffset,
    budget,
  );
  // Runtime v9.0.0 MetadataReader recognizes #JTD before sizing references.
  // Minimal deltas also use baseline coordinates and cumulative heap handles;
  // widening local rows alone cannot establish standalone member identities.
  if (minimalDeltaOffset !== null)
    throw new ManagedReaderFailure(
      {
        code: "unsupported-metadata",
        scope: "metadata.#JTD",
        detail:
          "Minimal Edit-and-Continue metadata (#JTD) requires its baseline and prior generations; standalone metadata identities and inventories are unknown.",
        offset: minimalDeltaOffset,
      },
      { metadataHeader: { version, streamNames: [...streams.keys()] } },
    );
  const { tableBytes, tablesOffset, heaps, valid } = readTablesHeader(
    artifact,
    streams,
  );
  const rowCounts = readRowCounts(tableBytes, tablesOffset, valid);
  const tables = buildMetadataTables({
    tableBytes,
    rowCounts,
    heaps,
    valid,
    tablesOffset,
  });
  const layout: ManagedMetadataLayout = {
    rootOffset,
    size,
    version,
    streamNames: [...streams.keys()].sort(),
    strings: requireStream(streams, "#Strings"),
    guid: requireStream(streams, "#GUID"),
    blob: streams.get("#Blob") ?? null,
    userStrings: streams.get("#US") ?? null,
    tables,
    rowCounts,
    stringIndexSize: heaps.string,
    guidIndexSize: heaps.guid,
    blobIndexSize: heaps.blob,
    table: (index) => tables.get(index),
    tableIndexSize: (index) => tableSize(index, rowCounts),
    codedIndexSize: (name) => codedSize(name, rowCounts),
  };
  attachManagedDecodeBudget(layout, budget);
  return layout;
};

/** Resolve a one-based metadata row to its exact file offset. */
export const metadataRowOffset = (
  layout: ManagedMetadataLayout,
  table: number,
  row: number,
): number => {
  const descriptor = layout.table(table);
  if (descriptor === undefined || row < 1 || row > descriptor.rowCount)
    throw managedFailure(
      "invalid-row",
      `metadata.${METADATA_TABLE_NAMES[table] ?? String(table)}`,
      `Metadata row ${String(row)} is outside its table`,
    );
  return descriptor.offset + (row - 1) * descriptor.rowSize;
};
