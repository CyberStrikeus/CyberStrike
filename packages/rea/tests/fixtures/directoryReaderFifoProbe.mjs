import { execFileSync } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, root] = process.argv.slice(2);
if (modulePath === undefined || root === undefined)
  throw new Error("Directory reader FIFO probe requires module and root paths");

const { DirectoryArtifactReader } = await import(pathToFileURL(modulePath));
const reader = new DirectoryArtifactReader(root);
let selected;
for await (const entry of reader.entries())
  if (entry.path === "module.js") selected = entry;
if (selected === undefined)
  throw new Error("Expected inventoried regular file");

const fifo = join(root, selected.path);
await unlink(fifo);
execFileSync("mkfifo", [fifo]);

const opening = reader.open(selected).then(
  (stream) => {
    stream.destroy();
    return "opened";
  },
  (cause) =>
    typeof cause === "object" && cause !== null && "reason" in cause
      ? String(cause.reason)
      : "failed",
);
const outcome = await Promise.race([
  opening,
  new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
]);
process.stdout.write(`${String(outcome)}\n`);

if (outcome === "blocked") {
  const writer = await open(fifo, "w");
  await writer.close();
  await opening;
}
await reader.close();
