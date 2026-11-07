import { createHash } from "node:crypto";

const IMAGE_BASE = 0x140000000n;
const address = (rva: number): bigint => IMAGE_BASE + BigInt(rva);

export const nativeAotPeDigest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export const nativeAotPeFixture = (major = 9, minor = 1): Buffer => {
  const bytes = Buffer.alloc(0xa00);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "ascii");
  bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(2, 0x86);
  bytes.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98;
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeBigUInt64LE(IMAGE_BASE, optional + 24);
  bytes.writeUInt32LE(0x3000, optional + 56);
  bytes.writeUInt32LE(0x400, optional + 60);
  const sectionTable = optional + 0xf0;
  bytes.write(".text", sectionTable, "ascii");
  bytes.writeUInt32LE(0x200, sectionTable + 8);
  bytes.writeUInt32LE(0x1000, sectionTable + 12);
  bytes.writeUInt32LE(0x200, sectionTable + 16);
  bytes.writeUInt32LE(0x400, sectionTable + 20);
  bytes.writeUInt32LE(0x60000020, sectionTable + 36);
  const data = sectionTable + 40;
  bytes.write(".rdata", data, "ascii");
  bytes.writeUInt32LE(0x400, data + 8);
  bytes.writeUInt32LE(0x2000, data + 12);
  bytes.writeUInt32LE(0x400, data + 16);
  bytes.writeUInt32LE(0x600, data + 20);
  bytes.writeUInt32LE(0x40000040, data + 36);

  bytes.writeUInt8(0xc3, 0x410);
  bytes.writeUInt8(0xc3, 0x420);
  bytes.writeUInt8(0xc3, 0x430);
  const header = 0x600;
  bytes.writeUInt32LE(0x00525452, header);
  bytes.writeUInt16LE(major, header + 4);
  bytes.writeUInt16LE(minor, header + 6);
  bytes.writeUInt16LE(2, header + 12);
  bytes.writeUInt8(24, header + 14);
  bytes.writeUInt8(1, header + 15);
  bytes.writeUInt32LE(207, header + 16);
  bytes.writeUInt32LE(1, header + 20);
  bytes.writeBigUInt64LE(address(0x2100), header + 24);
  bytes.writeBigUInt64LE(address(0x2105), header + 32);
  bytes.writeUInt32LE(206, header + 40);
  bytes.writeBigUInt64LE(address(0x2300), header + 48);
  bytes.writeBigUInt64LE(address(0x2380), header + 56);
  bytes.writeInt32LE(0x280, 0x700);
  bytes.writeUInt8(0x09, 0x704);

  const writeMethodTable = (
    rva: number,
    flags: number,
    baseSize: number,
    related: bigint,
    slots: readonly bigint[],
  ) => {
    const offset = 0x600 + rva - 0x2000;
    bytes.writeUInt32LE(flags, offset);
    bytes.writeUInt32LE(baseSize, offset + 4);
    bytes.writeBigUInt64LE(related, offset + 8);
    bytes.writeUInt16LE(slots.length, offset + 16);
    bytes.writeUInt16LE(0, offset + 18);
    bytes.writeUInt32LE(0x1234, offset + 20);
    slots.forEach((slot, index) =>
      bytes.writeBigUInt64LE(slot, offset + 24 + index * 8),
    );
  };
  const object = address(0x2200);
  writeMethodTable(0x2200, 0x50000000, 0x18, 0n, [
    address(0x1010),
    address(0x1020),
    address(0x1030),
  ]);
  writeMethodTable(0x2280, 0x50000000, 0x20, object, [address(0x1040)]);
  writeMethodTable(0x22c0, 0x50000000, 0x16, object, []);

  const frozen = 0x600 + 0x2300 - 0x2000;
  bytes.writeBigUInt64LE(address(0x22c0), frozen);
  const value = Buffer.from("REA_NATIVEAOT_FROZEN", "utf16le");
  bytes.writeUInt32LE(value.length / 2, frozen + 8);
  value.copy(bytes, frozen + 12);
  bytes.writeUInt16LE(0, frozen + 12 + value.length);
  return bytes;
};

/** An RTR indirection into PE headers; its whole pointer interval must map. */
export const nativeAotPeHeaderIndirectionFixture = (rva: number): Buffer => {
  const bytes = nativeAotPeFixture();
  bytes.writeUInt32LE(204, 0x600 + 40);
  bytes.writeBigUInt64LE(IMAGE_BASE + BigInt(rva), 0x600 + 48);
  bytes.writeBigUInt64LE(0n, 0x600 + 56);
  return bytes;
};

/** Keep section-table placement consistent with the selected optional header. */
export const nativeAotPeOptionalHeaderFixture = (
  optionalBytes: number,
): Buffer => {
  const bytes = nativeAotPeFixture();
  bytes.copy(bytes, 0x98 + optionalBytes, 0x98 + 0xf0, 0x98 + 0xf0 + 80);
  bytes.writeUInt16LE(optionalBytes, 0x94);
  return bytes;
};

/** Add a zero-filled virtual section without changing the captured metadata bytes. */
export const nativeAotPeVirtualSectionFixture = (
  rva: number,
  virtualSize: number,
  position: "before-data" | "after-data" = "after-data",
): Buffer => {
  const bytes = nativeAotPeFixture();
  const table = 0x98 + 0xf0;
  const data = Buffer.from(bytes.subarray(table + 40, table + 80));
  bytes.writeUInt16LE(3, 0x86);
  const extra = position === "before-data" ? table + 40 : table + 80;
  bytes.fill(0, extra, extra + 40);
  bytes.write(".bss", extra, "ascii");
  bytes.writeUInt32LE(virtualSize, extra + 8);
  bytes.writeUInt32LE(rva, extra + 12);
  bytes.writeUInt32LE(0xc0000080, extra + 36);
  if (position === "before-data") data.copy(bytes, table + 80);
  return bytes;
};

/** One authored RTR9.1 hydration command; fixup targets are absolute addresses. */
export type NativeAotHydrationCommand =
  | { readonly copy: Buffer }
  | { readonly zero: number }
  | { readonly fixupRel: bigint }
  | { readonly fixupPtr: bigint }
  | { readonly inlineRel: readonly bigint[] }
  | { readonly inlinePtr: readonly bigint[] }
  /** Stream bytes emitted verbatim for malformed-input cases; no output. */
  | { readonly raw: Buffer };

/** Overlay address and capacity of {@link nativeAotPeHydrationFixture}. */
export const NATIVE_AOT_HYDRATION_BASE = address(0x40000);
export const NATIVE_AOT_HYDRATION_CAPACITY = 0x22000;

const hydrationHeader = (command: number, payload: number): Buffer => {
  if (payload <= 28) return Buffer.from([(payload << 3) | command]);
  const extra = payload - 28;
  const width = extra < 0x100 ? 1 : extra < 0x10000 ? 2 : 3;
  const bytes = Buffer.alloc(1 + width, ((28 + width) << 3) | command);
  bytes.writeUIntLE(extra, 1, width);
  return bytes;
};

/**
 * Expand .rdata so DEHYDRATED_DATA at RVA 0x3000 can carry an authored command
 * stream whose overlay at RVA 0x40000 may grow to the end of the section.
 * Returns the bytes the RTR9.1 writer semantics say hydration must produce.
 */
export const nativeAotPeHydrationFixture = (
  commands: readonly NativeAotHydrationCommand[],
): { readonly bytes: Buffer; readonly expected: Buffer } => {
  const bytes = Buffer.alloc(0x60600);
  nativeAotPeFixture().copy(bytes);
  const data = 0x98 + 0xf0 + 40;
  bytes.writeUInt32LE(0x60000, data + 8);
  bytes.writeUInt32LE(0x60000, data + 16);
  bytes.writeUInt32LE(0x62000, 0x98 + 56);
  const start = 0x3000;
  const fileOffset = (rva: number): number => 0x600 + rva - 0x2000;
  const stream: Buffer[] = [Buffer.alloc(4)];
  let streamLength = 4;
  const emit = (...chunks: Buffer[]): void => {
    for (const chunk of chunks) {
      stream.push(chunk);
      streamLength += chunk.length;
    }
  };
  const fixups: bigint[] = [];
  const expected: Buffer[] = [];
  let produced = 0;
  const relative = (target: bigint): Buffer => {
    const value = Buffer.alloc(4);
    value.writeInt32LE(
      Number(target - (NATIVE_AOT_HYDRATION_BASE + BigInt(produced))),
    );
    produced += 4;
    return value;
  };
  const pointer = (target: bigint): Buffer => {
    const value = Buffer.alloc(8);
    value.writeBigUInt64LE(target);
    produced += 8;
    return value;
  };
  const inline = (targets: readonly bigint[]): void => {
    for (const target of targets) {
      const value = Buffer.alloc(4);
      value.writeInt32LE(Number(target - address(start + streamLength)));
      emit(value);
    }
  };
  for (const command of commands) {
    if ("copy" in command) {
      emit(hydrationHeader(0, command.copy.length), command.copy);
      expected.push(command.copy);
      produced += command.copy.length;
    } else if ("zero" in command) {
      emit(hydrationHeader(1, command.zero));
      expected.push(Buffer.alloc(command.zero));
      produced += command.zero;
    } else if ("fixupRel" in command) {
      emit(hydrationHeader(2, fixups.push(command.fixupRel) - 1));
      expected.push(relative(command.fixupRel));
    } else if ("fixupPtr" in command) {
      emit(hydrationHeader(3, fixups.push(command.fixupPtr) - 1));
      expected.push(pointer(command.fixupPtr));
    } else if ("inlineRel" in command) {
      emit(hydrationHeader(4, command.inlineRel.length));
      inline(command.inlineRel);
      expected.push(...command.inlineRel.map(relative));
    } else if ("raw" in command) {
      emit(command.raw);
    } else {
      emit(hydrationHeader(5, command.inlinePtr.length));
      inline(command.inlinePtr);
      expected.push(...command.inlinePtr.map(pointer));
    }
  }
  const end = start + streamLength;
  if (end + fixups.length * 4 > 0x40000)
    throw new Error("Hydration fixture stream overlaps its overlay");
  Buffer.concat(stream).copy(bytes, fileOffset(start));
  bytes.writeInt32LE(0x40000 - start, fileOffset(start));
  fixups.forEach((target, index) => {
    const location = end + index * 4;
    bytes.writeInt32LE(
      Number(target - address(location)),
      fileOffset(location),
    );
  });
  bytes.writeBigUInt64LE(address(start), 0x618);
  bytes.writeBigUInt64LE(address(end), 0x620);
  return { bytes, expected: Buffer.concat(expected) };
};
