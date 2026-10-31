import { readMemberReferenceRowFacts } from "./ManagedMemberReferenceRows.js";
import { readTypeDefinitionRowFacts } from "./ManagedTypeDefinitionRows.js";
import { managedDecodeBudget } from "./ManagedDecodeBudget.js";
import { managedTypeReferences } from "./ManagedTypeReferences.js";
import { MAX_TYPE_NESTING_DEPTH } from "./ManagedSignatureTypeNames.js";
import { readManagedTypeNesting } from "./ManagedTypeNesting.js";
import { memberDeclaringTypeRowLookup } from "./ManagedMemberOwnership.js";
import type { TypeMemberListFacts } from "./ManagedTypeMemberLists.js";

import type {
  ManagedArtifactInspection,
  ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";
import {
  MANAGED_CODED_INDEXES,
  metadataRowOffset,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  metadataRowCursor,
  readManagedCompressedUnsigned,
  decodeMetadataCodedIndex,
  type ManagedCodedIndex,
  metadataToken,
  readMetadataBlob,
  readMetadataGuid,
  readMetadataString,
} from "./ManagedMetadataHeaps.js";
import { managedFailure, readManagedValue } from "./ManagedReaderFailure.js";
import type { ManagedTypeReferenceLookup } from "./ManagedTypeReferences.js";
import type { ManagedResourceDirectory } from "./ManagedMetadataInventory.js";
import type { ManagedType, parseTypes } from "./ManagedMemberInspectorCore.js";

type ModuleIdentity = NonNullable<ManagedArtifactInspection["module"]>;
type AssemblyIdentity = NonNullable<ManagedArtifactInspection["assembly"]>;
type AssemblyReference = ManagedArtifactInspection["references"][number];
type ManagedResource = ManagedArtifactInspection["resources"][number];
type CustomAttribute = ManagedArtifactInspection["attributes"][number];

const publicKeyIdentity = (
  bytes: Buffer,
  kind: "public-key" | "public-key-token",
  layout: ManagedMetadataLayout,
): AssemblyIdentity["public_key"] => ({
  kind: bytes.length === 0 ? "none" : kind,
  byte_length: bytes.length,
  sha256:
    bytes.length === 0
      ? null
      : managedDecodeBudget(layout).digest(bytes, "sha256"),
  token:
    bytes.length === 0
      ? null
      : kind === "public-key"
        ? Buffer.from(managedDecodeBudget(layout).digest(bytes, "sha1"), "hex")
            .subarray(-8)
            .reverse()
            .toString("hex")
        : bytes.length === 8
          ? bytes.toString("hex")
          : null,
});

export const readModule = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  heapExtent: number,
): ModuleIdentity | null => {
  const table = layout.table(0);
  if (table === undefined || table.rowCount === 0) return null;
  const cursor = metadataRowCursor(bytes, layout, 0, 1);
  const generation = cursor.readUInt16();
  const name = readMetadataString(
    bytes,
    layout,
    cursor.readIndex(layout.stringIndexSize),
    heapExtent,
  );
  const mvid = readMetadataGuid(
    bytes,
    layout,
    cursor.readIndex(layout.guidIndexSize),
  );
  const encId = readMetadataGuid(
    bytes,
    layout,
    cursor.readIndex(layout.guidIndexSize),
  );
  const encBaseId = readMetadataGuid(
    bytes,
    layout,
    cursor.readIndex(layout.guidIndexSize),
  );
  return {
    name,
    generation,
    mvid,
    enc_id: encId,
    enc_base_id: encBaseId,
    token: metadataToken(0, 1),
    row_offset: table.offset,
  };
};

export const readAssembly = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  heapExtent: number,
): AssemblyIdentity | null => {
  const table = layout.table(32);
  if (table === undefined || table.rowCount === 0) return null;
  const cursor = metadataRowCursor(bytes, layout, 32, 1);
  const hashAlgorithm = cursor.readUInt32();
  const version = [
    cursor.readUInt16(),
    cursor.readUInt16(),
    cursor.readUInt16(),
    cursor.readUInt16(),
  ].join(".");
  const flags = cursor.readUInt32();
  const key = readMetadataBlob(
    bytes,
    layout,
    cursor.readIndex(layout.blobIndexSize),
    heapExtent,
  );
  const name = readMetadataString(
    bytes,
    layout,
    cursor.readIndex(layout.stringIndexSize),
    heapExtent,
  );
  const culture = readMetadataString(
    bytes,
    layout,
    cursor.readIndex(layout.stringIndexSize),
    heapExtent,
  );
  return {
    name,
    version,
    culture: culture.length === 0 ? null : culture,
    flags,
    hash_algorithm: hashAlgorithm,
    public_key: publicKeyIdentity(
      key,
      (flags & 1) === 0 ? "public-key-token" : "public-key",
      layout,
    ),
    token: metadataToken(32, 1),
    row_offset: table.offset,
  };
};

/** One owner for the shared AssemblyRef prefix and column indexes. */
const assemblyReferenceHeader = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
) => {
  const cursor = metadataRowCursor(bytes, layout, 35, row);
  const version = [
    cursor.readUInt16(),
    cursor.readUInt16(),
    cursor.readUInt16(),
    cursor.readUInt16(),
  ].join(".");
  return {
    cursor,
    version,
    flags: cursor.readUInt32(),
    keyIndex: cursor.readIndex(layout.blobIndexSize),
    nameIndex: cursor.readIndex(layout.stringIndexSize),
  };
};

/** Name/token facts do not require decoding or hashing unrelated key/hash payloads. */
export const readAssemblyReferenceName = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
  heapExtent: number,
): Pick<AssemblyReference, "name" | "token" | "row_offset"> => {
  const { nameIndex } = assemblyReferenceHeader(bytes, layout, row);
  return {
    name: readMetadataString(bytes, layout, nameIndex, heapExtent),
    token: metadataToken(35, row),
    row_offset: metadataRowOffset(layout, 35, row),
  };
};

export const readAssemblyReference = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
  heapExtent: number,
): AssemblyReference => {
  const { cursor, version, flags, keyIndex, nameIndex } =
    assemblyReferenceHeader(bytes, layout, row);
  const keyOrToken = readMetadataBlob(bytes, layout, keyIndex, heapExtent);
  const name = readMetadataString(bytes, layout, nameIndex, heapExtent);
  const culture = readMetadataString(
    bytes,
    layout,
    cursor.readIndex(layout.stringIndexSize),
    heapExtent,
  );
  const hashValue = readMetadataBlob(
    bytes,
    layout,
    cursor.readIndex(layout.blobIndexSize),
    heapExtent,
  );
  return {
    name,
    version,
    culture: culture.length === 0 ? null : culture,
    flags,
    public_key_or_token: publicKeyIdentity(
      keyOrToken,
      (flags & 1) === 0 ? "public-key-token" : "public-key",
      layout,
    ),
    hash_value_sha256:
      hashValue.length === 0
        ? null
        : managedDecodeBudget(layout).digest(hashValue, "sha256"),
    hash_value_length: hashValue.length,
    token: metadataToken(35, row),
    row_offset: metadataRowOffset(layout, 35, row),
  };
};

export type ManagedMetadataTypeNameLookup = (
  table: 1 | 2,
  row: number,
) => string | null;

/** Resolve the display name from the same validated nesting facts used by member parsing. */
export const managedMetadataTypeNames = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
  parsedTypes?: Pick<ReturnType<typeof parseTypes>, "types" | "nesting">,
  parsedReferences?: ManagedTypeReferenceLookup,
): ManagedMetadataTypeNameLookup => {
  const nesting =
    parsedTypes?.nesting ?? readManagedTypeNesting(bytes, layout, issues);
  const references =
    parsedReferences ?? managedTypeReferences(bytes, layout, issues);
  const definitions = new Map<number, ManagedType>();
  if (parsedTypes !== undefined) {
    managedDecodeBudget(layout).reserve(parsedTypes.types.length * 128, null);
    for (const { row, type } of parsedTypes.types) definitions.set(row, type);
  }
  const cache = new Map<
    string,
    {
      readonly fullName: string;
      readonly depth: number;
      readonly utf8Bytes: number;
    } | null
  >();
  const depthLimit = Symbol("type-name-depth-limit");
  const resolve = (
    table: 1 | 2,
    row: number,
    active: ReadonlySet<string> = new Set(),
  ):
    | {
        readonly fullName: string;
        readonly depth: number;
        readonly utf8Bytes: number;
      }
    | null
    | typeof depthLimit => {
    const key = `${String(table)}:${String(row)}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const descriptor = layout.table(table);
    if (descriptor === undefined || row < 1 || row > descriptor.rowCount)
      return null;
    if (active.has(key)) {
      cache.set(key, null);
      return null;
    }
    if (active.size >= MAX_TYPE_NESTING_DEPTH) return depthLimit;
    managedDecodeBudget(layout).reserve(128, null);
    let name: string;
    let namespace: string;
    let parentRow: number | null;
    if (table === 1) {
      const reference = references(row);
      if (reference === null || !reference.scopeValid) {
        cache.set(key, null);
        return null;
      }
      ({ name, namespace, enclosingRow: parentRow } = reference);
    } else {
      if (!nesting.complete) {
        cache.set(key, null);
        return null;
      }
      const parsed = definitions.get(row);
      if (parsedTypes !== undefined && parsed === undefined) {
        cache.set(key, null);
        return null;
      }
      let flags: number;
      if (parsed !== undefined) {
        name = parsed.name;
        namespace = parsed.namespace;
        flags = parsed.flags;
      } else {
        const source = readTypeDefinitionRowFacts(bytes, layout, row);
        flags = source.flags;
        name = readMetadataString(
          bytes,
          layout,
          source.nameIndex,
          layout.strings.size,
        );
        namespace = readMetadataString(
          bytes,
          layout,
          source.namespaceIndex,
          layout.strings.size,
        );
      }
      parentRow = nesting.enclosing.get(row) ?? null;
      const isNested = (flags & 0x7) >= 2;
      if (isNested !== (parentRow !== null)) {
        cache.set(key, null);
        return null;
      }
    }
    let fullName: string | null;
    let depth = 1;
    let utf8Bytes = 0;
    const nameBytes = Buffer.byteLength(name, "utf8");
    if (parentRow === null) {
      if (namespace.length === 0) {
        fullName = name;
        utf8Bytes = nameBytes;
      } else {
        utf8Bytes = Buffer.byteLength(namespace, "utf8") + 1 + nameBytes;
        managedDecodeBudget(layout).reserveString(
          utf8Bytes,
          metadataRowOffset(layout, table, row),
        );
        fullName = `${namespace}.${name}`;
      }
    } else {
      const parents = new Set(active);
      parents.add(key);
      const parent = resolve(table, parentRow, parents);
      if (parent === depthLimit) return depthLimit;
      if (parent === null) fullName = null;
      else {
        depth = parent.depth + 1;
        utf8Bytes = parent.utf8Bytes + 1 + nameBytes;
        managedDecodeBudget(layout).reserveString(
          utf8Bytes,
          metadataRowOffset(layout, table, row),
        );
        fullName = `${parent.fullName}+${name}`;
      }
    }
    if (depth > MAX_TYPE_NESTING_DEPTH) fullName = null;
    const named = fullName === null ? null : { fullName, depth, utf8Bytes };
    cache.set(key, named);
    return named;
  };
  return (table, row) => {
    const named = resolve(table, row);
    return named === null || named === depthLimit ? null : named.fullName;
  };
};

const declaringTypeForMethod = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  methodRow: number,
  memberLists: TypeMemberListFacts,
  typeName: ManagedMetadataTypeNameLookup,
): string | null => {
  const owner = memberDeclaringTypeRowLookup(
    bytes,
    layout,
    6,
    memberLists,
  )(methodRow);
  if (owner === 0) return null;
  return typeName(2, owner);
};

const attributeTypeName = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  constructor: Extract<ManagedCodedIndex, { readonly kind: "valid" }>,
  memberLists: TypeMemberListFacts,
  typeName: ManagedMetadataTypeNameLookup,
): string | null => {
  const { table, row } = constructor;
  if (table === 6)
    return declaringTypeForMethod(bytes, layout, row, memberLists, typeName);
  const { parent } = readMemberReferenceRowFacts(bytes, layout, row);
  if (parent.kind === "null") return null;
  if (parent.table === 2 || parent.table === 1)
    return typeName(parent.table, parent.row);
  if (parent.table === 6)
    return declaringTypeForMethod(
      bytes,
      layout,
      parent.row,
      memberLists,
      typeName,
    );
  return null;
};

const decodeFixedString = (
  blob: Buffer,
  layout: ManagedMetadataLayout,
): string | null => {
  if (blob.length < 3 || blob.readUInt16LE(0) !== 1 || blob[2] === 0xff)
    return null;
  const decoded = readManagedCompressedUnsigned(blob, 2);
  if (!decoded.ok) return null;
  const { value: length, width } = decoded.value;
  const start = 2 + width;
  if (start > blob.length - length) return null;
  managedDecodeBudget(layout).reserveString(
    length,
    layout.blob?.offset ?? layout.rootOffset,
  );
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      blob.subarray(start, start + length),
    );
  } catch (cause: unknown) {
    // Invalid UTF-8 blobs decode as null.
    void cause;
    return null;
  }
};

export const readCustomAttribute = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
  heapExtent: number,
  issues: ManagedParseIssue[],
  memberLists: TypeMemberListFacts,
  typeNames: ManagedMetadataTypeNameLookup,
): CustomAttribute => {
  const cursor = metadataRowCursor(bytes, layout, 12, row);
  const parentRaw = cursor.readIndex(
    layout.codedIndexSize("HasCustomAttribute"),
  );
  const typeOffset = cursor.offset;
  const typeRaw = cursor.readIndex(
    layout.codedIndexSize("CustomAttributeType"),
  );
  const value = readMetadataBlob(
    bytes,
    layout,
    cursor.readIndex(layout.blobIndexSize),
    heapExtent,
  );
  const parent = decodeMetadataCodedIndex(
    parentRaw,
    MANAGED_CODED_INDEXES.HasCustomAttribute.bits,
    MANAGED_CODED_INDEXES.HasCustomAttribute.tables,
    layout.rowCounts,
  );
  if (parent.kind !== "valid") {
    throw managedFailure(
      "invalid-row",
      `metadata.CustomAttribute:${metadataToken(12, row)}`,
      `CustomAttribute parent coded index 0x${parentRaw.toString(16)} is invalid${parent.kind === "null" ? " because the required parent is null" : `: ${parent.reason}`}`,
      cursor.start,
    );
  }
  const constructor = decodeMetadataCodedIndex(
    typeRaw,
    MANAGED_CODED_INDEXES.CustomAttributeType.bits,
    MANAGED_CODED_INDEXES.CustomAttributeType.tables,
    layout.rowCounts,
  );
  if (constructor.kind !== "valid") {
    issues.push({
      code: "invalid-row",
      scope: `metadata.CustomAttribute:${metadataToken(12, row)}`,
      offset: typeOffset,
      detail:
        constructor.kind === "null"
          ? "CustomAttribute constructor coded index 0x0 is null, but Type must reference a MethodDef or MemberRef row"
          : `CustomAttribute constructor coded index 0x${typeRaw.toString(16)} is invalid: ${constructor.reason}`,
    });
  }
  let typeName: string | null = null;
  if (constructor.kind === "valid")
    typeName =
      readManagedValue(
        () =>
          attributeTypeName(bytes, layout, constructor, memberLists, typeNames),
        issues,
      ) ?? null;
  return {
    parent_token: parent.token,
    constructor_token: constructor.kind === "valid" ? constructor.token : null,
    type_name: typeName,
    value_length: value.length,
    value_sha256: managedDecodeBudget(layout).digest(value, "sha256"),
    decoded_fixed_string:
      typeName === "System.Runtime.Versioning.TargetFrameworkAttribute"
        ? decodeFixedString(value, layout)
        : null,
    token: metadataToken(12, row),
    row_offset: cursor.start,
  };
};

interface ReadResourceContext {
  readonly bytes: Buffer;
  readonly layout: ManagedMetadataLayout;
  readonly row: number;
  readonly directory: ManagedResourceDirectory | null;
  readonly issues: ManagedParseIssue[];
}

export const readResource = ({
  bytes,
  layout,
  row,
  directory,
  issues,
}: ReadResourceContext): ManagedResource => {
  const cursor = metadataRowCursor(bytes, layout, 40, row);
  const declaredOffset = cursor.readUInt32();
  const flags = cursor.readUInt32();
  const name = readMetadataString(
    bytes,
    layout,
    cursor.readIndex(layout.stringIndexSize),
    Math.max(layout.strings.size, layout.blob?.size ?? 0),
  );
  const implementationOffset = cursor.offset;
  const implementationRaw = cursor.readIndex(
    layout.codedIndexSize("Implementation"),
  );
  const implementation = decodeMetadataCodedIndex(
    implementationRaw,
    MANAGED_CODED_INDEXES.Implementation.bits,
    MANAGED_CODED_INDEXES.Implementation.tables,
    layout.rowCounts,
  );
  if (implementation.kind === "invalid")
    issues.push({
      code: "invalid-row",
      scope: `metadata.ManifestResource:${metadataToken(40, row)}`,
      offset: implementationOffset,
      detail: `ManifestResource implementation coded index 0x${implementationRaw.toString(16)} is invalid: ${implementation.reason}`,
    });
  let dataLength: number | null = null;
  let dataSha256: string | null = null;
  if (implementation.kind === "null") {
    if (directory === null || declaredOffset > directory.size - 4) {
      issues.push({
        code: "invalid-resource",
        scope: `metadata.ManifestResource:${metadataToken(40, row)}`,
        offset: directory?.offset ?? null,
        detail: "Embedded resource offset leaves the CLI resources directory",
      });
    } else {
      const start = directory.offset + declaredOffset;
      dataLength = bytes.readUInt32LE(start);
      if (dataLength > directory.size - declaredOffset - 4) {
        issues.push({
          code: "invalid-resource",
          scope: `metadata.ManifestResource:${metadataToken(40, row)}`,
          offset: start,
          detail: "Embedded resource length leaves the CLI resources directory",
        });
      } else {
        dataSha256 = managedDecodeBudget(layout).digest(
          bytes.subarray(start + 4, start + 4 + dataLength),
          "sha256",
        );
      }
    }
  }
  return {
    name,
    flags,
    visibility:
      (flags & 7) === 1 ? "public" : (flags & 7) === 2 ? "private" : "unknown",
    implementation_token:
      implementation.kind === "valid" ? implementation.token : null,
    embedded: implementation.kind === "null",
    declared_offset: declaredOffset,
    data_length: dataLength,
    data_sha256: dataSha256,
    token: metadataToken(40, row),
    row_offset: cursor.start,
  };
};
