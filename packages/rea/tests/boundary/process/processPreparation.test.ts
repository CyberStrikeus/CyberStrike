import { expect, it, vi } from "vitest";

import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { AnalysisAccessDeniedError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  ProcessCaptureResourceScope,
  prepareProcessCapture,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import {
  ProcessCaptureSnapshotFailure,
  snapshotRoots,
} from "../../../src/process/capture/FilesystemSnapshot.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { emptyProcessCapture } from "../../../src/domain/process/processCapture.fixture.js";

const emptyFilesystemCoverage =
  emptyProcessCapture().truncation_details.filesystem_before;

it("prepares ownership inspection before snapshotting or allocating a target run", async () => {
  const failure = new Error("native process identity inspection unavailable");
  const createTemporaryRoot = vi.fn(async () => "/unused");
  const cleanup = vi.fn(async () => undefined);
  const prepareOwnershipInspector = vi.fn(async () => {
    throw failure;
  });
  const captureSnapshot: typeof snapshotRoots = async () => {
    throw new Error("snapshot must not run after failed ownership preflight");
  };

  await expect(
    prepareProcessCapture(
      processScenarioSchema.parse({
        executable: "/bin/true",
        working_directory: "/tmp",
      }),
      undefined,
      captureSnapshot,
      { prepareOwnershipInspector, createTemporaryRoot, cleanup },
    ),
  ).rejects.toBe(failure);

  expect(prepareOwnershipInspector).toHaveBeenCalledOnce();
  expect(createTemporaryRoot).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
});

it("cleans the temporary root when cancellation arrives during identity capture", async () => {
  const controller = new AbortController();
  const temporaryRoot = "/temporary-capture-root";
  const cleanup = vi.fn(async () => undefined);
  const host = {
    createTemporaryRoot: vi.fn(async () => temporaryRoot),
    captureOwnershipBaseline: vi.fn(async (signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return [];
    }),
    cleanup,
  };

  await expect(
    prepareProcessCapture(
      processScenarioSchema.parse({
        executable: "/bin/true",
        working_directory: "/tmp",
      }),
      controller.signal,
      async () => ({
        files: [],
        truncated: false,
        completeRoots: [],
        coverage: emptyFilesystemCoverage,
      }),
      host,
    ),
  ).rejects.toThrow(/cancelled/u);
  expect(host.captureOwnershipBaseline).toHaveBeenCalledWith(controller.signal);
  expect(cleanup).toHaveBeenCalledWith(temporaryRoot);
});

it.each([false, true])(
  "preserves denied snapshot admission through temporary-root cleanup failure=%s and retry",
  async (denyCleanup) => {
    const path = "/selected/denied/child";
    const primary = new AnalysisAccessDeniedError(
      "capture_process",
      path,
      "EACCES",
    );
    const snapshot = {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage,
    };
    const scope = new ProcessCaptureResourceScope();
    let failing = denyCleanup;
    const cleanup = vi.fn(async () => {
      if (failing) throw new Error("controlled temporary-root removal denial");
    });
    const observed = await prepareProcessCapture(
      processScenarioSchema.parse({
        executable: "/bin/true",
        filesystem_observation_paths: [path],
      }),
      undefined,
      async () => {
        throw new ProcessCaptureSnapshotFailure({ cause: primary, snapshot });
      },
      { createTemporaryRoot: async () => "/owned/temporary-root", cleanup },
      scope,
    ).catch((cause: unknown) => cause);
    if (!(observed instanceof AnalysisError)) throw observed;
    try {
      expect(projectAnalysisError(observed).code).toBe(
        denyCleanup ? "cleanup_incomplete" : "access_denied",
      );
      expect(observed.partialObservation).toMatchObject({
        observations: {
          filesystem_snapshots: {
            before: { state: "available", value: snapshot },
          },
        },
      });
      if (denyCleanup) {
        failing = false;
        await scope.retryCleanup();
      }
      expect(observed.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(observed)).toMatchObject({
        code: "access_denied",
        details: { path, system_code: "EACCES", boundary: "filesystem-read" },
      });
      expect(cleanup).toHaveBeenCalledTimes(denyCleanup ? 2 : 1);
    } finally {
      failing = false;
      await scope.close();
    }
  },
);
