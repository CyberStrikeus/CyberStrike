import type { BigIntStats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { FileHandle } from "node:fs/promises";

import { ArtifactReaderFailure } from "./ArtifactReader.js";

export type DirectoryIdentity = Pick<BigIntStats, "dev" | "ino">;
export type FileIdentity = DirectoryIdentity;

/** Reject unowned, missing or replaced entries before an output tree is published. */
export const assertExactTreeEntries = async (
  root: string,
  directories: ReadonlyMap<string, DirectoryIdentity>,
  files: ReadonlyMap<string, FileIdentity>,
): Promise<void> => {
  const expected = new Map<string, Set<string>>();
  expected.set(root, new Set());
  for (const directory of directories.keys())
    expected.set(directory, new Set());
  for (const path of directories.keys())
    expected.get(dirname(path))?.add(basename(path));
  for (const path of files.keys())
    expected.get(dirname(path))?.add(basename(path));
  for (const [directory, names] of expected) {
    const entries = await readdir(directory);
    const remaining = new Map<string, number>();
    for (const name of names) {
      const key = name.normalize("NFC");
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    let unexpected = entries.length !== names.size;
    for (const entry of entries) {
      const key = entry.normalize("NFC");
      const count = remaining.get(key) ?? 0;
      if (count === 0) unexpected = true;
      else remaining.set(key, count - 1);
    }
    // HFS+ can return an equivalent decomposed spelling. Counts avoid merging
    // distinct Linux names; the original paths must still resolve to owned IDs.
    if (unexpected)
      throw new ArtifactReaderFailure(
        "path",
        `Unowned or missing output entries: ${directory}`,
      );
  }
  for (const [path, identity] of files)
    await assertFilePathIdentity(path, identity);
};

export const readDirectoryIdentity = async (
  path: string,
): Promise<DirectoryIdentity> => {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory())
    throw new ArtifactReaderFailure(
      "path",
      `Output destination must be a directory: ${path}`,
    );
  return { dev: metadata.dev, ino: metadata.ino };
};

export const assertPathIdentity = async (
  path: string,
  expected: DirectoryIdentity,
): Promise<void> => {
  const metadata = await lstat(path, { bigint: true });
  if (
    !metadata.isDirectory() ||
    metadata.dev !== expected.dev ||
    metadata.ino !== expected.ino
  )
    throw replacedDirectory(path);
};

export const assertHandleIdentity = async (
  handle: FileHandle,
  expected: DirectoryIdentity,
  path: string,
): Promise<void> => {
  const metadata = await handle.stat({ bigint: true });
  if (
    !metadata.isDirectory() ||
    metadata.dev !== expected.dev ||
    metadata.ino !== expected.ino
  )
    throw replacedDirectory(path);
};

export const readFileIdentity = async (
  handle: FileHandle,
  path: string,
): Promise<FileIdentity> => {
  const metadata = await handle.stat({ bigint: true });
  if (!metadata.isFile())
    throw new ArtifactReaderFailure(
      "path",
      `Extraction file identity changed: ${path}`,
    );
  return { dev: metadata.dev, ino: metadata.ino };
};

export const assertFilePathIdentity = async (
  path: string,
  expected: FileIdentity,
): Promise<void> => {
  const metadata = await lstat(path, { bigint: true });
  if (
    !metadata.isFile() ||
    metadata.dev !== expected.dev ||
    metadata.ino !== expected.ino
  )
    throw new ArtifactReaderFailure(
      "path",
      `Extraction file identity changed: ${path}`,
    );
};

export const isAbsent = async (path: string): Promise<boolean> =>
  lstat(path).then(
    () => false,
    (cause: unknown) => {
      if (isNotFound(cause)) return true;
      throw cause;
    },
  );

export const replacedDirectory = (path: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure(
    "path",
    `Extraction directory identity changed: ${path}`,
  );

const isNotFound = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";
