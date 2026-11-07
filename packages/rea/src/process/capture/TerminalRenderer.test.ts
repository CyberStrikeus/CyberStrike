import { createRequire } from "node:module";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { TerminalRenderer } from "./TerminalRenderer.js";
import { ProcessCaptureResourceScope } from "./ProcessCaptureLifecycle.js";
import { createBoundedProcessTextNormalizer } from "./ProcessNormalization.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import type { BoundedProcessTextNormalization } from "./ProcessNormalization.js";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

const boundedNormalize =
  (
    normalize: (value: string) => string,
  ): ((value: string, maxBytes: number) => BoundedProcessTextNormalization) =>
  (value, maxBytes) => {
    const normalized = normalize(value);
    const utf8Bytes = Buffer.byteLength(normalized);
    return utf8Bytes <= maxBytes
      ? { state: "normalized", value: normalized, utf8Bytes }
      : { state: "over_budget", reason: "retention" };
  };

const renderFrames = async (
  data: string,
  normalize: (value: string) => string = (value) => value,
) => {
  const renderer = new TerminalRenderer({
    columns: 20,
    rows: 4,
    scrollback: 10,
    maxBytes: 100_000,
    normalize: boundedNormalize(normalize),
  });
  renderer.write(data, 0);
  const frames = await renderer.frames();
  const retention = renderer.retention();
  await renderer.dispose();
  return { frames, retention };
};

it("omits trailing blank cells from visible lines without losing rows", async () => {
  const { frames, retention } = await renderFrames(
    "left  right   \r\n\r\n  indented",
  );
  const [frame] = frames;
  expect(frame?.lines).toEqual(["left  right", "", "  indented", ""]);
  // Fixed-width rows remain recoverable from the recorded column count.
  expect(frame?.lines.map((line) => line.padEnd(frame.columns, " "))).toEqual([
    "left  right         ",
    " ".repeat(20),
    "  indented          ",
    " ".repeat(20),
  ]);
  expect(retention.retained_bytes).toBe(
    Buffer.byteLength(frame?.serialized_state ?? "") +
      Buffer.byteLength("left  right  indented"),
  );
});

it("applies rendered retention cumulatively across sparse frames", async () => {
  const renderer = new TerminalRenderer({
    columns: 10,
    rows: 1,
    scrollback: 0,
    maxBytes: 5,
    normalize: boundedNormalize((value) => value),
  });
  try {
    renderer.write("a", 0);
    renderer.write("b", 1);
    const frames = await renderer.frames();

    expect(frames.map(({ lines }) => lines)).toEqual([["a"]]);
    expect(renderer.retention()).toEqual({
      budget_bytes: 5,
      observed_bytes: 2,
      retained_bytes: 2,
      observed_frames: 2,
      retained_frames: 1,
      unknown_size_frames: 1,
    });
    expect(renderer.truncated()).toBe(true);
  } finally {
    await renderer.dispose();
  }
});

it("trims only after normalization sees the full-width row", async () => {
  const { frames } = await renderFrames("pid 4242", (value) =>
    value.replace(/4242 +$/u, "<pid>"),
  );
  expect(frames[0]?.lines[0]).toBe("pid <pid>");
});

it.each([
  { data: "界", cells: 2 },
  // The pinned xterm Unicode table treats this emoji as one cell.
  { data: "😀", cells: 1 },
  { data: "e\u0301", cells: 1 },
  { data: "ab", cells: 2 },
])(
  "normalizes the terminal cells of $data without extra padding",
  async ({ data, cells }) => {
    const { frames } = await renderFrames(data, (value) =>
      value.replaceAll(" ", "_"),
    );
    expect(frames[0]?.lines).toEqual([
      data + "_".repeat(20 - cells),
      "_".repeat(20),
      "_".repeat(20),
      "_".repeat(20),
    ]);
  },
);

it("omits rendered frames with unknown expanded size and keeps later bounded states", async () => {
  const renderer = new TerminalRenderer({
    columns: 10,
    rows: 1,
    scrollback: 0,
    maxBytes: 1_000,
    normalize: createBoundedProcessTextNormalizer(
      processScenarioSchema.parse({
        executable: "unused",
        normalization: {
          paths: false,
          pids: false,
          ports: false,
          patterns: [{ pattern: "a", replacement: "x".repeat(2_000) }],
        },
      }),
      "/tmp",
      -1,
    ),
  });
  try {
    renderer.write("a", 0);
    renderer.write("\u001b[2J\rz", 1);
    const frames = await renderer.frames();

    expect(frames).toHaveLength(1);
    expect(frames[0]?.lines[0]).toBe("z");
    expect(renderer.retention()).toMatchObject({
      observed_frames: 2,
      retained_frames: 1,
      unknown_size_frames: 1,
      normalization_over_budget_frames: 1,
    });
    expect(renderer.truncated()).toBe(true);
  } finally {
    await renderer.dispose();
  }
});

it.each(["write", "resize"] as const)(
  "releases terminal resources after a queued %s observation fails",
  async (operation) => {
    const failure = new Error("normalization failed");
    const terminalDispose = vi.spyOn(Terminal.prototype, "dispose");
    const addonDispose = vi.spyOn(SerializeAddon.prototype, "dispose");
    const renderer = new TerminalRenderer({
      columns: 20,
      rows: 4,
      scrollback: 10,
      maxBytes: 100_000,
      normalize: boundedNormalize(() => {
        throw failure;
      }),
    });
    const scope = new ProcessCaptureResourceScope();
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "rea-terminal-cleanup-"),
    );
    try {
      if (operation === "write") renderer.write("output", 0);
      else renderer.resize(30, 4, 0);
      await expect(renderer.frames()).rejects.toBe(failure);
      const cleanup = await scope.release({
        timers: new Set(),
        terminal: undefined,
        renderer,
        runId: "failed-observation",
        temporaryRoot,
      });
      expect(cleanup.report.terminal_renderer).toEqual({
        state: "cleaned",
        reason: null,
      });
      expect(terminalDispose).toHaveBeenCalledTimes(1);
      expect(addonDispose).toHaveBeenCalledTimes(1);
      await expect(stat(temporaryRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(scope.run(async () => "next capture")).resolves.toBe(
        "next capture",
      );
      await expect(renderer.frames()).rejects.toBe(failure);
    } finally {
      await scope.close();
      terminalDispose.mockRestore();
      addonDispose.mockRestore();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
);

it("retains disposal failures for a later cleanup retry", async () => {
  const failure = new Error("terminal disposal failed");
  const terminalDispose = vi.spyOn(Terminal.prototype, "dispose");
  terminalDispose.mockImplementationOnce(() => {
    throw failure;
  });
  const renderer = new TerminalRenderer({
    columns: 20,
    rows: 4,
    scrollback: 10,
    maxBytes: 100_000,
    normalize: boundedNormalize((value) => value),
  });
  const scope = new ProcessCaptureResourceScope();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rea-terminal-retry-"));
  try {
    const cleanup = await scope.release({
      timers: new Set(),
      terminal: undefined,
      renderer,
      runId: "failed-disposal",
      temporaryRoot,
    });
    expect(cleanup.report.terminal_renderer).toEqual({
      state: "failed",
      reason: failure.message,
    });
    await expect(scope.run(async () => "next capture")).resolves.toBe(
      "next capture",
    );
    expect(terminalDispose).toHaveBeenCalledTimes(2);
  } finally {
    await scope.close();
    terminalDispose.mockRestore();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

it.each([1024, 2048])(
  "keeps unchanged representation retention distinct from normalization at budget %s",
  async (maxBytes) => {
    const renderer = new TerminalRenderer({
      columns: 600,
      rows: 1,
      scrollback: 0,
      maxBytes,
      normalize: createBoundedProcessTextNormalizer(
        processScenarioSchema.parse({
          executable: "unused",
          normalization: { paths: false, pids: false, ports: false },
        }),
        "/tmp",
        -1,
      ),
    });
    try {
      renderer.write("a".repeat(600), 0);
      const frames = await renderer.frames();
      expect(frames).toHaveLength(maxBytes === 1024 ? 0 : 1);
      expect(renderer.retention().normalization_over_budget_frames ?? 0).toBe(
        0,
      );
      expect(renderer.retention().unknown_size_frames ?? 0).toBe(
        maxBytes === 1024 ? 1 : 0,
      );
    } finally {
      await renderer.dispose();
    }
  },
);

it("renders retained chunks once after late PID knowledge, preserving event times and resize order", async () => {
  let identifiers: readonly number[] = [100];
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    normalization: {
      paths: false,
      ports: false,
      pids: true,
      patterns: [
        { pattern: "<pid>", replacement: "selected" },
        { pattern: "200", replacement: "wrong-order" },
      ],
    },
  });
  const write = vi.spyOn(Terminal.prototype, "write");
  const renderer = new TerminalRenderer({
    columns: 30,
    rows: 2,
    scrollback: 0,
    maxBytes: 1000,
    normalize: createBoundedProcessTextNormalizer(
      scenario,
      "/tmp",
      () => identifiers,
    ),
  });
  try {
    renderer.write("child=200", 17);
    renderer.resize(40, 3, 18);
    expect(write).not.toHaveBeenCalled();
    identifiers = [100, 200];
    const frames = await renderer.frames();
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      frames.map(({ at_ms, columns, rows }) => ({ at_ms, columns, rows })),
    ).toEqual([
      { at_ms: 17, columns: 30, rows: 2 },
      { at_ms: 18, columns: 40, rows: 3 },
    ]);
    for (const frame of frames) {
      expect(frame.lines[0]).toBe("child=selected");
      expect(frame.serialized_state).toContain("child=selected");
    }
  } finally {
    await renderer.dispose();
    write.mockRestore();
  }
});

it("renders a bounded sequence of retained chunks and resizes", async () => {
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    normalization: { paths: false, ports: false, pids: true, patterns: [] },
  });
  const renderer = new TerminalRenderer({
    columns: 20,
    rows: 4,
    scrollback: 10,
    maxBytes: 1_048_576,
    normalize: createBoundedProcessTextNormalizer(scenario, "/tmp", 100),
  });
  try {
    for (let index = 0; index < 100; index += 1) {
      renderer.write(`root=100 row=${index}\r\n`, index * 10);
      if (index === 24 || index === 74)
        renderer.resize(index === 24 ? 30 : 20, 4, index * 10 + 1);
    }
    const frames = await renderer.frames();
    expect(frames).toHaveLength(102);
    expect(
      frames
        .filter(({ at_ms }) => at_ms % 10 === 1)
        .map(({ at_ms, columns }) => ({ at_ms, columns })),
    ).toEqual([
      { at_ms: 241, columns: 30 },
      { at_ms: 741, columns: 20 },
    ]);
    expect(frames.at(-1)?.serialized_state).toContain("root=<pid> row=99");
    expect(renderer.retention().retained_frames).toBe(102);
    expect(renderer.truncated()).toBe(false);
  } finally {
    await renderer.dispose();
  }
});
