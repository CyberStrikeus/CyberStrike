import { copyFile, cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Prepare an isolated loader graph; the caller owns the workspace and cleanup. */
export const prepareWindowsNativeInspectionWorkspace = async ({
  root,
  artifact,
  workspace,
}) => {
  // Copy the complete compiled graph so loader dependencies have one owner.
  await cp(join(root, "dist"), join(workspace, "dist"), { recursive: true });
  await writeFile(join(workspace, "package.json"), '{"type":"module"}');
  await symlink(
    resolve(root, "node_modules"),
    join(workspace, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  // The injected addon must remain separate from the production installation.
  const native = join(workspace, "native", "windows", "build");
  await mkdir(native, { recursive: true });
  for (const name of ["manifest.json", "rea-windows-x64.node"])
    await copyFile(join(artifact, name), join(native, name));
  return pathToFileURL(
    join(workspace, "dist", "windows", "WindowsNativeLoader.js"),
  ).href;
};
