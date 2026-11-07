import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { inspectModuleBoundaries } from "./lib/module-boundaries.mjs";

const execute = promisify(execFile);
const root = process.cwd();
const selected = process.argv.slice(2);
for (const file of selected)
  if (!file.endsWith(".ts"))
    throw new TypeError(`Expected an exact TypeScript source file: ${file}`);

const enumerateSourceFiles = async () => {
  if (selected.length > 0) return selected;
  let isGitRoot = false;
  try {
    const { stdout } = await execute("git", ["rev-parse", "--show-cdup"], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
    });
    isGitRoot = stdout.trim() === "";
  } catch {
    // Archives and source snapshots may not be in a Git worktree.
  }
  if (isGitRoot) {
    try {
      const { stdout } = await execute(
        "git",
        [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          "src",
        ],
        { cwd: root, maxBuffer: 8 * 1024 * 1024 },
      );
      return stdout.split("\0");
    } catch {
      // Fall back to disk when Git's index is unavailable or unreadable.
    }
  }
  const entries = await readdir(resolve(root, "src"), { recursive: true });
  return entries.map((entry) => join("src", entry));
};

const files = await enumerateSourceFiles();

let checked = 0;
for (const file of new Set(files.filter((path) => path.endsWith(".ts")))) {
  let source;
  try {
    source = await readFile(resolve(root, file), "utf8");
  } catch (cause) {
    if (
      selected.length === 0 &&
      (cause.code === "ENOENT" || cause.code === "EISDIR")
    )
      continue;
    throw cause;
  }
  checked += 1;
  try {
    for (const violation of inspectModuleBoundaries(file, source, root)) {
      console.error(
        `${violation.file}:${violation.line}: ${violation.boundary}: ${violation.specifier} resolves to ${violation.target}`,
      );
      process.exitCode = 1;
    }
  } catch (cause) {
    console.error(`Could not inspect ${file}: ${cause.message}`);
    process.exitCode = 1;
  }
}
if (process.exitCode !== 1)
  console.log(`Checked resolved module boundaries in ${checked} source files.`);
