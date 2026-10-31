import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { PyInstallerArtifactReader } from "../../src/artifacts/PyInstallerArtifactReader.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

export const withPyInstallerReader = async (
  bytes: Buffer,
  run: (
    reader: PyInstallerArtifactReader,
    handle: FileHandle,
    path: string,
  ) => Promise<void>,
) => {
  const root = await createTestTempDirectory("rea-pyi-boundary-");
  const path = join(root, "app");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  const reader = new PyInstallerArtifactReader(path, {
    handle,
    initial: await handle.stat(),
  });
  try {
    await run(reader, handle, path);
  } finally {
    try {
      await reader.close();
    } finally {
      await handle.close();
    }
  }
};
