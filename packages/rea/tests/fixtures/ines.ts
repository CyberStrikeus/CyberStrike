/** Source-owned iNES bytes; the payload is test data, not a game ROM. */
export const inesFixture = (
  options: {
    readonly trainer?: boolean;
    readonly chrUnits?: number;
    readonly trailing?: Buffer;
  } = {},
): Buffer => {
  const header = Buffer.alloc(16);
  header.write("NES\x1a", "latin1");
  header[4] = 2;
  header[5] = options.chrUnits ?? 1;
  header[6] = 0x31 | (options.trainer === true ? 4 : 0);
  header[7] = 0x10;
  return Buffer.concat([
    header,
    ...(options.trainer === true ? [Buffer.alloc(512, 0x54)] : []),
    Buffer.alloc(16_384, 0x41),
    Buffer.alloc(16_384, 0x42),
    ...Array.from({ length: header.readUInt8(5) }, () =>
      Buffer.alloc(8_192, 0x43),
    ),
    options.trailing ?? Buffer.alloc(0),
  ]);
};
