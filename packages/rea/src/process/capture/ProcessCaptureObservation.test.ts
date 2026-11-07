import { expect, it } from "vitest";

import {
  ProcessCaptureSnapshotFailure,
  snapshotRoots,
} from "./FilesystemSnapshot.js";
import { buildCaptureResult } from "./ProcessCaptureLifecycle.js";
import { isInitializedPtyRoot } from "./ProcessSampling.js";
import { readLinuxChildren } from "./LinuxProcessSampling.js";
import { TerminalRenderer } from "./TerminalRenderer.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import type { ProcessCapture } from "../../domain/process/processCaptureParsing.js";
import type {
  FilesystemCoverage,
  ProcessCaptureTruncationDetails,
} from "../../domain/process/processCaptureCoverage.js";
import { emptyProcessCapture as emptyCapture } from "../../domain/process/processCapture.fixture.js";

const base = {
  executable: "/bin/sh",
  working_directory: "/tmp",
};

const emptyFilesystemCoverage = () =>
  emptyCapture().truncation_details.filesystem_before;

const truncationDetails = (
  frames: readonly ProcessCapture["frames"][number][],
  renderedFrames: readonly ProcessCapture["rendered_frames"][number][],
  samples: readonly ProcessCapture["process_samples"][number][],
): ProcessCaptureTruncationDetails => {
  const emptyDetails = emptyCapture().truncation_details;
  const rawBytes = frames.reduce(
    (total, frame) => total + Buffer.byteLength(frame.raw_data ?? frame.data),
    0,
  );
  const renderedBytes = renderedFrames.reduce(
    (total, frame) =>
      frame.lines.reduce(
        (sum, line) => sum + Buffer.byteLength(line),
        total + Buffer.byteLength(frame.serialized_state),
      ),
    0,
  );
  return {
    raw_terminal: {
      ...emptyDetails.raw_terminal,
      observed_bytes: rawBytes,
      retained_bytes: rawBytes,
      observed_frames: frames.length,
      retained_frames: frames.length,
    },
    rendered_terminal: {
      ...emptyDetails.rendered_terminal,
      observed_bytes: renderedBytes,
      retained_bytes: renderedBytes,
      observed_frames: renderedFrames.length,
      retained_frames: renderedFrames.length,
    },
    filesystem_before: emptyDetails.filesystem_before,
    filesystem_after: emptyDetails.filesystem_after,
    process: {
      ...emptyDetails.process,
      retained_samples: samples.length,
    },
  };
};

it("returns detached terminal observations", async () => {
  const observed: string[] = [];
  const renderer = new TerminalRenderer({
    columns: 40,
    rows: 12,
    scrollback: 100,
    maxBytes: 100_000,
    normalize: (value, maxBytes) => {
      const utf8Bytes = Buffer.byteLength(value);
      return utf8Bytes <= maxBytes
        ? { state: "normalized", value, utf8Bytes }
        : { state: "over_budget", reason: "retention" };
    },
    recordEvent: (collection, index) =>
      observed.push(`${collection}:${String(index)}`),
  });
  renderer.write("A", 20);
  renderer.resize(40, 12, 10);
  for (let index = 0; index < 20; index += 1)
    renderer.resize(40, 12, 11 + index);
  const frames = await renderer.frames();
  expect(frames).toHaveLength(22);
  expect(frames.slice(0, 2).map(({ at_ms }) => at_ms)).toEqual([20, 10]);
  expect(observed).toHaveLength(22);
  const frame = frames[0];
  if (frame === undefined) throw new Error("expected observed frame");
  const originalCursor = frame.cursor_x;
  Reflect.set(frame, "cursor_x", 999);
  const reread = await renderer.frames();
  expect(reread).toHaveLength(frames.length);
  expect(reread[0]?.cursor_x).toBe(originalCursor);
  await renderer.dispose();
});

it("preserves rendered observation order instead of timestamp sorting", () => {
  const capture = emptyCapture();
  const renderedFrames: ProcessCapture["rendered_frames"] = [
    {
      sequence: 0,
      at_ms: 20,
      columns: 1,
      rows: 1,
      cursor_x: 0,
      cursor_y: 0,
      active_buffer: "normal",
      lines: ["first"],
      serialized_state: "first",
    },
    {
      sequence: 1,
      at_ms: 10,
      columns: 1,
      rows: 1,
      cursor_x: 0,
      cursor_y: 0,
      active_buffer: "normal",
      lines: ["second"],
      serialized_state: "second",
    },
  ];
  const result = buildCaptureResult({
    frames: [],
    exit: { exitCode: 0, reason: "exited" },
    samples: [],
    before: {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage(),
    },
    after: {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage(),
    },
    truncationDetails: truncationDetails([], renderedFrames, []),
    scenario: processScenarioSchema.parse(base),
    rootPid: 1,
    samplingPartial: false,
    renderedFrames,
    interactions: [],
    checkpoints: capture.filesystem_checkpoints,
    settlement: {
      state: capture.settlement.state,
      elapsed_ms: capture.settlement.elapsed_ms,
    },
    manifest: capture.manifest,
    eventJournal: [],
  });

  expect(result.rendered_frames).toEqual(renderedFrames);
});

it("marks redacted scripted input as an interaction unknown", () => {
  const capture = emptyCapture();
  const result = buildCaptureResult({
    frames: [],
    exit: { exitCode: 0, reason: "exited" },
    samples: [],
    before: {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage(),
    },
    after: {
      files: [],
      truncated: false,
      completeRoots: [],
      coverage: emptyFilesystemCoverage(),
    },
    truncationDetails: truncationDetails([], [], []),
    scenario: processScenarioSchema.parse({
      ...base,
      events: [{ type: "input", at_ms: 0, data: "secret", sensitive: true }],
    }),
    rootPid: 1,
    samplingPartial: false,
    renderedFrames: [],
    interactions: [
      {
        sequence: 0,
        scheduled_at_ms: 0,
        dispatched_at_ms: 0,
        type: "input",
        data: "",
        sensitive: true,
        input_bytes: 6,
        outcome: "dispatched",
      },
    ],
    checkpoints: capture.filesystem_checkpoints,
    settlement: {
      state: capture.settlement.state,
      elapsed_ms: capture.settlement.elapsed_ms,
    },
    manifest: capture.manifest,
    eventJournal: [],
  });

  expect(result.residual_unknowns).toContainEqual({
    scope: "interaction",
    reason:
      "Sensitive scripted input literals and retained terminal echoes are redacted. Terminal states are reconstructed from the redacted stream; private display effects and transformed values remain unknown.",
  });
});

it("collects and deduplicates children from every Linux thread", async () => {
  const signal = new AbortController().signal;
  expect(
    await readLinuxChildren(100, signal, {
      taskIds: () => Promise.resolve([100, 101, 102]),
      children: (_pid, taskId) =>
        Promise.resolve(
          taskId === 100 ? "201 202" : taskId === 101 ? "202 203" : "",
        ),
    }),
  ).toEqual({
    value: [201, 202, 203],
    diagnostics: { count: 0, first: null, interrupted: false },
  });
});

it("admits PTY samples only after stable session and token setup", () => {
  const initialized = {
    pid: 100,
    parent_pid: 10,
    process_group_id: 100,
    session_id: 100,
    startTime: "200",
  };
  expect(
    isInitializedPtyRoot({
      rootPid: 100,
      expectedRunId: "run-token",
      before: { ...initialized, process_group_id: 10, session_id: 10 },
      observedRunId: undefined,
      after: initialized,
    }),
  ).toBe(false);
  expect(
    isInitializedPtyRoot({
      rootPid: 100,
      expectedRunId: "run-token",
      before: initialized,
      observedRunId: "run-token",
      after: { ...initialized, startTime: "201" },
    }),
  ).toBe(false);
  expect(
    isInitializedPtyRoot({
      rootPid: 100,
      expectedRunId: "run-token",
      before: initialized,
      observedRunId: "run-token",
      after: initialized,
    }),
  ).toBe(true);
  expect(
    isInitializedPtyRoot({
      rootPid: 100,
      expectedRunId: "run-token",
      before: { ...initialized, session_id: null },
      observedRunId: "run-token",
      after: { ...initialized, session_id: null },
    }),
  ).toBe(true);
});

it("cancels filesystem snapshots before traversing declared roots", async () => {
  const controller = new AbortController();
  controller.abort();
  const failure: unknown = await snapshotRoots(
    processScenarioSchema.parse({
      ...base,
      filesystem_observation_paths: ["/tmp"],
    }),
    controller.signal,
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(ProcessCaptureSnapshotFailure);
  expect(failure).toMatchObject({
    _tag: "ProcessCaptureError",
    reason: "cancelled",
    userCategory: "cancelled",
    cause: expect.objectContaining({ name: "AbortError" }),
    snapshot: {
      files: [],
      truncated: true,
      completeRoots: [],
      coverage: {
        hashed_bytes: 0,
        enumeration_omissions: [],
        hash_omissions: [],
      },
    },
    cleanupLeases: [],
    readFailures: [],
  });
  expect(failure instanceof Error ? failure.cause : undefined).toBe(
    controller.signal.reason,
  );
});

it.each(["symlink_not_followed", "observer_owned"] as const)(
  "projects %s subtree coverage into Evidence limitations and residual unknowns",
  (reason) => {
    const capture = emptyCapture();
    const build = (coverage: FilesystemCoverage) => {
      const snapshot = {
        files: [],
        truncated: false,
        completeRoots: ["root_0"],
        coverage,
      };
      return buildCaptureResult({
        frames: [],
        exit: { exitCode: 0, reason: "exited" },
        samples: [],
        before: snapshot,
        after: snapshot,
        truncationDetails: {
          ...truncationDetails([], [], []),
          filesystem_before: coverage,
          filesystem_after: coverage,
        },
        scenario: processScenarioSchema.parse({
          ...base,
          filesystem_observation_paths: ["/selected"],
        }),
        rootPid: 1,
        samplingPartial: false,
        renderedFrames: [],
        interactions: [],
        checkpoints: capture.filesystem_checkpoints,
        settlement: {
          state: capture.settlement.state,
          elapsed_ms: capture.settlement.elapsed_ms,
        },
        manifest: capture.manifest,
        eventJournal: [],
      });
    };
    const complete = { ...emptyFilesystemCoverage(), unobserved_subtrees: [] };
    expect(
      build(complete).residual_unknowns.filter(
        ({ scope }) => scope === "filesystem",
      ),
    ).toEqual([]);
    const result = build({
      ...complete,
      unobserved_subtrees: [{ path: "root_0:.", reason }],
    });
    const unknowns = result.residual_unknowns.filter(
      ({ scope }) => scope === "filesystem",
    );
    expect(unknowns).toHaveLength(2);
    for (const unknown of unknowns) {
      expect(unknown.reason).toContain("root_0:.");
      expect(unknown.reason).toContain(
        reason === "symlink_not_followed"
          ? "symbolic links are not followed"
          : "exact observer-owned directory",
      );
      expect(result.limitations).toContain(unknown.reason);
    }
    expect(result.truncated).toBe(false);
  },
);
