import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import type { HopperStartupDiagnostic } from "../../../../src/domain/hopperStartupFailure.js";
import { ok } from "../../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX } from "../../../../src/hopper/LinuxPrivateDisplayDiagnostic.js";

import { HopperFixtureLauncher as FixtureLauncher } from "./hopperClient.fixture.js";

class SilentLauncher implements BridgeLauncher {
  launch() {
    return Promise.resolve(
      ok({
        process: spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          {
            stdio: ["ignore", "ignore", "pipe"],
          },
        ),
        ownsProcessLifetime: true as const,
        providerLifetime: "launcher-process" as const,
        shutdownMode: "bridge-request" as const,
      }),
    );
  }
}

class CancelThenFixtureLauncher implements BridgeLauncher {
  #launches = 0;
  #firstLaunchReady: ((process: ChildProcess) => void) | undefined;
  readonly firstLaunch = new Promise<ChildProcess>((resolve) => {
    this.#firstLaunchReady = resolve;
  });
  retriedProcess: ChildProcess | undefined;

  async launch(session: BridgeSession) {
    this.#launches += 1;
    const launched = await (this.#launches === 1
      ? new SilentLauncher().launch()
      : new FixtureLauncher().launch(session));
    if (this.#launches === 1 && launched.ok)
      this.#firstLaunchReady?.(launched.value.process);
    else if (launched.ok) this.retriedProcess = launched.value.process;
    return launched;
  }
}

class ExitingLauncher implements BridgeLauncher {
  constructor(readonly code: number) {}

  launch() {
    return Promise.resolve(
      ok({
        process: spawn(process.execPath, ["-e", `process.exit(${this.code})`], {
          stdio: ["ignore", "ignore", "pipe"],
        }),
        ownsProcessLifetime: true as const,
        providerLifetime: "launcher-process" as const,
        shutdownMode: "bridge-request" as const,
      }),
    );
  }
}

class DiagnosticExitingLauncher implements BridgeLauncher {
  launch() {
    const diagnostic: HopperStartupDiagnostic = {
      component: "hopper_private_display",
      operation: "launch",
      status: "error",
      failure_code: "x11_socket_directory_unusable",
      reason: "socket_directory_read_only",
      socket_directory: "/tmp/.X11-unix",
      socket_directory_mode: "0777",
      mount_read_only: true,
      effective_socket_directory_mode: "0777",
      effective_mount_read_only: true,
      wsl: true,
      strategy: "direct",
      fallback_reason: null,
      xvfb_stderr_bytes: 100,
    };
    const line = `${LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX}${JSON.stringify(diagnostic)}\n`;
    return Promise.resolve(
      ok({
        process: spawn(
          process.execPath,
          [
            "-e",
            `process.stderr.write(${JSON.stringify(line)}, () => process.exit(80))`,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        ),
        ownsProcessLifetime: true as const,
        providerLifetime: "launcher-process" as const,
        shutdownMode: "bridge-request" as const,
      }),
    );
  }
}

class LateSilentLauncher implements BridgeLauncher {
  readonly directories: string[] = [];
  readonly processes: ChildProcess[] = [];

  async launch(session: BridgeSession) {
    this.directories.push(session.directory);
    const launched = await new SilentLauncher().launch();
    if (launched.ok) this.processes.push(launched.value.process);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return launched;
  }
}

/**
 * Bridge fixture whose health handshake returns an invalid payload, so
 * parseHopperServerInfo rejects it with HopperProtocolError.
 * Note: assumes the client's first bridge request is `health`; any
 * auth/preamble request added before it would hit the -32601 branch.
 */
class BadHealthLauncher implements BridgeLauncher {
  #server: Server | undefined;
  #process: ChildProcess | undefined;

  async launch(session: BridgeSession) {
    const server = createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const request = JSON.parse(line) as {
              id: number;
              method: string;
            };
            if (request.method === "health") {
              socket.write(
                `${JSON.stringify({ id: request.id, result: { bogus: true } })}\n`,
              );
            } else {
              socket.write(
                `${JSON.stringify({
                  id: request.id,
                  error: { code: -32601, message: "unknown method" },
                })}\n`,
              );
            }
          } catch {
            // Ignore malformed input; the client only sends NDJSON.
          }
          newline = buffer.indexOf("\n");
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(session.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.#server = server;
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        stdio: "ignore",
      },
    );
    this.#process = child;
    return ok({
      process: child,
      ownsProcessLifetime: true as const,
      providerLifetime: "launcher-process" as const,
      shutdownMode: "process-cleanup" as const,
      cleanup: async () => {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return { cleaned: true as const, signaled: true };
      },
    });
  }
}

const clients: HopperClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
}, 45_000);

describe("HopperClient startup deadline", () => {
  it("applies one deadline to launcher, socket, and health startup phases", async () => {
    const launcher = new LateSilentLauncher();
    const client = new HopperClient({ launcher, startupTimeoutMs: 500 });
    clients.push(client);

    const result = await client.start();

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "HopperTimeoutError", timeoutMs: 500 },
    });
    expect(client.operationHealth()).toMatchObject({
      state: "not_started",
      stage: "launch",
      retryAction: "retry",
      exitCode: null,
    });
    if (!result.ok)
      expect(projectAnalysisError(result.error).details).toMatchObject({
        stage: "startup",
      });
    expect(launcher.directories).toHaveLength(1);
    await expect(access(launcher.directories[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const process = launcher.processes[0];
    expect(
      process !== undefined &&
        (process.exitCode !== null || process.signalCode !== null),
    ).toBe(true);
  });
});

describe("HopperClient startup failures", () => {
  it("cancels bridge startup without waiting for the startup timeout", async () => {
    const launcher = new CancelThenFixtureLauncher();
    const client = new HopperClient({
      launcher,
      // Keep the retry proof independent from scheduler pressure when the
      // complete boundary project is starting several child-process fixtures.
      startupTimeoutMs: 30_000,
    });
    clients.push(client);
    const controller = new AbortController();
    const pending = client.callTool("echo", {}, { signal: controller.signal });
    // Cancel after launch: a timer can fire during runtime-directory creation,
    // leaving the silent first launch to be consumed by the retry instead.
    const firstProcess = await launcher.firstLaunch;
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("HopperCancelledError");
    expect(
      firstProcess.exitCode !== null || firstProcess.signalCode !== null,
    ).toBe(true);
    const restarted = await client.start();
    const retriedProcess = launcher.retriedProcess;
    expect(retriedProcess).toBeDefined();
    expect(retriedProcess).not.toBe(firstProcess);
    expect(restarted).toEqual({
      ok: true,
      value: {
        name: "REA Hopper bridge",
        version: "1.0.0",
        processId: retriedProcess?.pid,
        maxRequestBytes: 16 * 1024 * 1024,
      },
    });
    await expect(
      client.callTool("echo", { value: "retried" }),
    ).resolves.toEqual({
      ok: true,
      value: { value: "retried" },
    });
  });

  it("retries after cancellation before the launcher starts", async () => {
    const launcher = new FixtureLauncher();
    const client = new HopperClient({ launcher, startupTimeoutMs: 30_000 });
    clients.push(client);
    const controller = new AbortController();

    const pending = client.callTool("echo", {}, { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperCancelledError" },
    });
    expect(launcher.processes).toHaveLength(0);
    const started = await client.start();
    expect(launcher.processes).toHaveLength(1);
    expect(started).toEqual({
      ok: true,
      value: {
        name: "REA Hopper bridge",
        version: "1.0.0",
        processId: launcher.processes[0]?.pid,
        maxRequestBytes: 16 * 1024 * 1024,
      },
    });
    await expect(
      client.callTool("echo", { value: "retried" }),
    ).resolves.toEqual({
      ok: true,
      value: { value: "retried" },
    });
  });

  it("records unknown when the health handshake is invalid", async () => {
    const launcher = new BadHealthLauncher();
    const client = new HopperClient({ launcher, startupTimeoutMs: 30_000 });
    clients.push(client);

    const result = await client.start();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("HopperProtocolError");
    // parseHopperServerInfo failures were never recorded, so operationHealth()
    // reported idle and the fast path kept a client whose next start stays
    // blocked by retained resources.
    expect(client.operationHealth()).toMatchObject({ state: "unknown" });
  });

  it.each([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82])(
    "reports Linux adapter exit %i during bridge startup",
    async (exitCode) => {
      const client = new HopperClient({
        launcher: new ExitingLauncher(exitCode),
        startupTimeoutMs: 10_000,
      });
      clients.push(client);
      const result = await client.start();
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatchObject({
          _tag: "HopperProcessError",
          exitCode,
        });
    },
  );

  it("projects actionable CI remediation for Hopper UI, license, and lifecycle failures", async () => {
    const client = new HopperClient({
      launcher: new ExitingLauncher(75),
      startupTimeoutMs: 10_000,
    });
    clients.push(client);
    const result = await client.start();
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const projected = projectAnalysisError(result.error);
    expect(projected.message).toContain("rea doctor --provider hopper --json");
    expect(projected.message).toContain("UI or license prompt");
    expect(projected.message).toContain("close stale Hopper sessions");
    expect(projected.details).toMatchObject({
      failure_code: "hopper_exited_during_startup",
      exit_code: 75,
    });
  });

  it("preserves the private-display diagnostic from an adapter exit", async () => {
    const client = new HopperClient({
      launcher: new DiagnosticExitingLauncher(),
      startupTimeoutMs: 10_000,
    });
    clients.push(client);
    const result = await client.start();
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "HopperProcessError",
        exitCode: 80,
        failureCode: "x11_socket_directory_unusable",
        diagnostic: {
          socket_directory: "/tmp/.X11-unix",
          socket_directory_mode: "0777",
          mount_read_only: true,
          wsl: true,
          strategy: "direct",
        },
      },
    });
  });
});
