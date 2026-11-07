import { createHash } from "node:crypto";

import type { BinaryTarget } from "../domain/binaryTargetTypes.js";

interface ManagedPeFixtureOptions {
  readonly additionalEmptyTypes?: number;
  readonly customAttributeRowCount?: number;
  readonly cliFlags?: number;
  readonly corruptMetadataSignature?: boolean;
  readonly customAttributeTypeRaw?: number;
  readonly customAttributeValue?: Buffer;
  readonly extendsRaw?: number;
  readonly exportedTypes?: readonly {
    readonly namespace: string;
    readonly name: string;
    readonly flags: number;
    readonly implementationRaw: number;
  }[];
  readonly fieldName?: string;
  readonly fieldSignature?: Buffer;
  readonly ilBody?: Buffer;
  readonly malformedAssemblyReferenceRows?: readonly number[];
  readonly malformedCustomAttributeRows?: readonly number[];
  readonly metadataExtraData?: number;
  readonly metadataValidMaskExtra?: bigint;
  readonly methodRowCount?: number;
  readonly methodName?: string;
  readonly methodFlags?: number;
  readonly methodSignature?: Buffer;
  readonly moduleRowCount?: number;
  readonly assemblyRowCount?: number;
  readonly assemblyName?: string;
  readonly assemblyFlags?: number;
  readonly memberRefParentRaw?: number;
  readonly memberRefRowCount?: number;
  readonly memberRefName?: string;
  readonly memberRefSignature?: Buffer;
  /** Raw MethodDefOrRef coded values, one MethodSpec row each. */
  readonly methodSpecMethods?: readonly number[];
  /** Instantiation blob shared by every MethodSpec row. */
  readonly methodSpecInstantiation?: Buffer;
  /** StandAloneSig LocalVarSig blobs, one row each. */
  readonly standaloneSignatures?: readonly Buffer[];
  /** TypeSpec signature blobs, one TypeSpec row each. */
  readonly typeSpecSignatures?: readonly Buffer[];
  /** Raw ResolutionScope coded value of the TypeRef row; null by default. */
  readonly typeRefScopeRaw?: number;
  readonly mvid?: Buffer;
  readonly pinvoke?: {
    readonly importName?: string;
    readonly memberForwardedRaw?: number;
    readonly mappingFlags?: number;
    readonly moduleName?: string;
  };
  readonly readyToRun?: boolean;
  readonly references?: readonly string[];
  readonly resourceImplementationRaw?: number;
  readonly resourceData?: Buffer;
  readonly targetFramework?: string | null;
  readonly typeName?: string;
  readonly typeNamespace?: string;
  /** NestedClass rows as [nested, enclosing] TypeDef rows. */
  readonly nestedTypes?: readonly (readonly [number, number])[];
  /** TypeRef rows after the TargetFrameworkAttribute row, from row 2. */
  readonly typeReferences?: readonly {
    readonly namespace: string;
    readonly name: string;
    /** TypeRef row of the enclosing type, for a nested type. */
    readonly enclosingRow?: number;
  }[];
  /** Raw #US stream bytes; omitted means the metadata has no #US stream. */
  readonly userStringHeap?: Buffer;
  readonly virtualSectionSize?: number;
}

const textEncoder = new TextEncoder();

const align4 = (value: number): number => (value + 3) & ~3;

const cString = (value: string): Buffer => Buffer.from(`${value}\0`, "utf8");

class StringHeap {
  readonly #chunks: Buffer[] = [Buffer.from([0])];
  #size = 1;

  get size(): number {
    return this.#size;
  }

  add(value: string): number {
    if (value.length === 0) return 0;
    const index = this.#size;
    const chunk = cString(value);
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    return index;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.#chunks);
  }
}

const compressedUnsigned = (value: number): Buffer =>
  value <= 0x7f
    ? Buffer.from([value])
    : value <= 0x3fff
      ? Buffer.from([0x80 | (value >> 8), value & 0xff])
      : Buffer.from([
          0xc0 | (value >> 24),
          (value >> 16) & 0xff,
          (value >> 8) & 0xff,
          value & 0xff,
        ]);

class BlobHeap {
  readonly #chunks: Buffer[] = [Buffer.from([0])];
  #size = 1;

  get size(): number {
    return this.#size;
  }

  add(value: Buffer): number {
    if (value.length === 0) return 0;
    const index = this.#size;
    const prefix = compressedUnsigned(value.length);
    this.#chunks.push(prefix, value);
    this.#size += value.length + prefix.length;
    return index;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.#chunks);
  }
}

const DEFAULT_MVID = Buffer.from([
  0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
  0xdd, 0xee, 0xff,
]);

/** Describe fixture bytes as the managed PE target consumed by static inspectors. */
export const managedPeFixtureTarget = (
  bytes: Buffer,
  path = "/fixture.exe",
): BinaryTarget => ({
  path,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  kind: "executable",
  format: "pe",
  architecture: "x86",
  availableArchitectures: ["x86"],
  executableRole: "application",
  managed: true,
});

const guidHeap = (mvid: Buffer = DEFAULT_MVID): Buffer => {
  if (mvid.length !== 16)
    throw new RangeError("Managed PE fixture MVID must be 16 bytes");
  return Buffer.from(mvid);
};

const u16 = (value: number): Buffer => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
};

const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value, 0);
  return bytes;
};

type MetadataIndexSize = 2 | 4;

const indexSize = (rows: number, codedTagBits = 0): MetadataIndexSize =>
  rows < 2 ** (16 - codedTagBits) ? 2 : 4;

const metadataIndex = (value: number, size: MetadataIndexSize): Buffer =>
  size === 2 ? u16(value) : u32(value);

const codedIndexSize = (
  rows: readonly number[],
  tagBits: number,
): MetadataIndexSize => indexSize(Math.max(...rows), tagBits);

const moduleRow = (
  name: number,
  stringSize: MetadataIndexSize,
  guidSize: MetadataIndexSize,
): Buffer =>
  Buffer.concat([
    u16(0),
    metadataIndex(name, stringSize),
    metadataIndex(1, guidSize),
    metadataIndex(0, guidSize),
    metadataIndex(0, guidSize),
  ]);

const typeRefRow = (
  name: number,
  namespace: number,
  stringSize: MetadataIndexSize,
  resolutionScope: Buffer,
): Buffer =>
  Buffer.concat([
    resolutionScope,
    metadataIndex(name, stringSize),
    metadataIndex(namespace, stringSize),
  ]);

const typeDefRow = ({
  name,
  namespace,
  fieldList,
  methodList,
  stringSize,
  typeDefOrRefSize,
  fieldListSize,
  methodListSize,
  extendsRaw = (1 << 2) | 1,
  flags = 0x0010_0001,
}: {
  readonly name: number;
  readonly namespace: number;
  readonly fieldList: number;
  readonly methodList: number;
  readonly stringSize: MetadataIndexSize;
  readonly typeDefOrRefSize: MetadataIndexSize;
  readonly fieldListSize: MetadataIndexSize;
  readonly methodListSize: MetadataIndexSize;
  readonly extendsRaw?: number;
  readonly flags?: number;
}): Buffer =>
  Buffer.concat([
    u32(flags),
    metadataIndex(name, stringSize),
    metadataIndex(namespace, stringSize),
    metadataIndex(extendsRaw, typeDefOrRefSize),
    metadataIndex(fieldList, fieldListSize),
    metadataIndex(methodList, methodListSize),
  ]);

const fieldRow = (
  name: number,
  signature: number,
  stringSize: MetadataIndexSize,
  blobSize: MetadataIndexSize,
): Buffer =>
  Buffer.concat([
    u16(0x0001),
    metadataIndex(name, stringSize),
    metadataIndex(signature, blobSize),
  ]);

interface MethodDefRowInput {
  readonly name: number;
  readonly signature: number;
  readonly stringSize: MetadataIndexSize;
  readonly blobSize: MetadataIndexSize;
  readonly parameterSize: MetadataIndexSize;
  readonly rva?: number;
  readonly flags?: number;
  readonly implFlags?: number;
  readonly parameterList?: number;
}

const methodDefRow = ({
  name,
  signature,
  stringSize,
  blobSize,
  parameterSize,
  rva = 0,
  flags = 0x0016,
  implFlags = 0,
  parameterList = 0,
}: MethodDefRowInput): Buffer =>
  Buffer.concat([
    u32(rva),
    u16(implFlags),
    u16(flags),
    metadataIndex(name, stringSize),
    metadataIndex(signature, blobSize),
    metadataIndex(parameterList, parameterSize),
  ]);

const memberRefRow = ({
  name,
  signature,
  stringSize,
  blobSize,
  parentSize,
  parentRaw = (1 << 3) | 1,
}: {
  readonly name: number;
  readonly signature: number;
  readonly stringSize: MetadataIndexSize;
  readonly blobSize: MetadataIndexSize;
  readonly parentSize: MetadataIndexSize;
  readonly parentRaw?: number;
}): Buffer =>
  Buffer.concat([
    metadataIndex(parentRaw, parentSize),
    metadataIndex(name, stringSize),
    metadataIndex(signature, blobSize),
  ]);

const moduleRefRow = (name: number, stringSize: MetadataIndexSize): Buffer =>
  Buffer.concat([metadataIndex(name, stringSize)]);

const implMapRow = (
  importName: number,
  importScope: number,
  mappingFlags: number,
  stringSize: MetadataIndexSize,
  memberForwardedSize: MetadataIndexSize,
  moduleRefSize: MetadataIndexSize,
  memberForwardedRaw: number,
): Buffer =>
  Buffer.concat([
    u16(mappingFlags),
    metadataIndex(memberForwardedRaw, memberForwardedSize),
    metadataIndex(importName, stringSize),
    metadataIndex(importScope, moduleRefSize),
  ]);

const assemblyRow = (
  name: number,
  stringSize: MetadataIndexSize,
  blobSize: MetadataIndexSize,
  flags = 0,
): Buffer =>
  Buffer.concat([
    u32(0x0000_8004),
    u16(1),
    u16(2),
    u16(3),
    u16(4),
    u32(flags),
    metadataIndex(0, blobSize),
    metadataIndex(name, stringSize),
    metadataIndex(0, stringSize),
  ]);

const assemblyRefRow = (
  name: number,
  keyOrToken: number,
  malformedName: boolean,
  stringSize: MetadataIndexSize,
  blobSize: MetadataIndexSize,
): Buffer =>
  Buffer.concat([
    u16(8),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    metadataIndex(keyOrToken, blobSize),
    metadataIndex(
      malformedName ? (stringSize === 2 ? 0xffff : 0xffff_ffff) : name,
      stringSize,
    ),
    metadataIndex(0, stringSize),
    metadataIndex(0, blobSize),
  ]);

const customAttributeRow = ({
  value,
  options,
  parentIndexSize,
  typeIndexSize,
  blobSize,
  row,
}: {
  readonly value: number;
  readonly options: ManagedPeFixtureOptions;
  readonly parentIndexSize: 2 | 4;
  readonly typeIndexSize: MetadataIndexSize;
  readonly blobSize: MetadataIndexSize;
  readonly row: number;
}): Buffer =>
  Buffer.concat([
    parentIndexSize === 2
      ? u16(
          options.malformedCustomAttributeRows?.includes(row)
            ? 0xffff
            : (1 << 5) | 14,
        )
      : u32(
          options.malformedCustomAttributeRows?.includes(row)
            ? 0xffff_ffff
            : (1 << 5) | 14,
        ),
    metadataIndex(
      options.customAttributeTypeRaw ?? (1 << 3) | 3,
      typeIndexSize,
    ),
    metadataIndex(value, blobSize),
  ]);

const manifestResourceRow = (
  name: number,
  stringSize: MetadataIndexSize,
  implementationSize: MetadataIndexSize,
  implementationRaw: number,
): Buffer =>
  Buffer.concat([
    u32(0),
    u32(2),
    metadataIndex(name, stringSize),
    metadataIndex(implementationRaw, implementationSize),
  ]);

const exportedTypeRow = (
  exported: { readonly name: number; readonly namespace: number },
  flags: number,
  stringSize: MetadataIndexSize,
  implementationSize: MetadataIndexSize,
  implementationRaw: number,
): Buffer =>
  Buffer.concat([
    u32(flags),
    u32(0),
    metadataIndex(exported.name, stringSize),
    metadataIndex(exported.namespace, stringSize),
    metadataIndex(implementationRaw, implementationSize),
  ]);

const fixedStringAttributeBlob = (value: string): Buffer => {
  const bytes = Buffer.from(textEncoder.encode(value));
  return Buffer.concat([
    Buffer.from([1, 0]),
    compressedUnsigned(bytes.length),
    bytes,
    u16(0),
  ]);
};

/**
 * Lay out ECMA-335 #US items (compressed length, UTF-16LE, terminal flag byte)
 * and return the `ldstr` token that names each value.
 */
// ECMA-335 II.24.2.4 terminal flag: 1 when a code unit has a high byte or a
// low byte in 0x01-0x08, 0x0E-0x1F, 0x27, 0x2D, or 0x7F.
const userStringFlag = (text: Buffer): number => {
  for (let index = 0; index < text.length; index += 2) {
    const unit = text.readUInt16LE(index);
    if (
      unit > 0xff ||
      (unit >= 0x01 && unit <= 0x08) ||
      (unit >= 0x0e && unit <= 0x1f) ||
      unit === 0x27 ||
      unit === 0x2d ||
      unit === 0x7f
    )
      return 1;
  }
  return 0;
};

/** A #US heap whose items carry the ECMA-335 terminal flag, and their tokens. */
export const fixtureUserStringHeap = (
  values: readonly string[],
): { readonly heap: Buffer; readonly tokens: readonly string[] } => {
  const items: Buffer[] = [Buffer.from([0])];
  const tokens: string[] = [];
  let size = 1;
  for (const value of values) {
    const text = Buffer.from(value, "utf16le");
    const length = text.length + 1;
    if (length > 0x3fff)
      throw new RangeError("Managed PE fixture user string is too long");
    const prefix =
      length < 0x80
        ? Buffer.from([length])
        : Buffer.from([0x80 | (length >> 8), length & 0xff]);
    tokens.push(`0x70${size.toString(16).padStart(6, "0")}`);
    const item = Buffer.concat([
      prefix,
      text,
      Buffer.from([userStringFlag(text)]),
    ]);
    items.push(item);
    size += item.length;
  }
  return { heap: Buffer.concat(items), tokens };
};

const metadataStreamHeader = (
  relativeOffset: number,
  size: number,
  name: string,
): Buffer => {
  const named = cString(name);
  const paddedName = Buffer.alloc(align4(named.length));
  named.copy(paddedName);
  return Buffer.concat([u32(relativeOffset), u32(size), paddedName]);
};

const metadataRoot = (
  {
    tables,
    strings,
    guid,
    blob,
    userStrings,
  }: {
    readonly tables: Buffer;
    readonly strings: Buffer;
    readonly guid: Buffer;
    readonly blob: Buffer;
    readonly userStrings?: Buffer | undefined;
  },
  tableStreamName: "#~" | "#-" = "#~",
): Buffer => {
  const streams: readonly (readonly [string, Buffer])[] = [
    [tableStreamName, tables],
    ["#Strings", strings],
    ...(userStrings === undefined ? [] : [["#US", userStrings] as const]),
    ["#GUID", guid],
    ["#Blob", blob],
  ];
  const version = Buffer.from("v4.0.30319\0\0", "utf8");
  const header = Buffer.concat([
    u32(0x424a_5342),
    u16(1),
    u16(1),
    u32(0),
    u32(version.length),
    version,
    u16(0),
    u16(streams.length),
  ]);
  const streamHeaderSize = streams.reduce(
    (total, [name]) => total + metadataStreamHeader(0, 0, name).length,
    0,
  );
  let offset = align4(header.length + streamHeaderSize);
  const placed = streams.map(([name, data]) => {
    const at = offset;
    offset = align4(offset + data.length);
    return { name, data, at };
  });
  const headers = Buffer.concat(
    placed.map(({ name, data, at }) =>
      metadataStreamHeader(at, data.length, name),
    ),
  );
  const root = Buffer.alloc(offset);
  header.copy(root, 0);
  headers.copy(root, header.length);
  for (const { data, at } of placed) data.copy(root, at);
  return root;
};

const tablesStream = (
  rows: ReadonlyMap<number, readonly Buffer[]>,
  extraValidMask: bigint,
  heapSizes: number,
  extraData?: number,
): Buffer => {
  let valid = extraValidMask;
  for (const table of rows.keys()) valid |= 1n << BigInt(table);
  const header = Buffer.alloc(24);
  header.writeUInt8(2, 4);
  header.writeUInt8(heapSizes | (extraData === undefined ? 0 : 0x40), 6);
  header.writeUInt8(1, 7);
  header.writeBigUInt64LE(valid, 8);
  const counts: Buffer[] = [];
  for (let index = 0; index <= 44; index += 1) {
    const tableRows = rows.get(index);
    if (tableRows === undefined) continue;
    counts.push(u32(tableRows.length));
  }
  const data: Buffer[] = [];
  for (let index = 0; index <= 44; index += 1) {
    const tableRows = rows.get(index);
    if (tableRows === undefined) continue;
    data.push(...tableRows);
  }
  return Buffer.concat([
    header,
    ...counts,
    ...(extraData === undefined ? [] : [u32(extraData)]),
    ...data,
  ]);
};

interface FixtureMetadataRowContext {
  readonly options: ManagedPeFixtureOptions;
  readonly methodRva: number;
  readonly referenceStringIndexes: readonly number[];
  readonly indexes: {
    readonly moduleName: number;
    readonly assemblyName: number;
    readonly attributeName: number;
    readonly attributeNamespace: number;
    readonly constructorName: number;
    readonly typeName: number;
    readonly additionalTypeNames: readonly number[];
    readonly typeNamespace: number;
    readonly fieldName: number;
    readonly methodName: number;
    readonly pinvokeModuleName: number | null;
    readonly pinvokeImportName: number | null;
    readonly resourceName: number;
    readonly exportedTypes: readonly {
      readonly name: number;
      readonly namespace: number;
    }[];
    readonly typeReferences: readonly {
      readonly name: number;
      readonly namespace: number;
      readonly enclosingRow?: number;
    }[];
    readonly tokenBlob: number;
    readonly fieldSignature: number;
    readonly methodSignature: number;
    readonly constructorSignature: number;
    readonly attributeBlob: number;
    readonly typeSpecSignatures: readonly number[];
    readonly methodSpecInstantiation: number;
    readonly standaloneSignatures: readonly number[];
  };
  readonly heapSizes: {
    readonly strings: MetadataIndexSize;
    readonly blobs: MetadataIndexSize;
    readonly guids: MetadataIndexSize;
  };
}

interface FixtureIndexWidths {
  readonly table: (index: number) => MetadataIndexSize;
  readonly coded: (
    tables: readonly number[],
    tagBits: number,
  ) => MetadataIndexSize;
  readonly resolutionScope: MetadataIndexSize;
  readonly typeDefOrRef: MetadataIndexSize;
  readonly memberRefParent: MetadataIndexSize;
  readonly hasCustomAttribute: MetadataIndexSize;
  readonly customAttributeType: MetadataIndexSize;
  readonly implementation: MetadataIndexSize;
}

const repeatedRows = (
  count: number,
  createRow: () => Buffer,
): readonly Buffer[] => Array.from({ length: count }, createRow);

const customAttributeRows = (
  {
    options,
    indexes,
    heapSizes,
  }: Pick<FixtureMetadataRowContext, "options" | "indexes" | "heapSizes">,
  widths: FixtureIndexWidths,
): readonly Buffer[] =>
  options.targetFramework === null
    ? []
    : Array.from({ length: options.customAttributeRowCount ?? 1 }, (_, index) =>
        customAttributeRow({
          value: indexes.attributeBlob,
          options,
          parentIndexSize: widths.hasCustomAttribute,
          typeIndexSize: widths.customAttributeType,
          blobSize: heapSizes.blobs,
          row: index + 1,
        }),
      );

const exportedTypeTable = (
  options: ManagedPeFixtureOptions,
  indexes: FixtureMetadataRowContext["indexes"],
  heapSizes: FixtureMetadataRowContext["heapSizes"],
  widths: FixtureIndexWidths,
): readonly (readonly [number, readonly Buffer[]])[] =>
  indexes.exportedTypes.length === 0
    ? []
    : [
        [
          39,
          indexes.exportedTypes.map((exported, index) =>
            exportedTypeRow(
              exported,
              options.exportedTypes?.[index]?.flags ?? 0,
              heapSizes.strings,
              widths.implementation,
              options.exportedTypes?.[index]?.implementationRaw ?? 0,
            ),
          ),
        ],
      ];

const typeRefTable = (
  options: ManagedPeFixtureOptions,
  indexes: FixtureMetadataRowContext["indexes"],
  heapSizes: FixtureMetadataRowContext["heapSizes"],
  widths: FixtureIndexWidths,
): readonly [number, readonly Buffer[]] => [
  1,
  [
    typeRefRow(
      indexes.attributeName,
      indexes.attributeNamespace,
      heapSizes.strings,
      metadataIndex(options.typeRefScopeRaw ?? 0, widths.resolutionScope),
    ),
    ...indexes.typeReferences.map(({ name, namespace, enclosingRow }) =>
      typeRefRow(
        name,
        namespace,
        heapSizes.strings,
        metadataIndex(
          enclosingRow === undefined ? 0 : (enclosingRow << 2) | 3,
          widths.resolutionScope,
        ),
      ),
    ),
  ],
];

const nestedClassTable = (
  options: ManagedPeFixtureOptions,
  widths: FixtureIndexWidths,
): readonly (readonly [number, readonly Buffer[]])[] =>
  (options.nestedTypes?.length ?? 0) === 0
    ? []
    : [
        [
          41,
          (options.nestedTypes ?? []).map(([nested, enclosing]) =>
            Buffer.concat([
              metadataIndex(nested, widths.table(2)),
              metadataIndex(enclosing, widths.table(2)),
            ]),
          ),
        ],
      ];

const specTables = (
  options: ManagedPeFixtureOptions,
  indexes: FixtureMetadataRowContext["indexes"],
  heapSizes: FixtureMetadataRowContext["heapSizes"],
  widths: FixtureIndexWidths,
): readonly (readonly [number, readonly Buffer[]])[] => [
  ...(indexes.standaloneSignatures.length === 0
    ? []
    : ([
        [
          17,
          indexes.standaloneSignatures.map((signature) =>
            metadataIndex(signature, heapSizes.blobs),
          ),
        ],
      ] as const)),
  ...(indexes.typeSpecSignatures.length === 0
    ? []
    : ([
        [
          27,
          indexes.typeSpecSignatures.map((signature) =>
            metadataIndex(signature, heapSizes.blobs),
          ),
        ],
      ] as const)),
  ...(options.methodSpecMethods === undefined
    ? []
    : ([
        [
          43,
          options.methodSpecMethods.map((method) =>
            Buffer.concat([
              metadataIndex(method, widths.coded([6, 10], 1)),
              metadataIndex(indexes.methodSpecInstantiation, heapSizes.blobs),
            ]),
          ),
        ],
      ] as const)),
];

const fixtureIndexWidths = ({
  options,
  referenceStringIndexes,
  indexes,
}: FixtureMetadataRowContext): FixtureIndexWidths => {
  const rowCounts = new Map<number, number>([
    [0, options.moduleRowCount ?? 1],
    [1, indexes.typeReferences.length + 1],
    [2, indexes.additionalTypeNames.length + 1],
    [4, 1],
    [6, options.methodRowCount ?? 1],
    [8, 0],
    [10, options.memberRefRowCount ?? 1],
    [
      12,
      options.targetFramework === null
        ? 0
        : (options.customAttributeRowCount ?? 1),
    ],
    ...(indexes.pinvokeModuleName === null ? [] : ([[26, 1]] as const)),
    ...(indexes.pinvokeImportName === null ? [] : ([[28, 1]] as const)),
    [27, indexes.typeSpecSignatures.length],
    [17, indexes.standaloneSignatures.length],
    [32, options.assemblyRowCount ?? 1],
    [35, referenceStringIndexes.length],
    [39, indexes.exportedTypes.length],
    [40, 1],
    [41, options.nestedTypes?.length ?? 0],
    [43, options.methodSpecMethods?.length ?? 0],
  ]);
  const count = (table: number): number => rowCounts.get(table) ?? 0;
  const table = (index: number): MetadataIndexSize => indexSize(count(index));
  const coded = (
    tables: readonly number[],
    tagBits: number,
  ): MetadataIndexSize => codedIndexSize(tables.map(count), tagBits);
  return {
    table,
    coded,
    resolutionScope: coded([0, 26, 35, 1], 2),
    typeDefOrRef: coded([2, 1, 27], 2),
    memberRefParent: coded([2, 1, 26, 6, 27], 3),
    hasCustomAttribute: coded(
      [
        6, 4, 1, 2, 8, 9, 10, 0, 14, 23, 20, 17, 26, 27, 32, 35, 38, 39, 40, 42,
        44, 43,
      ],
      5,
    ),
    customAttributeType: coded([6, 10], 3),
    implementation: coded([38, 35, 39], 2),
  };
};

const fixtureMetadataRows = ({
  options,
  methodRva,
  referenceStringIndexes,
  indexes,
  heapSizes,
}: FixtureMetadataRowContext): ReadonlyMap<number, readonly Buffer[]> => {
  const widths = fixtureIndexWidths({
    options,
    methodRva,
    referenceStringIndexes,
    indexes,
    heapSizes,
  });
  const nestedRows = new Set(
    (options.nestedTypes ?? []).map(([nested]) => nested),
  );
  const rows = new Map<number, readonly Buffer[]>([
    [
      0,
      repeatedRows(options.moduleRowCount ?? 1, () =>
        moduleRow(indexes.moduleName, heapSizes.strings, heapSizes.guids),
      ),
    ],
    typeRefTable(options, indexes, heapSizes, widths),
    [
      2,
      [...indexes.additionalTypeNames, indexes.typeName].map((name, index) =>
        typeDefRow({
          name,
          flags: nestedRows.has(index + 1) ? 0x0010_0002 : 0x0010_0001,
          namespace: indexes.typeNamespace,
          fieldList: 1,
          methodList: 1,
          stringSize: heapSizes.strings,
          typeDefOrRefSize: widths.typeDefOrRef,
          fieldListSize: widths.table(4),
          methodListSize: widths.table(6),
          ...(options.extendsRaw === undefined
            ? {}
            : { extendsRaw: options.extendsRaw }),
        }),
      ),
    ],
    [
      4,
      [
        fieldRow(
          indexes.fieldName,
          indexes.fieldSignature,
          heapSizes.strings,
          heapSizes.blobs,
        ),
      ],
    ],
    [
      6,
      repeatedRows(options.methodRowCount ?? 1, () =>
        methodDefRow({
          name: indexes.methodName,
          signature: indexes.methodSignature,
          stringSize: heapSizes.strings,
          blobSize: heapSizes.blobs,
          parameterSize: widths.table(8),
          rva: methodRva,
          flags:
            options.methodFlags ??
            (options.pinvoke === undefined ? 0x0016 : 0x2016),
        }),
      ),
    ],
    [
      10,
      repeatedRows(options.memberRefRowCount ?? 1, () =>
        memberRefRow({
          name: indexes.constructorName,
          signature: indexes.constructorSignature,
          stringSize: heapSizes.strings,
          blobSize: heapSizes.blobs,
          parentSize: widths.memberRefParent,
          ...(options.memberRefParentRaw === undefined
            ? {}
            : { parentRaw: options.memberRefParentRaw }),
        }),
      ),
    ],
    [12, customAttributeRows({ options, indexes, heapSizes }, widths)],
    ...(indexes.pinvokeModuleName === null
      ? []
      : ([
          [26, [moduleRefRow(indexes.pinvokeModuleName, heapSizes.strings)]],
        ] as const)),
    ...(indexes.pinvokeImportName === null
      ? []
      : ([
          [
            28,
            [
              implMapRow(
                indexes.pinvokeImportName,
                1,
                options.pinvoke?.mappingFlags ?? 0x0344,
                heapSizes.strings,
                widths.coded([4, 6], 1),
                widths.table(26),
                options.pinvoke?.memberForwardedRaw ?? (1 << 1) | 1,
              ),
            ],
          ],
        ] as const)),
    [
      32,
      repeatedRows(options.assemblyRowCount ?? 1, () =>
        assemblyRow(
          indexes.assemblyName,
          heapSizes.strings,
          heapSizes.blobs,
          options.assemblyFlags,
        ),
      ),
    ],
    [
      35,
      referenceStringIndexes.map((name, index) =>
        assemblyRefRow(
          name,
          indexes.tokenBlob,
          options.malformedAssemblyReferenceRows?.includes(index + 1) ?? false,
          heapSizes.strings,
          heapSizes.blobs,
        ),
      ),
    ],
    ...exportedTypeTable(options, indexes, heapSizes, widths),
    ...specTables(options, indexes, heapSizes, widths),
    ...nestedClassTable(options, widths),
    [
      40,
      [
        manifestResourceRow(
          indexes.resourceName,
          heapSizes.strings,
          widths.implementation,
          options.resourceImplementationRaw ?? 0,
        ),
      ],
    ],
  ]);
  return rows;
};

/** Blob indexes for the MemberRef and optional spec rows; defaults leave the heap unchanged. */
const referenceBlobIndexes = (
  blobs: BlobHeap,
  options: ManagedPeFixtureOptions,
): Pick<
  FixtureMetadataRowContext["indexes"],
  "constructorSignature" | "typeSpecSignatures" | "methodSpecInstantiation"
> => ({
  constructorSignature: blobs.add(
    options.memberRefSignature ?? Buffer.from([0x20, 0x01, 0x01, 0x0e]),
  ),
  typeSpecSignatures: (options.typeSpecSignatures ?? []).map((signature) =>
    blobs.add(signature),
  ),
  // Defaults to GENERICINST with one string type argument.
  methodSpecInstantiation:
    options.methodSpecMethods === undefined
      ? 0
      : blobs.add(
          options.methodSpecInstantiation ?? Buffer.from([0x0a, 0x01, 0x0e]),
        ),
});

const buildManagedFixtureMetadata = (
  options: ManagedPeFixtureOptions,
  methodRva: number,
): Buffer => {
  const strings = new StringHeap();
  const blobs = new BlobHeap();
  const moduleName = strings.add("Fixture.dll");
  const assemblyName = strings.add(options.assemblyName ?? "Fixture.Managed");
  const attributeName = strings.add("TargetFrameworkAttribute");
  const attributeNamespace = strings.add("System.Runtime.Versioning");
  const constructorName = strings.add(options.memberRefName ?? ".ctor");
  const typeName = strings.add(options.typeName ?? "Program");
  const additionalTypeNames = Array.from(
    { length: options.additionalEmptyTypes ?? 0 },
    (_, index) => strings.add(`Empty${String(index)}`),
  );
  const typeNamespace = strings.add(options.typeNamespace ?? "Fixture");
  const fieldName = strings.add(options.fieldName ?? "counter");
  const methodName = strings.add(options.methodName ?? "Main");
  const pinvokeModuleName =
    options.pinvoke === undefined
      ? null
      : strings.add(options.pinvoke.moduleName ?? "user32.dll");
  const pinvokeImportName =
    options.pinvoke === undefined
      ? null
      : strings.add(options.pinvoke.importName ?? "MessageBoxW");
  const resourceName = strings.add("Fixture.resources");
  const exportedTypes = (options.exportedTypes ?? []).map(
    ({ namespace, name }) => ({
      name: strings.add(name),
      namespace: strings.add(namespace),
    }),
  );
  const typeReferences = (options.typeReferences ?? []).map(
    ({ namespace, name, enclosingRow }) => ({
      name: strings.add(name),
      namespace: strings.add(namespace),
      ...(enclosingRow === undefined ? {} : { enclosingRow }),
    }),
  );
  const referenceNames = options.references ?? ["System.Runtime"];
  const referenceStringIndexes = referenceNames.map((name) =>
    strings.add(name),
  );
  const tokenBlob = blobs.add(Buffer.from("b77a5c561934e089", "hex"));
  const fieldSignature = blobs.add(
    options.fieldSignature ?? Buffer.from([0x06, 0x08]),
  );
  const methodSignature = blobs.add(
    options.methodSignature ?? Buffer.from([0x00, 0x00, 0x01]),
  );
  const standaloneSignatures = (options.standaloneSignatures ?? []).map(
    (signature) => blobs.add(signature),
  );
  const referenceBlobs = referenceBlobIndexes(blobs, options);
  const attributeBlob = blobs.add(
    options.customAttributeValue ??
      fixedStringAttributeBlob(
        options.targetFramework === null
          ? ".NETCoreApp,Version=v8.0"
          : (options.targetFramework ?? ".NETCoreApp,Version=v8.0"),
      ),
  );
  const stringSize = indexSize(strings.size);
  const blobSize = indexSize(blobs.size);
  const guidSize = indexSize(guidHeap(options.mvid).length);
  const rows = fixtureMetadataRows({
    options,
    methodRva,
    referenceStringIndexes,
    indexes: {
      moduleName,
      assemblyName,
      attributeName,
      attributeNamespace,
      constructorName,
      typeName,
      additionalTypeNames,
      typeNamespace,
      fieldName,
      methodName,
      pinvokeModuleName,
      pinvokeImportName,
      resourceName,
      exportedTypes,
      typeReferences,
      tokenBlob,
      fieldSignature,
      methodSignature,
      standaloneSignatures,
      attributeBlob,
      ...referenceBlobs,
    },
    heapSizes: { strings: stringSize, blobs: blobSize, guids: guidSize },
  });
  const heapFlags =
    (stringSize === 4 ? 0x01 : 0) |
    (guidSize === 4 ? 0x02 : 0) |
    (blobSize === 4 ? 0x04 : 0);
  const metadata = metadataRoot({
    tables: tablesStream(
      rows,
      options.metadataValidMaskExtra ?? 0n,
      heapFlags,
      options.metadataExtraData,
    ),
    strings: strings.toBuffer(),
    guid: guidHeap(options.mvid),
    blob: blobs.toBuffer(),
    userStrings: options.userStringHeap,
  });
  if (options.corruptMetadataSignature === true) metadata.writeUInt32LE(0, 0);
  return metadata;
};

const buildManagedFixtureImage = (
  options: ManagedPeFixtureOptions,
  buildMetadata: (methodRva: number) => Buffer,
): Buffer => {
  const resourceData = options.resourceData ?? Buffer.from("resource-data");
  const resourceDirectory = Buffer.concat([
    u32(resourceData.length),
    resourceData,
  ]);
  const initialMetadata = buildMetadata(0);
  const resourceOffset = Math.max(
    0x0800,
    Math.ceil((0x0300 + initialMetadata.length) / 0x0200) * 0x0200,
  );
  const resourceRva = 0x2000 + resourceOffset - 0x0200;
  const bodyOffset = Math.max(
    0x0a00,
    Math.ceil((resourceOffset + resourceDirectory.length) / 0x0200) * 0x0200,
  );
  const methodRva = 0x2000 + bodyOffset - 0x0200;
  const metadata = buildMetadata(methodRva);
  const body =
    options.ilBody ??
    Buffer.from([
      0x32, 0x02, 0x7b, 0x01, 0x00, 0x00, 0x04, 0x28, 0x01, 0x00, 0x00, 0x0a,
      0x2a,
    ]);
  const legacyReadyToRunOffset = 0x0900;
  const metadataEnd = 0x0300 + metadata.length;
  const resourceEnd = resourceOffset + resourceDirectory.length;
  const bodyEnd = bodyOffset + body.length;
  const overlapsReadyToRun = (start: number, end: number): boolean =>
    legacyReadyToRunOffset < end && legacyReadyToRunOffset + 4 > start;
  const readyToRunOffset =
    options.readyToRun === true
      ? overlapsReadyToRun(0x0300, metadataEnd) ||
        overlapsReadyToRun(resourceOffset, resourceEnd) ||
        overlapsReadyToRun(bodyOffset, bodyEnd)
        ? Math.ceil(Math.max(metadataEnd, resourceEnd, bodyEnd) / 4) * 4
        : legacyReadyToRunOffset
      : null;
  const rawSectionSize =
    Math.ceil(
      Math.max(
        0x0e00,
        0x0100 + metadata.length,
        bodyOffset - 0x0200 + body.length,
        readyToRunOffset === null ? 0 : readyToRunOffset - 0x0200 + 4,
      ) / 0x0200,
    ) * 0x0200;
  const virtualSectionSize =
    options.virtualSectionSize ?? Math.max(0x1000, rawSectionSize);
  const image = Buffer.alloc(0x0200 + rawSectionSize);
  image.write("MZ", 0, "ascii");
  image.writeUInt32LE(0x80, 0x3c);
  image.writeUInt32LE(0x0000_4550, 0x80);
  const coff = 0x84;
  image.writeUInt16LE(0x014c, coff);
  image.writeUInt16LE(1, coff + 2);
  image.writeUInt16LE(0x00e0, coff + 16);
  image.writeUInt16LE(0x0102, coff + 18);
  const optional = coff + 20;
  image.writeUInt16LE(0x010b, optional);
  image.writeUInt32LE(0x2000, optional + 20);
  image.writeUInt32LE(0x0040_0000, optional + 28);
  image.writeUInt32LE(0x1000, optional + 32);
  image.writeUInt32LE(0x200, optional + 36);
  image.writeUInt32LE(
    Math.ceil((0x2000 + virtualSectionSize) / 0x1000) * 0x1000,
    optional + 56,
  );
  image.writeUInt32LE(0x200, optional + 60);
  image.writeUInt32LE(16, optional + 92);
  image.writeUInt32LE(0x2000, optional + 96 + 14 * 8);
  image.writeUInt32LE(72, optional + 96 + 14 * 8 + 4);
  const section = optional + 0x00e0;
  image.write(".text\0\0\0", section, "ascii");
  image.writeUInt32LE(virtualSectionSize, section + 8);
  image.writeUInt32LE(0x2000, section + 12);
  image.writeUInt32LE(rawSectionSize, section + 16);
  image.writeUInt32LE(0x0200, section + 20);
  image.writeUInt32LE(0x6000_0020, section + 36);
  const cli = 0x0200;
  image.writeUInt32LE(72, cli);
  image.writeUInt16LE(2, cli + 4);
  image.writeUInt16LE(5, cli + 6);
  image.writeUInt32LE(0x2100, cli + 8);
  image.writeUInt32LE(metadata.length, cli + 12);
  image.writeUInt32LE(options.cliFlags ?? 1, cli + 16);
  image.writeUInt32LE(0x0600_0001, cli + 20);
  image.writeUInt32LE(resourceRva, cli + 24);
  image.writeUInt32LE(resourceDirectory.length, cli + 28);
  if (readyToRunOffset !== null) {
    image.writeUInt32LE(0x2000 + readyToRunOffset - 0x0200, cli + 64);
    image.writeUInt32LE(4, cli + 68);
    image.write("RTR\0", readyToRunOffset, "ascii");
  }
  body.copy(image, bodyOffset);
  metadata.copy(image, 0x0300);
  resourceDirectory.copy(image, resourceOffset);
  return image;
};

/** Build a source-owned PE32/CLI fixture without committing compiled binaries. */
export const buildManagedPeFixture = (
  options: ManagedPeFixtureOptions = {},
): Buffer =>
  buildManagedFixtureImage(options, (methodRva) =>
    buildManagedFixtureMetadata(options, methodRva),
  );

/** Two attribute classes whose pointer-table slots can reorder physical members. */
export const buildManagedMemberPointerFixture = (
  options: {
    readonly fieldPointers?: readonly number[] | null;
    readonly methodPointers?: readonly number[] | null;
    readonly streamName?: "#~" | "#-";
  } = {},
): Buffer => {
  const fieldPointers =
    options.fieldPointers === undefined ? [2, 1] : options.fieldPointers;
  const methodPointers =
    options.methodPointers === undefined ? [2, 1] : options.methodPointers;
  // Both instance constructors call System.Attribute::.ctor(), then return.
  const body = Buffer.from([0x1e, 0x02, 0x28, 0x01, 0, 0, 0x0a, 0x2a]);
  const image = buildManagedFixtureImage({ ilBody: body }, (methodRva) => {
    const strings = new StringHeap();
    const blobs = new BlobHeap();
    const moduleName = strings.add("MemberPointers.dll");
    const assemblyName = strings.add("Fixture.MemberPointers");
    const namespace = strings.add("Fixture");
    const typeNames = ["<Module>", "A", "B"].map((name) => strings.add(name));
    const fieldNames = ["firstField", "secondField"].map((name) =>
      strings.add(name),
    );
    const constructorName = strings.add(".ctor");
    const attributeName = strings.add("Attribute");
    const systemNamespace = strings.add("System");
    const runtimeName = strings.add("System.Runtime");
    const fieldSignature = blobs.add(Buffer.from([0x06, 0x08]));
    const constructorSignature = blobs.add(
      Buffer.from([0x20, 0x01, 0x01, 0x0e]),
    );
    const baseConstructorSignature = blobs.add(Buffer.from([0x20, 0, 0x01]));
    const attributeValue = blobs.add(fixedStringAttributeBlob("fixture"));
    const rows = new Map<number, readonly Buffer[]>([
      [0, [moduleRow(moduleName, 2, 2)]],
      // ResolutionScope selects AssemblyRef 1, which contains System.Attribute.
      [
        1,
        [
          Buffer.concat([
            u16((1 << 2) | 2),
            u16(attributeName),
            u16(systemNamespace),
          ]),
        ],
      ],
      [
        2,
        typeNames.map((name, index) =>
          typeDefRow({
            name,
            namespace: index === 0 ? 0 : namespace,
            fieldList: index === 2 ? 2 : 1,
            methodList: index === 2 ? 2 : 1,
            stringSize: 2,
            typeDefOrRefSize: 2,
            fieldListSize: 2,
            methodListSize: 2,
            extendsRaw: index === 0 ? 0 : (1 << 2) | 1,
            flags: index === 0 ? 0 : 0x0010_0001,
          }),
        ),
      ],
      [4, fieldNames.map((name) => fieldRow(name, fieldSignature, 2, 2))],
      [
        6,
        [1, 2].map(() =>
          methodDefRow({
            name: constructorName,
            signature: constructorSignature,
            stringSize: 2,
            blobSize: 2,
            parameterSize: 2,
            parameterList: 1,
            rva: methodRva,
            flags: 0x1886,
          }),
        ),
      ],
      [
        10,
        [
          memberRefRow({
            name: constructorName,
            signature: baseConstructorSignature,
            stringSize: 2,
            blobSize: 2,
            parentSize: 2,
          }),
        ],
      ],
      // The assembly attribute constructor is physical MethodDef row 1.
      [
        12,
        [
          customAttributeRow({
            value: attributeValue,
            options: { customAttributeTypeRaw: (1 << 3) | 2 },
            parentIndexSize: 2,
            typeIndexSize: 2,
            blobSize: 2,
            row: 1,
          }),
        ],
      ],
      [32, [assemblyRow(assemblyName, 2, 2)]],
      [35, [assemblyRefRow(runtimeName, 0, false, 2, 2)]],
    ]);
    if (fieldPointers !== null) rows.set(3, fieldPointers.map(u16));
    if (methodPointers !== null) rows.set(5, methodPointers.map(u16));
    return metadataRoot(
      {
        tables: tablesStream(rows, 0n, 0),
        strings: strings.toBuffer(),
        guid: guidHeap(),
        blob: blobs.toBuffer(),
      },
      options.streamName ?? "#-",
    );
  });
  // The shared PE shell defaults to an executable; this fixture is a DLL.
  image.writeUInt16LE(image.readUInt16LE(0x84 + 18) | 0x2000, 0x84 + 18);
  image.writeUInt32LE(0, 0x0200 + 20);
  return image;
};

/**
 * Two top-level types A and B, each enclosing a nested type named Inner with
 * one method M and one field F; the first Inner also encloses Leaf with a
 * method M. Every method shares the fixture body. Swapping the enclosing
 * types keeps every row but moves each Inner, with its Leaf, under the other
 * top-level type. NestedClass rows pair a nested TypeDef row with its
 * enclosing row and may be replaced to exercise malformed metadata.
 */
export const buildManagedNestedTypeFixture = ({
  swapEnclosing = false,
  nestedClassRows,
  literalTopLevelName,
  topLevelTypes = false,
}: {
  readonly swapEnclosing?: boolean;
  readonly nestedClassRows?: readonly (readonly [number, number])[];
  readonly literalTopLevelName?: string;
  readonly topLevelTypes?: boolean;
} = {}): Buffer => {
  const image = buildManagedFixtureImage({}, (methodRva) => {
    const strings = new StringHeap();
    const blobs = new BlobHeap();
    const moduleName = strings.add("Nested.dll");
    const assemblyName = strings.add("Fixture.Nested");
    const namespace = strings.add("Fixture");
    const typeNames = [
      "<Module>",
      "A",
      "B",
      "Inner",
      literalTopLevelName ?? (topLevelTypes ? "OtherInner" : "Inner"),
      "Leaf",
    ].map((name) => strings.add(name));
    const methodName = strings.add("M");
    const fieldName = strings.add("F");
    const objectName = strings.add("Object");
    const systemNamespace = strings.add("System");
    const runtimeName = strings.add("System.Runtime");
    const methodSignature = blobs.add(Buffer.from([0x20, 0, 0x08]));
    const fieldSignature = blobs.add(Buffer.from([0x06, 0x08]));
    // TypeDef rows 4 and 5 own one method and one field each; row 6 owns a method.
    const memberList = [1, 1, 1, 1, 2, 3];
    const rows = new Map<number, readonly Buffer[]>([
      [0, [moduleRow(moduleName, 2, 2)]],
      [
        1,
        [
          Buffer.concat([
            u16((1 << 2) | 2),
            u16(objectName),
            u16(systemNamespace),
          ]),
        ],
      ],
      [
        2,
        typeNames.map((name, index) =>
          typeDefRow({
            name,
            namespace: index === 1 || index === 2 ? namespace : 0,
            fieldList: Math.min(memberList[index] ?? 1, 3),
            methodList: memberList[index] ?? 1,
            stringSize: 2,
            typeDefOrRefSize: 2,
            fieldListSize: 2,
            methodListSize: 2,
            extendsRaw: index === 0 ? 0 : (1 << 2) | 1,
            flags:
              index <= 2 ||
              topLevelTypes ||
              (index === 4 && literalTopLevelName !== undefined)
                ? 0x0010_0001
                : 0x0010_0002,
          }),
        ),
      ],
      [4, [1, 2].map(() => fieldRow(fieldName, fieldSignature, 2, 2))],
      [
        6,
        [1, 2, 3].map(() =>
          methodDefRow({
            name: methodName,
            signature: methodSignature,
            stringSize: 2,
            blobSize: 2,
            parameterSize: 2,
            parameterList: 1,
            rva: methodRva,
            flags: 0x0086,
          }),
        ),
      ],
      [
        41,
        (
          nestedClassRows ??
          (topLevelTypes
            ? []
            : [
                [4, swapEnclosing ? 3 : 2],
                [5, swapEnclosing ? 2 : 3],
                [6, 4],
              ])
        )
          .filter(
            ([nested]) => literalTopLevelName === undefined || nested !== 5,
          )
          .map(([nested, enclosing]) =>
            Buffer.concat([u16(nested), u16(enclosing)]),
          ),
      ],
      [32, [assemblyRow(assemblyName, 2, 2)]],
      [35, [assemblyRefRow(runtimeName, 0, false, 2, 2)]],
    ]);
    return metadataRoot({
      tables: tablesStream(rows, 0n, 0),
      strings: strings.toBuffer(),
      guid: guidHeap(),
      blob: blobs.toBuffer(),
    });
  });
  // The shared PE shell defaults to an executable; this fixture is a DLL.
  image.writeUInt16LE(image.readUInt16LE(0x84 + 18) | 0x2000, 0x84 + 18);
  image.writeUInt32LE(0, 0x0200 + 20);
  return image;
};

/** Build a syntactically valid PE32 fixture with no CLI directory. */
export const buildNativePeFixture = (): Buffer => {
  const image = buildManagedPeFixture();
  const cliDirectory = 0x84 + 20 + 96 + 14 * 8;
  image.writeUInt32LE(0, cliDirectory);
  image.writeUInt32LE(0, cliDirectory + 4);
  return image;
};
