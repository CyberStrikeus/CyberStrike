import { execFile } from "node:child_process";
import {
  access,
  appendFile,
  chmod,
  copyFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";
import { assertCleanLinuxHopperRuntime } from "./lib/clean-linux-hopper-runtime.mjs";
import { isUnsupportedHopperLaunchFailure } from "./verify-package-platform.mjs";

const execFileAsync = promisify(execFile);
const verifierRun = createVerifierRun();
const command = process.env.REA_VERIFY_SERVER_COMMAND;
if (process.platform !== "linux" || process.getuid?.() !== 0)
  throw new Error("Linux setup verification requires a root Linux runner");
if (!command) throw new Error("REA_VERIFY_SERVER_COMMAND is required");
await assertCleanLinuxHopperRuntime();
try {
  await access("/opt/hopper/bin/Hopper");
  throw new Error("Linux setup verification requires a clean runner");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const runJson = async (args) => {
  const { stdout } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
};

const plan = await runJson([
  "setup",
  "--install-hopper",
  "--dry-run",
  "--json",
]);
if (
  plan.status !== "planned" ||
  !plan.plannedActions.some(({ kind }) => kind === "install_hopper") ||
  plan.appliedActions.length !== 0
)
  throw new Error("setup did not produce a read-only Hopper installation plan");
await access("/opt/hopper/bin/Hopper").then(
  () => {
    throw new Error("setup plan mutated the clean runner");
  },
  (error) => {
    if (error?.code !== "ENOENT") throw error;
  },
);

const installed = await runJson([
  "setup",
  "--yes",
  "--install-hopper",
  "--json",
]);
if (
  installed.status !== "ready" ||
  !installed.appliedActions.includes("installed_hopper")
)
  throw new Error(
    `approved setup did not become ready: ${JSON.stringify(installed)}`,
  );
const doctor = await runJson(["doctor", "--provider", "hopper", "--json"]);
if (doctor.healthy !== true)
  throw new Error(`doctor is unhealthy: ${JSON.stringify(doctor)}`);

await execFileAsync(command, ["analyze", "/usr/bin/true"], {
  env: process.env,
  timeout: 180_000,
  maxBuffer: 10 * 1024 * 1024,
});
process.env.REA_VERIFY_SERVER_ARGS_JSON = '["mcp"]';
await import("./verify-real-hopper-linux.mjs");

const modifiedDirectory = await mkdtemp(join(tmpdir(), "rea-modified-hopper-"));
try {
  const modifiedHopper = join(modifiedDirectory, "Hopper");
  await copyFile("/opt/hopper/bin/Hopper", modifiedHopper);
  await appendFile(modifiedHopper, new Uint8Array([0]));
  await chmod(modifiedHopper, 0o700);
  try {
    await execFileAsync(
      command,
      ["analyze", "/usr/bin/true", "--provider", "hopper", "--json"],
      {
        env: { ...process.env, HOPPER_LAUNCHER_PATH: modifiedHopper },
        timeout: 30_000,
      },
    );
    throw new Error("modified Hopper build was not rejected");
  } catch (error) {
    if (
      error?.code !== 1 ||
      typeof error.stdout !== "string" ||
      !isUnsupportedHopperLaunchFailure(JSON.parse(error.stdout))
    )
      throw new Error(
        "modified Hopper build did not return its stable failure code",
        { cause: error },
      );
  }
} finally {
  await rm(modifiedDirectory, { recursive: true, force: true });
}

const repeated = await runJson(["setup", "--yes", "--json"]);
if (
  repeated.status !== "ready" ||
  repeated.plannedActions.length !== 0 ||
  repeated.appliedActions.length !== 0
)
  throw new Error("a second setup was not idempotent");
await assertCleanLinuxHopperRuntime();
const completedVerifierRun = await completeVerifierRun(verifierRun);
if (
  completedVerifierRun.process_lineage.status !== "verified" ||
  completedVerifierRun.process_lineage.descendants.length !== 0
)
  throw new Error("Linux setup verification did not prove owned child cleanup");

console.log(
  JSON.stringify({
    verifier_run: completedVerifierRun,
    status: "verified",
    setup: true,
    cli: true,
    mcp: true,
    idempotent: true,
  }),
);
