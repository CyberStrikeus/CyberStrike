import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

/** Build a one-entry ZIP for tests that need to rewrite its stored filename. */
export const createSingleEntryZip = async (
  name: string,
  contents = "member bytes",
): Promise<Buffer> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(name, new TextReader(contents));
  return Buffer.from(await writer.close());
};

/** Rewrite both single-entry ZIP headers while preserving all other bytes. */
export const rewriteSingleEntryZipName = (
  archive: Buffer,
  originalName: string,
  rawName: Buffer,
  utf8Flag: boolean,
): Buffer => {
  const rewritten = Buffer.from(archive);
  const expectedName = Buffer.from(originalName, "utf8");
  for (const { signature, nameOffset, flagsOffset, lengthOffset } of [
    {
      signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      nameOffset: 30,
      flagsOffset: 6,
      lengthOffset: 26,
    },
    {
      signature: Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      nameOffset: 46,
      flagsOffset: 8,
      lengthOffset: 28,
    },
  ]) {
    const header = rewritten.indexOf(signature);
    if (header < 0) throw new Error("Expected ZIP member header");
    const nameLength = rewritten.readUInt16LE(header + lengthOffset);
    if (
      nameLength !== expectedName.length ||
      nameLength !== rawName.length ||
      !rewritten
        .subarray(header + nameOffset, header + nameOffset + nameLength)
        .equals(expectedName)
    )
      throw new Error("Expected the original ZIP member name");
    rawName.copy(rewritten, header + nameOffset);
    const flags = rewritten.readUInt16LE(header + flagsOffset);
    rewritten.writeUInt16LE(
      utf8Flag ? flags | 0x0800 : flags & ~0x0800,
      header + flagsOffset,
    );
  }
  return rewritten;
};
