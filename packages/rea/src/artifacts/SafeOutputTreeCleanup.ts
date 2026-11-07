import { readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, sep } from "node:path";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import {
  assertFilePathIdentity,
  assertPathIdentity,
  replacedDirectory,
  type DirectoryIdentity,
  type FileIdentity,
} from "./SafeOutputTreeIdentity.js";

/** Remove only tracked files and empty directories, preserving successful progress. */
export const removeOwnedTree = async (input: {
  readonly outputRoot: string;
  readonly rootIdentity: DirectoryIdentity;
  readonly directories: Map<string, DirectoryIdentity>;
  readonly files: Map<string, FileIdentity>;
  readonly preserveRoot?: boolean;
}): Promise<void> => {
  const { outputRoot, rootIdentity, directories, files } = input;
  const filesByDirectory = new Map<string, [string, FileIdentity][]>();
  for (const entry of files) {
    const directory = dirname(entry[0]);
    const group = filesByDirectory.get(directory) ?? [];
    group.push(entry);
    filesByDirectory.set(directory, group);
  }
  const postorder = [...directories].sort(
    ([left], [right]) =>
      right.slice(outputRoot.length).split(sep).length -
      left.slice(outputRoot.length).split(sep).length,
  );
  for (const [path, identity] of postorder) {
    await removeFiles(path, identity, filesByDirectory.get(path) ?? [], files);
    const parentPath = dirname(path);
    const parentIdentity =
      parentPath === outputRoot ? rootIdentity : directories.get(parentPath);
    if (parentIdentity === undefined) throw replacedDirectory(parentPath);
    await assertPathIdentity(parentPath, parentIdentity);
    await assertPathIdentity(path, identity);
    await requireEmpty(path);
    await rmdir(path);
    directories.delete(path);
  }
  await removeFiles(
    outputRoot,
    rootIdentity,
    filesByDirectory.get(outputRoot) ?? [],
    files,
  );
  await assertPathIdentity(outputRoot, rootIdentity);
  await requireEmpty(outputRoot);
  if (!input.preserveRoot) await rmdir(outputRoot);
};

const removeFiles = async (
  directory: string,
  identity: DirectoryIdentity,
  filesInDirectory: readonly (readonly [string, FileIdentity])[],
  retainedFiles: Map<string, FileIdentity>,
): Promise<void> => {
  for (const [path, fileIdentity] of filesInDirectory) {
    await assertPathIdentity(directory, identity);
    await assertFilePathIdentity(path, fileIdentity);
    await unlink(path);
    retainedFiles.delete(path);
  }
};

const requireEmpty = async (directory: string): Promise<void> => {
  if ((await readdir(directory)).length > 0)
    throw new ArtifactReaderFailure(
      "path",
      `Unowned entries remain in extraction directory: ${directory}`,
    );
};
