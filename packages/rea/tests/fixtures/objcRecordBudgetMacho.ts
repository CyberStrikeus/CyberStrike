const base = 0x100000000n;

/** Minimal inert Mach-O with one class instance method and protocol method. */
export const objcRecordBudgetMacho = (
  owner: "class" | "protocol",
  classMethodOffsets: readonly number[] = [0x700],
): Buffer => {
  const bytes = Buffer.alloc(4096);
  const u32 = (offset: number, value: number) =>
    bytes.writeUInt32LE(value, offset);
  const pointer = (offset: number, target: number) =>
    bytes.writeBigUInt64LE(base + BigInt(target), offset);
  const nullPointer = (offset: number) => bytes.writeBigUInt64LE(0n, offset);

  u32(0, 0xfeedfacf);
  u32(4, 0x0100000c);
  u32(12, 2);
  u32(16, 1);
  u32(20, owner === "protocol" ? 232 : 152);
  u32(32, 0x19);
  u32(36, owner === "protocol" ? 232 : 152);
  bytes.write("__DATA", 40);
  pointer(56, 0);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(4096n, 80);
  u32(88, 7);
  u32(92, 5);
  u32(96, owner === "protocol" ? 2 : 1);
  bytes.write("__objc_classlist", 104);
  bytes.write("__DATA", 120);
  pointer(136, 0x180);
  bytes.writeBigUInt64LE(8n, 144);
  u32(152, 0x180);
  if (owner === "protocol") {
    bytes.write("__objc_protolist", 184);
    bytes.write("__DATA", 200);
    pointer(216, 0x6c0);
    bytes.writeBigUInt64LE(8n, 224);
    u32(232, 0x6c0);
    pointer(0x6c0, 0x740);
  }

  pointer(0x180, 0x200);
  // class_t: zero isa/superclass; class_ro_t is root, named and has one method.
  nullPointer(0x200);
  nullPointer(0x208);
  pointer(0x220, 0x300);
  u32(0x300, 2);
  u32(0x308, 8);
  pointer(0x318, 0x900);
  pointer(0x320, 0x500);
  nullPointer(0x328);
  nullPointer(0x330);
  nullPointer(0x340);
  bytes.write("FixtureClass\0", 0x900);
  u32(0x500, 24);
  u32(0x504, classMethodOffsets.length);
  for (const [index, implementation] of classMethodOffsets.entries()) {
    const entry = 0x508 + index * 24;
    pointer(entry, 0x920);
    pointer(entry + 8, 0x940);
    pointer(entry + 16, implementation);
  }
  bytes.write("classMethod\0", 0x920);
  bytes.write("v@:\0", 0x940);

  // Protocol method lists use the same declaration boundary and budget.
  pointer(0x6c0, 0x740);
  pointer(0x748, 0x980);
  pointer(0x758, 0x800);
  u32(0x780, 72);
  u32(0x800, 24);
  u32(0x804, 1);
  pointer(0x808, 0x9a0);
  bytes.write("FixtureProtocol\0", 0x980);
  bytes.write("protocolMethod\0", 0x9a0);
  return bytes;
};
