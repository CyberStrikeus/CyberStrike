/** Build a public, source-owned 16-bit DOS MZ fixture without a compiler or binary seed. */
export function buildDosMzFixture() {
  const headerBytes = 64;
  const moduleBytes = 128;
  const bytes = Buffer.alloc(headerBytes + moduleBytes);
  const word = (offset, value) => bytes.writeUInt16LE(value, offset);
  word(0, 0x5a4d); // MZ, not a PE stub.
  word(2, bytes.length); // Bytes in the final 512-byte page.
  word(4, 1); // One page.
  word(6, 1); // One relocation.
  word(8, headerBytes / 16);
  word(10, 0);
  word(12, 0xffff);
  word(14, 8); // SS relative to load segment.
  word(16, 0x100); // SP.
  word(20, 0); // IP.
  word(22, 0); // CS relative to load segment.
  word(24, 0x1c); // Relocation table in the header.
  word(0x1c, 9); // Far-call segment word at module+9.
  word(0x1e, 0);
  // Entry: MOV AX,1234h; near CALL +20h; relocated far CALL 0004:0000;
  // Conditional JZ to a separated terminal block, else RET. A conditional edge
  // keeps the tail in entry rather than creating an unconditional tail-call thunk.
  // A RET after DOS exit bounds static analysis even without interrupt semantics.
  // REA never executes this code.
  bytes.set(
    [
      0xb8, 0x34, 0x12, 0xe8, 0x1a, 0x00, 0x9a, 0x00, 0x00, 0x04, 0x00, 0x74,
      0x53, 0xc3,
    ],
    headerBytes,
  );
  bytes.set([0xb8, 0x00, 0x4c, 0xcd, 0x21, 0xc3], headerBytes + 0x60);
  bytes.set([0xfe, 0x00, 0x40, 0xc3], headerBytes + 0x20); // INC byte [BX+SI]; INC AX; RET.
  bytes.set([0x05, 0x02, 0x00, 0xcb], headerBytes + 0x40); // ADD AX,2; RETF.
  return {
    bytes,
    header_bytes: headerBytes,
    module_bytes: moduleBytes,
    load_segment: 0x1000,
    entry_offset: 0,
    near_offset: 0x20,
    far_offset: 0x40,
    near_call_offset: 3,
    far_call_offset: 6,
    relocation_offset: 9,
    entry_first_bytes: 14,
    entry_tail_offset: 0x60,
    entry_tail_bytes: 6,
    near_body_bytes: 4,
    far_body_bytes: 4,
  };
}
