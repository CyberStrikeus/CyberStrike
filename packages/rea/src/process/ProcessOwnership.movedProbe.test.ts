// Regression for a child moving groups during the production probe cleanup.
import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const originalPlatform = vi.hoisted(() => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
  });
  return descriptor;
});
const state = vi.hoisted(() => ({
  readFile: vi.fn(),
  spawn: vi.fn(),
  ps: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  readFile: state.readFile,
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: state.spawn,
}));
vi.mock("./ExecFileOutput.js", () => ({ execFileOutput: state.ps }));

import { runLinuxPrivateDisplayProbe } from "../hopper/LinuxPrivateDisplayProbe.js";
import { cleanupOwnedProcessGroup } from "./ProcessOwnership.js";
import { systemProcessOwnershipHost } from "./ProcessOwnershipObservation.js";

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", originalPlatform);
});

it("runs the production private-display timeout cleanup through the Linux host", async () => {
  expect(systemProcessOwnershipHost.platform).toBe("linux");
  const signals: number[] = [];
  let token = "";
  let moved = false;
  let rootLive = true;
  let childLive = true;
  const helper = Object.assign(new EventEmitter(), {
    pid: 100,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    unref: vi.fn(),
  });
  state.spawn.mockImplementation((_command, _arguments, options) => {
    token = options.env.REA_PROCESS_RUN_ID;
    queueMicrotask(() => helper.emit("spawn"));
    return helper;
  });
  const rows = () => [
    `${process.pid} ${process.ppid} ${process.pid} 1000 S verifier`,
    ...(rootLive
      ? [`100 ${process.pid} 100 1000 S /usr/bin/python3 helper.py`]
      : []),
    ...(childLive
      ? [`101 ${rootLive ? 100 : 1} ${moved ? 101 : 100} 1000 S Xvfb`]
      : []),
  ];
  state.ps.mockImplementation(async (command) => {
    expect(command).toBe("ps");
    return { stdout: rows().join("\n"), stderr: "" };
  });
  state.readFile.mockImplementation(async (path) => {
    const match = /^\/proc\/(\d+)\/(stat|environ)$/u.exec(String(path));
    if (match === null) throw new Error(`Unexpected read: ${String(path)}`);
    const pid = Number(match[1]);
    if ((pid === 100 && !rootLive) || (pid === 101 && !childLive))
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    if (match[2] === "environ") {
      // A same-generation child moves after the native relation snapshot,
      // during the identity/token/identity bracket used by the real host.
      if (pid === 101) moved = true;
      return pid === process.pid
        ? "FOREIGN=value\0"
        : `REA_PROCESS_RUN_ID=${token}\0`;
    }
    const parent =
      pid === 100
        ? process.pid
        : pid === 101
          ? rootLive
            ? 100
            : 1
          : process.ppid;
    const group =
      pid === 101 ? (moved ? 101 : 100) : pid === 100 ? 100 : process.pid;
    const fields = ["S", String(parent), String(group), "100", "0", "0", "0"];
    while (fields.length < 19) fields.push("0");
    fields.push(String(pid * 10));
    return `${pid} (fixture) ${fields.join(" ")}`;
  });
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (
      signal === 0 &&
      ((pid === 100 && !rootLive) || (pid === 101 && !childLive))
    )
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    if (pid >= 0 || signal !== "SIGKILL")
      throw new Error(`Unexpected signal ${pid}`);
    signals.push(-pid);
    if (pid === -100) {
      rootLive = false;
      if (!moved) childLive = false;
      helper.signalCode = "SIGKILL";
      helper.stdout.end();
      helper.stderr.end();
      helper.emit("exit", null, "SIGKILL");
      helper.emit("close", null, "SIGKILL");
    } else if (pid === -101) childLive = false;
    return true;
  });
  const result = await runLinuxPrivateDisplayProbe("direct", {
    helperPath: "scripts/hopper-demo-x11.py",
    timeoutMs: 1,
    environment: {},
  });
  expect(result).toMatchObject({
    outcome: "timed-out",
    cleanup: { status: "pending" },
  });
  expect(signals).toEqual([]);
  expect(childLive).toBe(true);
  expect(moved).toBe(true);
  // The launcher may exit while cleanup is pending. Retry the same lease,
  // which must retain the moved child instead of treating the empty root as released.
  rootLive = false;
  helper.signalCode = "SIGKILL";
  helper.stdout.end();
  helper.stderr.end();
  helper.emit("exit", null, "SIGKILL");
  helper.emit("close", null, "SIGKILL");
  if (result.cleanup.status !== "pending")
    throw new Error("expected pending cleanup");
  await result.cleanup.lease.release();
  expect(signals).toEqual([101]);
  expect(childLive).toBe(false);

  // The same safety applies to callers which use the optional implicit owner.
  rootLive = true;
  childLive = true;
  moved = false;
  signals.length = 0;
  const implicitOwner = {
    runId: token,
    leaderPid: 100,
    processGroupId: 100,
  };
  expect((await cleanupOwnedProcessGroup(implicitOwner)).cleaned).toBe(false);
  rootLive = false;
  expect((await cleanupOwnedProcessGroup(implicitOwner)).cleaned).toBe(true);
  expect(signals).toEqual([101]);
  expect(childLive).toBe(false);
});
