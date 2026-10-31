import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Write text fixture files, creating parent directories as needed. */
export const writeFixtureFiles = async (
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  const entries = Object.entries(files).map(([relative, contents]) => ({
    path: join(root, relative),
    contents,
  }));
  // Concurrent recursive mkdir calls can race for shared ancestors on Windows.
  for (const directory of new Set(entries.map(({ path }) => dirname(path)))) {
    await mkdir(directory, { recursive: true });
  }
  await Promise.all(
    entries.map(({ path, contents }) => writeFile(path, contents)),
  );
};
