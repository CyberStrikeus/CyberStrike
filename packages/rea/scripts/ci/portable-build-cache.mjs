import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const output = ".cache/ci-build-cache";
const plan = ".cache/ci-build-plan.json";

function readTasks() {
  const { tasks } = z
    .object({
      tasks: z
        .array(
          z.object({
            taskId: z.string().min(1),
            // The pinned Turbo version uses eager 64-bit hexadecimal hashes.
            hash: z.string().regex(/^[0-9a-f]{16}$/u),
          }),
        )
        .min(1),
    })
    .parse(JSON.parse(readFileSync(0, "utf8")));
  const identities = new Set();
  for (const { taskId } of tasks) {
    if (identities.has(taskId))
      throw new Error(`Duplicate portable build task: ${taskId}`);
    identities.add(taskId);
  }
  return tasks;
}

async function copyEntry(hash) {
  const entries = [];
  for (const suffix of [".tar.zst", "-meta.json", "-manifest.json"]) {
    const name = `${hash}${suffix}`;
    const source = join(".turbo/cache", name);
    const entry = await lstat(source).catch((error) => {
      // Eviction can remove a cache hit even during the successful build.
      // Manifests are also optional in supported local cache entries.
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!entry) continue;
    if (!entry.isFile())
      throw new Error(
        `Portable build cache entry must be a regular file: ${source}`,
      );
    entries.push({ suffix, name, source, size: entry.size });
  }
  // Publish whole reusable entries only. Consumers rebuild missing tasks.
  if (
    ![".tar.zst", "-meta.json"].every((suffix) =>
      entries.some((entry) => entry.suffix === suffix),
    )
  )
    return undefined;
  const copied = [];
  let missing = false;
  for (const entry of entries) {
    try {
      await copyFile(entry.source, join(output, entry.name));
      copied.push(entry);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (entry.suffix === "-manifest.json") continue;
      missing = true;
      break;
    }
  }
  if (missing) {
    for (const entry of copied) await rm(join(output, entry.name));
    return undefined;
  }
  return {
    files: copied.length,
    bytes: copied.reduce((sum, entry) => sum + entry.size, 0),
  };
}

async function snapshot(tasks) {
  await mkdir(output, { recursive: true });
  let files = 0;
  let bytes = 0;
  const available = new Set();
  try {
    for (const hash of new Set(tasks.map((task) => task.hash))) {
      const entry = await copyEntry(hash);
      if (!entry) continue;
      available.add(hash);
      files += entry.files;
      bytes += entry.bytes;
    }
    // A fully evicted cache still has an explicit artifact and coverage record;
    // required build outputs and downstream verification remain separate gates.
    const manifest = `${JSON.stringify({
      version: 1,
      tasks: tasks.map((task) => ({
        ...task,
        available: available.has(task.hash),
      })),
    })}\n`;
    await writeFile(join(output, "portable-build-cache.json"), manifest);
    files++;
    bytes += Buffer.byteLength(manifest);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  console.log(
    JSON.stringify({
      tasks: tasks.length,
      files,
      bytes,
      path: output,
      missing_tasks: tasks
        .filter((task) => !available.has(task.hash))
        .map((task) => task.taskId),
    }),
  );
}

const [mode, ...extra] = process.argv.slice(2);
if (extra.length || !["key", "snapshot"].includes(mode))
  throw new Error(
    "Usage: portable-build-cache.mjs key|snapshot < turbo-dry-plan.json",
  );
// Invalidate this mode's previous result before parsing its input. Failed
// validation must not leave stale plans or snapshots for downstream reuse.
if (mode === "snapshot") await rm(output, { recursive: true, force: true });
else await rm(plan, { force: true });
const tasks = readTasks();
if (mode === "key") {
  const prefix = z
    .string()
    .min(1)
    .regex(/^[^\r\n]+$/u)
    .parse(process.env.BUILD_CACHE_PREFIX);
  const hashes = tasks.map(({ taskId, hash }) => `${taskId}:${hash}`).sort();
  const digest = createHash("sha256").update(hashes.join("\n")).digest("hex");
  // Retain only validated identities for the later snapshot. Running Turbo
  // again after the build can evict cache entries before they are copied.
  await mkdir(".cache", { recursive: true });
  await writeFile(plan, `${JSON.stringify({ tasks })}\n`);
  console.log(`key=${prefix}-${digest}\nprefix=${prefix}-`);
} else {
  await snapshot(tasks);
}
