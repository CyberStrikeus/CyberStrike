import { describe, expect, it, vi } from "vitest";

import {
  HopperFixtureLauncher,
  startHopperFixtureClient as startClient,
} from "./hopperClient.fixture.js";

describe("HopperClient progress", () => {
  it("forwards correlated Python progress before the terminal response", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startClient(launcher);
    const updates: Array<{
      readonly phase: string;
      readonly completed: number;
      readonly terminal?: boolean;
    }> = [];
    const pending = client.callTool(
      "echo",
      { value: "progress", gate: "progress" },
      {
        progress: {
          report: (update) => {
            updates.push(update);
            return Promise.resolve();
          },
        },
      },
    );
    const request = await launcher.waitForRequest("echo", "progress");
    await vi.waitFor(() =>
      expect(updates).toContainEqual(
        expect.objectContaining({ phase: "hopper_bridge", completed: 0 }),
      ),
    );
    expect(updates.some(({ terminal }) => terminal === true)).toBe(false);
    await launcher.release(request);
    const result = await pending;

    expect(result).toEqual({
      ok: true,
      value: { value: "progress", gate: "progress" },
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "hopper_bridge",
          completed: 0,
        }),
        expect.objectContaining({
          phase: "hopper_bridge",
          completed: 1,
          terminal: true,
        }),
      ]),
    );
  });

  it("isolates synchronous progress observer failures from bridge responses", async () => {
    const client = await startClient();
    await expect(
      client.callTool(
        "echo",
        { value: "alive" },
        {
          progress: {
            report: () => {
              throw new Error("observer failed");
            },
          },
        },
      ),
    ).resolves.toEqual({ ok: true, value: { value: "alive" } });
  });

  it("projects a missing bridge API as typed capability unavailability", async () => {
    const client = await startClient();
    const result = await client.callTool("capability_unavailable");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        providerId: "hopper",
        operation: "capability_unavailable",
        reason: "fixture API is unavailable",
        diagnostics: {
          provider_request: {
            operation: "capability_unavailable",
            provider_code: -32000,
            diagnostic_type: "capability_unavailable",
            request_id: expect.any(Number),
          },
        },
      });
  });

  it("cancels and ignores late responses without corrupting the session", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startClient(launcher);
    const controller = new AbortController();
    const pending = client.callTool(
      "echo",
      { gate: "late-reply" },
      { signal: controller.signal },
    );
    const request = await launcher.waitForRequest("echo", "late-reply");
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok)
      expect(cancelled.error._tag).toBe("HopperCancelledError");

    await launcher.release(request);
    await expect(client.callTool("echo", { value: "alive" })).resolves.toEqual({
      ok: true,
      value: { value: "alive" },
    });
  });

  it("retains cancelled bridge activity until the reply releases the queue", async () => {
    const launcher = new HopperFixtureLauncher();
    const client = await startClient(launcher);
    const progress: string[] = [];
    const controller = new AbortController();
    const pending = client.callTool(
      "echo",
      { gate: "cancel-active" },
      {
        signal: controller.signal,
        progress: {
          report: (update) => {
            progress.push(update.message);
            return Promise.resolve();
          },
        },
      },
    );
    const request = await launcher.waitForRequest("echo", "cancel-active");
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "HopperCancelledError" },
    });
    expect(client.requestActivity()).toMatchObject({
      operation: "echo",
      callerState: "cancelled",
    });
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.stringContaining("started on Hopper's serial bridge"),
      ]),
    );
    await launcher.release(request);
    await vi.waitFor(() => expect(client.requestActivity()).toBeNull());
    await expect(client.callTool("echo", { alive: true })).resolves.toEqual({
      ok: true,
      value: { alive: true },
    });
  });
});
