import { expect, it, vi, onTestFinished } from "vitest";
import type { IPty } from "@lydell/node-pty";
import type {
  ProcessSample,
  TerminalFrame,
} from "../../domain/process/processCapture.js";
import { createProcessCaptureJournal } from "./ProcessCaptureJournal.js";
import {
  createBoundedProcessTextNormalizer,
  createProcessIdentifierLookup,
} from "./ProcessNormalization.js";
import { scheduleProcessDelay } from "./ProcessTimer.js";
import { TerminalRenderer } from "./TerminalRenderer.js";
import {
  ProcessCaptureError,
  processCaptureCancelled,
} from "./ProcessCaptureError.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import {
  createProcessCaptureObservationBuffer,
  resolveProcessResult,
  releaseProcessResources,
  captureTerminalFrames,
} from "./ProcessCaptureLifecycle.js";
import { createProcessTerminalFinalizer } from "./ProcessTerminalObservation.js";

const createTerminalCleanupFixture = () => {
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    terminal: { columns: 80, rows: 4 },
    normalization: { paths: false, ports: false },
  });
  const frames: TerminalFrame[] = [];
  const samples: ProcessSample[] = [];
  const journal = createProcessCaptureJournal();
  const observations = createProcessCaptureObservationBuffer({
    frames,
    samples,
    interactions: [],
    eventJournal: journal.entries,
    before: undefined,
  });
  const identifiers = createProcessIdentifierLookup(samples, () => 100);
  const normalize = createBoundedProcessTextNormalizer(
    scenario,
    "/tmp",
    identifiers,
  );
  const renderer = new TerminalRenderer({
    ...scenario.terminal,
    maxBytes: scenario.limits.output_bytes,
    normalize,
    recordEvent: journal.recordEvent,
  });
  const rendererState = { released: false };
  onTestFinished(async () => {
    if (!rendererState.released) await renderer.dispose();
  });
  const events: string[] = [];
  let onData: ((data: string) => void) | undefined;
  const terminal = {
    pid: 100,
    onData: (callback: (data: string) => void) => {
      onData = callback;
      return {
        dispose: () => {
          events.push("input sealed");
        },
      };
    },
  } as unknown as IPty;
  const retention = captureTerminalFrames({
    terminal,
    scenario,
    frames,
    started: 0,
    onOutput: () => undefined,
    renderer,
    normalizeText: normalize,
    identifiers,
    recordEvent: journal.recordEvent,
  });
  const owner = createProcessTerminalFinalizer(
    renderer,
    retention,
    observations,
  );
  return {
    scenario,
    frames,
    samples,
    journal,
    observations,
    renderer,
    rendererState,
    events,
    owner,
    emitOutput: (data: string) => onData?.(data),
  };
};

it("retains completed terminal facts and the typed capacity failure through finalization", async () => {
  const failure = new AnalysisResourceConstraintError(
    "capture_process",
    "capacity",
    "Sampled PID projection exceeded output_bytes",
    { maximum_output_bytes: 4 },
  );
  const readRetention = vi.fn(() => {
    throw failure;
  });
  const frames = [{ sequence: 0, at_ms: 17, data: "20" }];
  const observations = createProcessCaptureObservationBuffer({
    frames,
    samples: [],
    interactions: [],
    eventJournal: [],
    before: undefined,
  });
  const rendered = [
    {
      sequence: 0,
      at_ms: 17,
      columns: 10,
      rows: 1,
      cursor_x: 0,
      cursor_y: 0,
      active_buffer: "normal" as const,
      lines: [""],
      serialized_state: "",
    },
  ];
  const closeFailure = new Error("renderer close failed once");
  const renderer = {
    frames: vi.fn(async () => rendered),
    dispose: vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(closeFailure)
      .mockResolvedValue(undefined),
  };
  const finalize = createProcessTerminalFinalizer(
    renderer,
    readRetention,
    observations,
  );
  const result = await finalize.complete();
  await expect(finalize.dispose()).rejects.toBe(closeFailure);
  await finalize.dispose();
  expect(await finalize.complete()).toBe(result);
  expect(readRetention).toHaveBeenCalledOnce();
  expect(renderer.frames).toHaveBeenCalledOnce();
  if (result.ok) throw new Error("Expected terminal capacity refusal");
  expect(result.error).toBe(failure);
  expect(observations.rendered_frames).toEqual({
    state: "available",
    value: rendered,
  });
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    limits: { output_bytes: 4 },
  });
  const cleanup = { state: "not_required" as const, reason: null };
  expect(() =>
    resolveProcessResult(
      undefined,
      result.error,
      {
        report: {
          owned_process_group: cleanup,
          terminal_renderer: cleanup,
          temporary_root: cleanup,
        },
        cleanupLease: undefined,
      },
      observations,
      { scenario, rootPid: 100 },
    ),
  ).toThrow(failure);
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "resource_constraint",
    details: {
      partial_observation: {
        observations: {
          frames: { state: "available", value: frames },
          rendered_frames: { state: "available", value: rendered },
        },
      },
    },
  });
});

it.each(["cancelled", "failed"] as const)(
  "stops pending interactions and the target before sealing %s terminal facts",
  async (outcome) => {
    const {
      scenario,
      frames,
      samples,
      journal,
      observations,
      renderer,
      rendererState,
      events,
      owner,
      emitOutput,
    } = createTerminalCleanupFixture();
    let pendingInteraction: (() => void) | undefined;
    const timer = scheduleProcessDelay(
      100,
      () => {
        events.push("unexpected interaction");
        renderer.resize(40, 4, 2);
      },
      (callback) => {
        pendingInteraction = callback;
        return {
          cancel: () => {
            events.push("timer cancelled");
          },
        };
      },
    );
    emitOutput("root 100\r\n");
    const cleanup = await releaseProcessResources({
      timers: new Set([timer]),
      terminal: { pid: 100 },
      renderer: owner,
      runId: "fixture-run",
      temporaryRoot: "/fixture/temporary-root",
      host: {
        platform: "linux",
        cleanupProcessGroup: async () => {
          events.push("target stopped");
          pendingInteraction?.();
          emitOutput("child 200\r\n");
          samples.push({
            at_ms: 1,
            pid: 200,
            parent_pid: 100,
            process_group_id: 100,
            session_id: null,
            command: "child",
          });
          journal.recordEvent("process_samples", 0);
          return { cleaned: true, signaled: true };
        },
        removeTemporaryRoot: async () => {
          events.push("temporary root removed");
        },
      },
    });
    rendererState.released =
      cleanup.report.terminal_renderer.state === "cleaned";
    expect(events).toEqual([
      "timer cancelled",
      "target stopped",
      "input sealed",
      "temporary root removed",
    ]);
    const completed = await owner.complete();
    if (!completed.ok) throw completed.error;
    emitOutput("late callback after sealing");
    expect(await owner.complete()).toBe(completed);
    expect(completed.value.retention.raw_terminal).toMatchObject({
      observed_frames: 2,
      retained_frames: 2,
      observed_bytes: 21,
      retained_bytes: 21,
    });
    expect(frames.map(({ data }) => data).join("")).toBe(
      "root <pid>\r\nchild <pid>\r\n",
    );
    expect(frames.map(({ raw_data, data }) => raw_data ?? data).join("")).toBe(
      "root 100\r\nchild 200\r\n",
    );
    expect(completed.value.renderedFrames.at(-1)?.lines).toEqual(
      expect.arrayContaining(["root <pid>", "child <pid>"]),
    );
    const reason = new Error("original capture failure");
    const primary =
      outcome === "cancelled" ? processCaptureCancelled(reason) : reason;
    let failure: unknown;
    try {
      resolveProcessResult(undefined, primary, cleanup, observations, {
        scenario,
        rootPid: 100,
      });
    } catch (cause: unknown) {
      failure = cause;
    }
    if (!(failure instanceof ProcessCaptureError))
      throw new Error("Expected a typed capture failure");
    expect(failure.cause).toBe(reason);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: outcome === "cancelled" ? "cancelled" : "process_capture_failed",
      details: {
        partial_observation: {
          observations: {
            frames: { state: "available", value: frames },
            rendered_frames: {
              state: "available",
              value: completed.value.renderedFrames,
            },
          },
        },
      },
    });
  },
);
