/** UF2 flag values from Microsoft's UF2 specification. */
export const UF2_FLAGS = {
  notMainFlash: 0x0000_0001,
  fileContainer: 0x0000_1000,
  familyId: 0x0000_2000,
  md5: 0x0000_4000,
  extensionTags: 0x0000_8000,
} as const;

export const RP2040_FAMILY = 0xe48b_ff56;
export const RP2XXX_ABSOLUTE_FAMILY = 0xe48b_ff57;
export const RP2350_ARM_S_FAMILY = 0xe48b_ff59;

export interface Uf2BlockFields {
  readonly address: number;
  readonly payload: Uint8Array | readonly number[];
  readonly blockNo: number;
  readonly numBlocks: number;
  /** Sets flag 0x2000 and the familyID word unless `fileSize` is given. */
  readonly familyId?: number;
  readonly fileSize?: number;
  readonly flags?: number;
  /** A payload size field that differs from the payload, for malformed blocks. */
  readonly declaredSize?: number;
  readonly magics?: readonly [number, number, number];
}

/** One 512-byte block written from the specification's field layout. */
export const uf2Block = (fields: Uf2BlockFields): Uint8Array => {
  const block = Buffer.alloc(512);
  const [start0, start1, end] = fields.magics ?? [
    0x0a32_4655, 0x9e5d_5157, 0x0ab1_6f30,
  ];
  const payload = Uint8Array.from(fields.payload);
  const flags =
    (fields.flags ?? 0) |
    (fields.familyId === undefined ? 0 : UF2_FLAGS.familyId);
  block.writeUInt32LE(start0, 0);
  block.writeUInt32LE(start1, 4);
  block.writeUInt32LE(flags >>> 0, 8);
  block.writeUInt32LE(fields.address, 12);
  block.writeUInt32LE(fields.declaredSize ?? payload.length, 16);
  block.writeUInt32LE(fields.blockNo, 20);
  block.writeUInt32LE(fields.numBlocks, 24);
  block.writeUInt32LE(fields.familyId ?? fields.fileSize ?? 0, 28);
  block.set(payload.subarray(0, 476), 32);
  block.writeUInt32LE(end, 508);
  return block;
};

/** Numbered 256-byte blocks for one family, as RP2040 producers write them. */
export const uf2Image = (
  familyId: number | undefined,
  address: number,
  bytes: Uint8Array,
  payloadSize = 256,
): Uint8Array[] => {
  const numBlocks = Math.ceil(bytes.length / payloadSize);
  return Array.from({ length: numBlocks }, (_, blockNo) =>
    uf2Block({
      address: address + blockNo * payloadSize,
      payload: bytes.subarray(
        blockNo * payloadSize,
        (blockNo + 1) * payloadSize,
      ),
      blockNo,
      numBlocks,
      ...(familyId === undefined ? {} : { familyId }),
    }),
  );
};

/** Deterministic, address-dependent bytes so misplaced payloads are visible. */
export const patternBytes = (length: number, seed = 0): Uint8Array =>
  Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 0xff);

export const uf2File = (blocks: readonly Uint8Array[]): Buffer =>
  Buffer.concat(blocks);
