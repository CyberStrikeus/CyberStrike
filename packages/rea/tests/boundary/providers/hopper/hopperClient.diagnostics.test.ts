import { access } from "node:fs/promises";

import { expect, it, onTestFinished, vi } from "vitest";

import { HopperTimeoutError } from "../../../../src/domain/hopperErrors.js";
import {
  HopperClient,
  HOPPER_PROCESS_DIAGNOSTIC_BYTES,
} from "../../../../src/hopper/HopperClient.js";
import { HopperFixtureLauncher } from "./hopperClient.fixture.js";

const expectStoppedLauncher = (launcher: HopperFixtureLauncher): void => {
  const child = launcher.processes[0];
  if (child === undefined) throw new Error("Diagnostic fixture did not launch");
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
};

it("bounds long-lived launcher output while keeping the bridge usable", async () => {
  let observedStderrBytes = 0;
  const diagnosticLauncher = new HopperFixtureLauncher(undefined, "noisy");
  const client = new HopperClient({
    launcher: diagnosticLauncher,
    startupTimeoutMs: 10_000,
    onDiagnostic(event) {
      if (event.type === "launcher-stderr") observedStderrBytes += event.bytes;
    },
  });
  onTestFinished(async () => {
    await client.close();
  });

  await expect(client.start()).resolves.toMatchObject({ ok: true });
  const session = await client.callTool("echo", { value: "still usable" });
  expect(session).toEqual({ ok: true, value: { value: "still usable" } });
  await vi.waitFor(() => {
    expect(observedStderrBytes).toBeGreaterThan(
      HOPPER_PROCESS_DIAGNOSTIC_BYTES,
    );
  });

  await client.close();
  const directory = diagnosticLauncher.directories[0] ?? "";
  await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  expectStoppedLauncher(diagnosticLauncher);
});

it("reports observed and retained output when capture cuts a token", async () => {
  const diagnosticLauncher = new HopperFixtureLauncher(
    undefined,
    "noisy_no_socket",
  );
  const client = new HopperClient({
    launcher: diagnosticLauncher,
    startupTimeoutMs: 1_000,
  });
  onTestFinished(async () => {
    await client.close();
  });

  const started = await client.start();
  if (started.ok || !(started.error instanceof HopperTimeoutError))
    throw new Error("Expected the no-socket fixture to time out");
  const outcome = started.error.launcherOutcome;
  expect(outcome).toMatchObject({ diagnostic_truncated: true });
  if (outcome === undefined) throw new Error("Launcher outcome was omitted");
  expect(outcome.stdout.bytes + outcome.stderr.bytes).toBeGreaterThan(
    HOPPER_PROCESS_DIAGNOSTIC_BYTES,
  );
  expect(
    outcome.stdout.retained_bytes + outcome.stderr.retained_bytes,
  ).toBeLessThanOrEqual(HOPPER_PROCESS_DIAGNOSTIC_BYTES);
  expect(outcome.stdout.bytes).toBeGreaterThanOrEqual(
    outcome.stdout.retained_bytes,
  );
  expect(outcome.stderr.bytes).toBeGreaterThanOrEqual(
    outcome.stderr.retained_bytes,
  );
  expect(outcome.stderr.retained_bytes).toBe(HOPPER_PROCESS_DIAGNOSTIC_BYTES);
  const token = diagnosticLauncher.tokens[0] ?? "";
  expect(JSON.stringify(outcome)).not.toContain(token);
  expect(`${outcome.stdout.text}${outcome.stderr.text}`).toContain(
    "[redacted transport credential]",
  );
  expect(
    outcome.stderr.text.endsWith(
      "source=/tmp/local-evidence.bin?cursor=keep&[redacted transport credential]",
    ),
  ).toBe(true);

  await client.close();
  const directory = diagnosticLauncher.directories[0] ?? "";
  await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  expectStoppedLauncher(diagnosticLauncher);
});
