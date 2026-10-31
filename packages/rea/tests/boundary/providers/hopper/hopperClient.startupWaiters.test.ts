import { access } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import {
  HopperCancelledError,
  HopperProcessError,
} from "../../../../src/domain/hopperErrors.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { ok } from "../../../../src/domain/result.js";
import { ProviderRunLineage } from "../../../../src/process/ProviderRunLineage.js";
import { waitForExit } from "../../../support/process/processFixture.js";
import {
  HopperFixtureLauncher,
  trackHopperClient,
} from "./hopperClient.fixture.js";

it("preserves a warm provider when an already cancelled caller joins", async () => {
  const launcher = new HopperFixtureLauncher();
  const client = trackHopperClient(new HopperClient({ launcher }));
  await expect(client.start()).resolves.toMatchObject({ ok: true });
  const controller = new AbortController();
  const reason = { source: "caller", opaque: 7 };
  controller.abort(reason);
  const joined = await client.start(controller.signal);
  expect(joined.ok).toBe(false);
  if (joined.ok) throw new Error("Expected cancellation");
  expect(joined.error).toBeInstanceOf(HopperCancelledError);
  expect(joined.error.cause).toBe(reason);
  expect(client.isReady()).toBe(true);
  expect(client.operationHealth()).toMatchObject({ state: "idle" });
  await expect(
    client.callTool("echo", { value: "live caller" }),
  ).resolves.toEqual({
    ok: true,
    value: { value: "live caller" },
  });
  expect(launcher.processes).toHaveLength(1);
});

it("reports provider closure to live startup callers without cancelling their signals", async () => {
  const launcher = new HopperFixtureLauncher(undefined, "quiet", "gated");
  const client = trackHopperClient(
    new HopperClient({ launcher, startupTimeoutMs: 10_000 }),
  );
  const first = new AbortController();
  const second = new AbortController();
  const waits = [client.start(first.signal), client.start(second.signal)];
  await launcher.waitForRequest("health");
  await expect(client.close()).resolves.toEqual({ ok: true, value: null });
  for (const waiting of waits)
    await expect(waiting).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "HopperProtocolError",
        message: "Hopper session closed during startup",
      },
    });
  expect(first.signal.aborted).toBe(false);
  expect(second.signal.aborted).toBe(false);
  expect(client.isReady()).toBe(false);
});

it("retains the final caller's cleanup failure and blocks replacement until close succeeds", async () => {
  const fixture = new HopperFixtureLauncher();
  const controller = new AbortController();
  let allowCleanup = false;
  const client = trackHopperClient(
    new HopperClient({
      startupTimeoutMs: 10_000,
      launcher: {
        async launch(session) {
          const launched = await fixture.launch(session);
          if (!launched.ok) return launched;
          if (fixture.processes.length === 1) controller.abort();
          return ok({
            ...launched.value,
            cleanup: async () =>
              allowCleanup
                ? launched.value.cleanup()
                : { cleaned: false as const, reason: "Fixture cleanup denied" },
          });
        },
      },
    }),
  );
  try {
    const first = await client.start(controller.signal);
    expect(first).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    if (first.ok) throw new Error("Expected retained cleanup");
    const retry = await client.start();
    if (retry.ok) throw new Error("Unexpected replacement startup");
    expect(retry.error).toBe(first.error);
    expect(fixture.processes).toHaveLength(1);
    await expect(access(fixture.directories[0] ?? "")).resolves.toBeUndefined();
    allowCleanup = true;
    await expect(client.close()).resolves.toEqual({ ok: true, value: null });
    await expect(access(fixture.directories[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    expect(fixture.processes).toHaveLength(2);
  } finally {
    allowCleanup = true;
    await client.close();
  }
});

it.each([0, 1])(
  "cancels Hopper startup caller %s independently of its peer",
  async (cancelledIndex) => {
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const launchPending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const launchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const launcher = new HopperFixtureLauncher();
    const client = trackHopperClient(
      new HopperClient({
        startupTimeoutMs: 10_000,
        launcher: {
          async launch(session) {
            entered?.();
            await launchGate;
            return launcher.launch(session);
          },
        },
      }),
    );
    const controllers = [new AbortController(), new AbortController()];
    const waits = controllers.map(({ signal }) =>
      client.callTool("echo", { value: "live peer" }, { signal }),
    );
    try {
      await launchPending;
      let cancelled: Awaited<ReturnType<HopperClient["callTool"]>> | undefined;
      void waits[cancelledIndex]?.then((result) => {
        cancelled = result;
      });
      const reason = { source: "caller", opaque: cancelledIndex };
      controllers[cancelledIndex]?.abort(reason);
      await vi.waitFor(() =>
        expect(cancelled).toMatchObject({
          ok: false,
          error: { _tag: "HopperCancelledError" },
        }),
      );
      if (cancelled === undefined || cancelled.ok)
        throw new Error("Expected cancellation");
      expect(cancelled.error).toBeInstanceOf(HopperCancelledError);
      expect(cancelled.error.cause).toBe(reason);
      expect(launcher.processes).toHaveLength(0);
      release?.();
      await expect(waits[1 - cancelledIndex]).resolves.toMatchObject({
        ok: true,
        value: { value: "live peer" },
      });
      expect(launcher.processes).toHaveLength(1);
      expect(client.isReady()).toBe(true);
    } finally {
      release?.();
      await Promise.all(waits);
    }
  },
);

it.each(["cancelled", "rejected"] as const)(
  "owns Hopper final startup cleanup when lineage is %s",
  async (stage) => {
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cause = new TypeError("Lineage reader rejected");
    const original = ProviderRunLineage.prototype.observe;
    const observe = vi.spyOn(ProviderRunLineage.prototype, "observe");
    observe.mockImplementationOnce(async function (
      this: ProviderRunLineage,
      launch,
    ) {
      entered?.();
      await gate;
      if (stage === "rejected") throw cause;
      await original.call(this, launch);
    });
    const launcher = new HopperFixtureLauncher();
    const client = trackHopperClient(
      new HopperClient({ launcher, startupTimeoutMs: 10_000 }),
    );
    const controller = new AbortController();
    const starting = client.start(controller.signal);
    try {
      await pending;
      if (stage === "cancelled") controller.abort();
      release?.();
      const result = await starting;
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag:
            stage === "cancelled" ? "HopperCancelledError" : "HopperStartError",
        },
      });
      if (result.ok) throw new Error("Expected interrupted startup");
      if (stage === "rejected") expect(result.error.cause).toBe(cause);
      const child = launcher.processes[0];
      if (child === undefined) throw new Error("Missing fixture process");
      expect(await waitForExit(child, 5_000)).toBe(true);
      await expect(access(launcher.directories[0] ?? "")).rejects.toMatchObject(
        { code: "ENOENT" },
      );
      expect(client.isReady()).toBe(false);
      await expect(client.start()).resolves.toMatchObject({ ok: true });
      expect(launcher.processes).toHaveLength(2);
    } finally {
      release?.();
      observe.mockRestore();
      await starting.catch(() => undefined);
    }
  },
);

it("keeps a post-connect launcher exit ahead of cancellation during lineage finalization", async () => {
  let entered: (() => void) | undefined;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = ProviderRunLineage.prototype.observe;
  const observe = vi.spyOn(ProviderRunLineage.prototype, "observe");
  observe.mockImplementationOnce(async function (
    this: ProviderRunLineage,
    launch,
  ) {
    entered?.();
    await gate;
    await original.call(this, launch);
  });
  const launcher = new HopperFixtureLauncher();
  const client = trackHopperClient(new HopperClient({ launcher }));
  const controller = new AbortController();
  const starting = client.start(controller.signal);
  try {
    await pending;
    const child = launcher.processes[0];
    if (child === undefined) throw new Error("Missing fixture process");
    child.kill("SIGKILL");
    expect(await waitForExit(child, 5_000)).toBe(true);
    controller.abort({ source: "after launcher exit" });
    release?.();

    const result = await starting;
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "HopperProcessError", exitCode: null },
    });
    if (result.ok) throw new Error("Expected launcher exit failure");
    expect(result.error).toBeInstanceOf(HopperProcessError);
    expect((result.error as HopperProcessError).launcherFailure).toMatchObject({
      exit_code: null,
      signal: "SIGKILL",
    });
  } finally {
    release?.();
    await starting;
  }
});

it("keeps an unstarted client reusable after an already cancelled startup wait", async () => {
  const launcher = new HopperFixtureLauncher();
  const client = trackHopperClient(
    new HopperClient({ launcher, startupTimeoutMs: 30_000 }),
  );
  const controller = new AbortController();
  controller.abort();

  const result = await client.start(controller.signal);

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("HopperCancelledError");
  expect(launcher.processes).toHaveLength(0);
  expect(client.isReady()).toBe(false);
  expect(client.operationHealth()).toMatchObject({ state: "idle" });
  await expect(
    client.callTool("echo", { value: "live caller" }),
  ).resolves.toEqual({
    ok: true,
    value: { value: "live caller" },
  });
  expect(launcher.processes).toHaveLength(1);
  expect(client.isReady()).toBe(true);
});
