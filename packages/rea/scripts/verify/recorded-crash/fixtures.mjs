import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runOwnedCommand } from "../../../dist/process/OwnedCommand.js";
import {
  spawnOwnedProviderProcess,
  ProviderProcessSupervisor,
} from "../../../dist/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../dist/process/ProcessOwnership.js";

/** Execute fixture tooling under an owned deadline; fixture generation deliberately runs its own test program. */
export async function fixtureCommand(
  command,
  arguments_,
  { root, environment, runId },
) {
  const result = await runOwnedCommand(
    {
      command,
      arguments: arguments_,
      cwd: root,
      runId,
      hostEnvironment: environment,
      expectedCommand: null,
    },
    { timeoutMs: 45_000, diagnosticBytes: 1024 * 1024 },
  );
  return result.stdout.text;
}

/** Build and record a source-owned two-thread crash without changing kernel core settings. */
export async function createRecordedCore(options) {
  const executable = join(options.root, "fixture-program");
  const core = join(options.root, "recording.core");
  await fixtureCommand(
    "gcc",
    [
      "-g",
      "-O0",
      "-pthread",
      "-fno-pie",
      "-no-pie",
      fileURLToPath(
        new URL("../../fixtures/recorded-crash.c", import.meta.url),
      ),
      "-o",
      executable,
    ],
    options,
  );
  // Fixed relative arguments avoid putting selected filesystem paths in GDB command syntax.
  await fixtureCommand(
    options.environment.REA_PWNDBG_GDB,
    [
      "-nx",
      "-nh",
      "--batch",
      "--quiet",
      "-iex",
      "set auto-load off",
      "-iex",
      "set debuginfod enabled off",
      "-ex",
      "set startup-with-shell off",
      "-ex",
      "set disable-randomization off",
      "-ex",
      "file ./fixture-program",
      "-ex",
      "run",
      "-ex",
      "generate-core-file ./recording.core",
    ],
    options,
  );
  return core;
}

/** Retain authority over an unrelated live process used only as a historical-PID collision oracle. */
export async function startCoreSentinel(options) {
  const launch = await spawnOwnedProviderProcess({
    command: process.execPath,
    arguments: [
      "-e",
      "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
    ],
    cwd: options.root,
    hostEnvironment: options.environment,
    runId: options.runId,
  });
  const supervisor = new ProviderProcessSupervisor({
    ...launch,
    ownsProcessLifetime: true,
    cleanup: () => cleanupOwnedProcessGroup(launch.ownership),
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error("Sentinel readiness timed out")),
        10_000,
      );
      const onData = () => {
        if (supervisor.snapshot().stdout.text.includes("ready\n")) finish();
      };
      const onExit = () =>
        finish(new Error("Sentinel exited before readiness"));
      function finish(error) {
        clearTimeout(timer);
        launch.process.stdout.off("data", onData);
        launch.process.off("exit", onExit);
        if (error) reject(error);
        else resolve();
      }
      launch.process.stdout.on("data", onData);
      launch.process.once("exit", onExit);
      onData();
    });
  } catch (cause) {
    try {
      await supervisor.stop();
    } finally {
      supervisor.dispose();
    }
    throw cause;
  }
  return {
    pid: launch.process.pid,
    assertAlive() {
      assert.equal(launch.process.exitCode, null);
      assert.equal(launch.process.signalCode, null);
      process.kill(launch.process.pid, 0);
    },
    async close() {
      try {
        const stopped = await supervisor.stop();
        assert.notEqual(stopped.status, "incomplete", JSON.stringify(stopped));
      } finally {
        supervisor.dispose();
      }
    },
  };
}
