import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Socket } from "node:net";

import { expect, it, onTestFinished } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { HopperStartError } from "../../../../src/domain/hopperErrors.js";
import { err, ok } from "../../../../src/domain/result.js";
import type {
  BridgeLaunch,
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import {
  HopperClient,
  type HopperClientOptions,
} from "../../../../src/hopper/HopperClient.js";
import {
  type HopperOwnedResources,
  cleanupHopperSession,
} from "../../../../src/hopper/HopperCleanup.js";
import { silentLogger } from "../../../../src/logger.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { ProviderProcessSupervisor } from "../../../../src/process/ProviderProcess.js";

class RetryCleanupLauncher implements BridgeLauncher {
  readonly sessions: BridgeSession[] = [];
  readonly processes: ChildProcess[] = [];
  allowCleanup = false;

  constructor(readonly externalDocument = false) {
    onTestFinished(async () => {
      for (const process of this.processes) await stopFixture(process);
      for (const session of this.sessions)
        await rm(session.directory, { recursive: true, force: true });
    });
  }

  async launch(session: BridgeSession) {
    this.sessions.push(session);
    const preparedImagePath = join(session.directory, "image.macho");
    await writeFile(preparedImagePath, "owned prepared backing image");
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1000)"],
      { stdio: "ignore" },
    );
    this.processes.push(child);
    const launch: BridgeLaunch = this.externalDocument
      ? {
          process: child,
          ownsProcessLifetime: false,
          providerLifetime: "external-application",
          shutdownMode: "bridge-request",
          preparedImagePath,
        }
      : {
          process: child,
          ownsProcessLifetime: true,
          providerLifetime: "launcher-process",
          shutdownMode: "process-cleanup",
          preparedImagePath,
          cleanup: async () => {
            if (!this.allowCleanup)
              return {
                cleaned: false,
                reason: "fixture transient cleanup denial",
              };
            await stopFixture(child);
            return { cleaned: true, signaled: true };
          },
        };
    return ok(launch);
  }
}

const stopFixture = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await exited;
};

const expectStoppedFixture = (
  child: Pick<ChildProcess, "exitCode" | "signalCode">,
): void => {
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  if (process.platform !== "win32") expect(child.signalCode).toBe("SIGKILL");
};

const createClient = (options: HopperClientOptions) => {
  const client = new HopperClient({ startupTimeoutMs: 100, ...options });
  onTestFinished(async () => {
    await client.close();
  });
  return client;
};

const failedStartup = async (launcher: RetryCleanupLauncher) => {
  const client = createClient({ launcher });
  await expect(client.start()).resolves.toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      cleanupIncomplete: true,
      cause: { cause: { _tag: "HopperTimeoutError" } },
    },
  });
  const session = launcher.sessions[0];
  const child = launcher.processes[0];
  if (session === undefined || child === undefined)
    throw new Error("Fixture launch was not observed");
  return { client, session, child };
};

it("retains failed startup cleanup until an owned process and its backing image are closed", async () => {
  const launcher = new RetryCleanupLauncher();
  const { client, session, child } = await failedStartup(launcher);
  const closed = await client.close();
  expect(closed).toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      cleanupResources: [
        "hopper-process",
        "hopper-document",
        session.directory,
      ],
    },
  });
  if (closed.ok) throw new Error("Expected incomplete fixture cleanup");
  expect(projectAnalysisError(closed.error)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      resources: ["hopper-process", "hopper-document", session.directory],
    },
  });
  expect(child.exitCode).toBeNull();
  expect(child.signalCode).toBeNull();
  await expect(
    readFile(join(session.directory, "image.macho"), "utf8"),
  ).resolves.toBe("owned prepared backing image");

  launcher.allowCleanup = true;
  const first = client.close();
  const second = client.close();
  await expect(first).resolves.toEqual({ ok: true, value: null });
  await expect(second).resolves.toEqual({ ok: true, value: null });
  expectStoppedFixture(child);
  await expect(access(session.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(client.close()).resolves.toEqual({
    ok: true,
    value: null,
  });
});

it.each([false, true])(
  "keeps an unconfirmed external document across closes when helper ownership is %s",
  async (ownsHelper) => {
    const launcher = new RetryCleanupLauncher(true);
    const runtimeRoot = await PrivateRuntimeRoot.create();
    onTestFinished(() => runtimeRoot.close());
    const launched = await launcher.launch({
      directory: runtimeRoot.path,
      socketPath: join(runtimeRoot.path, "bridge.sock"),
      token: "fixture-token",
      runId: "fixture-run",
    });
    if (!launched.ok) throw launched.error;
    const child = launched.value.process;
    const launch: BridgeLaunch = ownsHelper
      ? { ...launched.value, ownsProcessLifetime: true }
      : launched.value;
    const supervisor = new ProviderProcessSupervisor(launch);
    onTestFinished(() => supervisor.dispose());
    const resources: HopperOwnedResources = {
      launch,
      processSupervisor: supervisor,
      runtimeRoot,
      shutdownConfirmed: false,
      externalApplication: undefined,
    };
    const socket = new Socket();
    onTestFinished(() => {
      socket.destroy();
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        cleanupHopperSession({
          socket: attempt === 0 ? socket : undefined,
          resources,
          activeRequest: null,
          retainDocument: false,
          progress: undefined,
          logger: silentLogger,
          onDiagnostic: undefined,
          request: () =>
            Promise.resolve(
              ok({
                shutdown: true,
                analysis_stopped: true,
                document_closed: false,
              }),
            ),
          releaseTransport: (socket) => socket?.destroy(),
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { cleanupResources: ["hopper-document", runtimeRoot.path] },
      });
    }
    if (ownsHelper)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    else {
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    }
    await expect(
      access(join(runtimeRoot.path, "image.macho")),
    ).resolves.toBeUndefined();
  },
);

it("blocks a fresh launch while cleanup remains unverified", async () => {
  const launcher = new RetryCleanupLauncher();
  const { client, child } = await failedStartup(launcher);
  await expect(client.start()).resolves.toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      cause: { cause: { _tag: "HopperTimeoutError" } },
      diagnostics: { primary_error: { code: "provider_timeout" } },
    },
  });
  expect(client.operationHealth()).toMatchObject({
    state: "not_started",
    stage: "launch",
  });
  expect(launcher.processes).toEqual([child]);
  launcher.allowCleanup = true;
  await expect(client.close()).resolves.toEqual({
    ok: true,
    value: null,
  });
});

it("preserves failed startup state through a blocked retry until cleanup succeeds", async () => {
  const launcher = new RetryCleanupLauncher();
  const { client } = await failedStartup(launcher);
  // The startup timeout leaves the client in not_started with retained
  // resources; cleanup is still incomplete.
  expect(client.operationHealth()).toMatchObject({ state: "not_started" });
  // An intervening retry is blocked by the retained resources, and now
  // surfaces the recorded startup failure (upstream 069308bb) instead of
  // a generic protocol error...
  await expect(client.start()).resolves.toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      cleanupIncomplete: true,
      cause: { cause: { _tag: "HopperTimeoutError" } },
    },
  });
  // ...but must not wipe the failed-startup state: the client still
  // reports not_started (never idle) until cleanup succeeds, so a
  // same-target open_binary keeps retiring the wedged client instead of
  // fast-pathing it.
  expect(client.operationHealth()).toMatchObject({ state: "not_started" });
  launcher.allowCleanup = true;
  await expect(client.close()).resolves.toEqual({ ok: true, value: null });
});

it("permits a fresh launch after stopping an owned bridge-request provider without an acknowledgement", async () => {
  const fixture = new RetryCleanupLauncher();
  fixture.allowCleanup = true;
  const launcher: BridgeLauncher = {
    async launch(session) {
      const launched = await fixture.launch(session);
      if (!launched.ok) return launched;
      return ok({ ...launched.value, shutdownMode: "bridge-request" as const });
    },
  };
  const client = createClient({ launcher });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(client.start()).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperTimeoutError" },
    });
    await expect(client.close()).resolves.toEqual({
      ok: true,
      value: null,
    });
  }
  expect(fixture.sessions).toHaveLength(2);
  for (const session of fixture.sessions)
    await expect(access(session.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  for (const child of fixture.processes) expectStoppedFixture(child);
});

it("retains a cross-client lease until owned cleanup succeeds", async () => {
  const fixture = new RetryCleanupLauncher();
  let owner: string | undefined;
  const launcher: BridgeLauncher = {
    async launch(session) {
      if (owner !== undefined)
        return err(new HopperStartError({ ownerRunId: owner }));
      const launched = await fixture.launch(session);
      if (!launched.ok) return launched;
      owner = session.runId;
      return ok({
        ...launched.value,
        releaseLease: async () => void (owner = undefined),
      });
    },
  };
  const first = createClient({ launcher, runId: "first" });
  const second = createClient({ launcher, runId: "second" });
  await expect(first.start()).resolves.toMatchObject({ ok: false });
  await expect(second.start()).resolves.toMatchObject({
    ok: false,
    error: { _tag: "HopperStartError", ownerRunId: "first" },
  });
  expect(fixture.processes).toHaveLength(1);

  fixture.allowCleanup = true;
  await expect(first.close()).resolves.toEqual({ ok: true, value: null });
  await expect(second.start()).resolves.toMatchObject({
    ok: false,
    error: { _tag: "HopperTimeoutError" },
  });
  expect(fixture.processes).toHaveLength(2);
  expect(owner).toBeUndefined();
});

it("retries a failed lease release after document, process, and runtime cleanup are confirmed", async () => {
  const fixture = new RetryCleanupLauncher();
  fixture.allowCleanup = true;
  let releaseAllowed = false;
  const launcher: BridgeLauncher = {
    async launch(session) {
      const launched = await fixture.launch(session);
      if (!launched.ok) return launched;
      return ok({
        ...launched.value,
        releaseLease: async () => {
          if (!releaseAllowed) throw new Error("fixture lease release denial");
        },
      });
    },
  };
  const client = createClient({ launcher });
  await expect(client.start()).resolves.toMatchObject({ ok: false });
  await expect(client.close()).resolves.toMatchObject({
    ok: false,
    error: { cleanupResources: ["hopper-lease"] },
  });
  await expect(client.start()).resolves.toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      diagnostics: { primary_error: { code: "provider_timeout" } },
    },
  });
  releaseAllowed = true;
  await expect(client.close()).resolves.toEqual({ ok: true, value: null });
  expect(fixture.processes).toHaveLength(1);
});

it("preserves confirmed document shutdown while retrying owned process cleanup", async () => {
  const launcher = new RetryCleanupLauncher();
  const runtimeRoot = await PrivateRuntimeRoot.create();
  onTestFinished(() => runtimeRoot.close());
  const launched = await launcher.launch({
    directory: runtimeRoot.path,
    socketPath: join(runtimeRoot.path, "bridge.sock"),
    token: "fixture-token",
    runId: "fixture-run",
  });
  if (!launched.ok) throw launched.error;
  const supervisor = new ProviderProcessSupervisor(launched.value);
  onTestFinished(() => supervisor.dispose());
  const input = {
    resources: {
      launch: launched.value,
      processSupervisor: supervisor,
      runtimeRoot,
      shutdownConfirmed: false,
      externalApplication: undefined,
    } satisfies HopperOwnedResources,
    activeRequest: null,
    retainDocument: false,
    progress: undefined,
    logger: silentLogger,
    onDiagnostic: undefined,
    request: () =>
      Promise.resolve(
        ok({
          shutdown: true,
          analysis_stopped: true,
          document_closed: true,
        }),
      ),
    releaseTransport: (socket: Socket | undefined) => socket?.destroy(),
  };
  const first = await cleanupHopperSession({ ...input, socket: new Socket() });
  expect(first).toMatchObject({
    ok: false,
    error: { cleanupResources: ["hopper-process", runtimeRoot.path] },
  });
  launcher.allowCleanup = true;
  const second = await cleanupHopperSession({
    ...input,
    socket: undefined,
  });
  expect(second).toEqual({ ok: true, value: null });
  expectStoppedFixture(launched.value.process);
  await expect(access(runtimeRoot.path)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  ["launcher-process", "waiting"],
  ["launcher-process", "cancelled"],
  ["external-application", "waiting"],
  ["external-application", "cancelled"],
] as const)(
  "checks document closure for a %s provider with a %s request",
  async (providerLifetime, callerState) => {
    const launcher = new RetryCleanupLauncher();
    launcher.allowCleanup = true;
    const runtimeRoot = await PrivateRuntimeRoot.create();
    onTestFinished(() => runtimeRoot.close());
    const launched = await launcher.launch({
      directory: runtimeRoot.path,
      socketPath: join(runtimeRoot.path, "bridge.sock"),
      token: "fixture-token",
      runId: "fixture-run",
    });
    if (!launched.ok) throw launched.error;
    const launch: BridgeLaunch = {
      ...launched.value,
      providerLifetime,
      shutdownMode: "bridge-request",
    };
    const supervisor = new ProviderProcessSupervisor(launch);
    onTestFinished(() => supervisor.dispose());
    const resources: HopperOwnedResources = {
      launch,
      processSupervisor: supervisor,
      runtimeRoot,
      shutdownConfirmed: false,
      externalApplication: undefined,
    };
    const result = await cleanupHopperSession({
      socket: new Socket(),
      resources,
      activeRequest: {
        requestId: 1,
        operation: "partial_then_wait",
        elapsedMs: 0,
        callerState,
        queuedRequests: 0,
      },
      retainDocument: false,
      progress: undefined,
      logger: silentLogger,
      onDiagnostic: undefined,
      request: () =>
        Promise.reject(new Error("Active request prevents shutdown")),
      releaseTransport: (socket) => socket?.destroy(),
    });
    if (providerLifetime === "launcher-process") {
      expect(result).toEqual({ ok: true, value: null });
      await expect(access(runtimeRoot.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } else {
      expect(result).toMatchObject({
        ok: false,
        error: { cleanupResources: ["hopper-document", runtimeRoot.path] },
      });
      await expect(
        access(join(runtimeRoot.path, "image.macho")),
      ).resolves.toBeUndefined();
    }
    expectStoppedFixture(launch.process);
  },
);
