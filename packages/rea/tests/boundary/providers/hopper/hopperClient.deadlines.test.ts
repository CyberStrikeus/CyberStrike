import { describe, expect, it, vi } from "vitest";
import { access } from "node:fs/promises";

import {
  HopperFixtureLauncher,
  startHopperFixtureClient,
} from "./hopperClient.fixture.js";

describe("HopperClient request deadlines", () => {
  it("propagates deadlines through the socket client and accepts late replies safely", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startHopperFixtureClient(launcher);
    const settled = vi.fn();
    const pending = client
      .callTool("echo", { gate: "deadline" }, { timeoutMs: 100 })
      .then(settled);
    const request = await launcher.waitForRequest("echo", "deadline");
    try {
      await vi.waitFor(
        () =>
          expect(settled).toHaveBeenCalledWith({
            ok: false,
            error: expect.objectContaining({
              _tag: "HopperTimeoutError",
              timeoutMs: 100,
              operation: "echo",
            }),
          }),
        { timeout: 1000 },
      );
      expect(client.requestActivity()).toMatchObject({
        callerState: "cancelled",
        operation: "echo",
      });
    } finally {
      await launcher.release(request);
      await pending;
    }
    await expect(
      client.callTool("echo", { value: "alive" }, { timeoutMs: 1000 }),
    ).resolves.toEqual({
      ok: true,
      value: { value: "alive" },
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(client.requestActivity()).toBeNull();
  });

  it("never transmits a request whose deadline expired in the FIFO", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startHopperFixtureClient(launcher);
    const active = client.callTool("echo", { gate: "hold-active" });
    const request = await launcher.waitForRequest("echo", "hold-active");
    try {
      await expect(
        client.callTool("echo", { value: "expired" }, { timeoutMs: 25 }),
      ).resolves.toMatchObject({
        ok: false,
        error: { _tag: "HopperTimeoutError" },
      });
      expect(
        launcher.requests.some(({ params }) => params?.value === "expired"),
      ).toBe(false);
    } finally {
      await launcher.release(request);
      await active;
    }
    await expect(client.callTool("echo", { value: "next" })).resolves.toEqual({
      ok: true,
      value: { value: "next" },
    });
    expect(
      launcher.requests.some(({ params }) => params?.value === "expired"),
    ).toBe(false);
  });

  it("closes and releases pending callers and private resources after an active timeout", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startHopperFixtureClient(launcher);
    const pending = client.callTool(
      "echo",
      { gate: "timeout-close" },
      { timeoutMs: 100 },
    );
    await launcher.waitForRequest("echo", "timeout-close");
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperTimeoutError" },
    });
    const queued = client.callTool(
      "echo",
      { value: "queued" },
      { timeoutMs: 1000 },
    );
    await vi.waitFor(() =>
      expect(client.requestActivity()?.queuedRequests).toBe(1),
    );
    await client.close();
    await expect(queued).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperProcessError" },
    });
    expect(client.requestActivity()).toBeNull();
    for (const directory of launcher.directories)
      await expect(access(directory)).rejects.toBeDefined();
    expect(
      launcher.processes.every(
        (child) => child.exitCode !== null || child.signalCode !== null,
      ),
    ).toBe(true);
  });
});

it("does not send a mutation after its synchronous progress observer consumes the deadline", async () => {
  const launcher = new HopperFixtureLauncher();
  const client = await startHopperFixtureClient(launcher);
  const result = await client.callTool(
    "set_comment",
    { comment: "must not reach the native boundary" },
    {
      timeoutMs: 10,
      progress: {
        report: () => {
          const started = performance.now();
          while (performance.now() - started < 30) {
            // Exercise an observer delaying dispatch of the actual deadline timer.
          }
          return Promise.resolve();
        },
      },
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "HopperTimeoutError",
      operation: "set_comment",
      providerState: "not_started",
    },
  });
  await expect(
    client.callTool("echo", { value: "recovered" }),
  ).resolves.toEqual({
    ok: true,
    value: { value: "recovered" },
  });
  expect(launcher.requests.some(({ method }) => method === "set_comment")).toBe(
    false,
  );
  expect(client.requestActivity()).toBeNull();
});
