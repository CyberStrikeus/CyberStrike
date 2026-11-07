import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return false;
    throw cause;
  }
};

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1_024 * 1_024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    throw new Error(
      `Prepack command failed with status ${String(result.status)}: ${command} ${args.join(" ")}`,
    );
  }
};

if (await pathExists(join(root, "src"))) {
  const packageManagerPath = process.env.npm_execpath;
  if (packageManagerPath === undefined)
    throw new Error("Prepack could not resolve the active package manager");
  run(process.execPath, [packageManagerPath, "run", "build:cached"]);
  run(process.execPath, ["scripts/generate-skill-metadata.mjs", "--check"]);
} else {
  for (const path of [
    "scripts/lib/cli-process-environment.mjs",
    "dist/main.js",
    "dist/mcp/main.js",
    "dist/cli-runtime/cli.js",
    "dist/cli-runtime/cliOutput.js",
    "dist/cli-runtime/cliBuiltinArguments.js",
    "dist/cli-runtime/cliResultOutput.js",
    "dist/cli-runtime/mcpDoctor.js",
    "dist/mcpDoctor.js",
    "dist/cli.js",
    "dist/cliOutput.js",
    "skills/reverse-engineer-anything/SKILL.md",
  ])
    await access(join(root, path));
}
