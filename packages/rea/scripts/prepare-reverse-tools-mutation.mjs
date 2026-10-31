import { mkdir, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = resolve(root, "node_modules/typescript6");

for (const packageName of ["core", "typescript-checker"]) {
  const packagePath = resolve(
    root,
    "node_modules/@stryker-mutator",
    packageName,
  );
  const nodeModulesPath = resolve(packagePath, "node_modules");
  const typescriptPath = resolve(nodeModulesPath, "typescript");
  await mkdir(nodeModulesPath, { recursive: true });
  await rm(typescriptPath, { recursive: true, force: true });
  await symlink(compiler, typescriptPath, "dir");
}
