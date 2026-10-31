import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ok } from "../../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { HopperFixtureLauncher } from "./hopperClient.fixture.js";

class ObservedProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }

  kill(): boolean {
    this.exit(0);
    return true;
  }
}

class LifecycleLauncher implements BridgeLauncher {
  readonly fixture = new HopperFixtureLauncher();
  observed = new ObservedProcess();

  constructor(readonly owned: boolean) {}

  async launch(session: BridgeSession) {
    this.observed = new ObservedProcess();
    await this.fixture.launch(session);
    return ok({
      process: this.observed,
      ownsProcessLifetime: true as const,
      providerLifetime: this.owned
        ? ("launcher-process" as const)
        : ("external-application" as const),
      shutdownMode: "bridge-request" as const,
    });
  }
}

const start = async (owned: boolean) => {
  const launcher = new LifecycleLauncher(owned);
  const client = new HopperClient({ launcher, startupTimeoutMs: 10_000 });
  onTestFinished(async () => {
    await client.close();
    for (const child of launcher.fixture.processes) child.kill();
  }, 45_000);
  expect((await client.start()).ok).toBe(true);
  return { client, launcher };
};

it("reports launch work until the first authenticated handshake completes", async () => {
  const fixture = new HopperFixtureLauncher(undefined, "quiet", "gated");
  let enterLaunch: (() => void) | undefined;
  let releaseLaunch: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enterLaunch = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  const client = new HopperClient({
    startupTimeoutMs: 10_000,
    launcher: {
      async launch(session) {
        enterLaunch?.();
        await release;
        return fixture.launch(session);
      },
    },
  });
  onTestFinished(async () => {
    releaseLaunch?.();
    await client.close();
  });
  const starting = client.callTool("current_document");
  await entered;
  expect(client.requestActivity()).toBeNull();
  expect(client.operationHealth()).toMatchObject({
    state: "busy",
    stage: "launch",
    retryAction: "wait",
  });
  releaseLaunch?.();
  const handshake = await fixture.waitForRequest("health");
  expect(client.operationHealth()).toMatchObject({
    state: "busy",
    stage: "launch",
    retryAction: "wait",
  });
  await fixture.release(handshake);
  const result = await starting;
  if (!result.ok) throw result.error;
  expect(result.value).toBe("fixture");
  expect(client.operationHealth()).toMatchObject({
    state: "idle",
    stage: null,
  });
});

describe("Hopper provider lifecycle health", () => {
  it("settles disconnected requests without attributing the helper exit to the GUI", async () => {
    const { client, launcher } = await start(false);
    launcher.observed.exit(0);
    const pending = client.callTool("hang");
    await launcher.fixture.waitForRequest("hang");
    launcher.fixture.processes.at(-1)?.send({ disconnect: true });
    await vi.waitFor(() =>
      expect(client.operationHealth().state).toBe("unreachable"),
    );
    expect(await pending).toMatchObject({
      ok: false,
      error: {
        providerState: "unreachable",
        exitCode: null,
        operation: "hang",
      },
    });
    expect(client.operationHealth()).toMatchObject({
      state: "unreachable",
      exitCode: null,
    });
    expect(
      await client.callTool("procedure_pseudo_code", { procedure: "main" }),
    ).toMatchObject({
      ok: false,
      error: {
        providerState: "unreachable",
        stage: "decompilation",
        operation: "procedure_pseudo_code",
      },
    });
    expect((await client.close()).ok).toBe(true);
  });

  it("projects the exit code when the owned process exit is observed before disconnection", async () => {
    const { client, launcher } = await start(true);
    const pending = client.callTool("hang");
    const request = await launcher.fixture.waitForRequest("hang");
    launcher.observed.exit(7);
    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "HopperProcessError",
        exitCode: 7,
        providerState: "exited",
        requestId: request.id,
      },
    });
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        message: expect.stringContaining(
          "Hopper exited during hang (exit code 7)",
        ),
        details: {
          provider_state: "exited",
          exit_code: 7,
          stage: "analysis",
          operation: "hang",
          request_id: request.id,
          launcher: { exit_code: 7, signal: null, output_closed: false },
        },
      });
  });

  it("retains an observed exit when an earlier successful reply resumes afterward", async () => {
    const { client, launcher } = await start(true);
    const first = client.callTool("echo", { gate: "before-exit" });
    const request = await launcher.fixture.waitForRequest(
      "echo",
      "before-exit",
    );
    const controller = new AbortController();
    const second = client.callTool(
      "hang",
      {},
      {
        signal: controller.signal,
        progress: {
          report: (update) => {
            if (update.message === "hang started on Hopper's serial bridge") {
              controller.abort();
              launcher.observed.exit(7);
            }
            return Promise.resolve();
          },
        },
      },
    );
    await vi.waitFor(() =>
      expect(client.requestActivity()?.queuedRequests).toBe(1),
    );
    await launcher.fixture.release(request);
    expect((await first).ok).toBe(true);
    expect(await second).toMatchObject({
      ok: false,
      error: { _tag: "HopperCancelledError" },
    });
    expect(client.operationHealth()).toMatchObject({
      state: "exited",
      exitCode: 7,
    });
    await client.close();
    expect((await client.start()).ok).toBe(true);
    expect(client.operationHealth().state).toBe("idle");
  });
});

it("preserves an owned signal exit and diagnostics for active, queued and later callers", async () => {
  const { client, launcher } = await start(true);
  const active = client.callTool("hang");
  const request = await launcher.fixture.waitForRequest("hang");
  const queued = client.callTool("echo");
  await vi.waitFor(() =>
    expect(client.requestActivity()?.queuedRequests).toBe(1),
  );
  const token = launcher.fixture.tokens[0];
  launcher.observed.stderr.write(`API_KEY=local-evidence-kept ${token}\n`);
  launcher.observed.exit(null, "SIGTERM");
  const results = await Promise.all([active, queued]);
  for (const [index, result] of results.entries()) {
    if (result.ok) throw new Error("Expected an observed provider exit");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "provider_unavailable",
      message: expect.stringContaining("signal SIGTERM"),
      details: {
        provider_state: "exited",
        operation: index === 0 ? "hang" : "echo",
        request_id: request.id + index,
        launcher: {
          exit_code: null,
          signal: "SIGTERM",
          output_closed: false,
          stderr: {
            text: "API_KEY=local-evidence-kept [redacted transport credential]\n",
          },
        },
      },
    });
    expect(JSON.stringify(projected)).not.toContain(token);
  }
  const later = await client.callTool("procedure_pseudo_code", {
    procedure: "main",
  });
  if (later.ok) throw new Error("An exited provider must reject later queries");
  expect(projectAnalysisError(later.error)).toMatchObject({
    code: "provider_unavailable",
    details: {
      provider_state: "exited",
      stage: "decompilation",
      operation: "procedure_pseudo_code",
      launcher: { signal: "SIGTERM", output_closed: true },
    },
  });
});
