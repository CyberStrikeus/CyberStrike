import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
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

const repository = fileURLToPath(new URL("../../../", import.meta.url));
// Select the same actual entrypoints from an owned original-source checkout for
// the regression's RED run. This changes no production imports or behavior.
const verifierSourceRoot = resolve(
  process.env.REA_NATIVE_VERIFIER_SOURCE_ROOT ?? repository,
);
const retainedBytes = Buffer.from("native preflight retained evidence α\0\n");
const versionStdout = "authored native version output\n";
const versionStderr = "authored native version diagnostics\n";

const clients = [
  { client: "claude", profile: "CLAUDE_CONFIG_DIR", javascript: false },
  { client: "copilot", profile: "COPILOT_HOME", javascript: false },
  { client: "deepseek", profile: "DSH_HOME", javascript: false },
  { client: "gemini", profile: "GEMINI_CLI_HOME", javascript: true },
  { client: "grok", profile: "GROK_HOME", javascript: false },
  { client: "omp", profile: "PI_CODING_AGENT_DIR", javascript: false },
  { client: "opencode", profile: "OPENCODE_CONFIG_DIR", javascript: false },
  { client: "qwen", profile: "QWEN_HOME", javascript: true },
] as const;

const readySchema = z.object({
  pids: z.array(z.number().int().positive()).length(2),
  runId: z.string().min(1),
  descendantRunId: z.string().min(1),
  argv: z.tuple([z.literal("--version")]),
  cwd: z.string(),
  lab: z.string(),
  artifact: z.string(),
  stdin: z.object({
    fifo: z.boolean(),
    socket: z.boolean(),
    character: z.literal(false),
    file: z.literal(false),
  }),
  stdout: z.literal(versionStdout),
  stderr: z.literal(versionStderr),
});

const receiptSchema = z.object({
  clientVersion: z.null(),
  passed: z.literal(false),
  artifacts: z.string(),
  catalogSize: z.null().optional(),
  requests: z.array(z.unknown()).optional(),
});

const descendantSource = `
import { appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const release = fileURLToPath(new URL("./release-descendant", import.meta.url));
const events = fileURLToPath(new URL("./descendant-events.jsonl", import.meta.url));
const finish = (reason) => {
  appendFileSync(events, JSON.stringify({ pid: process.pid, reason }) + "\\n");
  process.exit(0);
};
// The ready message is an acquisition barrier, independent of process-table
// scheduling. Ignored stdio lets the version leader and verifier finish first.
process.send({ pid: process.pid, runId: process.env.REA_PROCESS_RUN_ID });
process.disconnect();
setInterval(() => {
  if (existsSync(release)) finish("external-release");
}, 25);
setTimeout(() => finish("bounded-fixture-deadline"), 20000);
`;

const selectedClientSource = (profile: string) => `
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fstatSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
assert.deepEqual(process.argv.slice(2), ["--version"]);
const metadata = fstatSync(0);
const stdin = {
  fifo: metadata.isFIFO(), socket: metadata.isSocket(),
  character: metadata.isCharacterDevice(), file: metadata.isFile(),
};
assert.ok(stdin.fifo || stdin.socket, "Native preflight stdin must retain a real pipe or socket");
assert.equal(stdin.character, false);
assert.equal(stdin.file, false);
const lab = dirname(process.env[${JSON.stringify(profile)}]);
const artifact = join(lab, "authored-preflight-evidence.bin");
writeFileSync(artifact, Buffer.from(${JSON.stringify(retainedBytes.toString("base64"))}, "base64"));
const child = spawn(process.execPath, [fileURLToPath(new URL("./descendant.mjs", import.meta.url))], {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
});
const acknowledged = await new Promise((resolve, reject) => {
  child.once("message", resolve);
  child.once("error", reject);
});
child.unref();
const stdout = ${JSON.stringify(versionStdout)};
const stderr = ${JSON.stringify(versionStderr)};
writeFileSync(fileURLToPath(new URL("./ready.json", import.meta.url)), JSON.stringify({
  pids: [process.pid, acknowledged.pid],
  runId: process.env.REA_PROCESS_RUN_ID, descendantRunId: acknowledged.runId,
  argv: process.argv.slice(2), cwd: process.cwd(), lab, artifact, stdin, stdout, stderr,
}));
await Promise.all([
  new Promise((resolve) => process.stdout.write(stdout, resolve)),
  new Promise((resolve) => process.stderr.write(stderr, resolve)),
]);
process.exit(7);
`;

const readReady = async (path: string) =>
  readFile(path, "utf8").then(
    (text) => readySchema.parse(JSON.parse(text)),
    (cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    },
  );

const liveAcknowledgedProcesses = async (pids: readonly number[]) =>
  liveProcesses(await systemProcessOwnershipHost.listProcesses())
    .filter(({ pid }) => pids.includes(pid))
    .map(({ pid }) => pid);

const awaitReleasedDescendant = async (readyPath: string) => {
  const ready = await readReady(readyPath);
  if (ready === undefined) return;
  const deadline = Date.now() + 7_500;
  while ((await liveAcknowledgedProcesses(ready.pids)).length !== 0) {
    if (Date.now() >= deadline)
      throw new Error(
        "Externally released native preflight fixture stayed live",
      );
    await delay(25);
  }
};

const shellQuote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;

// These are authored selected clients, not installed-provider verification.
// CommandCode remains unverified: its actual disposable OS account is required.
it.skipIf(process.platform === "win32").each(clients)(
  "$client actual verifier reclaims a failed preflight descendant and retains its lab",
  async ({ client, profile, javascript }) => {
    const workspace = await createTestWorkspace(
      `rea-native-${client}-preflight-`,
    );
    const readyPath = workspace.path("ready.json");
    const releasePath = workspace.path("release-descendant");
    let acquired:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    let supervisor: ProviderProcessSupervisor | undefined;
    try {
      const temporaryRoot = await workspace.mkdir("native-labs");
      const selectedJavaScript = await workspace.write(
        "selected-client.mjs",
        selectedClientSource(profile),
      );
      await workspace.write("descendant.mjs", descendantSource);
      const command = javascript
        ? selectedJavaScript
        : await workspace.write(
            "selected-client",
            `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(selectedJavaScript)} "$@"\n`,
          );
      if (!javascript) await chmod(command, 0o700);
      acquired = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: [
          join(verifierSourceRoot, "scripts", `verify-${client}-client.mjs`),
          "call",
        ],
        cwd: repository,
        runId: `rea-native-preflight-test-${randomUUID()}`,
        sweepTokenOwnedProcesses: true,
        hostEnvironment: {
          ...process.env,
          ...workspace.environment,
          TMPDIR: temporaryRoot,
          TMP: temporaryRoot,
          TEMP: temporaryRoot,
          REA_VERIFY_RUNTIME_ROOT: repository,
          [`REA_VERIFY_${client.toUpperCase()}_COMMAND`]: command,
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
      const ready = await readReady(readyPath);
      if (ready === undefined)
        throw new Error(
          `${client} did not reach the authored version preflight: ${completed.stderr.text}`,
        );
      // Observe before stop(), external release, receipt parsing or workspace
      // removal. A successful test-owned teardown cannot hide verifier leakage.
      const liveAtVerifierCompletion = await liveAcknowledgedProcesses(
        ready.pids,
      );
      expect(
        liveAtVerifierCompletion,
        `${client} acknowledged processes still alive when its actual verifier completed`,
      ).toEqual([]);
      expect(completed.exitCode, completed.stderr.text).not.toBe(0);
      expect(completed.signal, completed.stderr.text).toBeNull();
      expect(completed.stderr.text).toContain(versionStderr);
      expect(ready.stdin.fifo || ready.stdin.socket).toBe(true);
      expect(ready.descendantRunId).toBe(ready.runId);
      expect(dirname(ready.lab)).toBe(temporaryRoot);
      expect(ready.artifact).toBe(
        join(ready.lab, "authored-preflight-evidence.bin"),
      );
      const receipt = receiptSchema.parse(
        JSON.parse(await readFile(join(ready.lab, "receipt.json"), "utf8")),
      );
      expect(receipt.artifacts).toBe(ready.lab);
      if (receipt.requests !== undefined) expect(receipt.requests).toEqual([]);
      // Read only after the verifier's own cleanup, before removing test scratch.
      expect(
        Buffer.compare(await readFile(ready.artifact), retainedBytes),
      ).toBe(0);
    } finally {
      // Self-release the authored orphan even on RED. PID observations never
      // authorize signals; outer cleanup retains its canonical acquisition proof.
      try {
        await writeFile(
          releasePath,
          "release this authored preflight descendant",
        );
        await awaitReleasedDescendant(readyPath);
      } finally {
        if (supervisor !== undefined) {
          const stopped = await supervisor.stop();
          if (stopped.status === "incomplete") throw new Error(stopped.reason);
        } else if (acquired !== undefined) {
          const stopped = await (acquired.cleanup === undefined
            ? cleanupOwnedProcessGroup(acquired.ownership)
            : acquired.cleanup());
          if (!stopped.cleaned) throw new Error(stopped.reason);
        }
      }
      await removeTestWorkspace(workspace.root);
    }
  },
  30_000,
);
