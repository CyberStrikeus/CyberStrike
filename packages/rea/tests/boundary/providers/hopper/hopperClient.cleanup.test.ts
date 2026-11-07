import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ok } from "../../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";

import {
  HopperFixtureLauncher as FixtureLauncher,
  hopperFixturePath as fixturePath,
  startHopperFixtureClient as startClient,
} from "./hopperClient.fixture.js";

class OwnedFixtureLauncher implements BridgeLauncher {
  ownership:
    | {
        readonly runId: string;
        readonly leaderPid: number;
        readonly processGroupId: number;
      }
    | undefined;

  async launch(session: BridgeSession) {
    const started = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [
        fixturePath,
        session.socketPath,
        session.token,
        session.runId,
        "cleanup-required",
      ],
      runId: session.runId,
      expectedCommand: null,
    });
    this.ownership = started.ownership;
    return ok({
      process: started.process,
      ownsProcessLifetime: true as const,
      providerLifetime: "launcher-process" as const,
      ownership: started.ownership,
      shutdownMode: "process-cleanup" as const,
      cleanup: () => cleanupOwnedProcessGroup(started.ownership),
    });
  }
}

const clients: HopperClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
}, 45_000);

describe("HopperClient cleanup", () => {
  it("waits for an operation reply without a fixed request deadline", async () => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const pending = client.callTool("echo", { value: "waited", gate: "reply" });
    const request = await launcher.waitForRequest("echo", "reply");
    expect(client.requestActivity()).toMatchObject({ operation: "echo" });
    await launcher.release(request);
    await expect(pending).resolves.toEqual({
      ok: true,
      value: { value: "waited", gate: "reply" },
    });
  });

  it("makes concurrent close callers await the same shutdown", async () => {
    const client = await startClient();
    let firstSettled = false;
    const first = client.close().then(() => {
      firstSettled = true;
    });
    await client.close();
    expect(firstSettled).toBe(true);
    await first;
  });

  it("exits an IPC-backed fixture cleanly after cancelling active work", async () => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const controller = new AbortController();
    const pending = client.callTool(
      "echo",
      { gate: "cancel-and-close" },
      {
        signal: controller.signal,
      },
    );
    await launcher.waitForRequest("echo", "cancel-and-close");
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperCancelledError" },
    });
    await client.close();
    const child = launcher.processes.at(-1);
    expect({
      exitCode: child?.exitCode,
      signalCode: child?.signalCode,
    }).toEqual({
      exitCode: 0,
      signalCode: null,
    });
  });

  it("kills only its owned Hopper group and emits sanitized shutdown coordinates", async () => {
    const unrelated = spawn(
      process.execPath,
      ["-e", "process.title = 'Hopper'; setInterval(() => undefined, 1000)"],
      { detached: true, stdio: "ignore" },
    );
    await new Promise<void>((resolve, reject) => {
      unrelated.once("spawn", resolve);
      unrelated.once("error", reject);
    });
    const launcher = new OwnedFixtureLauncher();
    const diagnostics: unknown[] = [];
    const runId = "22222222-2222-4222-8222-222222222222";
    const client = new HopperClient({
      launcher,
      runId,
      // Cold Darwin ownership-reader compilation runs inside launcher startup.
      startupTimeoutMs: 10_000,
      onDiagnostic: (event) => diagnostics.push(event),
    });
    clients.push(client);

    try {
      await expect(client.start()).resolves.toMatchObject({ ok: true });
      await client.close();

      const unrelatedPid = unrelated.pid;
      if (unrelatedPid === undefined)
        throw new Error("Unrelated Hopper fixture has no PID");
      expect(() => process.kill(unrelatedPid, 0)).not.toThrow();
      expect(diagnostics).toContainEqual({
        type: "owned-shutdown",
        status: "verified-cleanup",
        launcher_pid: launcher.ownership?.leaderPid,
        process_group_id: launcher.ownership?.processGroupId,
        cleanup_signaled: true,
        reason: null,
      });
      expect(JSON.stringify(diagnostics)).not.toContain(runId);
    } finally {
      await stopUnrelatedFixture(unrelated);
    }
  });

  it("makes sequential double-close release its process runtime", async () => {
    const launcher = new FixtureLauncher();
    const client = new HopperClient({ launcher, startupTimeoutMs: 1_000 });
    clients.push(client);
    await expect(client.start()).resolves.toMatchObject({ ok: true });

    await client.close();
    await client.close();

    const directory = launcher.directories[0] ?? "";
    const child = launcher.processes[0];
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(child).toBeDefined();
    if (child === undefined)
      throw new Error("Fixture process was not captured");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
const stopUnrelatedFixture = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  await exited;
};
