/**
 * Build a minimal valid DOL: one text section at 0x80003100 with a 32-byte body.
 * Optional data and BSS ranges exercise the multi-section import path.
 */
export const buildGamecubeDol = (
  options: {
    readonly entryPoint?: number;
    readonly textAddress?: number;
    readonly data?: { readonly address: number; readonly bytes: Buffer };
    readonly bss?: { readonly address: number; readonly size: number };
  } = {},
): Buffer => {
  const textAddress = options.textAddress ?? 0x8000_3100;
  const text = Buffer.from("4e800020".repeat(8), "hex");
  const data = options.data?.bytes ?? Buffer.alloc(0);
  const header = Buffer.alloc(0x100);
  header.writeUInt32BE(0x100, 0x00); // text slot 0 file offset
  header.writeUInt32BE(textAddress, 0x48); // text slot 0 load address
  header.writeUInt32BE(text.length, 0x90); // text slot 0 size
  if (options.data !== undefined) {
    header.writeUInt32BE(0x100 + text.length, 0x1c); // data slot 0 file offset
    header.writeUInt32BE(options.data.address, 0x64); // data slot 0 load address
    header.writeUInt32BE(data.length, 0xac); // data slot 0 size
  }
  if (options.bss !== undefined) {
    header.writeUInt32BE(options.bss.address, 0xd8); // BSS load address
    header.writeUInt32BE(options.bss.size, 0xdc); // BSS size
  }
  header.writeUInt32BE(options.entryPoint ?? textAddress, 0xe0); // entry point
  return Buffer.concat([header, text, data]);
};
