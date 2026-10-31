import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { aotFixtureImage } from "../../src/flutter/FlutterBuild.fixture.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

/** Materialize real ZIP members with test-scoped exact-path cleanup. */
export const createFlutterApk = async (
  name: string,
  files: ReadonlyArray<{ readonly path: string; readonly bytes: Buffer }>,
): Promise<string> => {
  const root = await createTestTempDirectory("rea-flutter-");
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  for (const file of files)
    await writer.add(file.path, new Uint8ArrayReader(file.bytes));
  const path = join(root, name);
  await writeFile(path, await writer.close());
  return path;
};

/** ZIP permits repeated names; the writer refuses them, so rewrite both records. */
export const createDuplicateFlutterApk = async (): Promise<string> => {
  const path = await createFlutterApk("duplicates.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotFixtureImage() },
    { path: "lib/arm64-v8a/libxxx.so", bytes: Buffer.alloc(64) },
  ]);
  const bytes = await readFile(path);
  const from = Buffer.from("lib/arm64-v8a/libxxx.so");
  for (
    let at = bytes.indexOf(from);
    at >= 0;
    at = bytes.indexOf(from, at + from.length)
  )
    bytes.write("lib/arm64-v8a/libapp.so", at);
  await writeFile(path, bytes);
  return path;
};
