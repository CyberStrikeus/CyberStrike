#!/usr/bin/env node
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { createPackageVerifierCommands } from "./lib/verify-package-commands.mjs";
import { WABT_WORKFLOW_TIMEOUT_MS } from "./lib/wabt-verifier-timeouts.mjs";
import { verifyPackagePack } from "./verify-package-pack.mjs";

const root = await PrivateRuntimeRoot.create({
  prefix: "rea-wabt-package-verifier-",
});
let commands;
const verifiedOutput = await withVerifierCleanup(async () => {
  commands = await createPackageVerifierCommands({ workspace: root });
  const { tarball } = await verifyPackagePack({
    root: process.cwd(),
    workspace: root.path,
    commands,
  });
  const prefix = join(root.path, "prefix");
  const home = join(root.path, "home");
  await mkdir(home);
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
  };
  await commands.execNpm(
    [
      "install",
      "--global",
      "--ignore-scripts",
      "--omit=dev",
      "--install-strategy=nested",
      "--prefix",
      prefix,
      tarball,
    ],
    { env: environment, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const entrypoint = join(
    prefix,
    ...(process.platform === "win32"
      ? ["node_modules"]
      : ["lib", "node_modules"]),
    "rea-agents",
    "scripts",
    "rea.mjs",
  );
  const verified = await commands.exec(
    process.execPath,
    [
      fileURLToPath(new URL("./verify-wasm-artifact.mjs", import.meta.url)),
      entrypoint,
      "--require-tools",
    ],
    {
      cwd: process.cwd(),
      env: environment,
      timeout: WABT_WORKFLOW_TIMEOUT_MS,
      diagnosticBytes: 4 * 1024 * 1024,
    },
  );
  return verified.stdout;
}, [() => (commands === undefined ? root.close() : commands.close())]);
process.stdout.write(verifiedOutput);
