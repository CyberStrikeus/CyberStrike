/** Generate a public source-owned COM fixture; no external compiler or game input. */
export const buildDosComFixture = () => {
  const bytes = Buffer.alloc(64, 0x90);
  bytes.set(Buffer.from("b83412e81a00cd20", "hex"));
  bytes.set(Buffer.from("40c3", "hex"), 32);
  return {
    bytes,
    entry: "0x10100",
    near: "0x10120",
    entry_hex: "b83412",
    load_segment: "0x1000",
  };
};
