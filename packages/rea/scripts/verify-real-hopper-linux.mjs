import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createVerifierRun } from "./lib/verifier-run.mjs";

const execFileAsync = promisify(execFile);
createVerifierRun();

if (process.platform !== "linux")
  throw new Error("Linux real-Hopper verification must run on Linux");
const configuredLauncher = process.env.HOPPER_LAUNCHER_PATH;
const launcher = configuredLauncher ?? "/opt/hopper/bin/Hopper";
await access(launcher);
await access("/usr/bin/Xvfb");
await access("/usr/bin/xauth");
await access("/usr/bin/python3");
const linked = await execFileAsync("ldd", [launcher]);
if (`${linked.stdout}\n${linked.stderr}`.includes("not found"))
  throw new Error("Hopper has unresolved shared-library dependencies");
const alternateDirectory = await mkdtemp(
  join(tmpdir(), "rea-real-hopper-launcher-"),
);
const alternateLauncher = join(alternateDirectory, "Hopper-alternate");
try {
  await symlink(launcher, alternateLauncher);
  process.env.HOPPER_LAUNCHER_PATH = alternateLauncher;
  await import("./verify-real-hopper.mjs");
} finally {
  if (configuredLauncher === undefined) delete process.env.HOPPER_LAUNCHER_PATH;
  else process.env.HOPPER_LAUNCHER_PATH = configuredLauncher;
  await rm(alternateDirectory, { recursive: true, force: true });
}
