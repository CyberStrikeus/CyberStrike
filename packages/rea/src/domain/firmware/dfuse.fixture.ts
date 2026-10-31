import { crc32 } from "node:zlib";

export interface DfuSeFixtureElement {
  readonly address: number;
  readonly data: Uint8Array | readonly number[];
  /** A dwElementSize that differs from the data, for malformed elements. */
  readonly declaredSize?: number;
}

export interface DfuSeFixtureTarget {
  readonly alternateSetting: number;
  /** Omitted or null writes bTargetNamed 0; raw bytes cover non-text names. */
  readonly name?: string | Uint8Array | null;
  readonly elements: readonly DfuSeFixtureElement[];
  readonly declaredSize?: number;
  readonly declaredElements?: number;
  readonly signature?: string;
}

export interface DfuSeFixture {
  readonly targets: readonly DfuSeFixtureTarget[];
  readonly vendorId?: number;
  readonly productId?: number;
  readonly deviceVersion?: number;
  readonly declaredTargets?: number;
  /** Replaces DFUImageSize, which otherwise counts the prefix and targets. */
  readonly imageSize?: number;
  /** Count the suffix in DFUImageSize too, as dfu-util's dfuse-pack.py does. */
  readonly imageSizeIncludesSuffix?: boolean;
  /** Bytes between the last target and the suffix. */
  readonly gap?: Uint8Array;
  readonly dfuVersion?: number;
  /** Replaces the computed dwCRC. */
  readonly crc?: number;
}

const targetBytes = (target: DfuSeFixtureTarget): Buffer => {
  const elements = Buffer.concat(
    target.elements.map((element) => {
      const data = Uint8Array.from(element.data);
      const header = Buffer.alloc(8);
      header.writeUInt32LE(element.address, 0);
      header.writeUInt32LE(element.declaredSize ?? data.length, 4);
      return Buffer.concat([header, data]);
    }),
  );
  const prefix = Buffer.alloc(274);
  prefix.write(target.signature ?? "Target", 0, "latin1");
  prefix.writeUInt8(target.alternateSetting, 6);
  if (target.name !== undefined && target.name !== null) {
    prefix.writeUInt32LE(1, 7);
    const name =
      typeof target.name === "string"
        ? Buffer.from(target.name, "latin1")
        : Buffer.from(target.name);
    name.copy(prefix, 11, 0, Math.min(name.length, 255));
  }
  prefix.writeUInt32LE(target.declaredSize ?? elements.length, 266);
  prefix.writeUInt32LE(target.declaredElements ?? target.elements.length, 270);
  return Buffer.concat([prefix, elements]);
};

/**
 * A DfuSe file written from ST UM0391 and the DFU 1.1 suffix, with the suffix
 * CRC computed as dfu-util's dfuse-pack.py does: the inverted zlib CRC-32.
 * DFUImageSize excludes the suffix unless `imageSizeIncludesSuffix` is set.
 */
export const dfuseFile = (fixture: DfuSeFixture): Buffer => {
  const targets = Buffer.concat(fixture.targets.map(targetBytes));
  const gap = Buffer.from(fixture.gap ?? []);
  const prefix = Buffer.alloc(11);
  prefix.write("DfuSe", 0, "latin1");
  prefix.writeUInt8(1, 5);
  prefix.writeUInt32LE(
    fixture.imageSize ??
      prefix.length +
        targets.length +
        gap.length +
        (fixture.imageSizeIncludesSuffix === true ? 16 : 0),
    6,
  );
  prefix.writeUInt8(fixture.declaredTargets ?? fixture.targets.length, 10);
  const suffix = Buffer.alloc(16);
  suffix.writeUInt16LE(fixture.deviceVersion ?? 0xffff, 0);
  suffix.writeUInt16LE(fixture.productId ?? 0xdf11, 2);
  suffix.writeUInt16LE(fixture.vendorId ?? 0x0483, 4);
  suffix.writeUInt16LE(fixture.dfuVersion ?? 0x011a, 6);
  suffix.write("UFD", 8, "latin1");
  suffix.writeUInt8(16, 11);
  const body = Buffer.concat([prefix, targets, gap, suffix.subarray(0, 12)]);
  suffix.writeUInt32LE(fixture.crc ?? ~crc32(body) >>> 0, 12);
  return Buffer.concat([body, suffix.subarray(12)]);
};
