import { crc32 } from "node:zlib";

import {
  UIMAGE_HEADER_SIZE,
  UIMAGE_MAGIC,
  UIMAGE_NAME_LENGTH,
} from "../../src/domain/uimageFormat.js";

export interface UImageFixtureOptions {
  readonly arch?: number;
  readonly os?: number;
  readonly type?: number;
  readonly compression?: number;
  readonly loadAddress?: number;
  readonly entryPoint?: number;
  readonly timestamp?: number;
  readonly name?: string;
  /** Raw stored payload bytes; for multi images pass the size table + parts. */
  readonly payload?: Buffer;
  /** Corrupt the header CRC after computing it (keeps a valid magic). */
  readonly corruptHeaderCrc?: boolean;
  /** Corrupt the data CRC after computing it. */
  readonly corruptDataCrc?: boolean;
}

/** Build a synthetic legacy uImage with correctly computed CRCs. */
export const buildUImage = (options: UImageFixtureOptions = {}): Buffer => {
  const payload = options.payload ?? Buffer.from("uimage-payload");
  const header = Buffer.alloc(UIMAGE_HEADER_SIZE);
  header.writeUInt32BE(UIMAGE_MAGIC, 0);
  header.writeUInt32BE(options.timestamp ?? 1700000000, 8);
  header.writeUInt32BE(payload.length, 12);
  header.writeUInt32BE(options.loadAddress ?? 0x8000, 16);
  header.writeUInt32BE(options.entryPoint ?? 0x8000, 20);
  // Data CRC first: corrupting it must keep the header CRC valid, so the
  // header CRC is computed over the final header bytes below.
  const dataCrc =
    (crc32(payload) >>> 0) ^ (options.corruptDataCrc === true ? 0xff : 0);
  header.writeUInt32BE(dataCrc >>> 0, 24);
  header[28] = options.os ?? 5;
  header[29] = options.arch ?? 2;
  header[30] = options.type ?? 2;
  header[31] = options.compression ?? 0;
  const name = Buffer.from(options.name ?? "test-kernel", "utf8");
  name.copy(header, 32, 0, Math.min(name.length, UIMAGE_NAME_LENGTH));
  const headerCrc = crc32(header) >>> 0;
  header.writeUInt32BE(
    options.corruptHeaderCrc === true ? (headerCrc ^ 0xff) >>> 0 : headerCrc,
    4,
  );
  return Buffer.concat([header, payload]);
};

/** Size table + parts layout for a multi-file image payload. */
export const buildMultiPayload = (parts: readonly Buffer[]): Buffer => {
  const table = Buffer.alloc((parts.length + 1) * 4);
  parts.forEach((part, index) => {
    table.writeUInt32BE(part.length, index * 4);
  });
  const stored: Buffer[] = [table];
  parts.forEach((part, index) => {
    if (part.length === 0)
      throw new Error(
        "A zero size terminates the uImage table; it cannot describe a component",
      );
    stored.push(part);
    if (index + 1 < parts.length)
      stored.push(Buffer.alloc((4 - (part.length % 4)) % 4));
  });
  return Buffer.concat(stored);
};
