/** Source-authored thin arm64 Mach-O with one classic dyld class-symbol bind. */
export const nativeObjcClassImportMachO = () => {
  const address = "0x100001000";
  const unboundAddress = "0x100001008";
  const bindStream = Buffer.from([
    0x11, // Set dylib ordinal 1.
    0x40,
    ...Buffer.from("_OBJC_CLASS_$_Document\0"),
    0x51, // Set pointer bind type.
    0x71,
    0x00, // Segment 1, offset 0.
    0x90, // Bind once.
    0x00,
  ]);
  const bindOffset = 0x300;
  const slotOffset = 0x400;
  const bytes = Buffer.alloc(slotOffset + 16);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, 0xfeedfacf, true);
  view.setUint32(4, 0x0100000c, true); // CPU_TYPE_ARM64
  view.setUint32(8, 0, true); // CPU_SUBTYPE_ARM64_ALL
  view.setUint32(12, 2, true); // MH_EXECUTE
  view.setUint32(16, 4, true);
  view.setUint32(20, 72 + 72 + 48 + 48, true);

  const writeSegment = (
    at: number,
    name: string,
    vmAddress: bigint,
    fileOffset: number,
    fileSize: number,
    protection: number,
  ) => {
    view.setUint32(at, 0x19, true); // LC_SEGMENT_64
    view.setUint32(at + 4, 72, true);
    bytes.write(name, at + 8, "ascii");
    view.setBigUint64(at + 24, vmAddress, true);
    view.setBigUint64(at + 32, BigInt(fileSize), true);
    view.setBigUint64(at + 40, BigInt(fileOffset), true);
    view.setBigUint64(at + 48, BigInt(fileSize), true);
    view.setUint32(at + 56, 7, true);
    view.setUint32(at + 60, protection, true);
  };

  const text = 32;
  writeSegment(text, "__TEXT", 0x100000000n, 0, slotOffset, 5);
  const data = text + 72;
  writeSegment(data, "__DATA", 0x100001000n, slotOffset, 16, 3);

  const dylib = data + 72;
  const library = Buffer.from(
    "/System/Library/Frameworks/AppKit.framework/AppKit\0",
  );
  const dylibSize = Math.ceil((24 + library.length) / 8) * 8;
  view.setUint32(20, 72 + 72 + dylibSize + 48, true);
  view.setUint32(dylib, 0x0c, true); // LC_LOAD_DYLIB
  view.setUint32(dylib + 4, dylibSize, true);
  view.setUint32(dylib + 8, 24, true);
  bytes.set(library, dylib + 24);

  const dyld = dylib + dylibSize;
  view.setUint32(dyld, 0x80000022, true); // LC_DYLD_INFO_ONLY
  view.setUint32(dyld + 4, 48, true);
  view.setUint32(dyld + 16, bindOffset, true);
  view.setUint32(dyld + 20, bindStream.length, true);
  bytes.set(bindStream, bindOffset);

  return { bytes, address, unboundAddress };
};
