import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { metadataRowCursor, metadataToken } from "./ManagedMetadataHeaps.js";

/** Scalar Field facts; consumers own heap admission and field selection. */
export const readFieldDefinitionRow = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
): {
  readonly token: string;
  readonly rowOffset: number;
  readonly flags: number;
  readonly nameIndex: number;
  readonly signatureIndex: number;
} => {
  // Layout admission bounds the complete row independently of its heap values.
  const cursor = metadataRowCursor(bytes, layout, 4, row);
  return {
    token: metadataToken(4, row),
    rowOffset: cursor.start,
    flags: cursor.readUInt16(),
    nameIndex: cursor.readIndex(layout.stringIndexSize),
    signatureIndex: cursor.readIndex(layout.blobIndexSize),
  };
};
