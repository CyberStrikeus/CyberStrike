import { expect, it, vi } from "vitest";
import { CdpExecutionWindow } from "./CdpExecutionWindow.js";

it("settles an already lost transport without arming a timer that cannot resolve", async () => {
  const window = new CdpExecutionWindow({
    target: { frame_id: "selected-main" },
    operation: "observe_web_execution",
    options: {},
  });
  window.end("target_terminated");
  await expect(window.start(30_000)).resolves.toBe("target_terminated");
  expect(window.active).toBe(false);
  expect(window.armedAt).toBeUndefined();
});

it("ends the actual armed window at its selected duration and disposes its timer", async () => {
  vi.useFakeTimers();
  const window = new CdpExecutionWindow({
    target: { frame_id: "selected-main" },
    operation: "observe_web_execution",
    options: {},
  });
  try {
    const result = window.start(10);
    expect(window.active).toBe(true);
    vi.advanceTimersByTime(10);
    await expect(result).resolves.toBe("window_elapsed");
    expect(window.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    window.dispose();
    vi.useRealTimers();
  }
});

it("settles caller cancellation and removes its local timer", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const window = new CdpExecutionWindow({
    target: { frame_id: "selected-main" },
    operation: "observe_web_execution",
    options: { signal: controller.signal },
  });
  try {
    const reason = new Error("operator stopped the armed window");
    const result = window.start(30_000).catch((error: unknown) => error);
    controller.abort(reason);
    const failure = await result;
    expect(failure).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
    expect(() => window.check()).toThrow(failure as Error);
    const endedAt = window.endedAt;
    window.end("target_terminated");
    expect(window.reason).toBeUndefined();
    expect(window.endedAt).toBe(endedAt);
    await expect(window.start(30_000)).rejects.toBe(failure);
    expect(window.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    window.dispose();
    vi.useRealTimers();
  }
});

it("keeps a root document transition distinct from a child frame event", async () => {
  const root = new CdpExecutionWindow({
    target: { frame_id: "selected-main" },
    operation: "observe_web_execution",
    options: {},
  });
  const rootResult = root.start(30_000);
  root.ingest({
    method: "Page.frameNavigated",
    params: { frame: { id: "new-main", url: "https://example.test/" } },
  });
  await expect(rootResult).resolves.toBe("document_changed");

  const child = new CdpExecutionWindow({
    target: { frame_id: "selected-main" },
    operation: "observe_web_execution",
    options: {},
  });
  const childResult = child.start(30_000);
  child.ingest({
    method: "Page.frameNavigated",
    params: {
      frame: {
        id: "child-frame",
        parentId: "selected-main",
        url: "https://example.test/child",
      },
    },
  });
  expect(child.active).toBe(true);
  child.end("window_elapsed");
  await expect(childResult).resolves.toBe("window_elapsed");
});

it("surfaces malformed frame identity as a protocol failure without guessing a transition", async () => {
  const window = new CdpExecutionWindow({
    target: { frame_id: "selected-main" },
    operation: "observe_web_execution",
    options: {},
  });
  const result = window.start(30_000);
  window.ingest({
    method: "Page.frameNavigated",
    params: {
      frame: { id: "child-frame", parentId: 7, url: "https://example.test/" },
    },
  });
  await expect(result).rejects.toMatchObject({
    _tag: "BrowserObservationError",
    reason: "protocol_error",
  });
  expect(window.reason).toBeUndefined();
});
