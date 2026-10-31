import { execFileSync } from "node:child_process";
import { lstat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [snapshotModulePath, directory] = process.argv.slice(2);
if (snapshotModulePath === undefined || directory === undefined)
  throw new Error(
    "Filesystem snapshot FIFO probe requires a module path and directory",
  );

const { hashFile } = await import(pathToFileURL(snapshotModulePath));
const path = join(directory, "observed-file");
await writeFile(path, "regular file\n");
const expected = await lstat(path);
await unlink(path);
execFileSync("mkfifo", [path]);
// This invokes the production lstat-to-open hashing seam with a known captured
// regular-file identity. The owner test bounds this child so an O_RDONLY FIFO
// regression cannot hang Vitest.
const outcome = await hashFile(path, expected, 1_000);
if (
  outcome.state !== "omitted" ||
  outcome.reason !== "file_changed_or_short_read" ||
  outcome.system_code !== null
)
  throw new Error(
    `Expected the FIFO to be omitted as a changed file: ${JSON.stringify(outcome)}`,
  );
process.stdout.write("rejected\n");
