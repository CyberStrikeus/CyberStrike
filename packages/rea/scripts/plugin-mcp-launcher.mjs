#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Release Please owns the scalar pin in each client declaration. The runtime
// and skill come from the same installed artifact, without another npx child.
const [version, ...extra] = process.argv.slice(2);
try {
  if (
    extra.length !== 0 ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version ?? "")
  )
    throw new Error("requires one exact rea-agents@VERSION pin");

  const bundledPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    bundledPackage.name !== "rea-agents" ||
    bundledPackage.version !== version
  )
    throw new Error(
      "version pin does not match its installed rea-agents package; reinstall the plugin",
    );

  await access(new URL("../dist/mcp/main.js", import.meta.url)).catch(
    (cause) => {
      if (cause?.code !== "ENOENT") throw cause;
      throw new Error(
        "runtime is missing; reinstall the plugin, or run npm ci && npm run build:cached in a source checkout",
        { cause },
      );
    },
  );
} catch (cause) {
  process.stderr.write(`REA plugin ${cause.message}.\n`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  process.argv = [
    process.execPath,
    fileURLToPath(new URL("./rea.mjs", import.meta.url)),
    "mcp",
  ];
  await import("./rea.mjs");
}
