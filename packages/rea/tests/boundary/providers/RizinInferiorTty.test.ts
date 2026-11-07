import { execFileSync, spawn as spawnChild } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "@lydell/node-pty";
import { afterEach, expect, it, vi } from "vitest";

import {
  assertRizinProcessStartTimeStable,
  RizinDebugSessionManager,
  truncateUtf8,
} from "../../../src/rizin/RizinDebugSessionManager.js";
import { evidenceSchema } from "../../../src/domain/evidence.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import {
  createRizinTestManager,
  rizinTestInferiorTty,
} from "./RizinTestInferiorTty.js";
import { createInjectedProcess } from "./RizinDebugSessionCoverage.fixtures.js";

let terminal: ReturnType<typeof spawn> | undefined;
let manager: RizinDebugSessionManager | undefined;
let testDirectory: string | undefined;
let inferiorPid: number | undefined;
let providerPid: number | undefined;
let providerWatchdogPid: number | undefined;
const rizinBinary = findRizinBinary();

afterEach(async () => {
  await manager?.closeAll().catch(() => undefined);
  manager = undefined;
  if (providerPid !== undefined && testDirectory !== undefined) {
    try {
      const commandLine = await readFile(
        `/proc/${providerPid}/cmdline`,
        "utf8",
      );
      if (commandLine.includes(testDirectory))
        process.kill(providerPid, "SIGKILL");
    } catch {
      // The owned fake provider may already have exited.
    }
  }
  providerPid = undefined;
  if (providerWatchdogPid !== undefined) {
    try {
      process.kill(providerWatchdogPid, "SIGTERM");
    } catch {
      // The watchdog may already have completed.
    }
  }
  providerWatchdogPid = undefined;
  terminal?.kill();
  terminal = undefined;
  let ownedPid = inferiorPid;
  if (ownedPid === undefined && testDirectory !== undefined) {
    try {
      ownedPid = Number(
        await readFile(join(testDirectory, "target.pid"), "utf8"),
      );
    } catch {
      // The target may not have started before the test failed.
    }
  }
  if (
    ownedPid !== undefined &&
    Number.isSafeInteger(ownedPid) &&
    ownedPid > 0
  ) {
    try {
      const commandLine = await readFile(`/proc/${ownedPid}/cmdline`, "utf8");
      if (testDirectory !== undefined && commandLine.includes(testDirectory))
        process.kill(ownedPid, "SIGKILL");
    } catch {
      // The test target may already have exited.
    }
  }
  inferiorPid = undefined;
  if (testDirectory !== undefined)
    await rm(testDirectory, { recursive: true, force: true });
  testDirectory = undefined;
});

it("requires an explicit inferior TTY before spawning Rizin", async () => {
  let spawned = false;
  const manager = new RizinDebugSessionManager(
    { REA_RIZIN_COMMAND: "rizin" },
    {
      spawnProcess: async () => {
        spawned = true;
        throw new Error("must not spawn");
      },
    },
  );

  const result = await manager.start({ path: "/tmp/fixture.bin" } as never);

  expect(result.ok).toBe(false);
  expect(spawned).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "fails the protocol when a NUL delimiter does not advance the frame parser",
  async () => {
    const injected = createInjectedProcess({
      startup: (control) => control.output(Buffer.from([0, 0])),
    });
    manager = createRizinTestManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      { spawnProcess: injected.spawnProcess },
    );
    const originalIndexOf = Buffer.prototype.indexOf;
    let forcedNonAdvancingBoundary = false;
    const indexOf = vi
      .spyOn(Buffer.prototype, "indexOf")
      .mockImplementation(function (this: Buffer, value, byteOffset, encoding) {
        if (
          this.length === 2 &&
          this[0] === 0 &&
          this[1] === 0 &&
          byteOffset === 1
        ) {
          forcedNonAdvancingBoundary = true;
          return 0;
        }
        return originalIndexOf.call(this, value, byteOffset, encoding);
      });
    try {
      const started = await manager.start({
        path: "/tmp/injected",
        inferior_tty: await rizinTestInferiorTty(),
      });
      expect(forcedNonAdvancingBoundary).toBe(true);
      expect(started.ok).toBe(false);
      if (!started.ok)
        expect(started.error.message).toContain(
          "frame parser failed to advance past a NUL delimiter",
        );
    } finally {
      indexOf.mockRestore();
    }
  },
);

it("declares that Rizin close can resume target code and mutate target state", () => {
  expect(TOOL_EFFECTS.close_rizin_debug_session).toMatchObject({
    mutatesTarget: true,
    executesForeignCode: true,
  });
});

it.skipIf(process.platform !== "linux").each([
  { name: "empty inferior list", response: "[]", closeSucceeds: true },
  { name: "malformed JSON", response: "not-json", closeSucceeds: false },
  { name: "non-array JSON", response: "{}", closeSucceeds: false },
  {
    name: "valid non-ptrace descriptor",
    response: '[{"raised":true,"fd":3,"uri":"file:///tmp/target"}]',
    closeSucceeds: true,
  },
  {
    name: "malformed descriptor row",
    response: "[null]",
    closeSucceeds: false,
  },
  {
    name: "inactive ptrace row",
    response: '[{"raised":false,"fd":3,"uri":"ptrace://1"}]',
    closeSucceeds: false,
  },
  {
    name: "malformed ptrace URI",
    response: '[{"raised":true,"fd":3,"uri":"ptrace://bad"}]',
    closeSucceeds: false,
  },
  {
    name: "multiple ptrace rows",
    response:
      '[{"raised":true,"fd":3,"uri":"ptrace://1"},{"raised":true,"fd":4,"uri":"ptrace://2"}]',
    closeSucceeds: false,
  },
])(
  "validates Rizin `olj` close response: $name",
  async ({ response, closeSucceeds }) => {
    const tty = await rizinTestInferiorTty();
    testDirectory = await mkdtemp(join(tmpdir(), "rea-rizin-olj-"));
    const provider = join(testDirectory, "fake-rizin.cjs");
    await writeFile(
      provider,
      `#!/usr/bin/env node
process.stdout.write("\\0");
let oljCalls = 0;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "olj") process.stdout.write((++oljCalls === 1 ? ${JSON.stringify(response)} : "[]") + "\\0");
    else if (line === "e dbg.exitkills") process.stdout.write("false\\0");
    else if (line.startsWith("!echo ")) process.stdout.write(line.slice(6) + "\\0");
  }
});
`,
    );
    execFileSync(process.execPath, ["--check", provider]);
    await chmod(provider, 0o700);
    manager = new RizinDebugSessionManager({
      ...process.env,
      REA_RIZIN_COMMAND: provider,
    });
    const started = await manager.start({
      path: "/tmp/fake-target",
      inferior_tty: tty,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const closed = await manager.close(started.value.session_id);
    expect(closed.ok).toBe(closeSucceeds);
    if (!closeSucceeds) {
      expect(manager.status(started.value.session_id)?.state).toBe("closed");
      await manager.closeAll();
    }
  },
);

it.skipIf(process.platform !== "linux").each([
  {
    name: "same descriptor remains listed after detach",
    afterDetach: (pid: number) =>
      `[{"raised":true,"fd":3,"uri":"ptrace://${pid}"}]`,
  },
  {
    name: "same inferior remains listed under a different FD",
    afterDetach: (pid: number) =>
      `[{"raised":true,"fd":4,"uri":"ptrace://${pid}"}]`,
  },
  {
    name: "an unexpected ptrace inferior remains listed",
    afterDetach: () => '[{"raised":true,"fd":4,"uri":"ptrace://999999999"}]',
  },
])(
  "retains ownership when o- readback finds $name",
  async ({ afterDetach }) => {
    const sessionId = await startFakeInferiorSession({ afterDetach });
    await expectCloseRejectedAndReleased(sessionId);
  },
);

it.skipIf(process.platform !== "linux")(
  "detaches a verified fake inferior before stopping the Rizin debugger",
  async () => {
    const sessionId = await startFakeInferiorSession();

    const closed = await manager!.close(sessionId);

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(manager!.status(sessionId)).toBeUndefined();
    expect(inferiorPid).toBeDefined();
    expect(() => process.kill(inferiorPid!, 0)).not.toThrow();
    const stat = await readFile(`/proc/${inferiorPid!}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(") ");
    expect(commandEnd).toBeGreaterThan(0);
    expect(stat.slice(commandEnd + 2).trimStart()[0]).not.toBe("Z");
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses detach when Rizin reports dbg.exitkills=true",
  async () => {
    const sessionId = await startFakeInferiorSession({ exitKills: "true" });
    await expectCloseRejectedAndReleased(sessionId);
  },
);

it.skipIf(process.platform !== "linux")(
  "refuses detach when the inferior stderr is not routed to the selected TTY",
  async () => {
    const sessionId = await startFakeInferiorSession({
      stderrPath: "/dev/null",
    });
    await expectCloseRejectedAndReleased(sessionId);
  },
);

it.skipIf(process.platform !== "linux")(
  "retains ownership when the ptrace PID has no proc identity",
  async () => {
    const sessionId = await startFakeInferiorSession({
      launchTarget: false,
      initialRows: '[{"raised":true,"fd":3,"uri":"ptrace://999999999"}]',
      startupWatchdogMs: 2_000,
    });
    await expectCloseRejectedAndReleased(sessionId);
  },
  4_000,
);

it("rejects changed or missing Rizin inferior identity during detach", () => {
  expect(() => assertRizinProcessStartTimeStable("11", "12")).toThrow(
    "disappeared or was reused",
  );
  expect(() => assertRizinProcessStartTimeStable("11", "11")).not.toThrow();
  expect(() => assertRizinProcessStartTimeStable("11", null)).toThrow(
    "disappeared or was reused",
  );
});

it("truncates UTF-8 strings by byte limit preserving multi-byte code point boundaries", () => {
  expect(truncateUtf8("", 10)).toBe("");
  expect(truncateUtf8("hello", 0)).toBe("");
  expect(truncateUtf8("hello", -1)).toBe("");
  expect(truncateUtf8("hello", 3)).toBe("hel");
  expect(truncateUtf8("hello", 10)).toBe("hello");

  // Multibyte 3-byte CJK character (0xe6 0x96 0x87)
  // 5 bytes allows only 1 character (3 bytes); the second character would need 6 bytes
  expect(truncateUtf8("中文", 5)).toBe("中");
  expect(truncateUtf8("中文", 6)).toBe("中文");

  // 4-byte emoji (🚀 = 0xf0 0x9f 0x9a 0x80)
  expect(truncateUtf8("🚀🚀", 3)).toBe("");
  expect(truncateUtf8("🚀🚀", 4)).toBe("🚀");
  expect(truncateUtf8("🚀🚀", 7)).toBe("🚀");
  expect(truncateUtf8("🚀🚀", 8)).toBe("🚀🚀");
});

it.skipIf(process.platform !== "linux")(
  "retains ownership when cleanup cannot read Rizin stdin",
  async () => {
    const injected = createInjectedProcess({ stdin: "null" });
    manager = new RizinDebugSessionManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      {
        spawnProcess: injected.spawnProcess,
        stopProcess: async (session) => {
          try {
            await session.detachInferior?.();
          } catch {
            // This fixture verifies the manager's fail-closed read path only.
          }
          return { status: "incomplete", reason: "unreachable" };
        },
      },
    );
    const started = await manager.start({
      path: "/tmp/fake-target",
      inferior_tty: await rizinTestInferiorTty(),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect((await manager.close(started.value.session_id)).ok).toBe(false);
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  },
);

it.skipIf(process.platform !== "linux")(
  "retains ownership when an internal Rizin frame is truncated",
  async () => {
    const sessionId = await startFakeInferiorSession({
      truncateCleanupFrame: true,
      maxCommandOutputBytes: 1_024,
    });
    expect((await manager!.close(sessionId)).ok).toBe(false);
    expect(manager!.status(sessionId)?.state).toBe("closed");
    await expect(manager!.closeAll()).rejects.toThrow("did not stop cleanly");
  },
);

it.skipIf(process.platform !== "linux")(
  "retains a verified active inferior after public command output truncation makes protocol state ambiguous",
  async () => {
    const sessionId = await startFakeInferiorSession({
      overflowPxCommand: true,
      withholdCleanupSynchronization: true,
      maxCommandOutputBytes: 1_024,
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      manager!.execute(sessionId, "px"),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("detach watchdog expired")),
          3_000,
        );
      }),
    ])
      .catch(async (error: unknown) => {
        if (providerPid !== undefined) {
          try {
            process.kill(providerPid, "SIGKILL");
          } catch {
            // The watchdog may race with provider exit.
          }
        }
        // The mutated path can leave commandTail permanently held. Prevent cleanup
        // from awaiting that same tail; afterEach still kills both child processes.
        manager = undefined;
        throw error;
      })
      .finally(() => {
        if (watchdog !== undefined) clearTimeout(watchdog);
      });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;
    expect(completed.error.cleanupIncomplete).toBe(true);
    expect(completed.error.cleanupResources).toEqual([sessionId]);
    const evidence = evidenceSchema.parse(completed.error.partialObservation);
    expect(evidence.normalized_result).toMatchObject({
      output_truncated: true,
    });
    expect(evidence.limitations.join(" ")).toContain(
      "The owned debugger session remains retained because cleanup could not be verified",
    );
    expect(manager!.status(sessionId)?.state).toBe("closed");
  },
);

it.skipIf(
  process.platform !== "linux" ||
    rizinBinary === undefined ||
    !rizinAvailable(rizinBinary),
)(
  "routes the inferior to the selected TTY and verifies detach with Rizin 0.7.4 protocol",
  async () => {
    let terminalOutput = "";
    terminal = spawn("sh", ["-c", "tty; exec sleep 60"], {
      name: "xterm",
      cols: 80,
      rows: 24,
      encoding: "utf8",
    });
    const ttyPath = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("TTY path not printed")),
        2_000,
      );
      terminal!.onData((data) => {
        terminalOutput += data;
        const match = /\/dev\/pts\/\d+/u.exec(terminalOutput);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    const tty = await realpath(ttyPath);
    testDirectory = await mkdtemp(join(tmpdir(), "rea-rizin-tty-"));
    const wrapper = join(testDirectory, "rizin-with-long-lived-inferior.sh");
    const pidPath = join(testDirectory, "target.pid");
    const releasePath = join(testDirectory, "emit-output");
    const target = join(testDirectory, "target.py");
    await writeFile(
      target,
      `import os, sys, time\nopen(${JSON.stringify(pidPath)}, "w").write(str(os.getpid()))\nwhile not os.path.exists(${JSON.stringify(releasePath)}): time.sleep(0.02)\nprint("REA_RIZIN_STDOUT_MARKER", flush=True)\nprint("REA_RIZIN_STDERR_MARKER", file=sys.stderr, flush=True)\ntime.sleep(60)\n`,
    );
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec ${shellQuote(rizinBinary!)} -R arg1=${target} "$@"\n`,
    );
    await chmod(wrapper, 0o700);
    manager = new RizinDebugSessionManager({ REA_RIZIN_COMMAND: wrapper });
    const started = await manager.start({
      path: "/usr/bin/python3",
      inferior_tty: tty,
    });
    expect(started.ok, started.ok ? "" : started.error.message).toBe(true);
    if (!started.ok) return;
    const closing = manager.close(started.value.session_id);
    expect((await manager.execute(started.value.session_id, "dr")).ok).toBe(
      false,
    );
    const closed = await closing;
    expect(closed.ok, closed.ok ? "" : closed.error.message).toBe(true);
    const deadline = Date.now() + 5_000;
    let pidText = "";
    while (Date.now() < deadline) {
      try {
        pidText = await readFile(pidPath, "utf8");
        break;
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
    }
    inferiorPid = Number(pidText);
    expect(Number.isSafeInteger(inferiorPid) && inferiorPid > 0).toBe(true);
    expect(() => process.kill(inferiorPid!, 0)).not.toThrow();
    await writeFile(releasePath, "release after close");
    const outputDeadline = Date.now() + 3_000;
    while (
      Date.now() < outputDeadline &&
      (!terminalOutput.includes("REA_RIZIN_STDOUT_MARKER") ||
        !terminalOutput.includes("REA_RIZIN_STDERR_MARKER"))
    )
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    expect(terminalOutput).toContain("REA_RIZIN_STDOUT_MARKER");
    expect(terminalOutput).toContain("REA_RIZIN_STDERR_MARKER");
    expect(() => process.kill(inferiorPid!, 0)).not.toThrow();
  },
);

function findRizinBinary(): string | undefined {
  try {
    return execFileSync("which", ["rizin"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function rizinAvailable(binary: string): boolean {
  try {
    return execFileSync(binary, ["-v"], { encoding: "utf8" }).includes("0.7.4");
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function startFakeInferiorSession(
  options: {
    readonly launchTarget?: boolean;
    readonly initialRows?: string;
    readonly afterDetach?: (pid: number) => string;
    readonly exitKills?: string;
    readonly stderrPath?: string;
    readonly truncateOlj?: boolean;
    readonly truncateCleanupFrame?: boolean;
    readonly overflowPxCommand?: boolean;
    readonly withholdCleanupSynchronization?: boolean;
    readonly startupWatchdogMs?: number;
    readonly maxCommandOutputBytes?: number;
  } = {},
): Promise<string> {
  const tty = await realpath(await rizinTestInferiorTty());
  testDirectory = await mkdtemp(join(tmpdir(), "rea-rizin-protocol-"));
  const targetPath = join(testDirectory, "inferior.mjs");
  const pidPath = join(testDirectory, "target.pid");
  const provider = join(testDirectory, "fake-rizin.cjs");
  const launchTarget = options.launchTarget ?? true;
  await writeFile(targetPath, "setInterval(() => {}, 1000);\n");
  const initialRows = options.initialRows ?? null;
  const afterDetach = options.afterDetach ?? (() => "[]");
  const stderrPath = options.stderrPath ?? tty;
  await writeFile(
    provider,
    `#!/usr/bin/env node
const fs = require("node:fs");
const { spawn } = require("node:child_process");
process.stdout.write("\\0");
${launchTarget ? `const ttyFlags = fs.constants.O_WRONLY | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK; const stdoutFd = fs.openSync(${JSON.stringify(tty)}, ttyFlags); const stderrFd = fs.openSync(${JSON.stringify(stderrPath)}, ttyFlags); const target = spawn(process.execPath, [${JSON.stringify(targetPath)}], { detached: true, stdio: ["ignore", stdoutFd, stderrFd] }); fs.closeSync(stdoutFd); fs.closeSync(stderrFd); target.unref(); const inferiorPid = target.pid; fs.writeFileSync(${JSON.stringify(pidPath)}, String(inferiorPid));` : "const inferiorPid = 999999999;"}
const initialRows = ${JSON.stringify(initialRows)} ?? JSON.stringify([{ raised: true, fd: 3, uri: "ptrace://" + inferiorPid }]);
const afterDetach = ${JSON.stringify(afterDetach(inferiorPid ?? 999999999))};
const exitKills = ${JSON.stringify(options.exitKills ?? "false")};
const truncateOlj = ${JSON.stringify(options.truncateOlj ?? false)};
const truncateCleanupFrame = ${JSON.stringify(options.truncateCleanupFrame ?? false)};
const overflowPxCommand = ${JSON.stringify(options.overflowPxCommand ?? false)};
const withholdCleanupSynchronization = ${JSON.stringify(options.withholdCleanupSynchronization ?? false)};
let oljCalls = 0;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\\n");
    if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (line === "olj") {
      oljCalls += 1;
      if (truncateOlj && oljCalls === 1) process.stdout.write("x".repeat(16 * 1024 * 1024 + 1) + "\\0");
      else process.stdout.write((oljCalls === 1 ? initialRows : oljCalls === 2 ? afterDetach : "[]") + "\\0");
    }
    else if (overflowPxCommand && line === "px") process.stdout.write("x".repeat(2_048) + "\\0");
    else if (line === "e dbg.exitkills") process.stdout.write(exitKills + "\\0");
    else if (withholdCleanupSynchronization && line.startsWith("!echo __REA_CLEANUP_SYNC_")) {}
    else if (line.startsWith("!echo ")) process.stdout.write((truncateCleanupFrame ? "x".repeat(2_048) : "") + line.slice(6) + "\\0");
  }
});
`,
  );
  await chmod(provider, 0o700);
  let providerStderr = "";
  manager = new RizinDebugSessionManager(
    { ...process.env, REA_RIZIN_COMMAND: provider },
    {
      spawnProcess: async (spawnOptions) => {
        const launched = await spawnOwnedProviderProcess(spawnOptions);
        providerPid = launched.process.pid;
        if (options.startupWatchdogMs !== undefined) {
          const watchdog = spawnChild(
            process.execPath,
            [
              "-e",
              `const fs = require("node:fs"); const provider = Number(process.argv[1]); const directory = process.argv[2]; const targetFile = process.argv[3]; const delay = Number(process.argv[4]); setTimeout(() => { let target; try { target = Number(fs.readFileSync(targetFile, "utf8")); } catch {} for (const pid of [provider, target]) { if (!Number.isSafeInteger(pid) || pid <= 0) continue; try { const commandLine = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8"); if (commandLine.includes(directory)) process.kill(pid, "SIGKILL"); } catch {} } }, delay);`,
              String(launched.process.pid),
              testDirectory!,
              join(testDirectory!, "target.pid"),
              String(options.startupWatchdogMs),
            ],
            { detached: true, stdio: "ignore" },
          );
          providerWatchdogPid = watchdog.pid;
          watchdog.unref();
        }
        launched.process.stderr?.on("data", (chunk) => {
          providerStderr += Buffer.from(chunk).toString("utf8");
        });
        return launched;
      },
      ...(options.maxCommandOutputBytes === undefined
        ? {}
        : { maxCommandOutputBytes: options.maxCommandOutputBytes }),
    },
  );
  const started = await manager.start({
    path: "/tmp/fake-target",
    inferior_tty: tty,
  });
  expect(
    started.ok,
    started.ok ? "" : `${started.error.message} ${providerStderr}`,
  ).toBe(true);
  if (!started.ok) throw started.error;
  if (launchTarget) {
    let pidText: string | undefined;
    const deadline = Date.now() + 2_000;
    while (pidText === undefined && Date.now() < deadline) {
      try {
        pidText = await readFile(pidPath, "utf8");
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    const parsedInferiorPid =
      pidText === undefined ? Number.NaN : Number(pidText);
    if (!Number.isSafeInteger(parsedInferiorPid) || parsedInferiorPid <= 0)
      throw new Error("The test inferior did not publish a valid PID.");
    inferiorPid = parsedInferiorPid;
  }
  return started.value.session_id;
}

async function expectCloseRejectedAndReleased(
  sessionId: string,
): Promise<void> {
  expect((await manager!.close(sessionId)).ok).toBe(false);
  expect(manager!.status(sessionId)?.state).toBe("closed");
  await manager!.closeAll();
  expect(manager!.status(sessionId)).toBeUndefined();
}
