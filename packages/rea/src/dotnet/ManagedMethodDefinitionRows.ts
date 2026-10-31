import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { metadataRowCursor, metadataToken } from "./ManagedMetadataHeaps.js";

/** Meaning of the MethodDef implementation bits, independent of RVA or ImplMap evidence. */
export interface ManagedMethodImplementationFlags {
  readonly codeType: "il" | "native" | "optil" | "runtime";
  readonly managedKind: "managed" | "unmanaged";
  readonly pinvokeFlag: boolean;
}

const METHOD_CODE_TYPES = ["il", "native", "optil", "runtime"] as const;

/** Scalar MethodDef facts; consumers own heap admission and method selection. */
export const readMethodDefinitionRow = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  row: number,
): {
  readonly token: string;
  readonly rowOffset: number;
  readonly rva: number;
  readonly implFlags: number;
  readonly flags: number;
  readonly nameIndex: number;
  readonly signatureIndex: number;
  readonly implementation: ManagedMethodImplementationFlags;
} => {
  // Layout admission bounds the whole fixed-width row before a cursor is created.
  const cursor = metadataRowCursor(bytes, layout, 6, row);
  const rva = cursor.readUInt32();
  const implFlags = cursor.readUInt16();
  const flags = cursor.readUInt16();
  return {
    token: metadataToken(6, row),
    rowOffset: cursor.start,
    rva,
    implFlags,
    flags,
    nameIndex: cursor.readIndex(layout.stringIndexSize),
    signatureIndex: cursor.readIndex(layout.blobIndexSize),
    implementation: {
      codeType: METHOD_CODE_TYPES[(implFlags & 0x0003) as 0 | 1 | 2 | 3],
      managedKind: (implFlags & 0x0004) === 0 ? "managed" : "unmanaged",
      pinvokeFlag: (flags & 0x2000) !== 0,
    },
  };
};
