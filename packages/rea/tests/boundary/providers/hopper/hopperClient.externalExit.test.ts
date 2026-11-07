import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type AnalysisProviderCandidate,
  type CapabilityDescriptor,
  type ProviderIdentity,
} from "../../../../src/application/AnalysisProvider.js";
import { AnalysisProviderRegistry } from "../../../../src/application/binary/AnalysisProviderRegistry.js";
import { BinarySession } from "../../../../src/application/binary/BinarySession.js";
import { SessionProviderRouter } from "../../../../src/application/binary/SessionProviderRouter.js";
import { createAnalysisProfile } from "../../../../src/domain/analysisProfile.js";
import { ok } from "../../../../src/domain/result.js";
import type { BridgeSession } from "../../../../src/hopper/BridgeLauncher.js";
import {
  cleanupHopperSession,
  type HopperOwnedResources,
} from "../../../../src/hopper/HopperCleanup.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { silentLogger } from "../../../../src/logger.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { observeProcessStartIdentity } from "../../../../src/process/ProcessOwnershipObservation.js";
import { HopperFixtureLauncher } from "./hopperClient.fixture.js";

const identities = {
  hopper: { id: "hopper", name: "Hopper fixture", version: null },
  ghidra: { id: "ghidra", name: "Ghidra fixture", version: null },
} satisfies Record<string, ProviderIdentity>;
const executionIdentities = {
  hopper: { ...identities.hopper, version: "1" },
  ghidra: { ...identities.ghidra, version: "1" },
} satisfies Record<string, ProviderIdentity>;

const makeCandidate = (
  id: keyof typeof identities,
  createClient: () => AnalysisClient,
): AnalysisProviderCandidate => {
  const identity = identities[id];
  const capability: CapabilityDescriptor = {
    provider: identity,
    operation: "address_name",
    available: true,
    reason: null,
    cachePolicy: "live",
    effects: {
      mutatesArtifact: false,
      launchesProcess: id === "hopper",
      mayShowUi: false,
      mayAccessNetwork: false,
      mayWriteFilesystem: false,
      changesPermissions: false,
      requiresRoot: false,
    },
    limitations: [],
  };
  return {
    identity: () => identity,
    capabilities: () => [capability],
    inspectAvailability: () => ({
      status: "available",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    inspectTargetSupport: () => ({
      status: "supported",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    resolveAnalysisProfile: () =>
      Promise.resolve(
        ok({
          profile: createAnalysisProfile(
            { id, name: identity.name, version: "1" },
            { fixture: id },
          ),
        }),
      ),
    createClient: () => createClient(),
  };
};

const fixtureAnalysisClient = (identity: ProviderIdentity): AnalysisClient => ({
  execute: (operation: AnalysisOperation) =>
    Promise.resolve(ok(createAnalysisExecution(null, identity))),
  close: () => Promise.resolve(ok(null)),
});

const stopFixture = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
};

class ExternalFixtureBridge {
  readonly fixture = new HopperFixtureLauncher();
  child: ChildProcess | undefined;
  readonly client: HopperClient;

  constructor() {
    const thisFixture = this;
    this.client = new HopperClient({
      startupTimeoutMs: 2_000,
      launcher: {
        async launch(session: BridgeSession) {
          const launched = await thisFixture.fixture.launch(session);
          if (!launched.ok) return launched;
          thisFixture.child = launched.value.process;
          return ok({
            process: launched.value.process,
            ownsProcessLifetime: false as const,
            providerLifetime: "external-application" as const,
            shutdownMode: "bridge-request" as const,
          });
        },
      },
    });
    onTestFinished(async () => {
      await this.client.close();
      for (const child of this.fixture.processes) await stopFixture(child);
      await Promise.all(
        this.fixture.directories.map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
    }, 45_000);
  }
}

it.skipIf(process.platform === "win32")(
  "retires an exited authenticated Hopper process before switching providers in the same session",
  async () => {
    const external = new ExternalFixtureBridge();
    const session = new BinarySession(
      SessionProviderRouter.selectable(
        new AnalysisProviderRegistry([
          makeCandidate("hopper", () => ({
            execute: async (operation) => {
              const started = await external.client.start();
              if (!started.ok) return started;
              if (operation === "health")
                return ok(
                  createAnalysisExecution(null, executionIdentities.hopper),
                );
              const observed = await external.client.callTool(operation, {});
              return observed.ok
                ? ok(
                    createAnalysisExecution(
                      observed.value,
                      executionIdentities.hopper,
                    ),
                  )
                : observed;
            },
            close: (options) => external.client.close(options),
          })),
          makeCandidate("ghidra", () =>
            fixtureAnalysisClient(executionIdentities.ghidra),
          ),
        ]),
        [],
      ),
    );
    onTestFinished(async () => {
      const closed = await session.close();
      if (!closed.ok) throw closed.error;
    });

    const opened = await session.open(process.execPath, {
      providerId: "hopper",
    });
    if (!opened.ok) throw opened.error;
    const observed = await session.execute("address_name", {});
    if (!observed.ok) throw observed.error;
    const externalProcess = external.child;
    if (externalProcess === undefined)
      throw new Error("The external Hopper bridge process was not recorded");
    expect(external.fixture.requests.map(({ method }) => method)).toEqual([
      "health",
      "address_name",
    ]);

    await stopFixture(externalProcess);

    const switched = await session.open(process.execPath, {
      providerId: "ghidra",
    });
    expect(switched.ok).toBe(true);
    expect(session.providerIdentity().id).toBe("ghidra");
    expect(await session.status()).toMatchObject({ open: true });
    expect(external.fixture.requests.map(({ method }) => method)).toEqual([
      "health",
      "address_name",
    ]);
  },
);

it.skipIf(process.platform === "win32")(
  "retains cleanup while the authenticated Hopper process is present and releases it after exit",
  async () => {
    const external = new ExternalFixtureBridge();
    const started = await external.client.start();
    if (!started.ok) throw started.error;
    const externalProcess = external.child;
    if (externalProcess === undefined)
      throw new Error("The external Hopper bridge process was not recorded");
    const identity = await observeProcessStartIdentity(started.value.processId);
    if (identity?.state !== "readable")
      throw new Error(
        "The authenticated fixture process identity was unavailable",
      );

    const runtimeRoot = await PrivateRuntimeRoot.create();
    onTestFinished(() => runtimeRoot.close());
    let leaseReleases = 0;
    const resources: HopperOwnedResources = {
      launch: {
        process: externalProcess,
        ownsProcessLifetime: false,
        providerLifetime: "external-application",
        shutdownMode: "bridge-request",
        releaseLease: async () => void (leaseReleases += 1),
      },
      processSupervisor: undefined,
      runtimeRoot,
      shutdownConfirmed: false,
      externalApplication: {
        pid: started.value.processId,
        identity,
      },
    };
    const cleanup = () =>
      cleanupHopperSession({
        socket: undefined,
        resources,
        activeRequest: null,
        retainDocument: false,
        progress: undefined,
        logger: silentLogger,
        onDiagnostic: undefined,
        request: async () => {
          throw new Error("Cleanup must not request a disconnected bridge");
        },
        releaseTransport: () => undefined,
      });

    const whilePresent = await cleanup();
    expect(whilePresent).toMatchObject({
      ok: false,
      error: { cleanupResources: ["hopper-document", runtimeRoot.path] },
    });
    expect(resources.shutdownConfirmed).toBe(false);
    expect(leaseReleases).toBe(0);

    await stopFixture(externalProcess);

    expect(await cleanup()).toEqual({ ok: true, value: null });
    expect(resources.launch).toBeUndefined();
    expect(resources.runtimeRoot).toBeUndefined();
    expect(leaseReleases).toBe(1);
  },
);
