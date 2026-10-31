import { rm, stat, type FileHandle } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";

import { captureProcessScenario } from "../../src/process/capture/ProcessHarness.js";
import { processScenarioSchema } from "../../src/domain/process/processScenario.js";
import { emptyProcessCapture } from "../../src/domain/process/processCapture.fixture.js";

const control = vi.hoisted(() => ({
  stage: "none" as "none" | "before" | "open" | "final-stat" | "close",
  controller: undefined as AbortController | undefined,
  reason: undefined as Error | undefined,
  handle: undefined as FileHandle | undefined,
  sampled: false,
  closed: false,
  launches: 0,
}));

// Exercise the actual startup decision without creating a target process.
vi.mock("@lydell/node-pty", () => ({
  spawn: () => {
    control.launches += 1;
    throw new Error("PTY launch sentinel");
  },
}));

// Native ownership inspection is outside this portable launch-boundary test.
vi.mock("../../src/process/ProcessOwnershipObservation.js", async (load) => {
  const original =
    await load<
      typeof import("../../src/process/ProcessOwnershipObservation.js")
    >();
  return {
    ...original,
    prepareProcessOwnershipInspection: async () => {},
    systemProcessOwnershipHost: {
      ...original.systemProcessOwnershipHost,
      captureBaseline: async () => [],
    },
  };
});

vi.mock("node:fs/promises", async (load) => {
  const original = await load<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (args[0] !== process.execPath) return handle;
      control.handle = handle;
      const nativeStat = handle.stat.bind(handle);
      const nativeClose = handle.close.bind(handle);
      const nativeRead = handle.read.bind(handle);
      handle.read = (async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | bigint | null,
      ) => {
        const result = await nativeRead(buffer, offset, length, position);
        if (result.bytesRead === 0) control.sampled = true;
        return result;
      }) as typeof handle.read;
      handle.stat = (async (...parameters: Parameters<typeof handle.stat>) => {
        const metadata = await nativeStat(...parameters);
        if (control.sampled && control.stage === "final-stat")
          control.controller?.abort(control.reason);
        return metadata;
      }) as typeof handle.stat;
      handle.close = async () => {
        await nativeClose();
        control.closed = true;
        if (control.stage === "close")
          control.controller?.abort(control.reason);
      };
      if (control.stage === "open") control.controller?.abort(control.reason);
      return handle;
    },
  };
});

afterEach(() => {
  control.controller = undefined;
  control.reason = undefined;
  control.handle = undefined;
});

it.each(["none", "before", "open", "final-stat", "close"] as const)(
  "gates launch on cancellation at %s while releasing startup resources",
  async (stage) => {
    const controller = new AbortController();
    const reason = new Error(`cancel at ${stage}`);
    Object.assign(control, {
      stage,
      controller,
      reason,
      sampled: false,
      closed: false,
      launches: 0,
    });
    if (stage === "before") controller.abort(reason);
    const removed: string[] = [];
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: ["--eval", "process.exit(0)"],
        working_directory: process.cwd(),
        settle_ms: 0,
      }),
      controller.signal,
      "linux",
      {},
      async () => ({
        files: [],
        truncated: false,
        completeRoots: [],
        coverage: emptyProcessCapture().truncation_details.filesystem_before,
      }),
      {
        platform: "linux",
        cleanupProcessGroup: async () => {
          throw new Error("No process should have been acquired");
        },
        removeTemporaryRoot: async (path) => {
          await rm(path, { recursive: true });
          removed.push(path);
        },
      },
    );
    expect(control.launches).toBe(stage === "none" ? 1 : 0);
    if (result.ok) throw new Error("Expected sentinel failure or cancellation");
    if (stage === "none")
      expect(String(result.error.cause)).toContain("PTY launch sentinel");
    else {
      expect(result.error).toMatchObject({ reason: "cancelled" });
      expect(result.error.cause).toBe(reason);
    }
    if (stage === "before") {
      expect(control.handle).toBeUndefined();
      expect(removed).toEqual([]);
    } else {
      expect(control.closed).toBe(true);
      expect(control.handle?.fd).toBe(-1);
      expect(removed).toHaveLength(1);
      const removedRoot = removed[0];
      if (removedRoot === undefined) throw new Error("Expected removed root");
      await expect(stat(removedRoot)).rejects.toMatchObject({ code: "ENOENT" });
      expect(control.sampled).toBe(stage !== "open");
    }
  },
);
