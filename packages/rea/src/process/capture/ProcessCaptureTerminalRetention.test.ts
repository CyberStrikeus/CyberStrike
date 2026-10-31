import { expect, it } from "vitest";
import type { IPty } from "@lydell/node-pty";

import { processScenarioSchema } from "../../domain/process/processScenario.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import {
  createProcessIdentifierLookup,
  createBoundedProcessTextNormalizer,
} from "./ProcessNormalization.js";
import type {
  TerminalFrame,
  ProcessSample,
} from "../../domain/process/processCapture.js";
import { captureTerminalFrames } from "./ProcessCaptureLifecycle.js";

it("omits an expanding chunk whole and retains a later smaller normalized chunk", () => {
  let onData: ((data: string) => void) | undefined;
  const terminal = {
    onData: (listener: (data: string) => void) => {
      onData = listener;
      return { dispose: () => undefined };
    },
  } as unknown as IPty;
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    limits: { output_bytes: 1_000 },
    normalization: {
      paths: false,
      pids: false,
      ports: false,
      patterns: [{ pattern: "a", replacement: "x".repeat(500) }],
    },
  });
  const frames: TerminalFrame[] = [];
  const renderedChunks: string[] = [];
  const journal: Array<[string, number]> = [];
  const captureRetention = captureTerminalFrames({
    terminal,
    scenario,
    frames,
    started: 0,
    onOutput: () => undefined,
    renderer: { write: (data: string) => renderedChunks.push(data) } as never,
    normalizeText: createBoundedProcessTextNormalizer(scenario, "/tmp", -1),
    recordEvent: (collection, index) => journal.push([collection, index]),
    identifiers: () => [],
  });

  onData?.("aaa");
  onData?.("z");

  expect(frames).toEqual([
    { sequence: 0, at_ms: expect.any(Number), data: "z" },
  ]);
  expect(renderedChunks).toEqual(["z"]);
  expect(journal).toEqual([["frames", 0]]);
  expect(captureRetention()).toEqual({
    raw_terminal: {
      budget_bytes: 1_000,
      observed_bytes: 4,
      retained_bytes: 1,
      observed_frames: 2,
      retained_frames: 1,
    },
    normalized_terminal: {
      budget_bytes: 1_000,
      retained_bytes: 1,
      omitted_frames: 1,
    },
  });
});

it.each([false, true])(
  "reprojects bounded retained raw chunks after sampled child discovery, capacity failure=%s",
  (overBudget) => {
    let onData: ((data: string) => void) | undefined;
    const terminal = {
      onData: (listener: (data: string) => void) => {
        onData = listener;
        return { dispose: () => undefined };
      },
    } as unknown as IPty;
    const scenario = processScenarioSchema.parse({
      executable: "unused",
      limits: { output_bytes: overBudget ? 4 : 1000 },
      normalization: {
        paths: false,
        ports: false,
        pids: true,
        patterns: overBudget
          ? []
          : [
              { pattern: "<pid>", replacement: "selected" },
              { pattern: "200", replacement: "wrong-order" },
            ],
      },
    });
    const samples: ProcessSample[] = [];
    const frames: TerminalFrame[] = [];
    const identifiers = createProcessIdentifierLookup(samples, () => 100);
    const readRetention = captureTerminalFrames({
      terminal,
      scenario,
      frames,
      started: 0,
      onOutput: () => undefined,
      renderer: { write: () => undefined } as never,
      normalizeText: createBoundedProcessTextNormalizer(
        scenario,
        "/tmp",
        identifiers,
      ),
      identifiers,
      recordEvent: () => undefined,
    });
    const original = overBudget ? "20" : "root=100 child=200 other=201";
    onData?.(original);
    const first = structuredClone(frames);
    samples.push({
      at_ms: 1,
      pid: overBudget ? 20 : 200,
      parent_pid: 100,
      process_group_id: 100,
      session_id: 100,
      command: "child",
    });
    if (overBudget) {
      expect(readRetention).toThrow(AnalysisResourceConstraintError);
      expect(frames).toEqual(first);
      expect(frames[0]?.data).toBe("20");
    } else {
      const retention = readRetention();
      expect(frames[0]?.data).toBe("root=selected child=selected other=201");
      expect(frames[0]?.raw_data).toBe(original);
      expect(frames[0]?.at_ms).toBe(first[0]?.at_ms);
      expect(retention.normalized_terminal.retained_bytes).toBe(
        Buffer.byteLength(frames[0]!.data),
      );
      expect(readRetention()).toEqual(retention);
    }
  },
);

it("retains PTY chunk boundaries when two output messages arrive fragmented", () => {
  let onData: ((data: string) => void) | undefined;
  const terminal = {
    onData: (listener: (data: string) => void) => {
      onData = listener;
      return { dispose: () => undefined };
    },
  } as unknown as IPty;
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    normalization: { paths: false, pids: false, ports: false },
  });
  const frames: TerminalFrame[] = [];
  const captureRetention = captureTerminalFrames({
    terminal,
    scenario,
    frames,
    started: 0,
    onOutput: () => undefined,
    renderer: { write: () => undefined } as never,
    normalizeText: createBoundedProcessTextNormalizer(scenario, "/tmp", -1),
    recordEvent: () => undefined,
    identifiers: () => [],
  });
  // A PTY transports chunks, independently of the child's write boundaries.
  const chunks = ["SPARSE_CHILD_", "STARTED\r\n", "SPARSE_CHILD_", "DONE\r\n"];
  for (const chunk of chunks) onData?.(chunk);

  expect(frames.map(({ data }) => data)).toEqual(chunks);
  expect(frames.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
  expect(frames.map(({ data }) => data).join("")).toBe(
    "SPARSE_CHILD_STARTED\r\nSPARSE_CHILD_DONE\r\n",
  );
  expect(captureRetention().raw_terminal).toMatchObject({
    observed_frames: 4,
    retained_frames: 4,
  });
});
