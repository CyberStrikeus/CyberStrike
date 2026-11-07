import { randomUUID } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const builtModule = (path: string): string =>
  pathToFileURL(resolve("dist", path)).href;

const PACKAGE_PACK_FIXTURE = `
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packageCommands } from "./lib/verify-package-commands.mjs";
export async function verifyPackagePack({ root, workspace, commands }) {
  assert.equal(commands, packageCommands);
  appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "pack", root, workspace }) + "\\n");
  const tarball = join(workspace, "authored.tgz");
  writeFileSync(tarball, "authored archive boundary");
  return { tarball };
}
`;

const NPM_INSTALL_FIXTURE = `
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
assert.equal(args[0], "install");
assert.ok(args.includes("--ignore-scripts"));
appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "install", prefix: args[args.indexOf("--prefix") + 1], home: process.env.HOME }) + "\\n");
`;

const PRIVATE_ROOT_OBSERVER = `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { PrivateRuntimeRoot as ActualPrivateRoot } from ${JSON.stringify(builtModule("process/PrivateRuntimeRoot.js"))};
import { systemProcessOwnershipHost } from ${JSON.stringify(builtModule("process/ProcessOwnershipObservation.js"))};
import { liveProcesses } from ${JSON.stringify(builtModule("process/ProcessOwnershipProcessTree.js"))};
export const PrivateRuntimeRoot = {
  async create(options) {
    const root = await ActualPrivateRoot.create(options);
    const actualClose = root.close.bind(root);
    root.close = async () => {
      const events = readFileSync(process.env.OWNERSHIP_EVENTS, "utf8").trim().split("\\n").map(JSON.parse);
      const ready = events.find((event) => event.kind === "ready");
      const readyPids = ready === undefined ? null : [ready.leader, ready.descendant];
      const processes = liveProcesses(await systemProcessOwnershipHost.listProcesses());
      const livePids = readyPids === null ? null : processes.filter(({ pid }) => readyPids.includes(pid)).map(({ pid }) => pid);
      appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "root-close", runtime: root.path, rootExists: existsSync(root.path), readyPids, livePids }) + "\\n");
      await actualClose();
      appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "root-closed", runtime: root.path, rootExists: existsSync(root.path) }) + "\\n");
    };
    return root;
  },
};
`;

const PACKAGE_COMMANDS_FIXTURE = `
import { appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPackageVerifierCommands as createActualCommands } from ${JSON.stringify(pathToFileURL(resolve("scripts/lib/verify-package-commands.mjs")).href)};
import { spawnOwnedProviderProcess } from ${JSON.stringify(builtModule("process/ProviderProcess.js"))};
import { cleanupOwnedProcessGroup } from ${JSON.stringify(builtModule("process/ProcessOwnership.js"))};
const nestedVerifier = fileURLToPath(new URL("../verify-wasm-artifact.mjs", import.meta.url));
export let packageCommands;
export async function createPackageVerifierCommands(options) {
packageCommands = await createActualCommands({
  ...options,
  launcher: async (input) => {
    const nested = input.arguments.includes(nestedVerifier);
    if (nested) appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "command", runId: input.runId, inheritedRunId: process.env.REA_PROCESS_RUN_ID }) + "\\n");
    const acquired = await spawnOwnedProviderProcess(input);
    if (!nested) return acquired;
    return {
      ...acquired,
      cleanup: async () => {
        const denied = process.env.OWNERSHIP_DENY === "1" && !existsSync(process.env.OWNERSHIP_ALLOW);
        appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "cleanup", denied }) + "\\n");
        if (denied) return { cleaned: false, reason: "authored process cleanup denial" };
        return acquired.cleanup === undefined ? cleanupOwnedProcessGroup(acquired.ownership) : acquired.cleanup();
      },
    };
  },
});
return packageCommands;
}
`;

const NESTED_VERIFIER_FIXTURE = `
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
const runtime = dirname(process.env.HOME);
const record = (entry) => appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify(entry) + "\\n");
const childSource = ${JSON.stringify(`
const { appendFileSync, existsSync } = require("node:fs");
const { dirname } = require("node:path");
process.on("SIGTERM", () => {
  appendFileSync(process.env.OWNERSHIP_EVENTS, JSON.stringify({ kind: "descendant-stopped", rootExists: existsSync(dirname(process.env.HOME)) }) + "\\n");
  process.exit(0);
});
process.send({ pid: process.pid, runId: process.env.REA_PROCESS_RUN_ID });
setInterval(() => {}, 1000);
`)};
const child = spawn(process.execPath, ["--eval", childSource], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
const ready = await new Promise((resolve, reject) => {
  child.once("message", resolve);
  child.once("error", reject);
});
process.on("SIGTERM", () => {
  record({ kind: "leader-stopped", rootExists: existsSync(runtime) });
  process.exit(0);
});
record({ kind: "ready", runtime, leader: process.pid, descendant: ready.pid, runId: process.env.REA_PROCESS_RUN_ID, descendantRunId: ready.runId });
process.stdout.write("nested ready\\n");
setInterval(() => {}, 1000);
`;

const HARNESS_FIXTURE = `
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { prepareOwnedCommand } from ${JSON.stringify(builtModule("process/OwnedCommand.js"))};
import { systemProcessOwnershipHost } from ${JSON.stringify(builtModule("process/ProcessOwnershipObservation.js"))};
import { liveProcesses } from ${JSON.stringify(builtModule("process/ProcessOwnershipProcessTree.js"))};
import { withVerifierCleanup } from "./scripts/lib/verifier-cleanup.mjs";
import { packageCommands } from "./scripts/lib/verify-package-commands.mjs";
await prepareOwnedCommand();
let failure;
try { await import("./scripts/verify-packaged-wasm-artifact.mjs"); }
catch (cause) { failure = cause; }
// Capture actual capabilities before any fixture parsing or assertion can fail.
const failures = failure instanceof AggregateError ? failure.errors : [failure];
const primary = failures.find((error) => error !== null && typeof error === "object" &&
  error.reason === "timeout" && error.snapshot !== null && typeof error.snapshot === "object");
const cleanup = failures.find((error) => error !== null && typeof error === "object" &&
  typeof error.cleanupOwner?.close === "function");
const compositeOwner = typeof cleanup?.cleanupOwner?.close === "function" ? cleanup.cleanupOwner : undefined;
const retainedProcess = primary?.cleanupOwner;
const retainedRoot = cleanup?.workspace;
await withVerifierCleanup(async () => {
if (process.env.OWNERSHIP_HARNESS_ASSERT === "1") throw new Error("authored harness assertion failure");
const events = (await readFile(process.env.OWNERSHIP_EVENTS, "utf8")).trim().split("\\n").map(JSON.parse);
const ready = events.find((entry) => entry.kind === "ready");
assert.ok(ready, "The actual descendant must acknowledge startup before the command deadline");
assert.ok(primary, "The owned nested command must fail with its timeout snapshot");
assert.equal(primary.reason, "timeout");
assert.ok(primary.snapshot.stdout.text.includes("nested ready"));
const pids = [ready.leader, ready.descendant];
const remaining = async () => liveProcesses(await systemProcessOwnershipHost.listProcesses()).filter(({ pid }) => pids.includes(pid)).map(({ pid }) => pid);
const result = { reason: primary.reason, runtime: ready.runtime, rootExists: existsSync(ready.runtime), livePids: await remaining(), pids, runId: ready.runId, descendantRunId: ready.descendantRunId };
if (process.env.OWNERSHIP_DENY === "1") {
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.cause, primary);
  assert.equal(failure.errors[1], cleanup);
  assert.equal(cleanup.name, "PackageVerifierCleanupFailure");
  assert.equal(cleanup.workspace.path, ready.runtime);
  assert.equal(typeof cleanup.cleanupOwner.close, "function");
  assert.equal(cleanup.cleanupOwner, packageCommands);
  assert.ok(primary.cleanupOwner);
  result.compositeOwner = true;
}
await writeFile(process.env.OWNERSHIP_REPORT, JSON.stringify(result));
process.stdout.write("ready\\n");
if (cleanup !== undefined) {
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.destroy();
  const owner = cleanup.cleanupOwner;
  await owner.close();
  await owner.close();
  result.recovered = { rootExists: existsSync(ready.runtime), livePids: await remaining() };
  await writeFile(process.env.OWNERSHIP_REPORT, JSON.stringify(result));
}
}, [async () => {
  await writeFile(process.env.OWNERSHIP_ALLOW, "harness cleanup restores process authority");
  if (compositeOwner !== undefined) {
    await compositeOwner.close();
  } else if (retainedProcess !== undefined) {
    const stopped = await retainedProcess.stop();
    if (stopped.status === "incomplete") throw new Error(stopped.reason);
    if (typeof retainedRoot?.close === "function") await retainedRoot.close();
  }
}]);
`;

const expectOwnedCleanup = (
  events: readonly Record<string, unknown>[],
  runtime: string,
  readyPids: readonly number[],
): void => {
  const commands = events.filter(({ kind }) => kind === "command");
  expect(commands).toHaveLength(1);
  const command = commands[0]!;
  expect(command).toMatchObject({
    runId: expect.any(String),
    inheritedRunId: expect.any(String),
  });
  expect(command.runId).not.toBe("");
  expect(command.runId).not.toBe(command.inheritedRunId);
  expect(events.filter(({ kind }) => kind === "ready")).toEqual([
    expect.objectContaining({
      runId: command.runId,
      descendantRunId: command.runId,
    }),
  ]);
  expect(events.filter(({ kind }) => kind === "root-close")).toEqual([
    { kind: "root-close", runtime, rootExists: true, readyPids, livePids: [] },
  ]);
  expect(events.filter(({ kind }) => kind === "root-closed")).toEqual([
    { kind: "root-closed", runtime, rootExists: false },
  ]);
};

const expectHarnessFailureCleanup = async (
  supervisor: ProviderProcessSupervisor,
  eventsPath: string,
): Promise<void> => {
  expect(await supervisor.waitForOutputClose(25_000)).toBe(true);
  const snapshot = supervisor.snapshot();
  expect(snapshot).toMatchObject({ exitCode: 1, signal: null });
  expect(snapshot.stderr.text).toContain("authored harness assertion failure");
  const events = (await readFile(eventsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const ready = events.find(({ kind }) => kind === "ready");
  expect(ready).toBeDefined();
  expectOwnedCleanup(events, ready.runtime, [ready.leader, ready.descendant]);
};

// Packaging, installation, and WABT are authored boundaries. The copied verifier,
// private runtime root, Node processes, ownership inspection, and cleanup are real.
it.skipIf(process.platform === "win32").each([
  { denied: false, harnessFailure: false },
  { denied: true, harnessFailure: false },
  { denied: true, harnessFailure: true },
])(
  "joins a real packaged-verifier descendant before root cleanup (denied: $denied, assertion failure: $harnessFailure)",
  async ({ denied, harnessFailure }) => {
    const workspace = await createTestWorkspace("rea-packaged-wasm-owner-");
    const events = workspace.path("events.jsonl");
    const report = workspace.path("report.json");
    const allow = workspace.path("allow-cleanup");
    const runtimeParent = await workspace.mkdir("runtime");
    await workspace.mkdir("scripts/lib");
    await workspace.mkdir("dist/process");
    await Promise.all([
      workspace.write("package.json", '{"type":"module"}\n'),
      copyFile(
        resolve("scripts/verify-packaged-wasm-artifact.mjs"),
        workspace.path("scripts/verify-packaged-wasm-artifact.mjs"),
      ),
      copyFile(
        resolve("scripts/lib/verifier-cleanup.mjs"),
        workspace.path("scripts/lib/verifier-cleanup.mjs"),
      ),
      workspace.write(
        "scripts/lib/wabt-verifier-timeouts.mjs",
        "export const WABT_WORKFLOW_TIMEOUT_MS = 1000;\n",
      ),
      workspace.write(
        "dist/process/PrivateRuntimeRoot.js",
        PRIVATE_ROOT_OBSERVER,
      ),
      workspace.write("scripts/verify-package-pack.mjs", PACKAGE_PACK_FIXTURE),
      workspace.write(
        "scripts/lib/verify-package-commands.mjs",
        PACKAGE_COMMANDS_FIXTURE,
      ),
      workspace.write("scripts/npm-fixture.mjs", NPM_INSTALL_FIXTURE),
      workspace.write(
        "scripts/verify-wasm-artifact.mjs",
        NESTED_VERIFIER_FIXTURE,
      ),
      workspace.write("harness.mjs", HARNESS_FIXTURE),
    ]);
    let supervisor: ProviderProcessSupervisor | undefined;
    let child:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    try {
      child = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: [workspace.path("harness.mjs")],
        cwd: workspace.root,
        runId: `rea-packaged-wasm-test-${randomUUID()}`,
        sweepTokenOwnedProcesses: true,
        stdin: "pipe",
        hostEnvironment: {
          ...process.env,
          ...workspace.environment,
          TMPDIR: runtimeParent,
          TMP: runtimeParent,
          TEMP: runtimeParent,
          npm_execpath: workspace.path("scripts/npm-fixture.mjs"),
          OWNERSHIP_EVENTS: events,
          OWNERSHIP_REPORT: report,
          OWNERSHIP_ALLOW: allow,
          OWNERSHIP_DENY: denied ? "1" : "0",
          OWNERSHIP_HARNESS_ASSERT: harnessFailure ? "1" : "0",
        },
      });
      supervisor = new ProviderProcessSupervisor(
        {
          ...child,
          ownsProcessLifetime: true,
          cleanup:
            child.cleanup ?? (() => cleanupOwnedProcessGroup(child!.ownership)),
        },
        { maxDiagnosticBytes: 64 * 1024 },
      );
      if (harnessFailure) {
        await expectHarnessFailureCleanup(supervisor, events);
        return;
      }
      await waitForProviderProcessReady(child.process, 25_000);
      const observed = JSON.parse(await readFile(report, "utf8"));
      expect(observed.reason).toBe("timeout");
      expect(observed.pids).toHaveLength(2);
      expect(observed.rootExists).toBe(denied);
      expect(observed.livePids.sort()).toEqual(
        denied ? [...observed.pids].sort() : [],
      );
      if (denied) {
        expect(observed.compositeOwner).toBe(true);
        await writeFile(allow, "restore actual process cleanup");
        child.process.stdin?.write("retry\n");
      }
      expect(await supervisor.waitForOutputClose(10_000)).toBe(true);
      expect(supervisor.snapshot()).toMatchObject({
        exitCode: 0,
        signal: null,
      });
      const final = JSON.parse(await readFile(report, "utf8"));
      if (denied)
        expect(final.recovered).toEqual({ rootExists: false, livePids: [] });
      const recorded = (await readFile(events, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(recorded.filter(({ kind }) => kind === "pack")).toEqual([
        expect.objectContaining({
          root: workspace.root,
          workspace: observed.runtime,
        }),
      ]);
      expect(recorded.filter(({ kind }) => kind === "install")).toHaveLength(1);
      expectOwnedCleanup(recorded, observed.runtime, observed.pids);
      expect(
        recorded.filter(
          ({ kind, denied: refusal }) =>
            kind === "cleanup" && refusal === false,
        ),
      ).toHaveLength(1);
    } finally {
      await writeFile(allow, "teardown restores cleanup");
      if (child?.process.exitCode === null && child.process.signalCode === null)
        child.process.stdin?.write("retry\n");
      await supervisor?.waitForOutputClose(5_000);
      if (supervisor !== undefined)
        expect((await supervisor.stop()).status).not.toBe("incomplete");
      await removeTestWorkspace(workspace.root);
    }
  },
  45_000,
);
