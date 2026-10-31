import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { TestReverseEngineeringService as ReverseEngineeringService } from "../support/reverseEngineeringService.js";

type PromiseOutcome<Value> =
  | { readonly status: "fulfilled"; readonly value: Value }
  | { readonly status: "rejected"; readonly reason: unknown }
  | { readonly status: "timeout" };

const settleWithin = async <Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<PromiseOutcome<Value>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): PromiseOutcome<Value> => ({ status: "fulfilled", value }),
        (reason: unknown): PromiseOutcome<Value> => ({
          status: "rejected",
          reason,
        }),
      ),
      new Promise<PromiseOutcome<Value>>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const processIsRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return !(
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "ESRCH"
    );
  }
};

const waitForProcessExit = async (
  pid: number,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !processIsRunning(pid);
};

const killProcessAndWait = async (
  pid: number,
  timeoutMs: number,
): Promise<boolean> => {
  try {
    process.kill(pid, "SIGKILL");
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH"))
      throw cause;
  }
  return waitForProcessExit(pid, timeoutMs);
};

type CancellationResult = Awaited<
  ReturnType<ReverseEngineeringService["executeRizinCommand"]>
>;

interface CancellationProcessMarkers {
  readonly providerPid: string;
  readonly descendantPid: string;
  readonly descendantStarted: string;
}

interface CancellationProcessIds {
  readonly providerPid: number;
  readonly descendantPid: number;
}

const readProcessMarker = async (path: string): Promise<number | undefined> => {
  const text = await readFile(path, "utf8").catch(() => "");
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
};

const waitForCancellationProcesses = async (
  markers: CancellationProcessMarkers,
): Promise<CancellationProcessIds> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const [providerPid, descendantPid, descendantStarted] = await Promise.all([
      readProcessMarker(markers.providerPid),
      readProcessMarker(markers.descendantPid),
      readFile(markers.descendantStarted).then(
        () => true,
        () => false,
      ),
    ]);
    if (
      providerPid !== undefined &&
      descendantPid !== undefined &&
      descendantStarted
    )
      return { providerPid, descendantPid };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("Rizin provider and descendant did not start in time.");
};

const killCancellationProcesses = async (
  ids: CancellationProcessIds,
): Promise<void> => {
  expect(await killProcessAndWait(ids.providerPid, 2_000)).toBe(true);
  expect(await killProcessAndWait(ids.descendantPid, 2_000)).toBe(true);
};

const settleCancelledProvider = async (
  pending: Promise<CancellationResult>,
): Promise<CancellationResult> => {
  const outcome = await settleWithin(pending, 7_000);
  if (outcome.status === "timeout")
    throw new Error("Rizin cancellation did not settle before its deadline");
  if (outcome.status === "rejected") throw outcome.reason;
  return outcome.value;
};

const expectCancelledResult = (result: CancellationResult): void => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cleanup).toBeUndefined();
  expect(result.error.capturedOutput).toMatchObject({
    stdout: "provider output before cancellation",
    stderr: "",
    truncated: false,
    exit_code: null,
    signal: "SIGKILL",
  });
  expect(result.error.cause).toBeInstanceOf(Error);
  expect(result.error.partialObservation).toMatchObject({
    raw_result: {
      stdout: "provider output before cancellation",
      completion_status: "unknown",
    },
  });
};

const cleanupCancellationScenario = async (options: {
  readonly controller: AbortController;
  readonly pending: Promise<CancellationResult> | undefined;
  readonly service: ReverseEngineeringService;
  readonly processIds: CancellationProcessIds | undefined;
  readonly directory: string;
}): Promise<void> => {
  options.controller.abort();
  try {
    if (options.pending !== undefined) {
      try {
        if (options.processIds !== undefined)
          await settleCancelledProvider(options.pending);
        else await settleWithin(options.pending, 10_000);
      } catch {
        // Main assertions report operation failures; continue cleanup.
      }
    }
    let cleanup = await settleWithin(options.service.close(), 7_000);
    if (cleanup.status === "timeout" && options.processIds !== undefined) {
      await killCancellationProcesses(options.processIds);
      cleanup = await settleWithin(options.service.close(), 3_000);
    }
    if (cleanup.status === "timeout")
      throw new Error("Service cleanup did not settle within its deadline.");
    if (cleanup.status === "rejected") throw cleanup.reason;
    if (options.processIds !== undefined) {
      for (const pid of [
        options.processIds.providerPid,
        options.processIds.descendantPid,
      ]) {
        if (processIsRunning(pid)) await killProcessAndWait(pid, 2_000);
      }
    }
  } finally {
    await rm(options.directory, { recursive: true, force: true });
  }
};

it("uses stoppable process mode for caller-selected provider commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-rizin-stoppable-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  let received: Record<string, unknown> | undefined;
  const service = new ReverseEngineeringService({
    run: async (_command, _args, options) => {
      received = options as Record<string, unknown>;
      return { stdout: "", stderr: "" };
    },
  });

  try {
    await service.executeRizinCommand({ path, command: "iI" });
    expect(received?.stopSignal).toBe("SIGTERM");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "waits for a cancelled Rizin process to exit before returning",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-rizin-cancel-settle-"));
    const path = join(directory, "fixture.bin");
    const providerPidMarker = join(directory, "provider-pid");
    const descendantStartedMarker = join(directory, "descendant-started");
    const descendantPidMarker = join(directory, "descendant-pid");
    const provider = join(directory, "slow-rizin.mjs");
    const descendantScript = [
      "const fs = require('node:fs');",
      "process.on('SIGTERM', () => {});",
      "fs.writeFileSync(process.env.REA_TEST_DESCENDANT_STARTED, 'started');",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    await writeFile(path, "before");
    await writeFile(
      provider,
      `#!${process.execPath}
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync(process.env.REA_TEST_PROVIDER_PID, String(process.pid));
process.stdout.write("provider output before cancellation");
const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { env: process.env, stdio: "ignore" });
writeFileSync(process.env.REA_TEST_DESCENDANT_PID, String(child.pid));
setInterval(() => {}, 1000);
`,
    );
    await chmod(provider, 0o755);
    const controller = new AbortController();
    const service = new ReverseEngineeringService({
      environment: {
        REA_RIZIN_COMMAND: provider,
        REA_TEST_ARTIFACT: path,
        REA_TEST_PROVIDER_PID: providerPidMarker,
        REA_TEST_DESCENDANT_STARTED: descendantStartedMarker,
        REA_TEST_DESCENDANT_PID: descendantPidMarker,
      },
    });

    let pending: ReturnType<typeof service.executeRizinCommand> | undefined;
    let processIds: CancellationProcessIds | undefined;
    try {
      pending = service.executeRizinCommand(
        { path, command: "sleep" },
        { signal: controller.signal },
      );
      processIds = await waitForCancellationProcesses({
        providerPid: providerPidMarker,
        descendantPid: descendantPidMarker,
        descendantStarted: descendantStartedMarker,
      });
      controller.abort();

      expectCancelledResult(await settleCancelledProvider(pending));
      expect(await readFile(path, "utf8")).toBe("before");
      expect(await waitForProcessExit(processIds.descendantPid, 2_000)).toBe(
        true,
      );
      expect(await waitForProcessExit(processIds.providerPid, 2_000)).toBe(
        true,
      );
    } finally {
      await cleanupCancellationScenario({
        controller,
        pending,
        service,
        processIds,
        directory,
      });
    }
  },
);
