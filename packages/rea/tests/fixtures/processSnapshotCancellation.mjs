import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const [root] = process.argv.slice(2);
if (root === undefined)
  throw new Error("Snapshot cancellation fixture requires an observation root");

await writeFile(join(root, "created-after-start"), "x");
