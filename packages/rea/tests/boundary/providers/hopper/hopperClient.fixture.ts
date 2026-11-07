import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { onTestFinished, vi } from "vitest";
import { z } from "zod";

import { ok } from "../../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import { waitForExit } from "../../../support/process/processFixture.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";

export const hopperFixturePath = fileURLToPath(
  new URL("../../../fixtures/fakeHopper.mjs", import.meta.url),
);

const requestSchema = z.object({
  id: z.number().int(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
type FixtureRequest = z.infer<typeof requestSchema>;

/** Real socket fixture with request acknowledgements and explicit response gates. */
export class HopperFixtureLauncher implements BridgeLauncher {
  readonly socketPaths: string[] = [];
  readonly directories: string[] = [];
  readonly runIds: string[] = [];
  readonly tokens: string[] = [];
  readonly processes: ChildProcess[] = [];
  readonly requests: FixtureRequest[] = [];

  constructor(
    readonly tokenOverride?: string,
    readonly diagnosticMode: "quiet" | "noisy" | "noisy_no_socket" = "quiet",
    readonly healthMode: "ready" | "gated" = "ready",
    readonly shutdownMode: "acknowledge" | "exit-without-ack" = "acknowledge",
    readonly inventoryFailure:
      | "none"
      | "capability_unavailable"
      | "bridge_exception" = "none",
    readonly advertisedRequestBytes?: number,
  ) {}

  launch(session: BridgeSession) {
    this.socketPaths.push(session.socketPath);
    this.directories.push(session.directory);
    this.runIds.push(session.runId);
    this.tokens.push(session.token);
    const child = spawn(
      process.execPath,
      [
        hopperFixturePath,
        session.socketPath,
        this.tokenOverride ?? session.token,
        session.runId,
        this.shutdownMode,
        this.diagnosticMode,
        this.healthMode,
        this.inventoryFailure,
        ...(this.advertisedRequestBytes === undefined
          ? []
          : [String(this.advertisedRequestBytes)]),
      ],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    child.on("message", (value: unknown) => {
      const request = requestSchema.safeParse(value);
      if (request.success) this.requests.push(request.data);
    });
    this.processes.push(child);
    return Promise.resolve(
      ok({
        process: child,
        ownsProcessLifetime: true as const,
        providerLifetime: "launcher-process" as const,
        shutdownMode: "process-cleanup" as const,
        cleanup: async () => {
          const exited = child.exitCode !== null || child.signalCode !== null;
          const signaled = !exited && child.kill("SIGTERM");
          return (await waitForExit(child, 5_000))
            ? { cleaned: true as const, signaled }
            : {
                cleaned: false as const,
                reason: "Fixture process did not exit",
              };
        },
      }),
    );
  }

  /** Wait for acknowledgement that the fixture actually received a request. */
  waitForRequest(method: string, gate?: string): Promise<FixtureRequest> {
    return vi.waitFor(
      () => {
        const request = this.requests.find(
          (value) =>
            value.method === method &&
            (gate === undefined || value.params?.gate === gate),
        );
        if (request === undefined)
          throw new Error(`Waiting for Hopper fixture request ${method}`);
        return request;
      },
      { timeout: 10_000 },
    );
  }

  /** Release a response held by the fixture's gate parameter. */
  release(request: FixtureRequest): Promise<void> {
    const child = this.processes.at(-1);
    if (child === undefined) throw new Error("Hopper fixture was not launched");
    return new Promise((resolve, reject) => {
      child.send({ release: request.id }, (error) => {
        if (error !== null) reject(error);
        else resolve();
      });
    });
  }
}

/** Register owned client cleanup before any startup assertion can fail. */
export const trackHopperClient = (client: HopperClient): HopperClient => {
  onTestFinished(async () => {
    await client.close();
  });
  return client;
};

/** Start a real fixture session with test-scoped cleanup. */
export const startHopperFixtureClient = async (
  launcher = new HopperFixtureLauncher(),
): Promise<HopperClient> => {
  const client = trackHopperClient(
    new HopperClient({
      launcher,
      startupTimeoutMs: 10_000,
    }),
  );
  const started = await client.start();
  if (!started.ok) throw started.error;
  return client;
};
