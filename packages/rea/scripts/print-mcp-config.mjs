#!/usr/bin/env node
/**
 * Print a ready-to-paste MCP server config with absolute paths filled in.
 *
 * Usage:
 *   node scripts/print-mcp-config.mjs /path/to/binary
 *   node scripts/print-mcp-config.mjs /path/to/binary --kind database
 *   node scripts/print-mcp-config.mjs /path/to/binary --loader-args '["-l","Mach-O","--aarch64"]'
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const targetPath = process.argv[2];
if (!targetPath) {
  process.stderr.write(
    "Usage: node scripts/print-mcp-config.mjs <target-path> [--kind executable|database] [--loader-args JSON]\n",
  );
  process.exit(1);
}

const flags = process.argv.slice(3);
const kind = readFlag(flags, "--kind") ?? "executable";
const loaderArgs = readFlag(flags, "--loader-args");

const env = {
  HOPPER_TARGET_PATH: resolve(targetPath),
  HOPPER_TARGET_KIND: kind,
};
if (loaderArgs) env.HOPPER_LOADER_ARGS_JSON = loaderArgs;

const config = {
  mcpServers: {
    rea: {
      command: "npx",
      args: [
        "-y",
        `${
          JSON.parse(
            await readFile(
              resolve(
                fileURLToPath(new URL("..", import.meta.url)),
                "package.json",
              ),
              "utf8",
            ),
          ).name
        }@latest`,
        "mcp",
      ],
      env,
    },
  },
};

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);

function readFlag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
