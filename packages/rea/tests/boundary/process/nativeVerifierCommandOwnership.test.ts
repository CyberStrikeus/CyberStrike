import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";

import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { systemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { liveProcesses } from "../../../src/process/ProcessOwnershipProcessTree.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const moduleUrl = (path: string) => pathToFileURL(resolve(path)).href;

const descendantSource = `
import { appendFileSync, existsSync } from "node:fs";
const finish = (reason) => {
  appendFileSync(process.env.NATIVE_EVENTS, JSON.stringify({ kind: "descendant-exit", reason, labExists: existsSync(process.env.NATIVE_LAB) }) + "\\n");
  process.exit(0);
};
process.on("SIGTERM", () => finish("SIGTERM"));
process.send({ pid: process.pid, runId: process.env.REA_PROCESS_RUN_ID });
setInterval(() => {
  if (existsSync(process.env.NATIVE_RELEASE)) finish("fixture-release");
}, 25);
setTimeout(() => finish("fixture-deadline"), 20000);
`;

const leaderSource = `
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, fstatSync, writeFileSync } from "node:fs";
const metadata = fstatSync(0);
const stdin = { fifo: metadata.isFIFO(), socket: metadata.isSocket(), character: metadata.isCharacterDevice(), file: metadata.isFile() };
assert.ok(stdin.fifo || stdin.socket, "Native client stdin must retain an actual pipe or socket");
assert.equal(stdin.character, false);
assert.equal(stdin.file, false);
let inputBytes = 0;
for await (const chunk of process.stdin) inputBytes += chunk.length;
assert.equal(inputBytes, 0);
process.once("SIGTERM", () => {
  appendFileSync(process.env.NATIVE_EVENTS, JSON.stringify({ kind: "leader-exit", labExists: existsSync(process.env.NATIVE_LAB) }) + "\\n");
  process.kill(process.pid, "SIGTERM");
});
const child = spawn(process.execPath, [process.env.NATIVE_DESCENDANT], {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
});
const acknowledged = await new Promise((resolve, reject) => {
  child.once("message", resolve);
  child.once("error", reject);
});
writeFileSync(process.env.NATIVE_READY, JSON.stringify({
  pids: [process.pid, acknowledged.pid], stdin, stdinEof: true, inputBytes,
  runId: process.env.REA_PROCESS_RUN_ID, descendantRunId: acknowledged.runId,
}));
process.stdout.write("native verifier stdin EOF\\n");
process.stderr.write("native verifier diagnostics\\n");
setInterval(() => {}, 1000);
setTimeout(() => process.exit(1), 20000);
`;

const driverSource = `
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createVerifierCommands } from ${JSON.stringify(moduleUrl("scripts/lib/verify-commands.mjs"))};
import { systemProcessOwnershipHost } from ${JSON.stringify(moduleUrl("dist/process/ProcessOwnershipObservation.js"))};
import { liveProcesses } from ${JSON.stringify(moduleUrl("dist/process/ProcessOwnershipProcessTree.js"))};
let failure;
const commands = await createVerifierCommands();
try {
  await commands.exec(process.execPath, [process.env.NATIVE_LEADER], {
    cwd: process.env.NATIVE_LAB, env: process.env, timeout: 1500, maxBuffer: 1024 * 1024,
    stdin: "closed-pipe",
  });
} catch (cause) {
  failure = { reason: cause.reason, signal: cause.snapshot?.signal, stdout: cause.snapshot?.stdout.text, stderr: cause.snapshot?.stderr.text };
} finally {
  await commands.close();
}
const ready = JSON.parse(await readFile(process.env.NATIVE_READY, "utf8"));
const liveAtCompletion = liveProcesses(await systemProcessOwnershipHost.listProcesses()).filter(({ pid }) => ready.pids.includes(pid)).map(({ pid }) => pid);
const artifactAtCompletion = (await readFile(process.env.NATIVE_ARTIFACT)).toString("base64");
process.stdout.write(JSON.stringify({ ready, failure, liveAtCompletion, labExists: existsSync(process.env.NATIVE_LAB), artifactAtCompletion }));
`;

const reportSchema = z.object({
  ready: z.object({
    pids: z.array(z.number().int().positive()).length(2),
    stdin: z.object({
      fifo: z.boolean(),
      socket: z.boolean(),
      character: z.literal(false),
      file: z.literal(false),
    }),
    stdinEof: z.literal(true),
    inputBytes: z.literal(0),
    runId: z.string().min(1),
    descendantRunId: z.string().min(1),
  }),
  failure: z.object({
    reason: z.literal("timeout"),
    // Canonical cleanup releases verified owned groups with SIGKILL.
    signal: z.literal("SIGKILL"),
    stdout: z.string(),
    stderr: z.string(),
  }),
  liveAtCompletion: z.array(z.number().int().positive()),
  labExists: z.boolean(),
  artifactAtCompletion: z.string(),
});

const awaitAuthoredExit = async (readyPath: string) => {
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
        "Authored native verifier processes did not finish cleanup",
      );
    await delay(25);
  }
};

// The native client is authored; actual stdin, timeout, descendants and census
// exercise the owned verifier command boundary without onboarding or network access.
it.skipIf(process.platform === "win32")(
  "joins a timed-out native verifier descendant after pipe EOF while retaining lab artifacts",
  async () => {
    const workspace = await createTestWorkspace("rea-native-verifier-owner-");
    const release = workspace.path("release-descendant");
    const readyPath = workspace.path("ready.json");
    const artifact = Buffer.from("retained native verifier lab α\0\n");
    let acquired:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    let supervisor: ProviderProcessSupervisor | undefined;
    try {
      const lab = await workspace.mkdir("retained lab");
      const artifactPath = await workspace.write(
        "retained lab/evidence.bin",
        artifact,
      );
      const leader = await workspace.write("leader.mjs", leaderSource);
      const descendant = await workspace.write(
        "descendant.mjs",
        descendantSource,
      );
      const driver = await workspace.write("driver.mjs", driverSource);
      acquired = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: [driver],
        cwd: process.cwd(),
        runId: `rea-native-verifier-test-${randomUUID()}`,
        sweepTokenOwnedProcesses: true,
        hostEnvironment: {
          ...process.env,
          ...workspace.environment,
          NATIVE_LAB: lab,
          NATIVE_ARTIFACT: artifactPath,
          NATIVE_LEADER: leader,
          NATIVE_DESCENDANT: descendant,
          NATIVE_READY: readyPath,
          NATIVE_RELEASE: release,
          NATIVE_EVENTS: workspace.path("events.jsonl"),
        },
      });
      const owned = acquired;
      supervisor = new ProviderProcessSupervisor(
        {
          ...owned,
          ownsProcessLifetime: true,
          cleanup:
            owned.cleanup ?? (() => cleanupOwnedProcessGroup(owned.ownership)),
        },
        { maxDiagnosticBytes: 64 * 1024 },
      );
      expect(await supervisor.waitForOutputClose(15_000)).toBe(true);
      const completed = supervisor.snapshot();
      expect(completed.exitCode, completed.stderr.text).toBe(0);
      expect(completed.signal, completed.stderr.text).toBeNull();
      const parsed = reportSchema.safeParse(JSON.parse(completed.stdout.text));
      if (!parsed.success)
        throw new Error(
          `Native verifier report failed validation: ${completed.stdout.text}`,
          { cause: parsed.error },
        );
      const report = parsed.data;
      expect(report.ready.stdin.fifo || report.ready.stdin.socket).toBe(true);
      expect(report.ready.descendantRunId).toBe(report.ready.runId);
      expect(report.failure.stdout).toBe("native verifier stdin EOF\n");
      expect(report.failure.stderr).toBe("native verifier diagnostics\n");
      expect(report.labExists).toBe(true);
      expect(report.artifactAtCompletion).toBe(artifact.toString("base64"));
      expect(Buffer.compare(await readFile(artifactPath), artifact)).toBe(0);
      expect(report.liveAtCompletion).toEqual([]);
    } finally {
      await writeFile(
        release,
        "release this authored native verifier descendant",
      );
      if (supervisor !== undefined) {
        const stopped = await supervisor.stop();
        if (stopped.status === "incomplete") throw new Error(stopped.reason);
      } else if (acquired !== undefined) {
        const stopped = await (acquired.cleanup === undefined
          ? cleanupOwnedProcessGroup(acquired.ownership)
          : acquired.cleanup());
        if (!stopped.cleaned) throw new Error(stopped.reason);
      }
      await awaitAuthoredExit(readyPath);
      await removeTestWorkspace(workspace.root);
    }
  },
  30_000,
);
