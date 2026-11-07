import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

/** Real ZIP entries whose Unix external attributes declare symlinks. */
export const zipSymlinkMetadataFixture = async (): Promise<Buffer> => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    versionMadeBy: 3 << 8,
  });
  await writer.add("target.txt", new TextReader("harmless target text"));
  for (const [name, mode] of [
    ["type-only-link", 0o120000],
    ["permissions-link", 0o120777],
  ] as const)
    await writer.add(name, new TextReader("target.txt"), {
      externalFileAttributes: (mode << 16) >>> 0,
    });
  return Buffer.from(await writer.close());
};
