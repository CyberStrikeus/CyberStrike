import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  HopperCancelledError,
  HopperProcessError,
} from "../../../../src/domain/hopperErrors.js";
import { ok } from "../../../../src/domain/result.js";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../../../src/hopper/BridgeLauncher.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";

/** A launcher process that exits 3 on its own, before any bridge readiness. */
class ObservedExitLauncher implements BridgeLauncher {
  #notified = false;

  constructor(readonly onExit: () => void) {}

  launch() {
    const child = spawn(process.execPath, ["-e", "process.exit(3)"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.once("exit", () => {
      if (this.#notified) return;
      this.#notified = true;
      setImmediate(() => this.onExit());
    });
    return Promise.resolve(
      ok({
        process: child,
        ownsProcessLifetime: true as const,
        providerLifetime: "launcher-process" as const,
        shutdownMode: "bridge-request" as const,
      }),
    );
  }
}

class AbortBeforeExitLauncher implements BridgeLauncher {
  constructor(readonly onSpawn: () => void) {}

  launch(_session: BridgeSession, options?: { readonly signal?: AbortSignal }) {
    const child = spawn(
      process.execPath,
      ["-e", "setTimeout(() => process.exit(3), 5000)"],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    options?.signal?.addEventListener("abort", () => child.kill("SIGTERM"), {
      once: true,
    });
    child.once("spawn", this.onSpawn);
    return Promise.resolve(
      ok({
        process: child,
        ownsProcessLifetime: true as const,
        providerLifetime: "launcher-process" as const,
        shutdownMode: "bridge-request" as const,
      }),
    );
  }
}

const start = async (abort: "never" | "after-exit") => {
  const controller = new AbortController();
  const reason = { caller: "after-launcher-exit" };
  const client = new HopperClient({
    launcher: new ObservedExitLauncher(() => {
      if (abort === "after-exit") controller.abort(reason);
    }),
    startupTimeoutMs: 5_000,
  });
  try {
    const started = await client.start(
      abort === "after-exit" ? controller.signal : undefined,
    );
    if (started.ok)
      throw new Error("the launcher failure was reported as success");
    return started.error;
  } finally {
    await client.close().catch(() => undefined);
  }
};

describe("Hopper startup failure priority", () => {
  it("keeps the observed launcher exit when cancellation arrives after it", async () => {
    const error = await start("after-exit");
    expect(error).toBeInstanceOf(HopperProcessError);
    if (!(error instanceof HopperProcessError)) return;
    expect(error.exitCode).toBe(3);
    expect(error.stage).toBe("launch");
  }, 30_000);

  it("reports the same launcher exit without any cancellation", async () => {
    const error = await start("never");
    expect(error._tag).toBe("HopperProcessError");
  }, 30_000);

  it("keeps cancellation first when its abort handler causes the later launcher exit", async () => {
    const controller = new AbortController();
    const reason = { caller: "abort-before-exit" };
    const client = new HopperClient({
      launcher: new AbortBeforeExitLauncher(() => controller.abort(reason)),
      startupTimeoutMs: 5_000,
    });
    try {
      const started = await client.start(controller.signal);
      expect(started).toMatchObject({
        ok: false,
        error: { _tag: "HopperCancelledError" },
      });
      if (started.ok) throw new Error("Expected startup cancellation");
      expect(started.error).toBeInstanceOf(HopperCancelledError);
      expect(started.error.cause).toBe(reason);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 30_000);
});
