/**
 * arm64 Mach-O with one Objective-C class, `Fixture`, whose two properties
 * `first` and `second` share one attribute string. The first name may be
 * replaced and the second name pointer may target an unmapped offset.
 */
export const machoWithPropertyAttributes = (
  attributes: string,
  {
    firstName = "first",
    secondNameOffset,
  }: { firstName?: string; secondNameOffset?: number } = {},
): Buffer => {
  const bytes = Buffer.alloc(4096);
  const base = 0x100000000n;
  const firstNameData = Buffer.from(`${firstName}\0`);
  const attributeData = Buffer.from(`${attributes}\0`);
  const attributeOffset = 0x600 + firstNameData.length;
  const secondNameDataOffset = attributeOffset + attributeData.length;
  const u32 = (at: number, value: number) => bytes.writeUInt32LE(value, at);
  const pointer = (at: number, offset: number) =>
    bytes.writeBigUInt64LE(base + BigInt(offset), at);
  u32(0, 0xfeedfacf);
  u32(4, 0x0100000c);
  u32(12, 2);
  u32(16, 1);
  u32(20, 152);
  u32(32, 0x19);
  u32(36, 152);
  bytes.write("__DATA", 40);
  pointer(56, 0);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(4096n, 80);
  u32(88, 5);
  u32(92, 5);
  u32(96, 1);
  bytes.write("__objc_classlist", 104);
  bytes.write("__DATA", 120);
  pointer(136, 0x180);
  bytes.writeBigUInt64LE(8n, 144);
  u32(152, 0x180);
  pointer(0x180, 0x200);
  pointer(0x200 + 32, 0x300);
  u32(0x300, 2);
  u32(0x308, 16);
  pointer(0x300 + 24, 0x400);
  bytes.write("Fixture\0", 0x400);
  pointer(0x340, 0x500);
  u32(0x500, 16);
  u32(0x504, 2);
  pointer(0x508, 0x600);
  pointer(0x510, attributeOffset);
  pointer(0x518, secondNameOffset ?? secondNameDataOffset);
  pointer(0x520, attributeOffset);
  firstNameData.copy(bytes, 0x600);
  attributeData.copy(bytes, attributeOffset);
  bytes.write("second\0", secondNameDataOffset);
  return bytes;
};
