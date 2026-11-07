/** Fixed PE resource records; callers own interval, budget and tree admission. */
export const PE_RESOURCE_DIRECTORY_BYTES = 16;
export const PE_RESOURCE_ENTRY_BYTES = 8;
export const PE_RESOURCE_NAME_PREFIX_BYTES = 2;

/** Decode an already-admitted IMAGE_RESOURCE_DIRECTORY record. */
export const readPeResourceDirectoryFacts = (bytes: Buffer) => {
  const namedEntries = bytes.readUInt16LE(12);
  const idEntries = bytes.readUInt16LE(14);
  return {
    characteristics: bytes.readUInt32LE(0),
    timestamp: bytes.readUInt32LE(4),
    majorVersion: bytes.readUInt16LE(8),
    minorVersion: bytes.readUInt16LE(10),
    namedEntries,
    idEntries,
    entryCount: namedEntries + idEntries,
  };
};

export type PeResourceIdentityDeclaration =
  | { readonly kind: "id"; readonly id: number }
  | { readonly kind: "name"; readonly offset: number };

/** Offsets remain relative to the resource root; numeric IDs retain all source bits. */
export const readPeResourceEntryFacts = (bytes: Buffer) => {
  const encodedIdentity = bytes.readUInt32LE(0);
  const encodedTarget = bytes.readUInt32LE(4);
  const identity: PeResourceIdentityDeclaration =
    (encodedIdentity & 0x80000000) === 0
      ? { kind: "id", id: encodedIdentity }
      : { kind: "name", offset: encodedIdentity & 0x7fffffff };
  return {
    identity,
    target: {
      kind:
        (encodedTarget & 0x80000000) === 0
          ? ("data" as const)
          : ("directory" as const),
      offset: encodedTarget & 0x7fffffff,
    },
  };
};

/** Observe the length only; callers admit decoded-name costs before reading or decoding payload. */
export const readPeResourceNameFacts = (bytes: Buffer) => {
  const utf16Units = bytes.readUInt16LE(0);
  return { utf16Units, payloadBytes: utf16Units * 2 };
};
