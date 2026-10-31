import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, onTestFinished, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

import {
  captureProcessScenario,
  type FinalizationHost,
} from "../../../src/process/capture/ProcessHarness.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { snapshotRoots } from "../../../src/process/capture/FilesystemSnapshot.js";
import { ProcessCaptureError } from "../../../src/process/capture/ProcessCaptureError.js";
import { expectUnverifiedHostCleanup } from "../../support/hostCleanup.js";
import {
  ProcessCaptureResourceScope,
  type ProcessCaptureCleanupHost,
  observeLaunchedExecutable,
  observeSelectedExecutable,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { emptyProcessCapture } from "../../../src/domain/process/processCapture.fixture.js";
import { processSourceTruncated } from "../../../src/domain/process/processCaptureCoverage.js";
import type { ProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";

const processFixture = fileURLToPath(
  new URL("../../fixtures/processFidelity.mjs", import.meta.url),
);
const snapshotCancellationFixture = fileURLToPath(
  new URL("../../fixtures/processSnapshotCancellation.mjs", import.meta.url),
);
const execFileAsync = promisify(execFile);

type CaptureRun = Awaited<ReturnType<typeof captureProcessScenario>>;
type PartialCapture = Extract<
  NonNullable<ProcessCaptureError["partialObservation"]>,
  { readonly capture: unknown }
>["capture"];
const emptyFilesystemCoverage =
  emptyProcessCapture().truncation_details.filesystem_before;
const captureObservations = (
  result: CaptureRun,
): {
  readonly capture: ProcessCapture | PartialCapture;
  readonly cleanupIncomplete: boolean;
} => {
  if (result.ok) return { capture: result.value, cleanupIncomplete: false };
  if (!(result.error instanceof ProcessCaptureError)) throw result.error;
  expectUnverifiedHostCleanup(result.error);
  const partial = result.error.partialObservation;
  if (partial === undefined || !("capture" in partial))
    throw new Error(
      "cleanup-incomplete capture omitted completed observations",
    );
  const capture = partial.capture;
  expect(capture.settlement.cleanup_outcome).toBe("failed");
  return { capture, cleanupIncomplete: true };
};

const processState = async (pid: number): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "stat=",
      "-p",
      String(pid),
    ]);
    return stdout.trim() || undefined;
  } catch (cause: unknown) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      cause.code === 1 &&
      "stdout" in cause &&
      cause.stdout === ""
    )
      return undefined;
    throw cause;
  }
};

const waitForProcessExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const state = await processState(pid);
    if (state === undefined || state.startsWith("Z")) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${String(pid)} did not exit within the test bound`);
};

const readDetachedFixturePids = async (marker: string): Promise<number[]> => {
  let contents: string;
  try {
    contents = await readFile(marker, "utf8");
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      return [];
    throw cause;
  }
  const parsed: unknown = JSON.parse(contents);
  if (typeof parsed !== "object" || parsed === null) return [];
  const candidatePids = [
    "ownedPid" in parsed ? parsed.ownedPid : undefined,
    "unownedPid" in parsed ? parsed.unownedPid : undefined,
  ];
  return candidatePids.flatMap((pid) =>
    typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1
      ? [pid]
      : [],
  );
};

const terminateFixtureProcess = async (pid: number): Promise<void> => {
  try {
    process.kill(pid, "SIGKILL");
  } catch (cause: unknown) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH"))
      throw cause;
  }
  await waitForProcessExit(pid);
};

itWithCaptureCapability(
  "retains a deleted observed file when its parent becomes a regular file",
  async () => {
    const root = await createTestTempDirectory("rea-observed-parent-type-");
    const payload = '{"result":42}\n';
    await mkdir(join(root, "reports"));
    await writeFile(join(root, "reports", "final.json"), payload);
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [
          "-e",
          `const fs = require('node:fs');
           fs.renameSync('reports', 'saved-reports');
           fs.writeFileSync('reports', 'regular file'); console.log('finished');`,
        ],
        working_directory: root,
        filesystem_observation_paths: [join(root, "reports", "final.json")],
        timeout_ms: 5_000,
        idle_timeout_ms: 5_000,
        settle_ms: 100,
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(result.value.filesystem_effects).toContainEqual(
      expect.objectContaining({
        path: "root_0:.",
        status: "deleted",
        before: expect.objectContaining({
          type: "file",
          sha256: createHash("sha256").update(payload).digest("hex"),
        }),
        after: null,
      }),
    );
    expect(
      await readFile(join(root, "saved-reports", "final.json"), "utf8"),
    ).toBe(payload);
  },
);

itWithCaptureCapability(
  "keeps the process deadline bounded when the wall clock moves backward",
  async ({ signal }) => {
    let wallNow = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => wallNow);
    const resources = new ProcessCaptureResourceScope();
    let reachedRunning = false;
    onTestFinished(async () => {
      now.mockRestore();
      await resources.close();
    }, 10_000);
    try {
      const result = await captureProcessScenario(
        processScenarioSchema.parse({
          executable: process.execPath,
          arguments: [processFixture, "hang"],
          working_directory: dirname(processFixture),
          timeout_ms: 100,
          idle_timeout_ms: 5_000,
        }),
        signal,
        process.platform,
        process.env,
        undefined,
        undefined,
        {
          async report(update) {
            if (update.phase === "running" && !reachedRunning) {
              reachedRunning = true;
              wallNow -= 60_000;
            }
          },
        },
        resources,
      );
      expect(reachedRunning).toBe(true);
      const { capture } = captureObservations(result);
      expect(capture.exit.reason).toBe("timeout");
    } finally {
      now.mockRestore();
    }
  },
  10_000,
);

itWithCaptureCapability(
  "preserves reversed wall-clock observations and monotonic frames across capture",
  async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    try {
      const result = await captureProcessScenario(
        processScenarioSchema.parse({
          executable: process.execPath,
          arguments: [processFixture, "partial"],
          working_directory: dirname(processFixture),
          settle_ms: 0,
          timeout_ms: 5_000,
          idle_timeout_ms: 5_000,
        }),
        undefined,
        process.platform,
        process.env,
        undefined,
        undefined,
        {
          async report(update) {
            if (update.phase === "running")
              vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
          },
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value.frames.length).toBeGreaterThan(0);
      expect(Date.parse(result.value.manifest.completed_at)).toBeLessThan(
        Date.parse(result.value.manifest.started_at),
      );
      expect(result.value.limitations).toContain(
        "Wall-clock completion time precedes start time; elapsed capture timing is recorded separately and remains monotonic.",
      );
      expect(
        result.value.frames.map(({ at_ms }) => at_ms),
        "capture-relative frame times stay ordered and nonnegative",
      ).toEqual(
        result.value.frames
          .map(({ at_ms }) => at_ms)
          .sort((left, right) => left - right),
      );
      expect(result.value.frames.every(({ at_ms }) => at_ms >= 0)).toBe(true);
      expect(result.value.exit.reason).toBe("exited");
      expect(result.value.settlement.elapsed_ms).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  },
  10_000,
);

itWithCaptureCapability(
  "cleans detached run-token children omitted by sampling and preserves an unowned neighbor",
  async () => {
    const root = await createTestTempDirectory("rea-detached-cleanup-");
    const pidMarker = join(root, "children.json");
    let ownedPid: number | undefined;
    let unownedPid: number | undefined;
    try {
      const result = await captureProcessScenario(
        processScenarioSchema.parse({
          executable: process.execPath,
          arguments: [processFixture, "detached-cleanup", pidMarker],
          working_directory: root,
          settle_ms: 0,
          timeout_ms: 5_000,
          idle_timeout_ms: 5_000,
          limits: { processes: 1 },
        }),
      );
      const { capture, cleanupIncomplete } = captureObservations(result);
      const parsed: unknown = JSON.parse(await readFile(pidMarker, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("ownedPid" in parsed) ||
        typeof parsed.ownedPid !== "number" ||
        !("unownedPid" in parsed) ||
        typeof parsed.unownedPid !== "number"
      )
        throw new TypeError("detached-child fixture wrote invalid PIDs");
      // Register fixture children before assertions so teardown can clean them
      // even when a later expectation fails.
      ownedPid = parsed.ownedPid;
      unownedPid = parsed.unownedPid;
      expect(capture.process_samples.some(({ pid }) => pid === ownedPid)).toBe(
        false,
      );
      if (cleanupIncomplete)
        expect(capture.settlement.cleanup_outcome).toBe("failed");
      else
        expect(result.ok && result.value.cleanup.owned_process_group).toBe(
          "verified",
        );
      await waitForProcessExit(ownedPid);
      const unownedState = await processState(unownedPid);
      expect(unownedState).toBeDefined();
      expect(unownedState?.startsWith("Z")).toBe(false);
    } finally {
      try {
        let fixturePids: number[] = [];
        let teardownFailure: unknown;
        try {
          fixturePids = await readDetachedFixturePids(pidMarker);
        } catch (cause: unknown) {
          teardownFailure = cause;
        }
        for (const pid of new Set([
          ...fixturePids,
          ...(ownedPid === undefined ? [] : [ownedPid]),
          ...(unownedPid === undefined ? [] : [unownedPid]),
        ])) {
          try {
            await terminateFixtureProcess(pid);
          } catch (cause: unknown) {
            teardownFailure ??= cause;
          }
        }
        if (teardownFailure !== undefined) throw teardownFailure;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  10_000,
);

itWithCaptureCapability(
  "retains collected observations when completion and cleanup both fail",
  async () => {
    let snapshotCalls = 0;
    const snapshotObserverPaths: string[][] = [];
    const captureSnapshot: typeof snapshotRoots = async (
      _scenario,
      _signal,
      _before,
      resources,
    ) => {
      snapshotObserverPaths.push([...(resources?.observerPaths ?? [])]);
      snapshotCalls += 1;
      if (snapshotCalls === 1)
        return {
          files: [],
          truncated: false,
          completeRoots: [],
          coverage: emptyFilesystemCoverage,
        };
      throw new Error("fixture final snapshot failure");
    };
    const cleanupHost: ProcessCaptureCleanupHost = {
      platform: process.platform,
      cleanupProcessGroup: async () => ({
        cleaned: false,
        reason: "fixture cleanup could not be verified",
      }),
      removeTemporaryRoot: async (path) =>
        rm(path, { recursive: true, force: true }),
    };
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "partial"],
        working_directory: dirname(processFixture),
        settle_ms: 0,
        timeout_ms: 5_000,
        idle_timeout_ms: 5_000,
      }),
      undefined,
      process.platform,
      process.env,
      captureSnapshot,
      cleanupHost,
    );

    if (result.ok) throw new Error("expected cleanup-incomplete failure");
    if (!(result.error instanceof ProcessCaptureError)) throw result.error;
    const partial = result.error.partialObservation;
    expect(result.error.reason).toBe("cleanup_incomplete");
    expect(result.error.executionFailure).toBe(
      "fixture final snapshot failure",
    );
    const temporaryRoot = snapshotObserverPaths[0]?.[0];
    if (temporaryRoot === undefined)
      throw new Error("expected the owned temporary root in snapshot inputs");
    expect(snapshotObserverPaths).toEqual([[temporaryRoot], [temporaryRoot]]);
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        cleanup: "incomplete",
        resources: ["owned_process_group", temporaryRoot],
      },
    });
    expect(projected).not.toHaveProperty("stack");
    expect(projected).not.toHaveProperty("cause");
    expect(partial).toBeDefined();
    if (partial === undefined || !("observations" in partial))
      throw new Error("expected incomplete process observations");
    const observations = partial.observations;
    expect(
      Object.keys(observations),
      "a default scenario keeps the base observation keys through the run path",
    ).not.toContain("finalization");
    expect(observations.frames.state).toBe("available");
    if (observations.frames.state !== "available")
      throw new Error("expected terminal output observations");
    expect(
      observations.frames.value.map(({ data }) => data).join(""),
    ).toContain("partial-frame");
    expect(observations.rendered_frames.state).toBe("available");
    if (observations.rendered_frames.state !== "available")
      throw new Error("expected rendered terminal observations");
    expect(observations.rendered_frames.value.length).toBeGreaterThan(0);
    expect(observations.interaction_events.state).toBe("available");
    expect(observations.exit).toMatchObject({
      state: "available",
      value: { reason: "exited" },
    });
    expect(observations.settlement.state).toBe("available");
    expect(observations.process_samples.state).toBe("available");
    expect(observations.target_pid).toEqual({ state: "available", value: 1 });
    expect(observations.filesystem_snapshots.before.state).toBe("available");
    if (observations.filesystem_snapshots.before.state !== "available")
      throw new Error("expected initial filesystem snapshot");
    expect(observations.filesystem_snapshots.before.value.truncated).toBe(
      false,
    );
    expect(observations.filesystem_snapshots.after).toEqual({
      state: "unavailable",
      reason:
        "Final filesystem snapshot failed: fixture final snapshot failure",
    });
    expect(observations.event_journal.state).toBe("available");
    if (observations.event_journal.state !== "available")
      throw new Error("expected capture event journal");
    expect(
      observations.event_journal.value.some(
        ({ collection }) => collection === "lifecycle",
      ),
    ).toBe(true);
    expect(observations.manifest.state).toBe("unavailable");
    expect(snapshotCalls).toBe(2);
  },
  10_000,
);

itWithCaptureCapability(
  "keeps selected executable evidence separate when the path identity changes before validation",
  async () => {
    const root = await createTestTempDirectory("rea-executable-replaced-");
    const executable = join(root, "selected-executable");
    await symlink(process.execPath, executable);
    try {
      const selected = await observeSelectedExecutable(executable);
      expect(selected.sha256).toMatch(/^[a-f0-9]{64}$/u);
      await rm(executable);
      await symlink("/bin/sh", executable);
      expect(observeLaunchedExecutable(executable, selected)).toEqual({
        selectedSha256: selected.sha256,
        sha256: null,
        state: "unknown",
        reason: "Executable path metadata changed between sampling and spawn.",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

itWithCaptureCapability(
  "keeps the prelaunch executable sample when the selected path is replaced during capture",
  async () => {
    const root = await createTestTempDirectory("rea-executable-identity-");
    const executable = join(root, "selected-executable");
    const readyMarker = join(root, "child-ready");
    await symlink(process.execPath, executable);
    const launchedDigest = createHash("sha256")
      .update(await readFile(process.execPath))
      .digest("hex");
    try {
      const capturePromise = captureProcessScenario(
        processScenarioSchema.parse({
          executable,
          arguments: [processFixture, "ready-hang", readyMarker],
          working_directory: root,
          timeout_ms: 1_500,
          idle_timeout_ms: 5_000,
        }),
      );
      const deadline = Date.now() + 2_000;
      let ready = false;
      while (!ready && Date.now() < deadline) {
        try {
          await access(readyMarker);
          ready = true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      expect(ready).toBe(true);
      await rm(executable);
      await symlink("/bin/sh", executable);
      const result = await capturePromise;
      const { capture } = captureObservations(result);
      expect(capture.manifest).toMatchObject({
        selected_executable_sha256: launchedDigest,
        executable_sha256: launchedDigest,
        executable_identity: {
          state: "path_metadata_unchanged",
          reason: null,
        },
      });
      expect(capture.exit.reason).toBe("timeout");
      expect(capture.limitations).toContain(
        "The executable digest is a prelaunch file sample; matching path metadata immediately after spawn does not prove an atomic operating-system image binding.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  10_000,
);

itWithCaptureCapability(
  "records external symlink metadata without following the target",
  async () => {
    const root = await createTestTempDirectory("rea-symlink-test-");
    await symlink("/etc/passwd", join(root, "escape"));
    try {
      const result = await captureProcessScenario(
        processScenarioSchema.parse({
          executable: "/usr/bin/true",
          working_directory: root,
          filesystem_observation_paths: [root],
        }),
      );
      const { capture } = captureObservations(result);
      const escaped = capture.files_after.find((file) =>
        file.path.endsWith(":escape"),
      );
      expect(escaped?.symlink_target).toBe("/etc/passwd");
      expect(processSourceTruncated(capture, "filesystem")).toBe(true);
      for (const coverage of [
        capture.truncation_details.filesystem_before,
        capture.truncation_details.filesystem_after,
      ]) {
        expect(coverage.enumeration_reasons).toContain("symlink_not_followed");
        expect(coverage.enumeration_omissions).toContainEqual({
          path: escaped?.path,
          reason: "symlink_not_followed",
          system_code: null,
        });
      }
      expect(JSON.stringify(capture.files_after)).not.toContain(root);
      expect(
        capture.files_after.some((file) => file.path.includes("passwd")),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

itWithCaptureCapability(
  "distinguishes timeout from cancellation and cleans both runs",
  async () => {
    const timedOut = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "hang"],
        working_directory: dirname(processFixture),
        timeout_ms: 50,
        idle_timeout_ms: 5_000,
      }),
    );
    const timedOutCapture = captureObservations(timedOut);
    expect(timedOutCapture.capture.exit.reason).toBe("timeout");
    if (!timedOutCapture.cleanupIncomplete && timedOut.ok) {
      expect(timedOut.value.cleanup).toMatchObject({
        owned_process_group: "verified",
        temporary_root: "removed",
      });
      for (const { pid } of timedOut.value.cleanup.unverified_processes ?? []) {
        expect(timedOut.value.residual_unknowns).toContainEqual({
          scope: "process",
          reason: expect.stringContaining(
            `${String(pid)} could not be verified`,
          ),
        });
      }
    }

    const controller = new AbortController();
    let reachedRunning = false;
    const cancelled = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "hang"],
        working_directory: dirname(processFixture),
        timeout_ms: 5_000,
        idle_timeout_ms: 5_000,
      }),
      controller.signal,
      process.platform,
      process.env,
      undefined,
      undefined,
      {
        async report(update) {
          if (update.phase === "running") {
            reachedRunning = true;
            controller.abort();
          }
        },
      },
    );
    if (cancelled.ok) throw new Error("expected cancellation");
    expect(reachedRunning).toBe(true);
    if (!(cancelled.error instanceof ProcessCaptureError))
      throw cancelled.error;
    if (cancelled.error.cleanupIncomplete)
      expectUnverifiedHostCleanup(cancelled.error);
    else
      expect(cancelled.error.cleanupReport).toMatchObject({
        owned_process_group: { state: "cleaned" },
        terminal_renderer: { state: "cleaned" },
        temporary_root: { state: "cleaned" },
      });
    const cancellation = cancelled.error.cleanupIncomplete
      ? cancelled.error.cause
      : cancelled.error;
    expect(cancellation, cancelled.error.message).toMatchObject({
      reason: "cancelled",
      userCategory: "cancelled",
    });
    expect(cancelled.error.partialObservation).toMatchObject({
      observations: {
        exit: { state: "available", value: { reason: "cancelled" } },
      },
    });
  },
);

const finalizationFixture = fileURLToPath(
  new URL("../../fixtures/processFinalization.mjs", import.meta.url),
);

const captureFinalizationFixture = async (
  mode: "cooperative" | "ignoring" | "exits",
  scenario: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<{ readonly result: CaptureRun; readonly root: string }> => {
  const root = await createTestTempDirectory("rea-finalization-");
  const result = await captureProcessScenario(
    processScenarioSchema.parse({
      executable: process.execPath,
      arguments: [finalizationFixture, mode, root],
      working_directory: root,
      filesystem_observation_paths: [root],
      idle_timeout_ms: 10_000,
      ...scenario,
    }),
    signal,
  );
  return { result, root };
};

const observedFile = (
  capture: ProcessCapture | PartialCapture,
  name: string,
): { readonly sha256: string | null } | undefined =>
  capture.files_after.find((file) => file.path.endsWith(name));

itWithCaptureCapability(
  "lets a cooperative target write its final report within the finalization interval",
  async () => {
    // The deadline leaves Node enough time to register its SIGTERM handler.
    const { result } = await captureFinalizationFixture("cooperative", {
      timeout_ms: 1_500,
      finalization_ms: 1_500,
    });
    const { capture } = captureObservations(result);

    expect(capture.exit.reason, "initiating deadline stays the reason").toBe(
      "timeout",
    );
    expect(
      capture.exit.code,
      "a deadline reason never declares a normal exit code",
    ).toBeNull();
    expect(capture.exit.finalization, "finalization is recorded").toMatchObject(
      {
        requested_ms: 1_500,
        exit_code: 0,
        signals: [{ signal: "SIGTERM", delivery: "signaled" }],
      },
    );
    expect(
      capture.exit.finalization?.elapsed_ms,
      "a cooperative exit ends before the interval does",
    ).toBeLessThan(1_500);
    expect(
      observedFile(capture, "final.json")?.sha256,
      "final report is retained with a digest",
    ).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      capture.frames.map(({ data }) => data).join(""),
      "output written during finalization is captured",
    ).toContain("finalized");
  },
  15_000,
);

itWithCaptureCapability(
  "records no finalization when the target exits before any deadline",
  async () => {
    const { result } = await captureFinalizationFixture("exits", {
      finalization_ms: 1_500,
    });
    const { capture } = captureObservations(result);

    expect(capture.exit.reason, "the target exited on its own").toBe("exited");
    expect(capture.exit.code, "its exit code is kept").toBe(0);
    expect(
      capture.exit,
      "no deadline fired, so nothing was finalized",
    ).not.toHaveProperty("finalization");
  },
  15_000,
);

itWithCaptureCapability(
  "starts finalization when the idle deadline fires",
  async () => {
    const { result } = await captureFinalizationFixture("cooperative", {
      timeout_ms: 10_000,
      idle_timeout_ms: 1_500,
      finalization_ms: 1_200,
    });
    const { capture } = captureObservations(result);

    expect(capture.exit.reason, "idle deadline is the initiating reason").toBe(
      "idle_timeout",
    );
    expect(
      capture.exit.finalization,
      "idle finalization is recorded",
    ).toMatchObject({
      requested_ms: 1_200,
      signals: [{ signal: "SIGTERM", delivery: "signaled" }],
    });
    expect(
      observedFile(capture, "final.json")?.sha256,
      "final report is retained with a digest",
    ).toMatch(/^[0-9a-f]{64}$/u);
  },
  15_000,
);

itWithCaptureCapability(
  "forces the kill when the target ignores the finalization signal",
  async () => {
    const { result } = await captureFinalizationFixture("ignoring", {
      timeout_ms: 500,
      finalization_ms: 1_500,
    });
    const { capture } = captureObservations(result);

    expect(capture.exit.reason, "initiating deadline stays the reason").toBe(
      "timeout",
    );
    expect(
      capture.exit.finalization,
      "finalization attempts are recorded",
    ).toMatchObject({
      requested_ms: 1_500,
      signals: [
        { signal: "SIGTERM", delivery: "signaled" },
        { signal: "SIGKILL", delivery: "signaled" },
      ],
    });
    expect(
      capture.exit.signal,
      "the target that ignores SIGTERM and SIGINT ends on SIGKILL",
    ).toBe(9);
    expect(
      capture.exit.finalization?.elapsed_ms,
      "the whole interval elapsed before the kill",
    ).toBeGreaterThanOrEqual(1_500);
    expect(
      capture.exit.finalization?.elapsed_ms,
      "the kill followed the interval promptly",
    ).toBeLessThan(4_000);
    expect(
      observedFile(capture, "final.json"),
      "an ignored signal writes no final report",
    ).toBeUndefined();
  },
  15_000,
);

itWithCaptureCapability(
  "keeps the immediate kill when no finalization interval is configured",
  async () => {
    const { result } = await captureFinalizationFixture("cooperative", {
      timeout_ms: 500,
    });
    const { capture } = captureObservations(result);

    expect(capture.exit.reason, "deadline reason is unchanged").toBe("timeout");
    expect(
      capture.exit.signal,
      "the default deadline still ends on SIGKILL",
    ).toBe(9);
    expect(
      capture.exit,
      "default captures carry no finalization record",
    ).not.toHaveProperty("finalization");
    expect(
      observedFile(capture, "final.json"),
      "SIGKILL leaves no final report",
    ).toBeUndefined();
  },
  15_000,
);

itWithCaptureCapability(
  "cancels before any deadline without starting finalization",
  async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_500);
    const started = Date.now();
    const { result } = await captureFinalizationFixture(
      "ignoring",
      { timeout_ms: 20_000, finalization_ms: 20_000 },
      controller.signal,
    );

    if (result.ok) throw new Error("expected cancellation");
    if (!(result.error instanceof ProcessCaptureError)) throw result.error;
    const partial = result.error.partialObservation;
    if (partial === undefined || !("observations" in partial))
      throw new Error("expected cancelled process observations");
    expect(
      partial.observations.exit,
      "cancellation before any deadline is not a finalization",
    ).toMatchObject({ state: "available", value: { reason: "cancelled" } });
    expect(
      partial.observations.exit,
      "no SIGTERM interval ran, so no finalization record exists",
    ).not.toHaveProperty("value.finalization");
    expect(
      Date.now() - started,
      "cancellation does not wait for either deadline",
    ).toBeLessThan(10_000);
  },
  15_000,
);

itWithCaptureCapability(
  "cancels immediately while a finalization interval is running",
  async () => {
    const controller = new AbortController();
    // Abort well after the 300 ms deadline so finalization is already running.
    setTimeout(() => controller.abort(), 2_000);
    const started = Date.now();
    const { result } = await captureFinalizationFixture(
      "ignoring",
      { timeout_ms: 300, finalization_ms: 20_000 },
      controller.signal,
    );

    if (result.ok) throw new Error("expected cancellation");
    if (!(result.error instanceof ProcessCaptureError)) throw result.error;
    const partial = result.error.partialObservation;
    if (partial === undefined || !("observations" in partial))
      throw new Error("expected cancelled process observations");
    expect(
      partial.observations.exit,
      "cancellation is the exit reason and signal attempts are recorded",
    ).toMatchObject({
      state: "available",
      value: {
        reason: "cancelled",
        finalization: {
          requested_ms: 20_000,
          signals: [
            { signal: "SIGTERM", delivery: "signaled" },
            { signal: "SIGKILL", delivery: "signaled" },
          ],
        },
      },
    });
    expect(
      partial.observations.finalization,
      "the attempts are published beside the exit, also for a failed run",
    ).toMatchObject({
      state: "available",
      value: {
        requested_ms: 20_000,
        signals: [
          { signal: "SIGTERM", delivery: "signaled" },
          { signal: "SIGKILL" },
        ],
      },
    });
    if (result.error.cleanupIncomplete) {
      expectUnverifiedHostCleanup(result.error);
      expect(
        result.error.executionFailure,
        "the host cleanup error wraps the cancellation",
      ).toBe("process capture was cancelled");
    }
    const cancellation = result.error.cleanupIncomplete
      ? result.error.cause
      : result.error;
    expect(cancellation, "cancellation wins over finalization").toMatchObject({
      reason: "cancelled",
      userCategory: "cancelled",
    });
    expect(
      Date.now() - started,
      "cancellation does not wait for the finalization interval",
    ).toBeLessThan(8_000);
  },
  15_000,
);

itWithCaptureCapability(
  "keeps the attempts when the escalation cannot be delivered through the retained identity",
  async () => {
    const calls: string[] = [];
    let observedAt: number | undefined;
    let firstSignalAt: number | undefined;
    const finalizationHost: FinalizationHost = {
      observe: async () => {
        observedAt ??= performance.now();
        return { state: "readable" as const, identity: "launch" };
      },
      signal: async (_pid, identity, signal) => {
        firstSignalAt ??= performance.now();
        calls.push(`${identity}:${signal}`);
        return signal === "SIGTERM" ? "signaled" : "unverified";
      },
    };
    const root = await createTestTempDirectory("rea-finalization-host-");
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [finalizationFixture, "ignoring", root],
        working_directory: root,
        filesystem_observation_paths: [root],
        idle_timeout_ms: 10_000,
        timeout_ms: 500,
        finalization_ms: 500,
      }),
      undefined,
      process.platform,
      process.env,
      undefined,
      undefined,
      undefined,
      undefined,
      finalizationHost,
    );

    if (result.ok) throw new Error("expected an unobserved exit");
    if (!(result.error instanceof ProcessCaptureError)) throw result.error;
    if (result.error.cleanupIncomplete)
      expectUnverifiedHostCleanup(result.error);
    expect(
      calls,
      "both finalization signals went through the identity-checked host",
    ).toEqual(["launch:SIGTERM", "launch:SIGKILL"]);
    expect(
      (firstSignalAt ?? 0) - (observedAt ?? Number.POSITIVE_INFINITY),
      "the start identity was read at launch, well before the 500 ms deadline signalled",
    ).toBeGreaterThanOrEqual(300);
    const partial = result.error.partialObservation;
    if (partial === undefined || !("observations" in partial))
      throw new Error("expected incomplete process observations");
    expect(
      partial.observations.finalization,
      "the attempts and their delivery results are published for a failed capture",
    ).toMatchObject({
      state: "available",
      value: {
        requested_ms: 500,
        elapsed_ms: null,
        exit_code: null,
        signals: [
          { signal: "SIGTERM", delivery: "signaled" },
          { signal: "SIGKILL", delivery: "unverified" },
        ],
      },
    });
    expect(
      partial.observations.exit.state,
      "no exit is invented when the escalation was not delivered",
    ).toBe("unavailable");
  },
  15_000,
);

itWithCaptureCapability(
  "classifies cancellation raised by the initial filesystem snapshot",
  async () => {
    const root = await createTestTempDirectory("rea-snapshot-initial-cancel-");
    const path = join(root, "input");
    await writeFile(path, "observed\n");
    const controller = new AbortController();
    const { signal } = controller;
    const throwIfAborted = signal.throwIfAborted.bind(signal);
    Object.defineProperty(signal, "throwIfAborted", {
      value: () => {
        controller.abort();
        throwIfAborted();
      },
    });

    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        working_directory: root,
        filesystem_observation_paths: [path],
      }),
      signal,
    );

    if (result.ok) throw new Error("expected initial snapshot cancellation");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cancelled",
      category: "cancelled",
      details: { operation: "process_capture", cleanup: "complete" },
    });
    expect(result.error).toMatchObject({
      reason: "cancelled",
      userCategory: "cancelled",
    });
  },
);

itWithCaptureCapability(
  "classifies cancellation raised by the final filesystem snapshot",
  async () => {
    const root = await createTestTempDirectory("rea-snapshot-final-cancel-");
    const controller = new AbortController();
    let initialSnapshotCompleted = false;
    const captureSnapshot: typeof snapshotRoots = async (scenario, signal) => {
      if (initialSnapshotCompleted) controller.abort();
      const snapshot = await snapshotRoots(scenario, signal);
      initialSnapshotCompleted = true;
      return snapshot;
    };
    const resultPromise = captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [snapshotCancellationFixture, root],
        working_directory: dirname(snapshotCancellationFixture),
        filesystem_observation_paths: [root],
        settle_ms: 0,
      }),
      controller.signal,
      process.platform,
      process.env,
      captureSnapshot,
    );

    const result = await resultPromise;
    if (result.ok) throw new Error("expected final snapshot cancellation");
    expect(initialSnapshotCompleted).toBe(true);
    if (!(result.error instanceof ProcessCaptureError)) throw result.error;
    if (result.error.cleanupIncomplete) {
      expectUnverifiedHostCleanup(result.error);
      expect(result.error.executionFailure).toBe(
        "process capture was cancelled",
      );
    }
    const cancellation = result.error.cleanupIncomplete
      ? result.error.cause
      : result.error;
    expect(cancellation, result.error.message).toMatchObject({
      reason: "cancelled",
      userCategory: "cancelled",
    });
  },
);

itWithCaptureCapability(
  "preserves filesystem errors that are not caller cancellation",
  async () => {
    const root = await createTestTempDirectory("rea-snapshot-io-error-");
    const obstruction = join(root, "not-a-directory");
    await writeFile(obstruction, "file");
    const controller = new AbortController();
    const captureSnapshot: typeof snapshotRoots = async (scenario, signal) => {
      try {
        return await snapshotRoots(scenario, signal);
      } catch (cause: unknown) {
        controller.abort();
        throw cause;
      }
    };

    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        working_directory: root,
        filesystem_observation_paths: [join(obstruction, "child")],
      }),
      controller.signal,
      process.platform,
      process.env,
      captureSnapshot,
    );

    if (result.ok) throw new Error("expected filesystem observation failure");
    expect(result.error).toMatchObject({
      reason: "capture_failed",
      cause: { code: "ENOTDIR" },
    });
  },
);

itWithCaptureCapability(
  "captures input, Unicode, and resize across PTY startup",
  async () => {
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "interactive"],
        working_directory: dirname(processFixture),
        events: [
          { type: "resize", at_ms: 0, columns: 100, rows: 40 },
          { type: "input", at_ms: 0, data: "answer\n" },
        ],
        normalization: { time_bucket_ms: 10 },
        timeout_ms: 20_000,
        idle_timeout_ms: 10_000,
      }),
    );
    const { capture } = captureObservations(result);
    const output = capture.frames.map(({ data }) => data).join("");
    expect(output).toContain("prompt>");
    expect(output).toContain("input:answer unicode:雪");
    expect(output).toContain("resize:100x40");
    expect(capture.interaction_events).toMatchObject([
      { type: "resize", outcome: "dispatched", scheduled_at_ms: 0 },
      { type: "input", outcome: "dispatched", scheduled_at_ms: 0 },
    ]);
    const resized = capture.rendered_frames.find(
      ({ columns, rows, lines }) =>
        columns === 100 &&
        rows === 40 &&
        lines.join("\n").includes("input:answer unicode:雪"),
    );
    expect(resized).toBeDefined();
    expect(resized?.lines.join("\n")).toContain("input:answer unicode:雪");
    expect(capture.exit.code).toBe(0);
  },
);

itWithCaptureCapability(
  "dispatches an external signal without depending on child startup output",
  async () => {
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "hang"],
        working_directory: dirname(processFixture),
        events: [{ type: "signal", at_ms: 0, signal: "SIGTERM" }],
        timeout_ms: 2_000,
        idle_timeout_ms: 2_000,
      }),
    );
    const { capture } = captureObservations(result);
    expect(capture.interaction_events).toMatchObject([
      { type: "signal", data: "SIGTERM", outcome: "dispatched" },
    ]);
    expect(capture.exit).toMatchObject({
      code: null,
      signal: 15,
      reason: "exited",
    });
  },
);

itWithCaptureCapability(
  "buffers newline input until a silent PTY fixture is ready to read it",
  async () => {
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "silent-interactive"],
        working_directory: dirname(processFixture),
        events: [
          { type: "resize", at_ms: 25, columns: 100, rows: 40 },
          { type: "input", at_ms: 50, data: "answer\n" },
        ],
        timeout_ms: 20_000,
        idle_timeout_ms: 20_000,
      }),
    );
    const { capture } = captureObservations(result);
    expect(capture.frames.map(({ data }) => data).join("")).toContain(
      "input:answer",
    );
    expect(capture.interaction_events).toMatchObject([
      { type: "resize", scheduled_at_ms: 25, outcome: "dispatched" },
      { type: "input", scheduled_at_ms: 50, outcome: "dispatched" },
    ]);
    expect(
      capture.interaction_events.every(
        ({ scheduled_at_ms, dispatched_at_ms }) =>
          dispatched_at_ms >= scheduled_at_ms,
      ),
    ).toBe(true);
    expect(
      capture.frames.find(({ data }) => data.includes("input:answer"))?.at_ms,
    ).toBeGreaterThanOrEqual(50);
  },
);

itWithCaptureCapability(
  "samples and cleans a source-owned child and grandchild process tree",
  async () => {
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: [processFixture, "tree"],
        working_directory: dirname(processFixture),
        // The post-capture ps lookup requires OS PIDs, not display identities.
        normalization: { pids: false },
        timeout_ms: 20_000,
        idle_timeout_ms: 20_000,
      }),
    );
    const { capture } = captureObservations(result);
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(capture.frames.map(({ data }) => data).join("")).toContain(
      "tree-ready",
    );
    const commands = capture.process_samples.map(({ command }) => command);
    expect(commands.some((command) => command.includes("tree-child"))).toBe(
      true,
    );
    expect(commands.some((command) => command.includes("forks.js"))).toBe(
      false,
    );
    expect(
      commands.some((command) => command.includes("tree-grandchild")),
    ).toBe(true);
    expect(JSON.stringify(capture.process_samples)).toContain(
      dirname(processFixture),
    );
    // Observe only this run's sampled descendants; never buffer the host table.
    const fixturePids = [
      ...new Set(
        capture.process_samples
          .filter(
            ({ command }) =>
              command.includes(`${processFixture} tree-child`) ||
              command.includes(`${processFixture} tree-grandchild`),
          )
          .map(({ pid }) => pid),
      ),
    ];
    let remainingCommands = "";
    try {
      remainingCommands = (
        await execFileAsync(
          "ps",
          ["-p", fixturePids.join(","), "-o", "command="],
          { maxBuffer: 64 * 1024 },
        )
      ).stdout;
    } catch (cause: unknown) {
      // ps exits 1 with no rows when all selected processes have exited.
      if (
        !(cause instanceof Error) ||
        !("code" in cause) ||
        cause.code !== 1 ||
        !("stdout" in cause) ||
        cause.stdout !== ""
      )
        throw cause;
    }
    expect(remainingCommands).not.toContain(`${processFixture} tree-child`);
    expect(remainingCommands).not.toContain(
      `${processFixture} tree-grandchild`,
    );
  },
  20_000,
);
