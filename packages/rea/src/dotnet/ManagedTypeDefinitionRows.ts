import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { metadataRowCursor } from "./ManagedMetadataHeaps.js";
import { memberListIndexSize } from "./ManagedMemberPointers.js";

/** Scalar TypeDef source facts; consumers own heap and coded-index admission. */
export interface TypeDefinitionRowFacts {
  readonly rowOffset: number;
  readonly flags: number;
  readonly nameIndex: number;
  readonly namespaceIndex: number;
  readonly extendsRaw: number;
  readonly extendsOffset: number;
  readonly fieldListRaw: number;
  readonly fieldListOffset: number;
  readonly methodListRaw: number;
  readonly methodListOffset: number;
}

export const readTypeDefinitionRowFacts = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
): TypeDefinitionRowFacts => {
  const cursor = metadataRowCursor(bytes, layout, 2, row);
  const flags = cursor.readUInt32();
  const nameIndex = cursor.readIndex(layout.stringIndexSize);
  const namespaceIndex = cursor.readIndex(layout.stringIndexSize);
  const extendsOffset = cursor.offset;
  const extendsRaw = cursor.readIndex(layout.codedIndexSize("TypeDefOrRef"));
  const fieldListOffset = cursor.offset;
  const fieldListRaw = cursor.readIndex(memberListIndexSize(layout, 4));
  const methodListOffset = cursor.offset;
  const methodListRaw = cursor.readIndex(memberListIndexSize(layout, 6));
  return {
    rowOffset: cursor.start,
    flags,
    nameIndex,
    namespaceIndex,
    extendsRaw,
    extendsOffset,
    fieldListRaw,
    fieldListOffset,
    methodListRaw,
    methodListOffset,
  };
};
