import type { IPty } from "@lydell/node-pty";
import { expect, it } from "vitest";
import type { TerminalFrame } from "../../domain/process/processCapture.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import {
  captureTerminalFrames,
  createProcessCaptureObservationBuffer,
} from "./ProcessCaptureLifecycle.js";
import { createProcessTerminalFinalizer } from "./ProcessTerminalObservation.js";
import { createBoundedProcessTextNormalizer } from "./ProcessNormalization.js";
import { createProcessSensitiveOutput } from "./ProcessSensitiveOutput.js";
import { ProcessCaptureError } from "./ProcessCaptureError.js";
import { TerminalRenderer } from "./TerminalRenderer.js";

const fixture = (
  outputBytes: number,
  throwOnProjection = false,
  throwOnDispose = false,
) => {
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    limits: { output_bytes: outputBytes },
    terminal: { columns: 60, rows: 2, scrollback: 0 },
    normalization: { paths: false, pids: false, ports: false },
    events: [{ type: "input", at_ms: 0, data: "secret\r", sensitive: true }],
  });
  const privacy = createProcessSensitiveOutput(scenario);
  if (!privacy.ok) throw privacy.error;
  if (privacy.value === undefined) throw new Error("Expected private policy");
  const frames: TerminalFrame[] = [];
  const observations = createProcessCaptureObservationBuffer({
    frames,
    samples: [],
    interactions: [],
    eventJournal: [],
    before: undefined,
  });
  const normalize = createBoundedProcessTextNormalizer(scenario, "/tmp", -1);
  const renderer = new TerminalRenderer({
    columns: 60,
    rows: 2,
    scrollback: 0,
    maxBytes: outputBytes,
    normalize,
  });
  let onData: ((value: string) => void) | undefined;
  let project = false;
  let disposed = false;
  const terminal = {
    onData: (listener: (value: string) => void) => {
      onData = listener;
      return {
        dispose: () => {
          disposed = true;
          if (throwOnDispose) throw new Error("disposal failed");
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
    normalizeText: (value, maxBytes) => {
      if (project && throwOnProjection)
        throw new Error("private details must not escape");
      return normalize(value, maxBytes);
    },
    identifiers: () => [],
    recordEvent: () => undefined,
    sensitiveOutput: privacy.value,
    onSensitiveOutputFailure: () => {
      observations.frames = {
        state: "unavailable",
        reason:
          "Sensitive terminal projection failed; terminal text was withheld.",
      };
    },
  });
  const owner = createProcessTerminalFinalizer(
    renderer,
    retention,
    observations,
  );
  return {
    frames,
    observations,
    renderer,
    owner,
    emit: (value: string) => onData?.(value),
    seal: () => {
      project = true;
    },
    disposed: () => disposed,
  };
};

it("redacts before deferred parsing so early rendered snapshots cannot retain split prefixes", async () => {
  const run = fixture(4096);
  run.emit("public:sec");
  run.emit("ret\r\nTAIL");
  run.seal();
  try {
    const result = await run.owner.complete();
    if (!result.ok) throw result.error;
    expect(run.frames.map(({ data }) => data).join("")).toBe("public:\r\nTAIL");
    expect(JSON.stringify(result.value.renderedFrames)).not.toContain("sec");
    expect(result.value.retention.raw_terminal).toMatchObject({
      observed_bytes: 19,
      retained_bytes: 13,
      redacted_bytes: 6,
      observed_frames: 2,
      retained_frames: 2,
    });
    expect(await run.owner.complete()).toEqual(result);
  } finally {
    await run.owner.dispose();
  }
  expect(run.disposed()).toBe(true);
});

it("withholds all retained terminal fragments when output admission has gaps", async () => {
  const run = fixture(10);
  run.emit("sec");
  run.emit("omitted long output");
  run.emit("ret!");
  run.seal();
  try {
    const result = await run.owner.complete();
    if (!result.ok) throw result.error;
    expect(run.frames.map(({ data }) => data)).toEqual(["", ""]);
    expect(result.value.retention.raw_terminal).toMatchObject({
      observed_bytes: 26,
      retained_bytes: 0,
      redacted_bytes: 7,
      observed_frames: 3,
      retained_frames: 2,
    });
    expect(JSON.stringify(result.value.renderedFrames)).not.toContain("sec");
  } finally {
    await run.owner.dispose();
  }
});

it.each([false, true])(
  "withholds terminal observations when final projection fails, disposal failure=%s",
  async (disposeFails) => {
    const run = fixture(4096, true, disposeFails);
    run.emit("secret\r\nPUBLIC");
    run.seal();
    const result = await run.owner.complete();
    if (result.ok)
      throw new Error("Expected private terminal projection failure");
    expect(result.error).toBeInstanceOf(ProcessCaptureError);
    expect(result.error).toMatchObject({
      _tag: "ProcessCaptureError",
      reason: "capture_failed",
    });
    expect(result.error.secondaryFailures).not.toContain(result.error);
    expect(result.error.secondaryFailures).toHaveLength(disposeFails ? 1 : 0);
    expect(run.frames.map(({ data }) => data)).toEqual([""]);
    expect(run.observations.frames.state).toBe("unavailable");
    expect(run.observations.rendered_frames.state).toBe("unavailable");
    expect(JSON.stringify(run.observations)).not.toContain("secret");
    expect(run.disposed()).toBe(true);
    await run.owner.dispose();
  },
);
