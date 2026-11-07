import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execFileAsync = promisify(execFile);
const injectedFailure = "injected upstream body failure";

it("retains upstream body failure and joins the active updater and installer child", async () => {
  const testRoot = await createTestTempDirectory("rea-update-registry-");
  const packageRoot = join(testRoot, "package");
  const workspace = join(testRoot, "workspace");
  const prefix = join(testRoot, "prefix");
  const tarball = join(testRoot, "release.tgz");
  const application = join(packageRoot, "dist", "application");
  const descendants = join(workspace, "updater-pids.json");
  await Promise.all([
    mkdir(application, { recursive: true }),
    mkdir(join(packageRoot, "scripts"), { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(prefix, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(tarball, "archive"),
    writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "rea-agents", version: "6.0.0" }),
    ),
    writeFile(
      join(packageRoot, "dist", "generatedPackageMetadata.js"),
      'export const generated = { version: "6.0.0" };\n',
    ),
    writeFile(
      join(packageRoot, "scripts", "rea.mjs"),
      [
        'import { readFileSync } from "node:fs";',
        'const metadata = new URL("../package.json", import.meta.url);',
        "console.log(JSON.parse(readFileSync(metadata, 'utf8')).version);",
        "",
      ].join("\n"),
    ),
    writeFile(
      join(application, "Update.js"),
      [
        'import { spawn } from "node:child_process";',
        'import { writeFile } from "node:fs/promises";',
        "export async function runUpdate() {",
        '  const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        '  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });',
        `  await writeFile(${JSON.stringify(descendants)}, JSON.stringify([process.pid, child.pid]));`,
        "  const registry = process.env.npm_config_registry;",
        "  const response = await fetch(`${registry}/unlisted`, {",
        "    signal: AbortSignal.timeout(5000),",
        "  });",
        "  const body = await response.text();",
        "  setInterval(() => {}, 1000);",
        "  await new Promise(() => {});",
        "}",
        "",
      ].join("\n"),
    ),
    writeFile(
      join(application, "UpdateRuntime.js"),
      "export const systemUpdateHost = () => ({});\n",
    ),
  ]);
  const verifierUrl = pathToFileURL(
    resolve("scripts/verify-package-update.mjs"),
  ).href;
  const commandsUrl = pathToFileURL(
    resolve("scripts/lib/verify-package-commands.mjs"),
  ).href;
  const cleanupUrl = pathToFileURL(
    resolve("scripts/lib/verifier-cleanup.mjs"),
  ).href;
  const harness = `
import { readFile, rm } from "node:fs/promises";
import { createPackageVerifierCommands } from ${JSON.stringify(commandsUrl)};
import { withVerifierCleanup } from ${JSON.stringify(cleanupUrl)};
globalThis.fetch = async () => ({
  status: 200,
  headers: new Headers({ "content-type": "application/json" }),
  arrayBuffer: async () => {
    throw new Error(${JSON.stringify(injectedFailure)});
  },
});
const { verifyPackageUpdate } = await import(${JSON.stringify(verifierUrl)});
const scratch = { path: ${JSON.stringify(workspace)}, close: () => rm(${JSON.stringify(workspace)}, { recursive: true, force: true }) };
let commands;
let failure;
let pids;
await withVerifierCleanup(async () => {
commands = await createPackageVerifierCommands({ workspace: scratch });
try {
  await verifyPackageUpdate({
    prefix: ${JSON.stringify(prefix)},
    packageRoot: ${JSON.stringify(packageRoot)},
    tarball: ${JSON.stringify(tarball)},
    workspace: ${JSON.stringify(workspace)},
    environment: { PATH: process.env.PATH },
    commands,
  });
} catch (cause) {
  failure = cause instanceof Error ? cause.message : String(cause);
}
pids = JSON.parse(await readFile(${JSON.stringify(descendants)}, "utf8"));
}, [() => commands === undefined ? scratch.close() : commands.close()]);
let livePids;
if (process.platform === "win32") {
  livePids = pids.filter((pid) => {
    try { process.kill(pid, 0); return true; }
    catch (cause) { if (cause.code === "ESRCH") return false; throw cause; }
  });
} else {
  const { systemProcessOwnershipHost } = await import(${JSON.stringify(pathToFileURL(resolve("dist/process/ProcessOwnershipObservation.js")).href)});
  const { liveProcesses } = await import(${JSON.stringify(pathToFileURL(resolve("dist/process/ProcessOwnershipProcessTree.js")).href)});
  livePids = liveProcesses(await systemProcessOwnershipHost.listProcesses()).filter(({pid}) => pids.includes(pid)).map(({pid}) => pid);
}
process.stdout.write(JSON.stringify({ failure, observedPids: pids.length, livePids }));
`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", harness],
    { env: { ...process.env }, maxBuffer: 1_024 * 1_024, timeout: 30_000 },
  );

  expect(JSON.parse(stdout)).toEqual({
    failure: injectedFailure,
    observedPids: 2,
    livePids: [],
  });
}, 45_000);
