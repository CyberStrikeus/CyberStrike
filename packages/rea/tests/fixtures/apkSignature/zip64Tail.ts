import { zipWith } from "./v1SignatureBlock.js";

/** A real stored entry with an authored APPNOTE 6.3.10 §4.3.14–15 Zip64 tail. */
export const zip64Tail = async () => {
  const classic = await zipWith(
    [{ name: "entry.txt", data: "inert", stored: true }],
    { dataDescriptor: false },
  );
  const original = new DataView(
    classic.buffer,
    classic.byteOffset,
    classic.byteLength,
  );
  const recordOffset = classic.length - 22;
  const locatorOffset = recordOffset + 56;
  const eocdOffset = locatorOffset + 20;
  const bytes = new Uint8Array(classic.length + 76);
  bytes.set(classic.subarray(0, recordOffset));
  bytes.set(classic.subarray(recordOffset), eocdOffset);
  const view = new DataView(bytes.buffer);
  view.setUint32(recordOffset, 0x06064b50, true);
  view.setBigUint64(recordOffset + 4, 44n, true);
  view.setUint16(recordOffset + 12, 45, true);
  view.setUint16(recordOffset + 14, 45, true);
  const entries = BigInt(original.getUint16(recordOffset + 10, true));
  view.setBigUint64(recordOffset + 24, entries, true);
  view.setBigUint64(recordOffset + 32, entries, true);
  view.setBigUint64(
    recordOffset + 40,
    BigInt(original.getUint32(recordOffset + 12, true)),
    true,
  );
  view.setBigUint64(
    recordOffset + 48,
    BigInt(original.getUint32(recordOffset + 16, true)),
    true,
  );
  view.setUint32(locatorOffset, 0x07064b50, true);
  view.setBigUint64(locatorOffset + 8, BigInt(recordOffset), true);
  view.setUint32(locatorOffset + 16, 1, true);
  view.setUint16(eocdOffset + 8, 0xffff, true);
  view.setUint16(eocdOffset + 10, 0xffff, true);
  view.setUint32(eocdOffset + 12, 0xffffffff, true);
  view.setUint32(eocdOffset + 16, 0xffffffff, true);
  return { bytes, recordOffset, locatorOffset, eocdOffset };
};
