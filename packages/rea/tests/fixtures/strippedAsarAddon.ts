import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";

import { createTestTempDirectory } from "./temporaryDirectory.js";

interface AdditionalAsarFile {
  readonly path: string;
  readonly contents: string;
}

/** Create an Electron ASAR, then model a distro-stripped unpacked native addon. */
export const createStrippedAsarAddon = async (
  additionalFiles: readonly AdditionalAsarFile[] = [],
) => {
  const root = await createTestTempDirectory("rea-stripped-asar-addon-");
  const source = join(root, "source");
  const archive = join(root, "app.asar");
  const addon = "node_modules/btime/binding.node";
  const addonPath = join(source, "node_modules", "btime", "binding.node");
  const original = Buffer.from("upstream native addon bytes");
  const stripped = Buffer.from("stripped native addon");
  await mkdir(join(source, "node_modules", "btime"), { recursive: true });
  await writeFile(join(source, "main.js"), "module.exports = 'observed';\n");
  await writeFile(addonPath, original);
  for (const file of additionalFiles) {
    const path = join(source, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.contents);
  }
  await createPackageWithOptions(source, archive, { unpack: "*.node" });
  await writeFile(
    join(`${archive}.unpacked`, "node_modules", "btime", "binding.node"),
    stripped,
  );
  return { root, archive, addon, original, stripped };
};
