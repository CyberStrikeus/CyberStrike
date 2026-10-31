import { readFile, writeFile } from "node:fs/promises";

/** Serialize a header-only ASAR, including Chromium pickle alignment. */
export const asarHeaderBytes = (
  json: string,
  options: { readonly padding?: Uint8Array } = {},
): Buffer => {
  const text = Buffer.from(json);
  const padding = options.padding ?? Buffer.alloc(0);
  const alignedJsonBytes = Math.ceil((text.length + padding.length) / 4) * 4;
  const headerSize = 8 + alignedJsonBytes;
  const bytes = Buffer.alloc(8 + headerSize);
  bytes.writeUInt32LE(4, 0);
  bytes.writeUInt32LE(headerSize, 4);
  bytes.writeUInt32LE(headerSize - 4, 8);
  bytes.writeUInt32LE(text.length, 12);
  text.copy(bytes, 16);
  Buffer.from(padding).copy(bytes, 16 + text.length);
  return bytes;
};

/** Nested metadata without a recursive fixture builder or real directories. */
export const nestedAsarHeader = (
  depth: number,
  name: string,
  leaves: number,
): Buffer => {
  let json = `{"files":{${Array.from(
    { length: leaves },
    (_, index) => `"f${index}":{"size":0,"offset":"0"}`,
  ).join(",")}}}`;
  for (let index = 0; index < depth; index++)
    json = `{"files":{${JSON.stringify(name)}:${json}}}`;
  return asarHeaderBytes(json);
};

/** Reserialize only the header of an official archive, preserving member bytes. */
export const prependAsarJsonWhitespace = async (
  archive: string,
  prefix: string,
): Promise<void> => {
  const bytes = await readFile(archive);
  const jsonBytes = bytes.readUInt32LE(12);
  const oldHeaderEnd = 8 + bytes.readUInt32LE(4);
  const json = bytes.subarray(16, 16 + jsonBytes).toString("utf8");
  await writeFile(
    archive,
    Buffer.concat([
      asarHeaderBytes(`${prefix}${json}`),
      bytes.subarray(oldHeaderEnd),
    ]),
  );
};
