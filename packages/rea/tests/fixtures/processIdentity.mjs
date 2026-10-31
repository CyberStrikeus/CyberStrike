import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// Read the producer's own kernel identity independently of REA's sampler.
const stat = await readFile("/proc/self/stat", "utf8");
const fields = stat
  .slice(stat.lastIndexOf(")") + 2)
  .trim()
  .split(/\s+/u);
const identity = {
  pid: Number(stat.slice(0, stat.indexOf(" "))),
  parent_pid: Number(fields[1]),
  process_group_id: Number(fields[2]),
  session_id: Number(fields[3]),
};
await writeFile(process.argv[2], JSON.stringify(identity));
process.stdout.write(`${JSON.stringify(identity)}\n`);
// Remain observable across multiple process-sampling intervals, then exit cleanly.
await setTimeout(500);
