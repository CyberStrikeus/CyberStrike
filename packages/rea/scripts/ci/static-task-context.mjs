import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
const STATIC_CONTEXT_SCRIPTS = new Set([
  "check:ci:fast:tasks",
  "check:ci:deep:tasks",
]);
const contextSchema = z.object({
  version: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/u),
  sourceClean: z.boolean(),
  prHeadSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .optional(),
  nodeVersion: z.string().min(1),
  npmVersion: z.string().min(1),
  turboVersion: z.string().min(1),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  taskHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{16}$/u)),
});

/** Parse the producing check graph's receipt; incomplete provenance is unknown. */
export const parseStaticTaskContext = (value) => contextSchema.parse(value);

/** Retain only named task hashes and tool/source identity, never the environment. */
export async function recordStaticTaskContext({
  root = process.cwd(),
  npmCli = process.env.npm_execpath,
  outputDirectory = join(root, ".cache/static-checks"),
  script = process.env.CI_STATIC_CONTEXT_SCRIPT ?? "check:ci:fast:tasks",
} = {}) {
  if (!STATIC_CONTEXT_SCRIPTS.has(script))
    throw new Error("Static context script is not a known check");
  if (typeof npmCli !== "string" || !npmCli)
    throw new Error(
      "Run static context recording through npm run ci:static-context",
    );
  const options = {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  };
  const [graph, source, status, npmVersion, turbo] = await Promise.all([
    execute(
      process.execPath,
      [npmCli, "run", "--silent", script, "--", "--dry=json"],
      options,
    ),
    execute("git", ["rev-parse", "HEAD"], options),
    execute(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      options,
    ),
    execute(process.execPath, [npmCli, "--version"], options),
    readFile(join(root, "node_modules/turbo/package.json"), "utf8"),
  ]);
  const tasks = z
    .object({
      tasks: z
        .array(
          z.object({
            task: z.string().min(1),
            hash: z.string().regex(/^[a-f0-9]{16}$/u),
          }),
        )
        .min(1),
    })
    .parse(JSON.parse(graph.stdout)).tasks;
  if (new Set(tasks.map(({ task }) => task)).size !== tasks.length)
    throw new Error("Static graph contains duplicate task identities");
  const context = parseStaticTaskContext({
    version: 1,
    sourceSha: source.stdout.trim(),
    sourceClean: status.stdout.length === 0,
    ...(process.env.CI_PR_HEAD_SHA
      ? { prHeadSha: process.env.CI_PR_HEAD_SHA }
      : {}),
    nodeVersion: process.version,
    npmVersion: npmVersion.stdout.trim(),
    turboVersion: z.object({ version: z.string() }).parse(JSON.parse(turbo))
      .version,
    platform: process.platform,
    architecture: process.arch,
    taskHashes: Object.fromEntries(tasks.map(({ task, hash }) => [task, hash])),
  });
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== context.sourceSha)
    throw new Error(
      "Static context source does not match the workflow revision",
    );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "static-task-context.json"),
    JSON.stringify(context, null, 2) + "\n",
  );
  return context;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await recordStaticTaskContext();
