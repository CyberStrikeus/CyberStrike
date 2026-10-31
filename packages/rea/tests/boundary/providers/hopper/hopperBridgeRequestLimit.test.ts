import { bridgeMaxRequestBytesRecovery } from "../../../../src/config/bridgeMaxRequestBytes.js";
import { expect, it, vi } from "vitest";

import { AnalysisResourceConstraintError } from "../../../../src/domain/analysisErrorCore.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import {
  HopperFixtureLauncher,
  trackHopperClient,
} from "./hopperClient.fixture.js";

const limit = (maximumBytes: number) =>
  ({ maximumBytes, source: "setting" }) as const;

it("reports a Hopper ceiling mismatch and releases the fixture", async () => {
  const launcher = new HopperFixtureLauncher();
  const client = trackHopperClient(
    new HopperClient({
      launcher,
      startupTimeoutMs: 10_000,
      bridgeMaxRequestBytes: limit(1_048_576),
    }),
  );
  const started = await client.start();
  expect(started.ok).toBe(false);
  if (started.ok) return;
  expect(started.error).toBeInstanceOf(AnalysisResourceConstraintError);
  if (!(started.error instanceof AnalysisResourceConstraintError)) return;
  expect(started.error.reportedLimits).toMatchObject({
    bridge_max_request_bytes: 16777216,
    client_max_request_bytes: 1048576,
  });
  expect(started.error.remediationAction).toBe(
    bridgeMaxRequestBytesRecovery(limit(1048576), "Hopper"),
  );
  const process = launcher.processes[0];
  expect(process?.exitCode !== null || process?.signalCode !== null).toBe(true);
});

it("refuses an oversized Hopper request before the fixture receives it", async () => {
  const launcher = new HopperFixtureLauncher(
    undefined,
    "quiet",
    "ready",
    "acknowledge",
    "none",
    8192,
  );
  const client = trackHopperClient(
    new HopperClient({
      launcher,
      startupTimeoutMs: 10_000,
      bridgeMaxRequestBytes: limit(8192),
    }),
  );
  expect((await client.start()).ok).toBe(true);
  const refused = await client.callTool("set_address_name", {
    address: "0x1",
    name: "n".repeat(9000),
  });
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.error).toBeInstanceOf(AnalysisResourceConstraintError);
  if (!(refused.error instanceof AnalysisResourceConstraintError)) return;
  expect(refused.error.reportedLimits).toMatchObject({
    max_request_bytes: 8192,
  });
  expect(refused.error.remediationAction).toBe(
    bridgeMaxRequestBytesRecovery(limit(8192), "Hopper"),
  );
  expect(launcher.requests.map(({ method }) => method)).not.toContain(
    "set_address_name",
  );
});

it("refuses a Hopper payload whose JSON expansion exceeds the ceiling before serializing it", async () => {
  const launcher = new HopperFixtureLauncher(
    undefined,
    "quiet",
    "ready",
    "acknowledge",
    "none",
    8192,
  );
  const client = trackHopperClient(
    new HopperClient({
      launcher,
      startupTimeoutMs: 10_000,
      bridgeMaxRequestBytes: limit(8192),
    }),
  );
  expect((await client.start()).ok).toBe(true);
  const name = "\u0001".repeat(2000);
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    const refused = await client.callTool("set_address_name", {
      address: "0x1",
      name,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(refused.error instanceof AnalysisResourceConstraintError)) return;
    expect(refused.error.reportedLimits).toMatchObject({
      max_request_bytes: 8192,
    });
    expect(refused.error.remediationAction).toBe(
      bridgeMaxRequestBytesRecovery(limit(8192), "Hopper"),
    );
    expect(launcher.requests.map(({ method }) => method)).not.toContain(
      "set_address_name",
    );
    expect(
      stringify.mock.calls.some((call) => {
        const value: unknown = call[0];
        if (typeof value !== "object" || value === null || !("params" in value))
          return false;
        const params = value.params;
        return (
          typeof params === "object" &&
          params !== null &&
          "name" in params &&
          params.name === name
        );
      }),
    ).toBe(false);
  } finally {
    stringify.mockRestore();
  }
});

const serializedPayload = (
  calls: readonly unknown[][],
  value: string,
): boolean =>
  calls.some((call) => {
    const candidate: unknown = call[0];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("params" in candidate)
    )
      return false;
    const params = candidate.params;
    return (
      typeof params === "object" &&
      params !== null &&
      "value" in params &&
      params.value === value
    );
  });

it("serializes a queued Hopper request only when it reaches the wire", async () => {
  const launcher = new HopperFixtureLauncher();
  const client = trackHopperClient(
    new HopperClient({
      launcher,
      startupTimeoutMs: 10_000,
    }),
  );
  expect((await client.start()).ok).toBe(true);
  const active = client.callTool("echo", { gate: "hold", value: "active" });
  const held = await launcher.waitForRequest("echo", "hold");
  const value = "queued-payload";
  const stringify = vi.spyOn(JSON, "stringify");
  let queuedNotice = false;
  const queued = client.callTool(
    "echo",
    { value },
    {
      progress: {
        report: (update) => {
          if (update.message.includes("queued behind")) queuedNotice = true;
          return Promise.resolve();
        },
      },
    },
  );
  await vi.waitFor(
    () => {
      if (!queuedNotice) throw new Error("echo is not queued yet");
    },
    { timeout: 5_000 },
  );
  expect(serializedPayload(stringify.mock.calls, value)).toBe(false);
  await launcher.release(held);
  await expect(active).resolves.toMatchObject({
    ok: true,
    value: { gate: "hold", value: "active" },
  });
  await expect(queued).resolves.toEqual({ ok: true, value: { value } });
  expect(serializedPayload(stringify.mock.calls, value)).toBe(true);
  stringify.mockRestore();
});

it("sends a Hopper request above 16 MiB when both sides raise the ceiling", async () => {
  const ceiling = 17 * 1024 * 1024;
  const launcher = new HopperFixtureLauncher(
    undefined,
    "quiet",
    "ready",
    "acknowledge",
    "none",
    ceiling,
  );
  const client = trackHopperClient(
    new HopperClient({
      launcher,
      startupTimeoutMs: 10_000,
      bridgeMaxRequestBytes: limit(ceiling),
    }),
  );
  expect((await client.start()).ok).toBe(true);
  const value = "h".repeat(16 * 1024 * 1024);
  // The fixture echoes the payload. That reply is the proof the pre-dispatch
  // check admitted a request above the historical 16 MiB ceiling. The fixture's
  // IPC acknowledgement is not used here; a 16 MiB params object is not a
  // reliable control message.
  await expect(client.callTool("echo", { value })).resolves.toEqual({
    ok: true,
    value: { value },
  });
});
