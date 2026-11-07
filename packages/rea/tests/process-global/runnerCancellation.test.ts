import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it, onTestFinished, vi } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const supervisorPath = fileURLToPath(
  new URL("../../scripts/run-exclusive-command.mjs", import.meta.url),
);

const runnerPath = fileURLToPath(
  new URL("../../scripts/run-exclusive.mjs", import.meta.url),
);

it.runIf(process.platform !== "win32")(
  "holds ownership until an uncooperative command has finished cancellation",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-cancel-");
    const runner = launch(
      directory,
      'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000);',
    );
    try {
      await runner.ready;
      runner.child.kill("SIGTERM");
      expect(await runner.closed).toMatchObject({ code: 143, signal: null });
      const replacement = launch(directory, 'process.stdout.write("ready");');
      expect(await replacement.closed).toMatchObject({ code: 0, signal: null });
    } finally {
      if (runner.child.exitCode === null) runner.child.kill("SIGKILL");
      await runner.closed;
    }
  },
);

it.runIf(process.platform !== "win32")(
  "retains the lock when the command exits but a descendant ignores cancellation",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-descendant-");
    const pidPath = join(directory, "descendant.pid");
    const activityPath = join(directory, "activity.log");
    const descendant = `
      const fs = require("node:fs");
      process.on("SIGTERM", () => {});
      fs.writeFileSync(${JSON.stringify(activityPath)}, "active\\n");
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      setInterval(() => fs.appendFileSync(${JSON.stringify(activityPath)}, "active\\n"), 20);
    `;
    const runner = launch(
      directory,
      `
      const fs = require("node:fs");
      require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });
      const ready = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(pidPath)})) {
          clearInterval(ready);
          process.stdout.write("ready");
        }
      }, 10);
      setInterval(() => {}, 1000);
    `,
    );
    let descendantPid: number | undefined;
    try {
      await runner.ready;
      descendantPid = Number(await readFile(pidPath, "utf8"));
      runner.child.kill("SIGTERM");
      const contender = launch(
        directory,
        'process.stdout.write("unexpected");',
      );
      expect(await contender.closed).toMatchObject({
        code: 1,
        stderr: expect.stringContaining("already running"),
      });
      expect(await runner.closed).toMatchObject({ code: 143 });
      const stopped = await readFile(activityPath, "utf8");
      await delay(100);
      expect(await readFile(activityPath, "utf8")).toBe(stopped);
      expect(
        await launch(directory, 'process.stdout.write("done");').closed,
      ).toMatchObject({ code: 0 });
    } finally {
      if (runner.child.exitCode === null) runner.child.kill("SIGTERM");
      await runner.closed;
      // Also clean up when this regression is run against the broken runner.
      if (descendantPid !== undefined) stopIfPresent(descendantPid);
    }
  },
);

it.runIf(process.platform === "win32")(
  "terminates the owned command after supervisor IPC cancellation",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-win-cancel-");
    const gate = join(directory, "release-child");
    const started = join(directory, "child-started");
    const runner = launchSupervisor(directory, gatedCommand(gate, started));
    onTestFinished(async () => {
      await writeFile(gate, "release");
      await runner.closed();
    });
    try {
      await runner.ready;
      await expect(readFile(started, "utf8")).resolves.toBe("started");
      runner.child.send("SIGTERM");
      await expect(runner.closed()).resolves.toMatchObject({ code: 143 });
      expect(await pathExists(gate)).toBe(false);
      await expect(
        launch(directory, 'process.stdout.write("released");').closed,
      ).resolves.toMatchObject({ code: 0, stdout: "released" });
    } finally {
      await writeFile(gate, "release");
    }
  },
);

it.runIf(process.platform === "win32")(
  "keeps the lock after leader exit and cancels a surviving grandchild by message or disconnect",
  async () => {
    await exerciseWindowsGrandchild("message");
    await exerciseWindowsGrandchild("disconnect");
  },
);

async function exerciseWindowsGrandchild(
  cancellation: "message" | "disconnect",
): Promise<void> {
  const directory = await createTestTempDirectory("rea-runner-win-tree-");
  const activityPath = join(directory, "grandchild-activity.log");
  const readyPath = join(directory, "grandchild-ready");
  const leaderExitedPath = join(directory, "leader-exited");
  const childExitedPath = join(directory, "child-exited");
  const childErrorPath = join(directory, "child-error");
  const grandchildExitedPath = join(directory, "grandchild-exited");
  const grandchildErrorPath = join(directory, "grandchild-error");
  const gatePath = join(directory, "grandchild-stop");
  const grandchild = `
      const fs = require("node:fs");
      const activity = ${JSON.stringify(activityPath)};
      const gate = ${JSON.stringify(gatePath)};
      process.on("exit", (code) => fs.writeFileSync(${JSON.stringify(grandchildExitedPath)}, String(code)));
      process.on("uncaughtExceptionMonitor", (error) => fs.writeFileSync(${JSON.stringify(grandchildErrorPath)}, String(error)));
      fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
      const write = () => fs.appendFileSync(activity, "active\\n");
      write();
      const timer = setInterval(() => {
        if (fs.existsSync(gate)) {
          clearInterval(timer);
          process.exit(0);
        }
        write();
      }, 20);
    `;
  const child = `
      const fs = require("node:fs");
      const grandchildProcess = require("node:child_process").spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchild)}],
        { detached: true, stdio: "ignore" },
      );
      grandchildProcess.once("error", (error) => fs.writeFileSync(${JSON.stringify(childErrorPath)}, String(error)));
      grandchildProcess.unref();
      process.on("exit", (code) => fs.writeFileSync(${JSON.stringify(childExitedPath)}, String(code)));
    `;
  const leader = `
      const fs = require("node:fs");
      process.on("exit", () => fs.writeFileSync(${JSON.stringify(leaderExitedPath)}, "exited"));
      const child = require("node:child_process").spawn(
        process.execPath,
        ["-e", ${JSON.stringify(child)}],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      const waitForGrandchild = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(readyPath)})) return;
        clearInterval(waitForGrandchild);
        process.stdout.write("ready");
      }, 10);
    `;
  const runner = launchSupervisor(directory, leader);
  onTestFinished(async () => {
    await writeFile(gatePath, "stop");
    await runner.closed();
  });

  try {
    await runner.ready;
    await expect(readFile(readyPath, "utf8")).resolves.toBe("ready");
    await vi.waitFor(async () =>
      expect(await readFile(leaderExitedPath, "utf8")).toBe("exited"),
    );
    const activityBefore = await readFile(activityPath, "utf8");
    await expect
      .poll(async () => (await readFile(activityPath, "utf8")).length, {
        timeout: 5_000,
      })
      .toBeGreaterThan(activityBefore.length);
    const activityDuring = await readFile(activityPath, "utf8");
    const contender = await launch(
      directory,
      'process.stdout.write("unexpected");',
    ).closed;
    const evidence = JSON.stringify({
      cancellation,
      supervisorAlive: runner.child.exitCode === null,
      leaderExited: await pathExists(leaderExitedPath),
      descendantReady: await pathExists(readyPath),
      descendantWroteDuringProbe: activityDuring.length > activityBefore.length,
      descendantExited: await pathExists(grandchildExitedPath),
      descendantError: await pathExists(grandchildErrorPath),
      childExited: await pathExists(childExitedPath),
      childError: await pathExists(childErrorPath),
      supervisorCode: runner.child.exitCode,
      supervisorStdout: runner.stdout,
      supervisorStderr: runner.stderr,
      contender,
    });
    expect(
      contender,
      `Windows process-tree ownership evidence: ${evidence}`,
    ).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("already running"),
    });

    if (cancellation === "disconnect") runner.child.disconnect();
    else runner.child.send("SIGTERM");
    await expect(runner.closed()).resolves.toMatchObject({ code: 143 });
    const stopped = await readFile(activityPath, "utf8");
    await delay(100);
    expect(await readFile(activityPath, "utf8")).toBe(stopped);
    await expect(
      launch(directory, 'process.stdout.write("released");').closed,
    ).resolves.toMatchObject({ code: 0, stdout: "released" });
  } finally {
    await writeFile(gatePath, "stop");
  }
}

it.runIf(process.platform === "win32")(
  "stops the owned command after the supervisor IPC disconnects",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-runner-win-disconnect-",
    );
    const gate = join(directory, "release-child");
    const started = join(directory, "child-started");
    const runner = launchSupervisor(directory, gatedCommand(gate, started));
    onTestFinished(async () => {
      await writeFile(gate, "release");
      await runner.closed();
    });
    try {
      await runner.ready;
      await expect(readFile(started, "utf8")).resolves.toBe("started");
      runner.child.disconnect();
      await expect(runner.closed()).resolves.toMatchObject({ code: 143 });
      expect(await pathExists(gate)).toBe(false);
      await expect(
        launch(directory, 'process.stdout.write("released");').closed,
      ).resolves.toMatchObject({ code: 0, stdout: "released" });
    } finally {
      await writeFile(gate, "release");
    }
  },
);

it("does not treat an old database timestamp as permission to replace a live owner", async () => {
  const directory = await createTestTempDirectory("rea-runner-live-");
  const runner = launch(
    directory,
    'process.stdout.write("ready"); setTimeout(() => {}, 1500);',
  );
  try {
    await runner.ready;
    const old = new Date("2000-01-01T00:00:00Z");
    await utimes(
      join(directory, ".cache/rea-command-locks/test.sqlite"),
      old,
      old,
    );
    const contender = launch(directory, 'process.stdout.write("unexpected");');
    expect(await contender.closed).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("already running"),
      stdout: "",
    });
    expect(await runner.closed).toMatchObject({ code: 0 });
  } finally {
    if (runner.child.exitCode === null) runner.child.kill("SIGKILL");
    await runner.closed;
  }
});

it("preserves executable arguments through the public runner", async () => {
  const directory = await createTestTempDirectory("rea-runner-argv-");
  const payload = 'spaces, "quotes", & ^ % ! (parens)';
  const code = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
  expect(
    await execute(directory, process.execPath, ["-e", code, payload]),
  ).toMatchObject({
    code: 0,
    stdout: JSON.stringify([payload]),
    stderr: "",
  });
});

it("preserves command stderr, warnings and exit status independently of supervisor notices", async () => {
  const directory = await createTestTempDirectory("rea-runner-diagnostics-");
  const stderr = 'authored command stderr: "quotes" & 雪\n';
  const result = await execute(directory, process.execPath, [
    "-e",
    `
process.stdout.write(JSON.stringify({
  disabledWarnings: process.execArgv.filter((argument) => argument.startsWith("--disable-warning")),
}));
process.stderr.write(${JSON.stringify(stderr)});
process.emitWarning("authored command experiment", { type: "ExperimentalWarning" });
process.emitWarning("authored command deprecation", { type: "DeprecationWarning" });
process.exitCode = 7;
`,
  ]);
  expect(result.code).toBe(7);
  expect(JSON.parse(result.stdout)).toEqual({ disabledWarnings: [] });
  expect(result.stderr).toContain(stderr);
  expect(result.stderr).toContain(
    "ExperimentalWarning: authored command experiment",
  );
  expect(result.stderr).toContain(
    "DeprecationWarning: authored command deprecation",
  );
  expect(result.stderr).not.toContain("stripTypeScriptTypes");
});

it.runIf(process.platform === "win32")(
  "launches an executable from a path containing spaces",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-spaced-exe-");
    const executable = join(directory, "node runtime", "node.exe");
    await mkdir(join(directory, "node runtime"), { recursive: true });
    await copyFile(process.execPath, executable);
    const payload = 'argument with spaces and "quotes" & ^ % !';
    const code = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
    expect(
      await execute(directory, executable, ["-e", code, payload]),
    ).toMatchObject({
      code: 0,
      stdout: JSON.stringify([payload]),
      stderr: "",
    });
  },
);

it.runIf(process.platform === "win32")(
  "resolves bare node and Windows command shims without losing arguments",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-shims-");
    const payload = 'argument with spaces and "quotes" & ^ % !';
    const code = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
    expect(
      await execute(directory, "node", ["-e", code, payload]),
    ).toMatchObject({
      code: 0,
      stdout: JSON.stringify([payload]),
      stderr: "",
    });

    const npm = await execute(directory, "npm", ["--version"]);
    expect(npm).toMatchObject({ code: 0, stderr: "" });
    expect(npm.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);

    const npmProject = join(directory, "npm project");
    await mkdir(npmProject, { recursive: true });
    await writeFile(
      join(npmProject, "package.json"),
      JSON.stringify({
        scripts: {
          "print-argv":
            'node -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" --',
        },
      }),
    );
    const shimPayload = 'argument with spaces and "quotes" & ^ % !';
    const npmArgv = await execute(npmProject, "npm", [
      "run",
      "print-argv",
      "--",
      shimPayload,
    ]);
    expect(npmArgv).toMatchObject({ code: 0, stderr: "" });
    expect(npmArgv.stdout).toContain(JSON.stringify([shimPayload]));

    const turbo = await execute(
      directory,
      join(process.cwd(), "node_modules", ".bin", "turbo"),
      ["--version"],
    );
    expect(turbo).toMatchObject({ code: 0, stderr: "" });
    expect(turbo.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
  },
);

it.runIf(process.platform !== "win32")(
  "recovers after abrupt owner death and keeps simultaneous contenders exclusive",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-recover-");
    // Killing the public runner disconnects its supervisor, which retains
    // ownership while cancelling the group before automatic OS lock release.
    const interrupted = launch(
      directory,
      'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000);',
    );
    await interrupted.ready;
    interrupted.child.kill("SIGKILL");
    expect(await interrupted.closed).toMatchObject({
      code: null,
      signal: "SIGKILL",
    });
    const activityPath = join(directory, "active");
    const logPath = join(directory, "activity.log");
    await writeFile(logPath, "");
    const command = `
      const fs = require("node:fs");
      const active = ${JSON.stringify(activityPath)};
      const log = ${JSON.stringify(logPath)};
      try { fs.closeSync(fs.openSync(active, "wx")); }
      catch { process.stderr.write("commands overlapped"); process.exit(77); }
      fs.appendFileSync(log, "start\\n");
      setTimeout(() => {
        fs.appendFileSync(log, "end\\n");
        fs.unlinkSync(active);
      }, 250);
    `;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => launch(directory, command).closed),
    );
    expect(results.some(({ code }) => code === 0)).toBe(true);
    for (const result of results) {
      expect([0, 1]).toContain(result.code);
      if (result.code === 1) expect(result.stderr).toContain("already running");
      expect(result.stderr).not.toContain("commands overlapped");
    }
    const events = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(events.length).toBeGreaterThan(0);
    for (let index = 0; index < events.length; index += 2)
      expect(events.slice(index, index + 2)).toEqual(["start", "end"]);
    expect(
      await launch(directory, 'process.stdout.write("done");').closed,
    ).toMatchObject({ code: 0, stdout: "done" });
  },
);

function stopIfPresent(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (cause) {
    if (
      !(cause instanceof Error) ||
      !("code" in cause) ||
      cause.code !== "ESRCH"
    )
      throw cause;
  }
}

function launch(directory: string, command: string) {
  const child = spawn(
    process.execPath,
    [runnerPath, "test", process.execPath, "-e", command],
    { cwd: directory, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let notifyReady: (() => void) | undefined;
  const ready = withTimeout(
    new Promise<void>((resolveReady) => {
      notifyReady = resolveReady;
    }),
    "runner child did not start",
  );
  // Some scenarios intentionally never print a ready marker.
  void ready.catch(() => {});
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (stdout.includes("ready")) notifyReady?.();
  });
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  const closed = withTimeout(
    new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }>((resolveClosed, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        notifyReady?.();
        resolveClosed({ code, signal, stdout, stderr });
      });
    }),
    "runner did not finish",
  );
  return { child, ready, closed };
}

function launchSupervisor(directory: string, command: string) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../scripts/run-exclusive-command.mjs", import.meta.url),
      ),
      "test",
      process.execPath,
      "-e",
      command,
    ],
    { cwd: directory, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  if (child.stdout === null || child.stderr === null)
    throw new Error("runner supervisor streams were not piped");
  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;
  let stdout = "";
  let stderr = "";
  let notifyReady: (() => void) | undefined;
  const ready = withTimeout(
    new Promise<void>((resolveReady) => {
      notifyReady = resolveReady;
    }),
    "runner supervisor child did not start",
  );
  void ready.catch(() => {});
  stdoutStream.on("data", (chunk) => {
    stdout += chunk.toString();
    if (stdout.includes("ready")) notifyReady?.();
  });
  stderrStream.on("data", (chunk) => (stderr += chunk.toString()));
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      notifyReady?.();
      resolveExit({ code, signal });
    });
  });
  const stdoutClosed = new Promise<void>((resolveClose) => {
    stdoutStream.once("close", resolveClose);
  });
  const stderrClosed = new Promise<void>((resolveClose) => {
    stderrStream.once("close", resolveClose);
  });
  const ipcDisconnected = new Promise<void>((resolveDisconnect) => {
    child.once("disconnect", resolveDisconnect);
  });
  const finished = Promise.all([
    exited,
    stdoutClosed,
    stderrClosed,
    ipcDisconnected,
  ]).then(([{ code, signal }]) => ({ code, signal, stdout, stderr }));
  return {
    child,
    ready,
    closed: () => withTimeout(finished, "runner supervisor did not finish"),
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function gatedCommand(gate: string, started: string): string {
  return `
    const fs = require("node:fs");
    const gate = ${JSON.stringify(gate)};
    fs.writeFileSync(${JSON.stringify(started)}, "started");
    process.stdout.write("ready");
    const poll = setInterval(() => {
      if (fs.existsSync(gate)) {
        clearInterval(poll);
        process.exit(0);
      }
    }, 10);
  `;
}

function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function execute(
  directory: string,
  command: string,
  arguments_: string[] = [],
) {
  return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [runnerPath, "test", command, ...arguments_],
      { cwd: directory, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = 5_000,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

it.runIf(process.platform !== "win32")(
  "retains lock ownership through a post-spawn child error until close",
  async () => {
    const directory = await createTestTempDirectory("rea-runner-child-error-");
    const readyPath = join(directory, "command-ready");
    const gatePath = join(directory, "allow-command-exit");
    const closedPath = join(directory, "command-closed");
    const source = await readFile(supervisorPath, "utf8");
    const crossSpawn = pathToFileURL(
      createRequire(import.meta.url).resolve("cross-spawn"),
    ).href;
    const spawnCall =
      /child = spawn\(command\[0\], command\.slice\(1\), \{\n\s+cwd: process\.cwd\(\),\n\s+env: process\.env,\n\s+stdio: "inherit",\n\s+\}\);/u;
    const postSpawnInjection = `child.once("spawn", () => {
  const waitForReady = setInterval(() => {
    if (!existsSync(${JSON.stringify(readyPath)})) return;
    clearInterval(waitForReady);
    process.stdout.write("controlled-post-spawn-error\\n");
    child.emit("error", new Error("controlled post-spawn child error"));
    child.emit("error", new Error("controlled secondary child error"));
  }, 5);
});`;
    expect(source).toMatch(spawnCall);
    const injectedSource = source
      .replace(
        'import spawn from "cross-spawn";',
        `import spawn from ${JSON.stringify(crossSpawn)};\nimport { existsSync } from "node:fs";`,
      )
      .replace(spawnCall, (call) => `${call}\n    ${postSpawnInjection}`);
    expect(injectedSource).toContain(postSpawnInjection);
    expect(injectedSource).toContain("controlled post-spawn child error");
    const copiedSupervisor = join(directory, "run-exclusive-command.mjs");
    const copiedHelperDirectory = join(directory, "lib");
    await mkdir(copiedHelperDirectory, { recursive: true });
    await copyFile(
      join(process.cwd(), "scripts/lib/windows-owned-command.mjs"),
      join(copiedHelperDirectory, "windows-owned-command.mjs"),
    );
    await writeFile(copiedSupervisor, injectedSource);

    const gatedCommand = `
    const fs = require("node:fs");
    fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
    process.stdout.write("command-ready\\n");
    const waitForGate = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(gatePath)})) return;
      clearInterval(waitForGate);
      fs.writeFileSync(${JSON.stringify(closedPath)}, "closed");
      process.stdout.write("command-closed\\n");
    }, 5);
  `;
    const supervisor = spawn(
      process.execPath,
      [copiedSupervisor, "test", process.execPath, "-e", gatedCommand],
      { cwd: directory, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    if (supervisor.stdout === null || supervisor.stderr === null) {
      supervisor.kill("SIGKILL");
      throw new Error("supervisor output pipes were not created");
    }
    const stdoutStream = supervisor.stdout;
    const stderrStream = supervisor.stderr;
    let stdout = "";
    let stderr = "";
    const outputWaiters = new Map<string, (() => void)[]>();
    stdoutStream.on("data", (chunk) => {
      stdout += chunk.toString();
      for (const [marker, waiters] of outputWaiters) {
        if (!stdout.includes(marker)) continue;
        outputWaiters.delete(marker);
        for (const notify of waiters) notify();
      }
    });
    stderrStream.on("data", (chunk) => (stderr += chunk.toString()));
    const waitForOutput = (marker: string) => {
      if (stdout.includes(marker)) return Promise.resolve();
      return withTimeout(
        new Promise<void>((resolveOutput) => {
          outputWaiters.set(marker, [
            ...(outputWaiters.get(marker) ?? []),
            resolveOutput,
          ]);
        }),
        `supervisor did not write ${marker}`,
      );
    };
    const exited = withTimeout(
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit, reject) => {
          supervisor.once("error", reject);
          supervisor.once("exit", (code, signal) =>
            resolveExit({ code, signal }),
          );
        },
      ),
      "supervisor did not exit",
    );
    try {
      await waitForOutput("controlled-post-spawn-error");
      const contender = await execute(directory, process.execPath, [
        "-e",
        'process.stdout.write("lock acquired");',
      ]);
      expect(contender).toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("already running"),
      });
      expect(stdout).not.toContain("command-closed");

      await writeFile(gatePath, "open");
      await waitForOutput("command-closed");
      expect(await exited).toEqual({ code: 1, signal: null });
      expect(stderr).toContain("controlled post-spawn child error");
      expect(stderr).not.toContain("controlled secondary child error");
      expect(
        await execute(directory, process.execPath, [
          "-e",
          'process.stdout.write("lock acquired");',
        ]),
      ).toMatchObject({ code: 0, stdout: "lock acquired" });
    } finally {
      await writeFile(gatePath, "open");
      await waitForOutput("command-closed").catch(() => undefined);
      await exited.catch(() => undefined);
    }
  },
);
