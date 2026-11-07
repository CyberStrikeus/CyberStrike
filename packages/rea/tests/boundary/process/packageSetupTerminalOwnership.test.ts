import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { z } from "zod";

import {
  createPackageVerifierCommands,
  type PackageVerifierCommands,
} from "../../../scripts/lib/verify-package-commands.mjs";
import {
  verifyInteractiveSetup,
  verifyRedirectedStdoutSetup,
} from "../../../scripts/lib/verify-setup-terminal.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { systemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { liveProcesses } from "../../../src/process/ProcessOwnershipProcessTree.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

const unchangedConfiguration = '{"callerSelected":"preserved"}\n';
const timeoutMessage =
  "packaged setup started an interactive prompt with redirected stdout:";

const descendantSource = `
import { appendFileSync, existsSync } from "node:fs";
const finish = (reason) => {
  appendFileSync(process.env.TERMINAL_EVENTS, JSON.stringify({ kind: "descendant-exit", reason, rootExists: existsSync(process.env.HOME) }) + "\\n");
  process.exit(0);
};
process.on("SIGHUP", () => undefined);
process.on("SIGTERM", () => finish("SIGTERM"));
process.send({ pid: process.pid });
setInterval(() => {
  if (existsSync(process.env.TERMINAL_RELEASE)) finish("fixture-release");
}, 25);
setTimeout(() => finish("fixture-deadline"), 30000);
`;

const setupStandinSource = `
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
assert.deepEqual(process.argv.slice(2), ["setup"]);
const tty = { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY) };
assert.deepEqual(tty, { stdin: true, stdout: false, stderr: true });
const parent = process.ppid;
const finish = (reason) => {
  appendFileSync(process.env.TERMINAL_EVENTS, JSON.stringify({ kind: "setup-exit", reason, rootExists: existsSync(process.env.HOME) }) + "\\n");
  process.exit(0);
};
process.on("SIGHUP", () => finish("SIGHUP"));
process.on("SIGTERM", () => finish("SIGTERM"));
const child = spawn(process.execPath, [process.env.TERMINAL_DESCENDANT], {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
});
const ready = await new Promise((resolve, reject) => {
  child.once("message", resolve);
  child.once("error", reject);
});
writeFileSync(process.env.TERMINAL_READY, JSON.stringify({ pids: [process.pid, ready.pid], tty, arguments: process.argv.slice(2) }));
process.stderr.write("authored setup pending\\n");
setInterval(() => {
  if (existsSync(process.env.TERMINAL_RELEASE)) finish("fixture-release");
  if (process.ppid !== parent) finish("wrapper-exit");
}, 25);
setTimeout(() => finish("fixture-deadline"), 30000);
`;

const reportSchema = z.object({
  ready: z.object({
    pids: z.array(z.number().int().positive()).length(2),
    tty: z.object({
      stdin: z.literal(true),
      stdout: z.literal(false),
      stderr: z.literal(true),
    }),
    arguments: z.tuple([z.literal("setup")]),
  }),
  liveAtRemoval: z.array(z.number().int().positive()),
  configurationAtRemoval: z.string(),
  rootRemoved: z.boolean(),
  failure: z.object({ name: z.string(), message: z.string() }),
});

const releaseStandin = async (release: string, readyPath: string) => {
  await writeFile(release, "release these authored setup processes");
  const ready = await readFile(readyPath, "utf8").then(
    (text) => reportSchema.shape.ready.parse(JSON.parse(text)),
    (cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    },
  );
  if (ready === undefined) return;
  const deadline = Date.now() + 7_500;
  while (
    liveProcesses(await systemProcessOwnershipHost.listProcesses()).some(
      ({ pid }) => ready.pids.includes(pid),
    )
  ) {
    if (Date.now() >= deadline)
      throw new Error(
        "Authored setup processes did not consume their release marker",
      );
    await delay(25);
  }
};

// The executable only acknowledges terminal shape and owns a harmless child.
// The PTY, deadline, process census, command owner and workspace removal are real.
processTest.skipIf(process.platform === "win32")(
  "joins a redirected-stdout setup descendant before removing its verifier workspace",
  { timeout: 35_000 },
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-package-setup-terminal-");
    const scratch = join(root, "scratch");
    const entry = join(root, "setup stand-in.mjs");
    const descendant = join(root, "descendant.mjs");
    const ready = join(root, "ready.json");
    const release = join(root, "release-setup");
    const events = join(root, "events.jsonl");
    const driver = join(root, "driver.mjs");
    await writeFile(entry, `#!${process.execPath}\n${setupStandinSource}`);
    await chmod(entry, 0o755);
    await writeFile(descendant, descendantSource);
    const moduleUrl = (path: string) => pathToFileURL(resolve(path)).href;
    await writeFile(
      driver,
      `
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createPackageVerifierCommands } from ${JSON.stringify(moduleUrl("scripts/lib/verify-package-commands.mjs"))};
import { verifyRedirectedStdoutSetup } from ${JSON.stringify(moduleUrl("scripts/lib/verify-setup-terminal.mjs"))};
import { withVerifierCleanup } from ${JSON.stringify(moduleUrl("scripts/lib/verifier-cleanup.mjs"))};
import { systemProcessOwnershipHost } from ${JSON.stringify(moduleUrl("dist/process/ProcessOwnershipObservation.js"))};
import { liveProcesses } from ${JSON.stringify(moduleUrl("dist/process/ProcessOwnershipProcessTree.js"))};
const scratch = process.env.HOME;
await mkdir(scratch);
const config = ${JSON.stringify(join(scratch, "selected-config.json"))};
await writeFile(config, ${JSON.stringify(unchangedConfiguration)});
let commands, recoveryOwner, ready, liveAtRemoval, configurationAtRemoval, failure;
let removed = false;
const workspace = {
  path: scratch,
  async close() {
    if (removed) return;
    ready = JSON.parse(await readFile(process.env.TERMINAL_READY, "utf8"));
    liveAtRemoval = liveProcesses(await systemProcessOwnershipHost.listProcesses()).filter(({ pid }) => ready.pids.includes(pid)).map(({ pid }) => pid);
    configurationAtRemoval = await readFile(config, "utf8");
    await rm(scratch, { recursive: true, force: true });
    removed = true;
  },
};
try {
  await withVerifierCleanup(async () => {
    commands = await createPackageVerifierCommands({ workspace });
    await verifyRedirectedStdoutSetup({ commands, command: ${JSON.stringify(entry)}, environment: process.env, root: ${JSON.stringify(process.cwd())}, unchangedPaths: [config] });
  }, [() => commands === undefined ? workspace.close() : commands.close()]);
} catch (cause) {
  const failures = cause instanceof AggregateError ? cause.errors : [cause];
  // Capture exact returned cleanup authority before projecting or asserting facts.
  recoveryOwner = failures.find(error => typeof error?.cleanupOwner?.close === "function")?.cleanupOwner ?? commands;
  const primary = failures.find(error => error instanceof Error && error.message.startsWith(${JSON.stringify(timeoutMessage)}));
  failure = primary === undefined ? undefined : { name: primary.name, message: primary.message };
} finally {
  if (recoveryOwner !== undefined) await recoveryOwner.close();
  else if (commands !== undefined) await commands.close();
  else await workspace.close();
}
process.stdout.write(JSON.stringify({ ready, liveAtRemoval, configurationAtRemoval, rootRemoved: !existsSync(scratch), failure }));
`,
    );
    try {
      const result = await processes.run(process.execPath, [driver], {
        timeoutMs: 25_000,
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: scratch,
          USERPROFILE: scratch,
          TERMINAL_DESCENDANT: descendant,
          TERMINAL_READY: ready,
          TERMINAL_RELEASE: release,
          TERMINAL_EVENTS: events,
        },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.signal, result.stderr).toBeNull();
      const report = reportSchema.parse(JSON.parse(result.stdout));
      expect(report.failure.name).toBe("Error");
      expect(report.failure.message).toContain(timeoutMessage);
      expect(report.failure.message).toContain("authored setup pending");
      expect(report.configurationAtRemoval).toBe(unchangedConfiguration);
      expect(report.liveAtRemoval).toEqual([]);
      expect(report.rootRemoved).toBe(true);
    } finally {
      await releaseStandin(release, ready);
    }
  },
);

const interactiveStandinSource = `
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
assert.deepEqual(process.argv.slice(2), ["setup"]);
const tty = { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY) };
assert.deepEqual(tty, { stdin: true, stdout: true, stderr: true });
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => {
  assert.deepEqual([...data], [3]);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  writeFileSync(process.env.TERMINAL_RECEIPT, JSON.stringify({ mode: "interactive", pid: process.pid, tty, interrupt: [...data], rawRestored: process.stdin.isRaw === false, exitStatus: 0 }));
  process.stdout.write("\\u001b[?25hNo changes were made.\\n", () => process.exit(0));
});
process.stdin.resume();
process.stdout.write("Which agents should use REA?");
`;

const redirectedStandinSource = `
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
assert.deepEqual(process.argv.slice(2), ["setup"]);
const tty = { stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY) };
assert.deepEqual(tty, { stdin: true, stdout: false, stderr: true });
const plainOutput = "Authored plain setup output.\\n";
writeFileSync(process.env.TERMINAL_RECEIPT, JSON.stringify({ mode: "redirected", pid: process.pid, tty, plainOutput, exitStatus: 1 }));
process.stdout.write(plainOutput);
process.exitCode = 1;
`;

const positiveReceiptSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("interactive"),
    pid: z.number().int().positive(),
    tty: z.strictObject({
      stdin: z.literal(true),
      stdout: z.literal(true),
      stderr: z.literal(true),
    }),
    interrupt: z.tuple([z.literal(3)]),
    rawRestored: z.literal(true),
    exitStatus: z.literal(0),
  }),
  z.strictObject({
    mode: z.literal("redirected"),
    pid: z.number().int().positive(),
    tty: z.strictObject({
      stdin: z.literal(true),
      stdout: z.literal(false),
      stderr: z.literal(true),
    }),
    plainOutput: z.literal("Authored plain setup output.\n"),
    exitStatus: z.literal(1),
  }),
]);

processTest
  .skipIf(process.platform === "win32")
  .each(["interactive", "redirected"] as const)(
  "preserves selected configuration and closes the real PTY for %s setup",
  { timeout: 30_000 },
  async (mode) => {
    const root = await createTestTempDirectory("rea-package-setup-success-");
    const scratch = join(root, "scratch");
    await mkdir(scratch);
    const config = join(scratch, "selected-config.json");
    await writeFile(config, unchangedConfiguration);
    const entry = join(root, "selected setup.mjs");
    const receiptPath = join(root, "terminal-receipt.json");
    await writeFile(
      entry,
      `#!${process.execPath}\n${mode === "interactive" ? interactiveStandinSource : redirectedStandinSource}`,
    );
    await chmod(entry, 0o755);
    let commands: PackageVerifierCommands | undefined;
    let receipt: z.output<typeof positiveReceiptSchema> | undefined;
    let configurationAtRemoval: string | undefined;
    let liveAtRemoval: readonly number[] | undefined;
    const workspace = {
      path: scratch,
      async close() {
        const pid = receipt?.pid;
        liveAtRemoval = liveProcesses(
          await systemProcessOwnershipHost.listProcesses(),
        )
          .filter((entry) => entry.pid === pid)
          .map(({ pid }) => pid);
        configurationAtRemoval = await readFile(config, "utf8");
        await rm(scratch, { recursive: true, force: true });
      },
    };
    await withVerifierCleanup(async () => {
      commands = await createPackageVerifierCommands({ workspace });
      const options = {
        commands,
        command: entry,
        environment: {
          ...process.env,
          HOME: scratch,
          TERMINAL_RECEIPT: receiptPath,
        },
        root: process.cwd(),
        unchangedPaths: [config],
      };
      if (mode === "interactive") await verifyInteractiveSetup(options);
      else await verifyRedirectedStdoutSetup(options);
      receipt = positiveReceiptSchema.parse(
        JSON.parse(await readFile(receiptPath, "utf8")),
      );
    }, [() => (commands === undefined ? workspace.close() : commands.close())]);

    expect(receipt).toMatchObject({ mode });
    expect(configurationAtRemoval).toBe(unchangedConfiguration);
    expect(liveAtRemoval).toEqual([]);
    await expect(readFile(config)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
