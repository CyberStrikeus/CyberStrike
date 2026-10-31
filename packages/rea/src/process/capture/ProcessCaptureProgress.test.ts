import { expect, it } from "vitest";

import {
  createProcessCaptureProgressTracker,
  type ProcessCaptureProgress,
} from "./ProcessCaptureProgress.js";

const blockedProgress = () => {
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delivered: Parameters<ProcessCaptureProgress["report"]>[0][] = [];
  const progress: ProcessCaptureProgress = {
    async report(update) {
      delivered.push(update);
      if (delivered.length === 1) await blocked;
    },
  };
  return { progress, delivered, release: () => release() };
};

it("coalesces intermediate observations while the progress receiver is blocked", async () => {
  const receiver = blockedProgress();
  const tracker = createProcessCaptureProgressTracker(receiver.progress);
  void tracker.report({
    phase: "running",
    counts: { frames: 1, samples: 0, interactions: 0 },
  });
  await Promise.resolve();
  let latest: Promise<void> | undefined;
  for (let frames = 2; frames <= 1_000; frames += 1) {
    latest = tracker.report({
      phase: "running",
      counts: { frames, samples: 0, interactions: 0 },
    });
  }
  expect(receiver.delivered).toHaveLength(1);
  receiver.release();
  await latest;
  expect(receiver.delivered.map((update) => update.completed)).toEqual([
    1, 1_000,
  ]);
  expect(receiver.delivered[1]?.message).toContain("frames=1000");
});

it("discards stale live observations before delivering final cleanup", async () => {
  const receiver = blockedProgress();
  const tracker = createProcessCaptureProgressTracker(receiver.progress);
  void tracker.report({
    phase: "running",
    counts: { frames: 1, samples: 0, interactions: 0 },
  });
  await Promise.resolve();
  void tracker.report({
    phase: "running",
    counts: { frames: 2, samples: 0, interactions: 0 },
  });
  void tracker.report({
    phase: "settling",
    counts: { frames: 2, samples: 1, interactions: 0 },
  });
  tracker.closeLive();
  await tracker.report({
    phase: "running",
    counts: { frames: 10, samples: 10, interactions: 10 },
  });
  const terminal = tracker.report({
    phase: "cleanup",
    counts: { frames: 2, samples: 2, interactions: 0 },
    disposition: "exited",
    terminal: true,
  });
  receiver.release();
  await terminal;
  expect(receiver.delivered.map((update) => update.phase)).toEqual([
    "running",
    "cleanup",
  ]);
  expect(receiver.delivered.at(-1)).toMatchObject({
    completed: 4,
    total: null,
    terminal: true,
  });
});

it("still delivers terminal status after an observer rejects an update", async () => {
  const delivered: Parameters<ProcessCaptureProgress["report"]>[0][] = [];
  const tracker = createProcessCaptureProgressTracker({
    async report(update) {
      delivered.push(update);
      if (delivered.length === 1) throw new Error("Observer disconnected");
    },
  });
  await tracker.report({
    phase: "prepare",
    counts: { frames: 0, samples: 0, interactions: 0 },
  });
  tracker.closeLive();
  await expect(
    tracker.report({
      phase: "cleanup",
      counts: { frames: 1, samples: 1, interactions: 0 },
      disposition: "failed",
      terminal: true,
    }),
  ).resolves.toBeUndefined();
  expect(delivered.at(-1)).toMatchObject({
    phase: "cleanup",
    completed: 2,
    terminal: true,
  });
  expect(delivered.at(-1)?.message).toContain(
    "owned_process_group=unverified terminal_renderer=unverified temporary_root=unverified",
  );
});

it("preserves known cleanup states in terminal progress", async () => {
  const delivered: Parameters<ProcessCaptureProgress["report"]>[0][] = [];
  const tracker = createProcessCaptureProgressTracker({
    async report(update) {
      delivered.push(update);
    },
  });
  await tracker.report({
    phase: "cleanup",
    counts: { frames: 0, samples: 0, interactions: 0 },
    disposition: "failed",
    terminal: true,
    cleanup: {
      owned_process_group: { state: "not_required", reason: null },
      terminal_renderer: { state: "not_required", reason: null },
      temporary_root: { state: "cleaned", reason: null },
    },
  });

  expect(delivered[0]?.message).toContain(
    "owned_process_group=not_required terminal_renderer=not_required temporary_root=cleaned",
  );
});
