import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { expect, it, onTestFinished, vi } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ok } from "../../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { HopperFixtureLauncher } from "./hopperClient.fixture.js";

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await exited;
};

// The GUI is a sibling owned by the test, never a descendant owned by REA's helper.
class ExternalBridgeLauncher implements BridgeLauncher {
  readonly fixture: HopperFixtureLauncher;
  readonly sessions: BridgeSession[] = [];
  readonly helpers: ChildProcess[] = [];

  constructor(
    readonly identity: "matching" | "wrong-run" | "wrong-token" = "matching",
    healthMode: "ready" | "gated" = "ready",
    shutdownMode: "acknowledge" | "exit-without-ack" = "acknowledge",
  ) {
    this.fixture = new HopperFixtureLauncher(
      identity === "wrong-token" ? "foreign-token" : undefined,
      "quiet",
      healthMode,
      shutdownMode,
    );
  }

  async launch(session: BridgeSession) {
    this.sessions.push(session);
    await this.fixture.launch({
      ...session,
      runId: this.identity === "wrong-run" ? "foreign-run" : session.runId,
    });
    const helper = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    this.helpers.push(helper);
    return ok({
      process: helper,
      ownsProcessLifetime: false as const,
      providerLifetime: "external-application" as const,
      shutdownMode: "bridge-request" as const,
    });
  }
}

const setup = (
  identity?: "matching" | "wrong-run" | "wrong-token",
  healthMode?: "ready" | "gated",
  shutdownMode?: "acknowledge" | "exit-without-ack",
) => {
  const launcher = new ExternalBridgeLauncher(
    identity,
    healthMode,
    shutdownMode,
  );
  const client = new HopperClient({ launcher, startupTimeoutMs: 2_000 });
  onTestFinished(async () => {
    await client.close();
    await Promise.all(
      [...launcher.helpers, ...launcher.fixture.processes].map(stop),
    );
    await Promise.all(
      launcher.sessions.map(({ directory }) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }, 45_000);
  return { client, launcher };
};

it.each(["missing", "not-listening"] as const)(
  "waits for a matching bridge published during close after a %s socket failure",
  async (socketState) => {
    const fixture = new HopperFixtureLauncher();
    let session: BridgeSession | undefined;
    let helper: ChildProcess | undefined;
    const client = new HopperClient({
      startupTimeoutMs: 2_000,
      launcher: {
        launch(value) {
          session = value;
          helper = spawn(process.execPath, ["-e", "process.exit(0)"], {
            stdio: "ignore",
          });
          return Promise.resolve(
            ok({
              process: helper,
              ownsProcessLifetime: false as const,
              providerLifetime: "external-application" as const,
              shutdownMode: "bridge-request" as const,
            }),
          );
        },
      },
    });
    onTestFinished(async () => {
      await Promise.all(
        [...(helper === undefined ? [] : [helper]), ...fixture.processes].map(
          stop,
        ),
      );
      if (session !== undefined)
        await rm(session.directory, { recursive: true, force: true });
    });
    const started = await client.start();
    if (started.ok) throw new Error("Expected readiness to time out");
    expect(projectAnalysisError(started.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { diagnostics: { primary_error: { code: "provider_timeout" } } },
    });
    if (session === undefined) throw new Error("Fixture did not launch");
    if (socketState === "not-listening")
      await promisify(execFile)(process.execPath, [
        "-e",
        'require("node:net").createServer().listen(process.argv[1], () => process.exit(0))',
        session.socketPath,
      ]);
    const closing = client.close();
    // Publish after close has encountered an unavailable endpoint, within its
    // cleanup window rather than before the caller requests cleanup.
    await delay(150);
    await rm(session.socketPath, { force: true });
    await fixture.launch(session);
    const closed = await closing;
    if (!closed.ok) throw closed.error;
    expect(fixture.requests.map(({ method }) => method)).toEqual([
      "health",
      "shutdown_document",
    ]);
    await vi.waitFor(() => expect(fixture.processes[0]?.exitCode).toBe(0));
    await expect(access(session.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["wrong-run", "wrong-token"] as const)(
  "never requests document shutdown after the first handshake rejects %s",
  async (identity) => {
    const { client, launcher } = setup(identity);
    const started = await client.start();
    if (started.ok) throw new Error("Expected a rejected handshake");
    expect(projectAnalysisError(started.error)).toMatchObject({
      code: "cleanup_incomplete",
    });
    await launcher.fixture.waitForRequest("health");
    expect(launcher.fixture.requests.map(({ method }) => method)).toEqual([
      "health",
    ]);
    expect(client.operationHealth()).toMatchObject({
      state: "unknown",
      stage: "launch",
    });
    const closed = await client.close();
    if (closed.ok)
      throw new Error("Expected retained foreign bridge ownership");
    expect(projectAnalysisError(closed.error)).toMatchObject({
      code: "cleanup_incomplete",
    });
    expect(
      launcher.fixture.requests.every(({ method }) => method === "health"),
    ).toBe(true);
    expect(launcher.fixture.processes[0]?.exitCode).toBeNull();
    const session = launcher.sessions[0];
    if (session === undefined) throw new Error("Fixture did not launch");
    await access(session.directory);
  },
);

it("reconnects for authenticated cleanup after a previously valid bridge transport fails", async () => {
  const { client, launcher } = setup();
  const started = await client.start();
  if (!started.ok) throw started.error;
  const malformed = await client.callTool("malformed");
  expect(malformed).toMatchObject({
    ok: false,
    error: { _tag: "HopperProtocolError" },
  });
  const closed = await client.close();
  if (!closed.ok) throw closed.error;
  expect(launcher.fixture.requests.map(({ method }) => method)).toEqual([
    "health",
    "malformed",
    "health",
    "shutdown_document",
  ]);
  await vi.waitFor(() =>
    expect(launcher.fixture.processes[0]?.exitCode).toBe(0),
  );
  const session = launcher.sessions[0];
  if (session === undefined) throw new Error("Fixture did not launch");
  await expect(access(session.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("preserves launcher diagnostics after a health deadline and reauthenticates for cleanup", async () => {
  const { client, launcher } = setup("matching", "gated");
  const starting = client.start();
  const first = await launcher.fixture.waitForRequest("health");
  const started = await starting;
  if (started.ok) throw new Error("Expected a health deadline");
  expect(projectAnalysisError(started.error)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      diagnostics: {
        primary_error: {
          code: "provider_timeout",
          details: {
            timeout_ms: 2_000,
            stage: "startup",
            launcher: { exit_code: 0, output_closed: true },
          },
        },
      },
    },
  });
  expect(client.requestActivity()).toBeNull();
  const closing = client.close();
  const next = await vi.waitFor(() => {
    const request = launcher.fixture.requests.find(
      ({ method, id }) => method === "health" && id !== first.id,
    );
    if (request === undefined)
      throw new Error("Waiting for recovery handshake");
    return request;
  });
  await launcher.fixture.release(next);
  const closed = await closing;
  if (!closed.ok) throw closed.error;
  expect(launcher.fixture.requests.map(({ method }) => method)).toEqual([
    "health",
    "health",
    "shutdown_document",
  ]);
});

it("recovers an application exit after the first valid handshake occurs during cleanup", async () => {
  const { client, launcher } = setup("matching", "gated", "exit-without-ack");
  const starting = client.start();
  const first = await launcher.fixture.waitForRequest("health");
  const started = await starting;
  if (started.ok) throw new Error("Expected the first handshake to time out");
  expect(projectAnalysisError(started.error)).toMatchObject({
    code: "cleanup_incomplete",
    remediation: {
      action: expect.stringContaining("restart the MCP connection"),
    },
    details: {
      diagnostics: {
        primary_error: { code: "provider_timeout" },
        cleanup_error: {
          details: {
            diagnostics: { authenticated_application: "not_observed" },
          },
        },
      },
    },
  });

  const closing = client.close();
  const next = await vi.waitFor(() => {
    const request = launcher.fixture.requests.find(
      ({ method, id }) => method === "health" && id !== first.id,
    );
    if (request === undefined)
      throw new Error("Waiting for cleanup authentication");
    return request;
  });
  await launcher.fixture.release(next);
  const closed = await closing;
  if (!closed.ok) throw closed.error;
  expect(launcher.fixture.requests.map(({ method }) => method)).toEqual([
    "health",
    "health",
    "shutdown_document",
  ]);
  const session = launcher.sessions[0];
  if (session === undefined) throw new Error("Fixture did not launch");
  await expect(access(session.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  const restarted = client.start();
  const health = await vi.waitFor(() => {
    const request = launcher.fixture.requests.find(
      ({ method, id }) => method === "health" && id > next.id,
    );
    if (request === undefined)
      throw new Error("Waiting for restarted authentication");
    return request;
  });
  await launcher.fixture.release(health);
  const ready = await restarted;
  if (!ready.ok) throw ready.error;
  const observed = await client.callTool("current_document");
  if (!observed.ok) throw observed.error;
  expect(observed.value).toBe("fixture");
  const reclosed = await client.close();
  if (!reclosed.ok) throw reclosed.error;
});
