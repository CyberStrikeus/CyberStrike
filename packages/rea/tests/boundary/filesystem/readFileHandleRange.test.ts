import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { readFileHandleRange } from "../../../src/filesystem/readFileHandleRange.js";

const source = async () => {
  const root = await createTestTempDirectory("rea-file-window-");
  const path = join(root, "bytes");
  await writeFile(path, "0123456789");
  const handle = await open(path, "r");
  onTestFinished(() => handle.close());
  const read = handle.read.bind(handle);
  const spy = vi.spyOn(handle, "read").mockImplementation((async (
    ...args: unknown[]
  ) => {
    args[2] = Math.min(args[2] as number, 2);
    return Reflect.apply(read, handle, args);
  }) as typeof handle.read);
  return { handle, spy };
};

it("fills positional windows across positive short reads and stops only at EOF", async () => {
  const { handle, spy } = await source();
  expect((await readFileHandleRange(handle, 3, 5)).toString()).toBe("34567");
  expect(spy.mock.calls.map((call) => (call as unknown[])[3])).toEqual([
    3, 5, 7,
  ]);
  expect((await readFileHandleRange(handle, 8, 5)).toString()).toBe("89");
  expect(await readFileHandleRange(handle, 12, 2)).toHaveLength(0);
  // The helper borrows the descriptor; it remains usable after EOF.
  expect((await handle.stat()).size).toBe(10);
});

it("validates ranges and checks cancellation even for empty windows", async () => {
  const { handle, spy } = await source();
  expect(await readFileHandleRange(handle, 2, 0)).toHaveLength(0);
  expect(spy).not.toHaveBeenCalled();
  for (const [offset, length] of [
    [-1, 2],
    [0, -1],
    [0.5, 2],
    [Number.MAX_SAFE_INTEGER, 1],
  ])
    await expect(readFileHandleRange(handle, offset!, length!)).rejects.toThrow(
      RangeError,
    );
  const cancelled = new Error("cancelled");
  await expect(
    readFileHandleRange(handle, 0, 0, () => {
      throw cancelled;
    }),
  ).rejects.toBe(cancelled);
});

it("checks cancellation after each fulfilled read and retains native failures", async () => {
  const { handle, spy } = await source();
  const cancelled = new Error("cancelled");
  await expect(
    readFileHandleRange(handle, 0, 4, () => {
      if (spy.mock.calls.length > 0) throw cancelled;
    }),
  ).rejects.toBe(cancelled);
  expect(spy).toHaveBeenCalledTimes(1);
  const native = new Error("native I/O failure");
  spy.mockRejectedValueOnce(native);
  await expect(readFileHandleRange(handle, 0, 4)).rejects.toBe(native);
});

it("returns explicit EOF for the caller to interpret before late cancellation", async () => {
  const { handle, spy } = await source();
  expect(
    await readFileHandleRange(handle, 10, 4, () => {
      if (spy.mock.calls.length > 0) throw new Error("late cancellation");
    }),
  ).toHaveLength(0);
});

it("reports complete acquisition so the owner can finalize bytes after a late abort", async () => {
  const { handle, spy } = await source();
  const checkpoints: number[] = [];
  const bytes = await readFileHandleRange(handle, 0, 4, (acquired) => {
    checkpoints.push(acquired);
    if (spy.mock.calls.length >= 2 && acquired < 4)
      throw new Error("cancelled before full acquisition");
  });
  expect(bytes.toString()).toBe("0123");
  expect(checkpoints).toEqual([0, 0, 2, 2, 4]);
});
