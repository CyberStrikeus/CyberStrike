import {
  checkRange,
  checkedSectionCount,
  readIndex,
  Il2cppMetadataFormatFailure,
} from "./Il2cppMetadataFormat.js";
import {
  IL2CPP_METADATA_VERSIONS,
  il2cppMetadataSectionNames,
  type Il2cppMetadata,
  type Il2cppMetadataSection,
  type IL2cppMetadataSectionName,
} from "../domain/il2cpp/il2cppMetadata.js";
import { observeIl2cppMetadataHeaderPrefix } from "../domain/il2cpp/il2cppMetadataHeaderPrefix.js";
import { firstDeclaringTypeCycle } from "../domain/il2cpp/il2cppDeclaringTypes.js";
import {
  readIl2cppMembers,
  readIl2cppMemberTables,
  type MetadataOwnerRange,
} from "./Il2cppMetadataMembers.js";

const NESTED_TYPE_ENTRY_BYTES = 4;

type SectionName = IL2cppMetadataSectionName;
type IndexWidth = 1 | 2 | 4;
export type Il2cppMetadataVersion = (typeof IL2CPP_METADATA_VERSIONS)[number];
type RecordSection = "typeDefinitions" | "images" | "methods";
export type Il2cppMetadataDecoded = Omit<
  Il2cppMetadata,
  | "artifact"
  | "limitations"
  | "binary"
  | "method_addresses"
  | "return_types"
  | "field_types"
  | "parameter_types"
  | "generic_method_instances"
>;

/**
 * Version-specific header and record shape. "fixed" headers hold
 * (offset, size) pairs and every index is a 4-byte int32; "counted" headers
 * hold (offset, size, count) triples whose counts select variable index widths.
 */
interface VersionLayout {
  readonly indexing: "fixed" | "counted";
  /** Type index fields: version 24 adds byref, 24 to 31 add elementTypeIndex. */
  readonly typeDefinitionTypeIndices: 3 | 4 | 5;
  /** Version 31 added returnParameterToken to method records. */
  readonly methodReturnParameterToken: boolean;
}

const VERSION_LAYOUTS: Readonly<Record<Il2cppMetadataVersion, VersionLayout>> =
  {
    27: {
      indexing: "fixed",
      typeDefinitionTypeIndices: 4,
      methodReturnParameterToken: false,
    },
    24: {
      indexing: "fixed",
      typeDefinitionTypeIndices: 5,
      methodReturnParameterToken: false,
    },
    29: {
      indexing: "fixed",
      typeDefinitionTypeIndices: 4,
      methodReturnParameterToken: false,
    },
    31: {
      indexing: "fixed",
      typeDefinitionTypeIndices: 4,
      methodReturnParameterToken: true,
    },
    39: {
      indexing: "counted",
      typeDefinitionTypeIndices: 3,
      methodReturnParameterToken: true,
    },
  };

const sectionEntryBytes = (layout: VersionLayout) =>
  layout.indexing === "counted" ? 12 : 8;

/** Magic, version and one entry per section. */
export const il2cppMetadataHeaderBytes = (version: Il2cppMetadataVersion) =>
  8 +
  il2cppMetadataSectionNames(version).length *
    sectionEntryBytes(VERSION_LAYOUTS[version]);

const isSupportedVersion = (value: number): value is Il2cppMetadataVersion =>
  (IL2CPP_METADATA_VERSIONS as readonly number[]).includes(value);

/** Width the runtime selects for an index into a collection of this many entries. */
export const il2cppIndexWidth = (entries: number): IndexWidth =>
  entries <= 0xff ? 1 : entries <= 0xffff ? 2 : 4;

/** Record sizes implied by the index widths of one metadata version. */
export const il2cppMetadataRecordBytes = (
  widths: {
    readonly type_definition: IndexWidth;
    readonly generic_container: IndexWidth;
    readonly parameter: IndexWidth;
    readonly type: IndexWidth;
  },
  version: Il2cppMetadataVersion,
): Readonly<Record<RecordSection, number>> => {
  const layout = VERSION_LAYOUTS[version];
  return {
    // Two string indices, the type indices, a generic container index,
    // flags, eight int32 starts, eight uint16 counts, bitfield and token.
    typeDefinitions:
      68 +
      layout.typeDefinitionTypeIndices * widths.type +
      widths.generic_container,
    // Name, assembly, two type-definition starts with uint32 counts, entry
    // point, token, custom-attribute start and count.
    images: 32 + 2 * widths.type_definition,
    // Name, declaring type, return type, optional return token, parameter
    // start, generic container, token and four uint16 fields.
    methods:
      16 +
      (layout.methodReturnParameterToken ? 4 : 0) +
      widths.type_definition +
      widths.type +
      widths.parameter +
      widths.generic_container,
  };
};

const isIndexWidth = (value: number): value is IndexWidth =>
  value === 1 || value === 2 || value === 4;

const readHeader = (bytes: Buffer) => {
  const prefix = observeIl2cppMetadataHeaderPrefix(bytes);
  if (prefix.kind !== "il2cpp")
    throw new Il2cppMetadataFormatFailure(
      "unrecognized-magic",
      "the file does not start with the IL2CPP global-metadata magic 0xFAB11BAF; encrypted or non-metadata inputs are not decoded",
    );
  if (prefix.version === null)
    throw new Il2cppMetadataFormatFailure(
      "truncated-header",
      `the file has ${bytes.length} bytes, fewer than the 8-byte magic/version prefix; the metadata version is unknown`,
    );
  const { magic, version } = prefix;
  if (!isSupportedVersion(version))
    throw new Il2cppMetadataFormatFailure(
      "unsupported-version",
      `metadata version ${version} is not supported; versions ${IL2CPP_METADATA_VERSIONS.join(", ")} are decoded`,
    );
  const headerBytes = il2cppMetadataHeaderBytes(version);
  if (bytes.length < headerBytes)
    throw new Il2cppMetadataFormatFailure(
      "truncated-header",
      `the file has ${bytes.length} bytes, fewer than the ${headerBytes}-byte version ${version} header`,
    );
  const entryBytes = sectionEntryBytes(VERSION_LAYOUTS[version]);
  const sections: Il2cppMetadataSection[] = il2cppMetadataSectionNames(
    version,
  ).map((name, index) => {
    const at = 8 + index * entryBytes;
    return {
      name,
      offset: bytes.readInt32LE(at),
      size: bytes.readInt32LE(at + 4),
      count: entryBytes === 12 ? bytes.readInt32LE(at + 8) : null,
    };
  });
  return { magic, version, headerBytes, sections } as const;
};

const checkSections = (
  bytes: Buffer,
  headerBytes: number,
  sections: readonly Il2cppMetadataSection[],
) => {
  const first = sections[0];
  if (first?.offset !== headerBytes)
    throw new Il2cppMetadataFormatFailure(
      "unexpected-header-size",
      `stringLiterals starts at ${String(first?.offset)}, not immediately after the ${headerBytes}-byte header`,
    );
  for (const section of sections)
    if (
      section.offset < 0 ||
      section.size < 0 ||
      (section.count ?? 0) < 0 ||
      section.offset + section.size > bytes.length
    )
      throw new Il2cppMetadataFormatFailure(
        "section-out-of-bounds",
        `section ${section.name} (offset ${section.offset}, size ${section.size}, count ${String(section.count)}) is negative or extends past the ${bytes.length}-byte file`,
      );
    else if (section.size > 0 && section.offset < headerBytes)
      throw new Il2cppMetadataFormatFailure(
        "section-out-of-bounds",
        `section ${section.name} starts at ${section.offset}, inside the ${headerBytes}-byte header`,
      );
  // Empty sections may share an offset with any neighbor; gaps are padding.
  const occupied = sections
    .filter((section) => section.size > 0)
    .sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < occupied.length; index += 1) {
    const previous = occupied[index - 1]!;
    const current = occupied[index]!;
    if (previous.offset + previous.size > current.offset)
      throw new Il2cppMetadataFormatFailure(
        "section-overlap",
        `section ${previous.name} [${previous.offset}, ${previous.offset + previous.size}) overlaps ${current.name} starting at ${current.offset}`,
      );
  }
};

/** A counted header's entry count; fixed headers record none. */
const headerCount = (section: Il2cppMetadataSection) => {
  if (section.count === null)
    throw new TypeError(`section ${section.name} has no header count`);
  return section.count;
};

/** Record size from a counted header; null for an empty section. */
const recordBytes = (section: Il2cppMetadataSection): number | null => {
  const count = headerCount(section);
  if (count === 0) {
    if (section.size !== 0)
      throw new Il2cppMetadataFormatFailure(
        "record-size-mismatch",
        `section ${section.name} declares ${section.size} bytes for zero records`,
      );
    return null;
  }
  if (section.size % count !== 0)
    throw new Il2cppMetadataFormatFailure(
      "record-size-mismatch",
      `section ${section.name} size ${section.size} is not a whole multiple of its ${count} records`,
    );
  return section.size / count;
};

const FIXED_WIDTHS: Il2cppMetadataDecoded["index_widths"] = {
  type_definition: 4,
  generic_container: 4,
  parameter: 4,
  type: 4,
  type_width_source: "fixed-width-version",
};

const GENERIC_CONTAINER_RECORD_BYTES = 16;

const resolveWidths = (
  section: (name: SectionName) => Il2cppMetadataSection,
): Il2cppMetadataDecoded["index_widths"] => {
  const genericContainers = section("genericContainers");
  const type_definition = il2cppIndexWidth(
    headerCount(section("typeDefinitions")),
  );
  const generic_container = il2cppIndexWidth(headerCount(genericContainers));
  const parameter = il2cppIndexWidth(headerCount(section("parameters")));
  // TypeIndex counts native types, so its width is recovered from records.
  const interfaceOffset = recordBytes(section("interfaceOffsets"));
  let type: number;
  let type_width_source: Il2cppMetadataDecoded["index_widths"]["type_width_source"];
  if (interfaceOffset !== null) {
    type = interfaceOffset - 4;
    type_width_source = "interface-offsets-record";
  } else {
    const typeDefinition = recordBytes(section("typeDefinitions"));
    type =
      typeDefinition === null
        ? Number.NaN
        : (typeDefinition - 68 - generic_container) / 3;
    type_width_source = "type-definition-record";
  }
  if (!isIndexWidth(type))
    throw new Il2cppMetadataFormatFailure(
      "type-index-width",
      `the ${type_width_source} does not imply a 1-, 2- or 4-byte TypeIndex`,
    );
  return {
    type_definition,
    generic_container,
    parameter,
    type,
    type_width_source,
  };
};

/** Record counts checked against the record sizes the widths imply. */
const recordCounts = (
  version: Il2cppMetadataVersion,
  section: (name: SectionName) => Il2cppMetadataSection,
  expected: Readonly<Record<RecordSection, number>>,
  widths: Il2cppMetadataDecoded["index_widths"],
): Readonly<
  Record<
    RecordSection | "nestedTypes" | "genericContainers" | "genericParameters",
    number
  >
> => {
  const genericContainers = checkedSectionCount(
    section("genericContainers"),
    GENERIC_CONTAINER_RECORD_BYTES,
  );
  const genericParameters = checkedSectionCount(
    section("genericParameters"),
    widths.generic_container + 12,
  );
  const names = ["typeDefinitions", "images", "methods"] as const;
  if (VERSION_LAYOUTS[version].indexing === "fixed") {
    checkedSectionCount(section("interfaceOffsets"), widths.type + 4);
    const sized = Object.fromEntries(
      names.map((name) => [
        name,
        checkedSectionCount(section(name), expected[name]),
      ]),
    ) as Record<RecordSection, number>;
    return {
      ...sized,
      nestedTypes: checkedSectionCount(
        section("nestedTypes"),
        NESTED_TYPE_ENTRY_BYTES,
      ),
      genericContainers,
      genericParameters,
    };
  }
  const counted = Object.fromEntries(
    names.map((name) => [
      name,
      checkedSectionCount(section(name), expected[name]),
    ]),
  ) as Record<RecordSection, number>;
  return {
    ...counted,
    nestedTypes: checkedSectionCount(
      section("nestedTypes"),
      NESTED_TYPE_ENTRY_BYTES,
    ),
    genericContainers,
    genericParameters,
  };
};

/**
 * Decode NUL-terminated UTF-8 names once each from the strings section. Indices
 * are byte offsets and may refer to a suffix of another stored name. Bounds,
 * termination, UTF-8 validity, and the total decoding budget remain enforced.
 */
const createStringReader = (
  bytes: Buffer,
  strings: Il2cppMetadataSection,
  beforeText?: (bytes: number) => void,
) => {
  const stringEnd = strings.offset + strings.size;
  const pool = bytes.subarray(strings.offset, stringEnd);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const cache = new Map<number, string>();
  return (index: number, label: string) => {
    const cached = cache.get(index);
    if (cached !== undefined) return cached;
    const end = index < 0 || index >= pool.length ? -1 : pool.indexOf(0, index);
    if (end === -1)
      throw new Il2cppMetadataFormatFailure(
        "invalid-string",
        `${label} string index ${index} has no terminated entry inside the ${strings.size}-byte string section`,
      );
    beforeText?.(end - index);
    let value: string;
    try {
      value = decoder.decode(pool.subarray(index, end));
    } catch (cause: unknown) {
      throw new Il2cppMetadataFormatFailure(
        "invalid-string",
        `${label} string index ${index} is not valid UTF-8`,
        { cause },
      );
    }
    cache.set(index, value);
    return value;
  };
};

/** Checked header facts shared by the record readers. */
export interface MetadataTables {
  readonly bytes: Buffer;
  readonly section: (name: SectionName) => Il2cppMetadataSection;
  readonly widths: Il2cppMetadataDecoded["index_widths"];
  readonly recordBytes: ReturnType<typeof il2cppMetadataRecordBytes>;
  readonly counts: ReturnType<typeof recordCounts>;
  readonly typeDefinitionTypeIndices: number;
  readonly indexing: "fixed" | "counted";
  readonly methodReturnParameterToken: boolean;
  readonly readString: ReturnType<typeof createStringReader>;
  readonly members: ReturnType<typeof readIl2cppMemberTables>;
  readonly beforeText: Il2cppMetadataReadOptions["beforeText"];
  readonly onRow: Il2cppMetadataReadOptions["onRow"];
  readonly linkFacts?: Il2cppMetadataLinkFacts;
}

function* readImages({
  bytes,
  section,
  widths,
  recordBytes: sizes,
  counts,
  readString,
  onRow,
}: MetadataTables): Generator<void, Il2cppMetadataDecoded["images"]> {
  const images = section("images");
  const typeTotal = counts.typeDefinitions;
  const width = widths.type_definition;
  const result: Il2cppMetadataDecoded["images"] = [];
  for (let index = 0; index < counts.images; index++) {
    if (index % 256 === 0) yield;
    const at = images.offset + index * sizes.images;
    const image = {
      name: readString(bytes.readInt32LE(at), `image ${index} name`),
      type_start: readIndex(bytes, at + 8, width),
      type_count: bytes.readUInt32LE(at + 8 + width),
    };
    checkRange(
      `image ${index} types`,
      image.type_start,
      image.type_count,
      typeTotal,
    );
    onRow?.(image);
    result.push(image);
  }
  return result;
}

/** Record each type's enclosing type from its declaring type's nestedTypes range. */
function* assignNesting(
  { bytes, section, counts }: MetadataTables,
  types: Il2cppMetadataDecoded["types"],
) {
  let work = 0;
  const nestedTypes = section("nestedTypes");
  for (const [index, type] of types.entries()) {
    if (work++ % 256 === 0) yield;
    checkRange(
      `type ${index} nested types`,
      type.nested_type_start,
      type.nested_type_count,
      counts.nestedTypes,
    );
    for (let offset = 0; offset < type.nested_type_count; offset += 1) {
      if (work++ % 256 === 0) yield;
      const nested = bytes.readInt32LE(
        nestedTypes.offset +
          (type.nested_type_start + offset) * NESTED_TYPE_ENTRY_BYTES,
      );
      const target = types[nested];
      if (target === undefined)
        throw new Il2cppMetadataFormatFailure(
          "index-out-of-range",
          `type ${index} lists nested type ${nested} outside the ${types.length} type definitions`,
        );
      if (nested === index)
        throw new Il2cppMetadataFormatFailure(
          "nested-type-conflict",
          `type ${index} lists itself as a nested type`,
        );
      if (target.declaring_type !== -1)
        throw new Il2cppMetadataFormatFailure(
          "nested-type-conflict",
          `type ${nested} is listed as nested in type ${index} and type ${target.declaring_type}`,
        );
      target.declaring_type = index;
    }
  }
  yield* rejectNestingCycles(types);
}

/** Each enclosing chain must reach a top-level type. */
function* rejectNestingCycles(types: Il2cppMetadataDecoded["types"]) {
  const cycle = yield* firstDeclaringTypeCycle(types);
  if (cycle !== null)
    throw new Il2cppMetadataFormatFailure(
      "nested-type-conflict",
      `type ${cycle} is nested inside itself through its declaring types`,
    );
}

function* readTypes(tables: MetadataTables): Generator<
  void,
  {
    types: Il2cppMetadataDecoded["types"];
    memberRanges: {
      fields: MetadataOwnerRange[];
      properties: MetadataOwnerRange[];
      events: MetadataOwnerRange[];
    };
  }
> {
  const { bytes, section, widths, recordBytes: sizes, counts } = tables;
  const { readString, typeDefinitionTypeIndices } = tables;
  const typeDefinitions = section("typeDefinitions");
  const methodTotal = counts.methods;
  const types: Il2cppMetadataDecoded["types"] = [];
  const memberRanges = {
    fields: [] as MetadataOwnerRange[],
    properties: [] as MetadataOwnerRange[],
    events: [] as MetadataOwnerRange[],
  };
  const genericContainerCount =
    tables.linkFacts === undefined ? 0 : tables.counts.genericContainers;
  for (let index = 0; index < counts.typeDefinitions; index++) {
    if (index % 256 === 0) yield;
    const at = typeDefinitions.offset + index * sizes.typeDefinitions;
    // int32 starts follow both string indices, the type indices, the
    // generic container index and flags.
    const starts =
      at +
      12 +
      typeDefinitionTypeIndices * widths.type +
      widths.generic_container;
    if (tables.linkFacts !== undefined) {
      const genericContainerIndex = readTypeGenericContainer(tables, index);
      if (
        genericContainerIndex < -1 ||
        genericContainerIndex >= genericContainerCount
      )
        throw new Il2cppMetadataFormatFailure(
          "index-out-of-range",
          `type ${index} generic container ${genericContainerIndex} is outside the ${genericContainerCount} available rows`,
        );
      if (genericContainerIndex !== -1) {
        const argumentCount = readGenericContainer(
          tables,
          genericContainerIndex,
        ).count;
        if (argumentCount < 0)
          throw new Il2cppMetadataFormatFailure(
            "index-out-of-range",
            `type ${index} generic container ${genericContainerIndex} has negative argument count ${argumentCount}`,
          );
        tables.linkFacts.genericTypeArgumentCounts[index] = argumentCount;
      }
    }
    const countsAt = starts + 32;
    const type = {
      name: readString(bytes.readInt32LE(at), `type ${index} name`),
      namespace: readString(
        bytes.readInt32LE(at + 4),
        `type ${index} namespace`,
      ),
      method_start: bytes.readInt32LE(starts + 4),
      method_count: bytes.readUInt16LE(countsAt),
      nested_type_start: bytes.readInt32LE(starts + 16),
      nested_type_count: bytes.readUInt16LE(countsAt + 8),
      declaring_type: -1,
    };
    checkRange(
      `type ${index} methods`,
      type.method_start,
      type.method_count,
      methodTotal,
    );
    memberRanges.fields.push({
      start: bytes.readInt32LE(starts),
      count: bytes.readUInt16LE(countsAt + 4),
    });
    memberRanges.events.push({
      start: bytes.readInt32LE(starts + 8),
      count: bytes.readUInt16LE(countsAt + 6),
    });
    memberRanges.properties.push({
      start: bytes.readInt32LE(starts + 12),
      count: bytes.readUInt16LE(countsAt + 2),
    });
    tables.onRow?.(type);
    types.push(type);
  }
  yield* assignNesting(tables, types);
  return { types, memberRanges };
}

function* readMethods({
  bytes,
  section,
  widths,
  recordBytes: sizes,
  counts,
  readString,
  methodReturnParameterToken,
  linkFacts,
  onRow,
}: MetadataTables): Generator<
  void,
  {
    methods: Il2cppMetadataDecoded["methods"];
    parameterRanges: MetadataOwnerRange[];
  }
> {
  const methods = section("methods");
  const typeTotal = counts.typeDefinitions;
  const result: Il2cppMetadataDecoded["methods"] = [];
  const parameterRanges: MetadataOwnerRange[] = [];
  for (let index = 0; index < counts.methods; index++) {
    if (index % 256 === 0) yield;
    const at = methods.offset + index * sizes.methods;
    const method = {
      name: readString(bytes.readInt32LE(at), `method ${index} name`),
      declaring_type: readIndex(bytes, at + 4, widths.type_definition),
    };
    if (method.declaring_type < -1 || method.declaring_type >= typeTotal)
      throw new Il2cppMetadataFormatFailure(
        "index-out-of-range",
        `method ${index} declares type ${method.declaring_type} outside the ${typeTotal} type definitions`,
      );
    if (linkFacts !== undefined) {
      const returnAt = at + 4 + widths.type_definition;
      linkFacts.returnTypes[index] = readIndex(bytes, returnAt, widths.type);
      linkFacts.methodTokens[index] = bytes.readUInt32LE(
        at +
          methodContainerAt({ widths, methodReturnParameterToken }) +
          widths.generic_container,
      );
    }
    parameterRanges.push({
      start: readIndex(
        bytes,
        at +
          4 +
          widths.type_definition +
          widths.type +
          (methodReturnParameterToken ? 4 : 0),
        widths.parameter,
      ),
      count: bytes.readUInt16LE(at + sizes.methods - 2),
    });
    onRow?.(method);
    result.push(method);
  }
  return { methods: result, parameterRanges };
}

/**
 * Type method ranges and method declaring types must agree in both
 * directions, so a damaged range cannot strand or misattribute a method.
 */
function* checkMethodOwners(
  types: Il2cppMetadataDecoded["types"],
  methods: Il2cppMetadataDecoded["methods"],
) {
  let work = 0;
  for (const [index, type] of types.entries()) {
    if (work++ % 256 === 0) yield;
    for (let offset = 0; offset < type.method_count; offset += 1) {
      if (work++ % 256 === 0) yield;
      const method = type.method_start + offset;
      const declaring = methods[method]!.declaring_type;
      if (declaring !== index)
        throw new Il2cppMetadataFormatFailure(
          "declaring-type-mismatch",
          `method ${method} is in type ${index}'s range but declares type ${declaring}`,
        );
    }
  }
  for (const [index, method] of methods.entries()) {
    if (work++ % 256 === 0) yield;
    const owner = types[method.declaring_type];
    if (
      owner !== undefined &&
      (index < owner.method_start ||
        index >= owner.method_start + owner.method_count)
    )
      throw new Il2cppMetadataFormatFailure(
        "declaring-type-mismatch",
        `method ${index} declares type ${method.declaring_type} but is outside its method range`,
      );
  }
}

/** Each type belongs to at most one image. */
function* checkImageRanges(images: Il2cppMetadataDecoded["images"]) {
  const ranges: { start: number; end: number; index: number }[] = [];
  for (let index = 0; index < images.length; index++) {
    if (index % 256 === 0) yield;
    const image = images[index]!;
    if (image.type_count > 0)
      ranges.push({
        start: image.type_start,
        end: image.type_start + image.type_count,
        index,
      });
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let at = 1; at < ranges.length; at++) {
    if (at % 256 === 0) yield;
    const previous = ranges[at - 1]!;
    const current = ranges[at]!;
    if (previous.end > current.start)
      throw new Il2cppMetadataFormatFailure(
        "image-range-overlap",
        `image ${previous.index} types [${previous.start}, ${previous.end}) overlap image ${current.index} starting at type ${current.start}`,
      );
  }
}

/** Row counts known from the header and record sizes, before rows are built. */
export interface Il2cppMetadataRowCounts {
  readonly images: number;
  readonly types: number;
  readonly methods: number;
  readonly fields: number;
  readonly properties: number;
  readonly events: number;
  readonly parameters: number;
  readonly string_literals: number;
}

export interface Il2cppMetadataReadOptions {
  /** Called before any row is decoded; may throw to refuse the file. */
  readonly beforeRows?: (counts: Il2cppMetadataRowCounts) => void;
  /** Guard raw text before allocating its decoded or base64 representation. */
  readonly beforeText?: (bytes: number) => void;
  /** Admit each fact before retention, including repeated strings. */
  readonly onRow?: (
    row: Readonly<Record<string, string | number | null>>,
  ) => void;
}

/** Per-row typed fields the public inventory omits but native linking needs. */
export interface Il2cppMetadataLinkFacts {
  /** Method definition token per method index. */
  readonly methodTokens: Uint32Array;
  /** Il2CppType table index of each method's return type. */
  readonly returnTypes: Int32Array;
  readonly fieldTypes: Int32Array;
  readonly parameterTypes: Int32Array;
  /** Total class generic argument count per TypeDefinition, including enclosing types. */
  readonly genericTypeArgumentCounts: Int32Array;
  /** Demand-read names from this stable metadata snapshot, by GenericParameterIndex. */
  readonly genericParameterName: (index: number) => string | undefined;
  /**
   * Demand-read GenericContainerIndex of a type definition: -1 for a
   * non-generic type, undefined when the index or layout is not decoded.
   */
  readonly typeGenericContainer: (index: number) => number | undefined;
  /**
   * Demand-read GenericContainerIndex of a method definition: -1 for a
   * non-generic method, undefined when the index is out of range.
   */
  readonly methodGenericContainer: (index: number) => number | undefined;
  /**
   * Demand-read argument count and first GenericParameterIndex of a generic
   * container; undefined out of range and for the counted (version 39)
   * layout, whose container records are not decoded.
   */
  readonly genericContainer: (
    index: number,
  ) => { readonly count: number; readonly parameterStart: number } | undefined;
}

/** Byte offset of GenericContainerIndex in a method record; the token follows. */
const methodContainerAt = ({
  widths,
  methodReturnParameterToken,
}: Pick<MetadataTables, "widths" | "methodReturnParameterToken">) =>
  4 +
  widths.type_definition +
  widths.type +
  (methodReturnParameterToken ? 4 : 0) +
  widths.parameter;

/** Raw row interpretation; callers own index and layout admission. */
const readTypeGenericContainer = (tables: MetadataTables, index: number) =>
  readIndex(
    tables.bytes,
    tables.section("typeDefinitions").offset +
      index * tables.recordBytes.typeDefinitions +
      8 +
      tables.typeDefinitionTypeIndices * tables.widths.type,
    tables.widths.generic_container,
  );

/** ownerIndex, type_argc, is_method and genericParameterStart are int32. */
const readGenericContainer = (tables: MetadataTables, index: number) => {
  const at =
    tables.section("genericContainers").offset +
    index * GENERIC_CONTAINER_RECORD_BYTES;
  return {
    count: tables.bytes.readInt32LE(at + 4),
    parameterStart: tables.bytes.readInt32LE(at + 12),
  };
};

/** Type and method container indices and container records, read on demand. */
const createGenericContainerReaders = (tables: MetadataTables) => {
  const typeCount = tables.counts.typeDefinitions;
  const containerCount =
    tables.indexing === "counted" ? 0 : tables.counts.genericContainers;
  const inRange = (index: number, count: number) =>
    Number.isInteger(index) && index >= 0 && index < count;
  const methods = tables.section("methods"),
    methodCount = tables.counts.methods,
    methodBytes = tables.recordBytes.methods,
    methodAt = methodContainerAt(tables);
  return {
    methodGenericContainer: (index: number): number | undefined =>
      !inRange(index, methodCount)
        ? undefined
        : readIndex(
            tables.bytes,
            methods.offset + index * methodBytes + methodAt,
            tables.widths.generic_container,
          ),
    typeGenericContainer: (index: number): number | undefined =>
      tables.indexing === "counted" || !inRange(index, typeCount)
        ? undefined
        : readTypeGenericContainer(tables, index),
    genericContainer: (index: number) =>
      !inRange(index, containerCount)
        ? undefined
        : readGenericContainer(tables, index),
  };
};

/** Own the row layout once; unused generic names allocate no arrays or strings. */
const createGenericParameterReader = (tables: MetadataTables) => {
  const parameters = tables.section("genericParameters"),
    width = tables.widths.generic_container + 12;
  const count = tables.counts.genericParameters;
  return (index: number): string | undefined => {
    if (!Number.isInteger(index) || index < 0 || index >= count)
      return undefined;
    return tables.readString(
      tables.bytes.readInt32LE(
        parameters.offset + index * width + tables.widths.generic_container,
      ),
      `generic parameter ${index} name`,
    );
  };
};

/** Decoded metadata plus the typed row facts that link it to a native binary. */
export interface Il2cppMetadataForLinking {
  readonly metadata: Il2cppMetadataDecoded;
  readonly link: Il2cppMetadataLinkFacts;
}

/** Decode image, type, method and member names and string literals without native binaries or decryption. */
export function* readIl2cppMetadataSteps(
  bytes: Buffer,
  options: Il2cppMetadataReadOptions = {},
): Generator<void, Il2cppMetadataDecoded> {
  return (yield* readMetadataCoreSteps(bytes, options, false)).metadata;
}

/** Decode metadata and retain the typed row facts used for native linking. */
export function* readIl2cppMetadataForLinkingSteps(
  bytes: Buffer,
  options: Il2cppMetadataReadOptions = {},
): Generator<void, Il2cppMetadataForLinking> {
  const parsed = yield* readMetadataCoreSteps(bytes, options, true);
  if (parsed.link === undefined)
    throw new Error(
      "Native metadata reader did not retain requested linking facts",
    );
  return { metadata: parsed.metadata, link: parsed.link };
}

function* readMetadataCoreSteps(
  bytes: Buffer,
  options: Il2cppMetadataReadOptions,
  linking: boolean,
): Generator<
  void,
  { metadata: Il2cppMetadataDecoded; link: Il2cppMetadataLinkFacts | undefined }
> {
  const { magic, version, headerBytes, sections } = readHeader(bytes);
  checkSections(bytes, headerBytes, sections);
  const byName = new Map(sections.map((entry) => [entry.name, entry]));
  const section = (name: SectionName) => byName.get(name)!;
  const layout = VERSION_LAYOUTS[version];
  const widths =
    layout.indexing === "counted" ? resolveWidths(section) : FIXED_WIDTHS;
  const expected = il2cppMetadataRecordBytes(widths, version);
  let tables: MetadataTables = {
    bytes,
    section,
    widths,
    recordBytes: expected,
    counts: recordCounts(version, section, expected, widths),
    typeDefinitionTypeIndices: layout.typeDefinitionTypeIndices,
    indexing: layout.indexing,
    methodReturnParameterToken: layout.methodReturnParameterToken,
    readString: createStringReader(
      bytes,
      section("strings"),
      options.beforeText,
    ),
    members: readIl2cppMemberTables({
      widths,
      indexing: layout.indexing,
      section,
    }),
    beforeText: options.beforeText,
    onRow: options.onRow,
  };
  options.beforeRows?.({
    images: tables.counts.images,
    types: tables.counts.typeDefinitions,
    methods: tables.counts.methods,
    ...tables.members.counts,
  });
  if (linking)
    tables = {
      ...tables,
      linkFacts: {
        methodTokens: new Uint32Array(tables.counts.methods),
        returnTypes: new Int32Array(tables.counts.methods),
        fieldTypes: new Int32Array(tables.members.counts.fields),
        parameterTypes: new Int32Array(tables.members.counts.parameters),
        genericTypeArgumentCounts: new Int32Array(
          tables.counts.typeDefinitions,
        ),
        genericParameterName: createGenericParameterReader(tables),
        ...createGenericContainerReaders(tables),
      },
    };
  yield;
  const images = yield* readImages(tables);
  yield* checkImageRanges(images);
  const { types, memberRanges } = yield* readTypes(tables);
  const { methods, parameterRanges } = yield* readMethods(tables);
  yield* checkMethodOwners(types, methods);
  const members = yield* readIl2cppMembers(tables, {
    ...memberRanges,
    parameters: parameterRanges,
  });
  return {
    metadata: {
      magic,
      metadata_version: version,
      index_widths: widths,
      sections,
      images,
      types,
      methods,
      ...members,
    },
    link: tables.linkFacts,
  };
}
