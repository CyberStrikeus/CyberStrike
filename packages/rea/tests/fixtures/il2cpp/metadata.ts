import {
  il2cppMetadataSectionNames,
  type IL2cppMetadataSectionName,
} from "../../../src/domain/il2cpp/il2cppMetadata.js";

type SectionName = IL2cppMetadataSectionName;
type Width = 1 | 2 | 4;

/** Synthetic version 39 metadata small enough to read in a hex dump. */
export interface Il2cppMetadataFixtureOptions {
  /** Serialized TypeIndex width. */
  readonly typeIndexWidth?: Width;
  /** Omit interfaceOffsets so the TypeIndex width comes from type records. */
  readonly interfaceOffsets?: boolean;
  /** Raw interfaceOffsets record size; defaults to 4 + typeIndexWidth. */
  readonly interfaceOffsetRecordBytes?: number;
  /** Make type 1 also list type 0, so 0 and 1 nest in each other. */
  readonly nestingCycle?: boolean;
  /** Append an image with no types, whose start is the -1 sentinel at the narrow width. */
  readonly emptyImage?: boolean;
  /** Nonempty property/event tables with deliberately different owner ranges. */
  readonly propertiesAndEvents?: boolean;
  /** Override type names while preserving the fixture's row ownership. */
  readonly typeNames?: Readonly<Record<number, string>>;
  readonly typeNamespaces?: Readonly<Record<number, string>>;
  /** Total generic argument count per type, including enclosing parameters. */
  readonly genericTypeArgumentCounts?: Readonly<Record<number, number>>;
  /** Metadata version; 29 and 31 use fixed 4-byte indices and no header counts. */
  readonly version?: 24 | 27 | 29 | 31 | 39;
  /**
   * Version 39 entry counts that widen the serialized indices: filler type
   * definitions (the last owns one extra method), zero-filled generic
   * containers, and zero-filled parameter rows that no method owns.
   */
  readonly wide?: {
    readonly fillerTypes: number;
    readonly genericContainers: number;
    readonly parameters: number;
  };
  /** Write FIXTURE_GENERIC_CONTAINERS and point their owners at them. */
  readonly genericOwners?: boolean;
}

/**
 * Generic containers as [owner, argument count, is method, first parameter]:
 * System.Größe<T0>, Game.Player.Slot.Add<T0, T1> and System.Größe.ToString<T0>;
 * the fixture names each container's parameters T0, T1 and so on.
 */
export const FIXTURE_GENERIC_CONTAINERS = [
  [3, 1, 0, 0],
  [2, 2, 1, 1],
  [4, 1, 1, 3],
] as const;

export const FIXTURE_IMAGES = [
  { name: "Assembly-CSharp.dll", type_start: 0, type_count: 3 },
  { name: "mscorlib.dll", type_start: 3, type_count: 1 },
] as const;

export const FIXTURE_TYPES = [
  {
    name: "Player",
    namespace: "Game",
    method_start: 0,
    method_count: 2,
    nested_type_start: 0,
    nested_type_count: 1,
    declaring_type: -1,
  },
  {
    name: "Slot",
    namespace: "",
    method_start: 2,
    method_count: 1,
    nested_type_start: -1,
    nested_type_count: 0,
    declaring_type: 0,
  },
  {
    name: "<Module>",
    namespace: "",
    method_start: -1,
    method_count: 0,
    nested_type_start: -1,
    nested_type_count: 0,
    declaring_type: -1,
  },
  {
    name: "Größe",
    namespace: "System",
    method_start: 3,
    method_count: 2,
    nested_type_start: -1,
    nested_type_count: 0,
    declaring_type: -1,
  },
] as const;

export const FIXTURE_METHODS = [
  { name: ".ctor", declaring_type: 0 },
  { name: "Update", declaring_type: 0 },
  { name: "Add", declaring_type: 1 },
  { name: ".ctor", declaring_type: 3 },
  { name: "ToString", declaring_type: 3 },
] as const;

/** Members of types 0 and 1; row position is the FieldIndex. */
export const FIXTURE_FIELDS = [
  { name: "slot", declaring_type: 0 },
  { name: "Count", declaring_type: 1 },
] as const;

export const FIXTURE_PROPERTIES = [
  { name: "IsActive", declaring_type: 0 },
  { name: "DisplayName", declaring_type: 0 },
  { name: "Capacity", declaring_type: 3 },
] as const;

export const FIXTURE_EVENTS = [
  { name: "Changed", declaring_type: 1 },
  { name: "Completed", declaring_type: 3 },
] as const;

/** The one parameter, owned by method 2 (`Add`). */
export const FIXTURE_PARAMETERS = [{ name: "amount", method: 2 }] as const;

const INVALID_UTF8_LITERAL = Buffer.from([0xff, 0xfe]);
export const FIXTURE_STRING_LITERALS = [
  { value: "Hello", value_base64: null },
  { value: null, value_base64: INVALID_UTF8_LITERAL.toString("base64") },
] as const;

/**
 * Per-image method tokens. Row ids restart in each image and do not follow
 * metadata order, so linking must use the token rather than the position.
 */
export const FIXTURE_METHOD_TOKENS = [
  0x06000002, 0x06000001, 0x06000003, 0x06000001, 0x06000002,
] as const;

const writeIndex = (
  target: Buffer,
  offset: number,
  width: Width,
  value: number,
) => {
  if (width === 1) target.writeUInt8(value === -1 ? 0xff : value, offset);
  else if (width === 2)
    target.writeUInt16LE(value === -1 ? 0xffff : value, offset);
  else target.writeInt32LE(value, offset);
};

/** Built bytes with helpers that address header fields and records by name. */
export interface Il2cppMetadataFixture {
  readonly bytes: Buffer;
  readonly typeIndexWidth: Width;
  readonly recordBytes: {
    readonly typeDefinitions: number;
    readonly images: number;
    readonly methods: number;
  };
  /** Byte offset of a header entry field; only version 39 records counts. */
  header(name: SectionName, field: "offset" | "size" | "count"): number;
  section(name: SectionName): {
    offset: number;
    size: number;
    count: number | null;
  };
  record(name: "typeDefinitions" | "images" | "methods", index: number): number;
  /** Absolute offset of a string's first byte in the strings section. */
  stringOffset(value: string): number;
}

type SectionContent = { bytes: Buffer; count: number };

/** Write the header and lay out non-empty sections in header order. */
const assembleFile = (
  version: 24 | 27 | 29 | 31 | 39,
  contents: ReadonlyMap<SectionName, SectionContent>,
) => {
  const fixed = version !== 39;
  const entryBytes = fixed ? 8 : 12;
  const names = il2cppMetadataSectionNames(version);
  const headerBytes = 8 + names.length * entryBytes;
  const header = Buffer.alloc(headerBytes);
  header.writeUInt32LE(0xfab11baf, 0);
  header.writeInt32LE(version, 4);
  const body: Buffer[] = [];
  let cursor = headerBytes;
  names.forEach((name, index) => {
    const content = contents.get(name);
    const at = 8 + index * entryBytes;
    header.writeInt32LE(cursor, at);
    header.writeInt32LE(content?.bytes.length ?? 0, at + 4);
    if (!fixed) header.writeInt32LE(content?.count ?? 0, at + 8);
    if (content !== undefined) {
      body.push(content.bytes);
      cursor += content.bytes.length;
    }
  });
  const bytes = Buffer.concat([header, ...body]);
  const headerField = (
    name: SectionName,
    field: "offset" | "size" | "count",
  ) => {
    if (fixed && field === "count")
      throw new Error(`Version ${version} headers record no counts`);
    return (
      8 +
      names.indexOf(name) * entryBytes +
      { offset: 0, size: 4, count: 8 }[field]
    );
  };
  const section = (name: SectionName) => ({
    offset: bytes.readInt32LE(headerField(name, "offset")),
    size: bytes.readInt32LE(headerField(name, "size")),
    count: fixed ? null : bytes.readInt32LE(headerField(name, "count")),
  });
  return { bytes, headerField, section };
};

/** Image rows a fixture holds, including the optional empty image. */
export const fixtureImages = (options: Il2cppMetadataFixtureOptions = {}) => [
  ...FIXTURE_IMAGES,
  ...(options.emptyImage === true
    ? [{ name: "Empty.dll", type_start: -1, type_count: 0 }]
    : []),
];

/** Method records with parameter ranges for the fixture parameters. */
const encodeMethods = (
  rows: readonly { readonly name: string; readonly declaring_type: number }[],
  methodBytes: number,
  { D, T, P, G }: Readonly<Record<"D" | "T" | "P" | "G", Width>>,
  returnToken: number,
  intern: (value: string) => number,
  methodContainerIndices: ReadonlyMap<number, number>,
) => {
  const recordBytes = { methods: methodBytes };
  const methods = Buffer.alloc(rows.length * recordBytes.methods);
  rows.forEach((method, index) => {
    const at = index * recordBytes.methods;
    methods.writeInt32LE(intern(method.name), at);
    writeIndex(methods, at + 4, D, method.declaring_type);
    writeIndex(methods, at + 4 + D, T, 0);
    const parameterStart = at + 4 + D + T + returnToken;
    const parameters = FIXTURE_PARAMETERS.filter(
      (parameter) => parameter.method === index,
    ).length;
    writeIndex(
      methods,
      parameterStart,
      P,
      parameters === 0
        ? -1
        : FIXTURE_PARAMETERS.findIndex(
            (parameter) => parameter.method === index,
          ),
    );
    writeIndex(
      methods,
      parameterStart + P,
      G,
      methodContainerIndices.get(index) ?? -1,
    );
    methods.writeUInt32LE(
      FIXTURE_METHOD_TOKENS[index]!,
      parameterStart + P + G,
    );
    methods.writeUInt16LE(parameters, at + recordBytes.methods - 2);
  });

  return methods;
};

/** Named member, parameter and string literal sections for the fixture rows. */
const encodeMembers = ({
  T,
  fixed,
  intern,
  named,
}: {
  readonly T: Width;
  readonly fixed: boolean;
  readonly intern: (value: string) => number;
  readonly named: {
    readonly properties: readonly { name: string }[];
    readonly events: readonly { name: string }[];
  };
}) => {
  // Field records: name, type index, token. Parameters: name, token, type.
  const fields = Buffer.alloc(FIXTURE_FIELDS.length * (8 + T));
  FIXTURE_FIELDS.forEach((field, index) => {
    fields.writeInt32LE(intern(field.name), index * (8 + T));
    writeIndex(fields, index * (8 + T) + 4, T, 0);
  });
  // Property: name, get, set, flags, token. Event: name, TypeIndex,
  // add/remove/raise MethodIndex values, token. Method indices stay int32.
  const properties = Buffer.alloc(named.properties.length * 20);
  named.properties.forEach((property, index) => {
    const at = index * 20;
    properties.writeInt32LE(intern(property.name), at);
    properties.writeInt32LE(0, at + 4);
    properties.writeInt32LE(1, at + 8);
    properties.writeUInt32LE(0x17000001 + index, at + 16);
  });
  const events = Buffer.alloc(named.events.length * (20 + T));
  named.events.forEach((event, index) => {
    const at = index * (20 + T);
    events.writeInt32LE(intern(event.name), at);
    writeIndex(events, at + 4, T, 0x2a);
    events.writeInt32LE(1, at + 4 + T);
    events.writeInt32LE(2, at + 8 + T);
    events.writeInt32LE(3, at + 12 + T);
    events.writeUInt32LE(0x14000001 + index, at + 16 + T);
  });
  const parameterRows = Buffer.alloc(FIXTURE_PARAMETERS.length * (8 + T));
  FIXTURE_PARAMETERS.forEach((parameter, index) => {
    parameterRows.writeInt32LE(intern(parameter.name), index * (8 + T));
    writeIndex(parameterRows, index * (8 + T) + 8, T, 0);
  });
  // Version 39 stores start offsets plus a sentinel; earlier versions store
  // (length, offset) pairs.
  const literalData = Buffer.concat([
    Buffer.from("Hello", "utf8"),
    INVALID_UTF8_LITERAL,
  ]);
  const literalStarts = [0, 5, literalData.length];
  const literals = fixed
    ? Buffer.alloc(16)
    : Buffer.alloc(literalStarts.length * 4);
  if (fixed)
    [
      [5, 0],
      [INVALID_UTF8_LITERAL.length, 5],
    ].forEach(([length, start], index) => {
      literals.writeUInt32LE(length!, index * 8);
      literals.writeInt32LE(start!, index * 8 + 4);
    });
  else
    literalStarts.forEach((start, index) =>
      literals.writeInt32LE(start, index * 4),
    );

  return {
    fields,
    properties,
    events,
    parameterRows,
    literals,
    literalData,
    literalRecords: fixed ? 2 : literalStarts.length,
  };
};

const widthFor = (entries: number): Width =>
  entries <= 0xff ? 1 : entries <= 0xffff ? 2 : 4;

/** Type and method rows a fixture holds, including any wide-index filler. */
export const fixtureRows = (options: Il2cppMetadataFixtureOptions = {}) => {
  const fillers = options.wide?.fillerTypes ?? 0;
  const last = FIXTURE_TYPES.length + fillers - 1;
  const types = [
    ...FIXTURE_TYPES.map((type, index) => ({
      ...type,
      name: options.typeNames?.[index] ?? type.name,
      namespace: options.typeNamespaces?.[index] ?? type.namespace,
    })),
    ...Array.from({ length: fillers }, (_, index) => ({
      name: "Filler",
      namespace: "",
      method_start: index === fillers - 1 ? FIXTURE_METHODS.length : -1,
      method_count: index === fillers - 1 ? 1 : 0,
      nested_type_start: -1,
      nested_type_count: 0,
      declaring_type: -1,
    })),
  ];
  const methods = [
    ...FIXTURE_METHODS,
    ...(fillers === 0 ? [] : [{ name: "Fill", declaring_type: last }]),
  ];
  return { types, methods };
};

/** A zero-filled section of `count` records, or none when `count` is 0. */
const zeroFilledSection = (
  name: SectionName,
  count: number,
  recordBytes: number,
): [SectionName, SectionContent][] =>
  count === 0
    ? []
    : [[name, { bytes: Buffer.alloc(count * recordBytes), count }]];

/** Real rows followed by zero-filled rows that no owner claims. */
const paddedRows = (
  rows: Buffer,
  count: number,
  recordBytes: number,
): SectionContent => ({
  bytes: Buffer.concat([rows, Buffer.alloc(count * recordBytes - rows.length)]),
  count,
});

/** Encode the type record and its distinct member ranges in one place. */
const encodeTypes = ({
  typeRows,
  recordSize,
  T,
  G,
  typeIndexFields,
  named,
  genericContainerIndices,
  intern,
}: {
  readonly typeRows: ReturnType<typeof fixtureRows>["types"];
  readonly recordSize: number;
  readonly T: Width;
  readonly G: Width;
  readonly typeIndexFields: number;
  readonly named: {
    readonly properties: readonly { declaring_type: number }[];
    readonly events: readonly { declaring_type: number }[];
  };
  readonly genericContainerIndices: ReadonlyMap<number, number>;
  readonly intern: (value: string) => number;
}) => {
  const types = Buffer.alloc(typeRows.length * recordSize);
  typeRows.forEach((type, index) => {
    let at = index * recordSize;
    types.writeInt32LE(intern(type.name), at);
    types.writeInt32LE(intern(type.namespace), at + 4);
    at += 8;
    // byval, native declaring and parent TypeIndex values are deliberately
    // unrelated to nesting; the reader must use nestedTypes instead.
    for (let field = 0; field < typeIndexFields; field += 1, at += T)
      writeIndex(types, at, T, 0x2a);
    writeIndex(types, at, G, genericContainerIndices.get(index) ?? -1);
    at += G + 4;
    const fieldStart = FIXTURE_FIELDS.findIndex(
      (field) => field.declaring_type === index,
    );
    const fieldCount = FIXTURE_FIELDS.filter(
      (field) => field.declaring_type === index,
    ).length;
    const starts = [
      fieldStart,
      type.method_start,
      named.events.findIndex((event) => event.declaring_type === index),
      named.properties.findIndex(
        (property) => property.declaring_type === index,
      ),
      type.nested_type_start,
    ];
    starts.forEach((value, field) => types.writeInt32LE(value, at + field * 4));
    types.writeInt32LE(-1, at + 20);
    types.writeInt32LE(-1, at + 24);
    types.writeInt32LE(-1, at + 28);
    at += 32;
    types.writeUInt16LE(type.method_count, at);
    types.writeUInt16LE(
      named.properties.filter((property) => property.declaring_type === index)
        .length,
      at + 2,
    );
    types.writeUInt16LE(fieldCount, at + 4);
    types.writeUInt16LE(
      named.events.filter((event) => event.declaring_type === index).length,
      at + 6,
    );
    types.writeUInt16LE(type.nested_type_count, at + 8);
    at += 16;
    types.writeUInt32LE(0, at);
    types.writeUInt32LE(0x02000001 + index, at + 4);
  });

  return types;
};

const genericContainerLayout = (
  options: Il2cppMetadataFixtureOptions,
  fixed: boolean,
) => {
  if (
    options.genericOwners === true &&
    options.genericTypeArgumentCounts !== undefined
  )
    throw new Error("genericOwners already declares the type containers");
  const definitions =
    options.genericOwners === true
      ? FIXTURE_GENERIC_CONTAINERS.map(([type, argumentCount, isMethod]) => ({
          type,
          argumentCount,
          isMethod,
        }))
      : Object.entries(options.genericTypeArgumentCounts ?? {})
          .map(([type, argumentCount]) => ({
            type: Number(type),
            argumentCount,
            isMethod: 0,
          }))
          .sort((left, right) => left.type - right.type);
  const count = Math.max(
    options.wide?.genericContainers ?? 0,
    definitions.length,
  );
  const owners = (isMethod: number) =>
    new Map(
      definitions.flatMap(({ type, isMethod: method }, index) =>
        method === isMethod ? [[type, index] as const] : [],
      ),
    );
  return {
    definitions,
    indices: owners(0),
    methodIndices: owners(1),
    count,
    width: fixed ? 4 : widthFor(count),
  };
};

const encodeGenericContainerTables = (
  definitions: readonly {
    type: number;
    argumentCount: number;
    isMethod: number;
  }[],
  containerCount: number,
  width: Width,
  intern: (value: string) => number,
) => {
  const parameters = definitions.flatMap(({ argumentCount }, container) =>
    Array.from({ length: argumentCount }, (_, num) => ({
      container,
      num,
      name: `T${String(num)}`,
    })),
  );
  for (const parameter of parameters) intern(parameter.name);

  const containers = Buffer.alloc(containerCount * 16);
  let parameterStart = 0;
  definitions.forEach(({ type, argumentCount, isMethod }, index) => {
    const at = index * 16;
    containers.writeInt32LE(type, at);
    containers.writeInt32LE(argumentCount, at + 4);
    containers.writeInt32LE(isMethod, at + 8);
    containers.writeInt32LE(parameterStart, at + 12);
    parameterStart += argumentCount;
  });

  const parameterBytes = Buffer.alloc(parameters.length * (width + 12));
  parameters.forEach((parameter, index) => {
    const at = index * (width + 12);
    writeIndex(parameterBytes, at, width, parameter.container);
    parameterBytes.writeInt32LE(intern(parameter.name), at + width);
    parameterBytes.writeInt16LE(-1, at + width + 4);
    parameterBytes.writeUInt16LE(0, at + width + 6);
    parameterBytes.writeUInt16LE(parameter.num, at + width + 8);
    parameterBytes.writeUInt16LE(0, at + width + 10);
  });
  return {
    containers,
    parameters: parameterBytes,
    parameterCount: parameters.length,
  };
};

const encodeImageRows = (
  images: readonly ReturnType<typeof fixtureImages>[number][],
  recordSize: number,
  typeDefinitionWidth: Width,
  intern: (value: string) => number,
) => {
  const bytes = Buffer.alloc(images.length * recordSize);
  images.forEach((image, index) => {
    const at = index * recordSize;
    bytes.writeInt32LE(intern(image.name), at);
    bytes.writeInt32LE(index, at + 4);
    writeIndex(bytes, at + 8, typeDefinitionWidth, image.type_start);
    bytes.writeUInt32LE(image.type_count, at + 8 + typeDefinitionWidth);
    writeIndex(bytes, at + 12 + typeDefinitionWidth, typeDefinitionWidth, -1);
    bytes.writeUInt32LE(0, at + 12 + 2 * typeDefinitionWidth);
    bytes.writeInt32LE(-1, at + 16 + 2 * typeDefinitionWidth);
  });
  return bytes;
};

const createStringTable = () => {
  const parts: Buffer[] = [];
  const offsets = new Map<string, number>();
  let size = 0;
  const intern = (value: string) => {
    const known = offsets.get(value);
    if (known !== undefined) return known;
    const encoded = Buffer.from(`${value}\0`, "utf8");
    offsets.set(value, size);
    parts.push(encoded);
    size += encoded.length;
    return offsets.get(value)!;
  };
  return {
    intern,
    bytes: () => Buffer.concat(parts),
    count: () => offsets.size,
    offset: (value: string) => {
      const index = offsets.get(value);
      if (index === undefined) throw new Error(`Unknown string ${value}`);
      return index;
    },
  };
};

/** Lay sections out in header order; empty sections share the next offset. */
export const createIl2cppMetadataFixture = (
  options: Il2cppMetadataFixtureOptions = {},
): Il2cppMetadataFixture => {
  const version = options.version ?? 39;
  const fixed = version !== 39;
  const T: Width = fixed ? 4 : (options.typeIndexWidth ?? 1);
  const rows = fixtureRows(options);
  const named = {
    properties: options.propertiesAndEvents ? FIXTURE_PROPERTIES : [],
    events: options.propertiesAndEvents ? FIXTURE_EVENTS : [],
  };
  const genericLayout = genericContainerLayout(options, fixed);
  const parameterCount = Math.max(
    options.wide?.parameters ?? 0,
    FIXTURE_PARAMETERS.length,
  );
  const D: Width = fixed ? 4 : widthFor(rows.types.length);
  const G = genericLayout.width;
  const P: Width = fixed ? 4 : widthFor(parameterCount);
  // Versions 29 and 31 also store elementTypeIndex in type records.
  const typeIndexFields = version === 24 ? 5 : fixed ? 4 : 3;
  // Version 31 added returnParameterToken to method records.
  const returnToken = version === 31 || version === 39 ? 4 : 0;
  const nestedTypeEntries = options.nestingCycle === true ? [1, 0] : [1];
  const typeRows = rows.types.map((type, index) =>
    options.nestingCycle === true && index === 1
      ? { ...type, nested_type_start: 1, nested_type_count: 1 }
      : type,
  );
  const recordBytes = {
    typeDefinitions: 68 + typeIndexFields * T + G,
    images: 32 + 2 * D,
    methods: 16 + returnToken + D + T + P + G,
  };

  const stringTable = createStringTable();
  const { intern } = stringTable;
  const imageRows = fixtureImages(options);
  for (const image of imageRows) intern(image.name);
  for (const type of FIXTURE_TYPES) {
    intern(type.name);
    intern(type.namespace);
  }
  for (const row of [...rows.types, ...rows.methods]) intern(row.name);
  for (const row of [...FIXTURE_FIELDS, ...FIXTURE_PARAMETERS])
    intern(row.name);
  const genericRows = encodeGenericContainerTables(
    genericLayout.definitions,
    genericLayout.count,
    G,
    intern,
  );

  const types = encodeTypes({
    typeRows,
    recordSize: recordBytes.typeDefinitions,
    T,
    G,
    typeIndexFields,
    named,
    genericContainerIndices: genericLayout.indices,
    intern,
  });

  const images = encodeImageRows(imageRows, recordBytes.images, D, intern);

  const methods = encodeMethods(
    rows.methods,
    recordBytes.methods,
    { D, T, P, G },
    returnToken,
    intern,
    genericLayout.methodIndices,
  );

  const {
    fields,
    properties,
    events,
    parameterRows,
    literals,
    literalData,
    literalRecords,
  } = encodeMembers({ T, fixed, intern, named });

  const nested = Buffer.alloc(nestedTypeEntries.length * 4);
  nestedTypeEntries.forEach((value, index) =>
    nested.writeInt32LE(value, index * 4),
  );

  const interfaceOffsetBytes = options.interfaceOffsetRecordBytes ?? 4 + T;
  const interfaceOffsets =
    options.interfaceOffsets === false
      ? null
      : Buffer.alloc(interfaceOffsetBytes);

  const contents = new Map<SectionName, SectionContent>([
    ["stringLiterals", { bytes: literals, count: literalRecords }],
    ["stringLiteralData", { bytes: literalData, count: 2 }],
    ["strings", { bytes: stringTable.bytes(), count: stringTable.count() }],
    // Wide-index padding rows are zero-filled and owned by no method.
    ["parameters", paddedRows(parameterRows, parameterCount, 8 + T)],
    ...(genericRows.parameterCount === 0
      ? []
      : [
          [
            "genericParameters",
            {
              bytes: genericRows.parameters,
              count: genericRows.parameterCount,
            },
          ] as [SectionName, SectionContent],
        ]),
    ["fields", { bytes: fields, count: FIXTURE_FIELDS.length }],
    ["properties", { bytes: properties, count: named.properties.length }],
    ["events", { bytes: events, count: named.events.length }],
    ["methods", { bytes: methods, count: rows.methods.length }],
    ...(genericLayout.count === 0
      ? []
      : [
          [
            "genericContainers",
            { bytes: genericRows.containers, count: genericLayout.count },
          ] as [SectionName, SectionContent],
        ]),
    ["nestedTypes", { bytes: nested, count: nestedTypeEntries.length }],
    ["typeDefinitions", { bytes: types, count: typeRows.length }],
    ["images", { bytes: images, count: imageRows.length }],
    ...(interfaceOffsets === null
      ? []
      : [
          ["interfaceOffsets", { bytes: interfaceOffsets, count: 1 }] as [
            SectionName,
            SectionContent,
          ],
        ]),
  ]);

  const { bytes, headerField, section } = assembleFile(version, contents);
  return {
    bytes,
    typeIndexWidth: T,
    recordBytes,
    header: headerField,
    section,
    record: (name, index) => section(name).offset + index * recordBytes[name],
    stringOffset: (value) =>
      section("strings").offset + stringTable.offset(value),
  };
};

/** Fixture variant whose generic instance type arguments have metadata owners. */
export const createLinkedIl2cppMetadataFixture = (
  options: Il2cppMetadataFixtureOptions = {},
): Il2cppMetadataFixture =>
  createIl2cppMetadataFixture({
    ...options,
    genericTypeArgumentCounts: options.genericTypeArgumentCounts ?? { 3: 1 },
  });
