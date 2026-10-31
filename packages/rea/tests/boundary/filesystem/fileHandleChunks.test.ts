import type { FileHandle } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import {
  FileReadCancelled,
  readFileHandleChunks,
} from "../../../src/filesystem/readFileHandleChunks.js";

it.each(["complete", "fail"])(
  "settles the pending descriptor read before cancellation: %s",
  async (outcome) => {
    let enter!: () => void;
    let release!: (value: { bytesRead: number; buffer: Buffer }) => void;
    let reject!: (cause: unknown) => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const pending = new Promise<{ bytesRead: number; buffer: Buffer }>(
      (resolve, fail) => {
        release = resolve;
        reject = fail;
      },
    );
    const read = vi.fn(async () => {
      enter();
      return pending;
    }) as unknown as FileHandle["read"];
    const controller = new AbortController();
    const source = readFileHandleChunks(
      { read },
      { signal: controller.signal },
    );
    let settled = false;
    const result = buffer(source)
      .catch((cause: unknown) => cause)
      .finally(() => {
        settled = true;
      });
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(entered, result, "descriptor read");
      controller.abort(null);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(source.destroyed).toBe(false);
      const failure = new Error("controlled native read failure");
      if (outcome === "fail") reject(failure);
      else release({ bytesRead: 0, buffer: Buffer.alloc(0) });
      const error = await result;
      if (outcome === "fail") expect(error).toBe(failure);
      else {
        expect(error).toBeInstanceOf(FileReadCancelled);
        if (error instanceof FileReadCancelled) expect(error.reason).toBeNull();
      }
      expect(read).toHaveBeenCalledTimes(1);
    }, [
      () => controller.abort(null),
      () => release({ bytesRead: 0, buffer: Buffer.alloc(0) }),
      async () => {
        await result;
      },
    ]);
  },
);

it.each([false, true])(
  "cancels an unconsumed stream without admitting a read (already aborted: %s)",
  async (alreadyAborted) => {
    const controller = new AbortController();
    const reason = new Error("caller cancellation");
    const read = vi.fn() as unknown as FileHandle["read"];
    if (alreadyAborted) controller.abort(reason);
    const source = readFileHandleChunks(
      { read },
      { signal: controller.signal },
    );
    const failed = new Promise<Error>((resolve) =>
      source.once("error", resolve),
    );
    if (!alreadyAborted) controller.abort(reason);
    const error = await failed;
    expect(error).toBeInstanceOf(FileReadCancelled);
    if (error instanceof FileReadCancelled) expect(error.reason).toBe(reason);
    expect(read).not.toHaveBeenCalled();
  },
);

it("removes cancellation observation after normal stream completion", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const read = vi.fn(async () => ({
    bytesRead: 0,
    buffer: Buffer.alloc(0),
  })) as unknown as FileHandle["read"];
  const source = readFileHandleChunks({ read }, { signal: controller.signal });
  expect(Buffer.compare(await buffer(source), Buffer.alloc(0))).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  controller.abort(null);
  expect(source.errored).toBeNull();
});

it.each(["range", "eof"])(
  "retains physical %s coverage independently of stream delivery",
  async (boundary) => {
    let calls = 0;
    const read = (async (
      target: Buffer,
      _offset: number,
      length: number,
      position: bigint,
    ) => {
      calls++;
      expect(position).toBe(calls === 1 ? 5n : 6n);
      if (boundary === "eof" && calls === 2)
        return { bytesRead: 0, buffer: target };
      const bytes = boundary === "range" ? 3 : 1;
      target.fill(0x61, 0, bytes);
      expect(length).toBe(3);
      return { bytesRead: bytes, buffer: target };
    }) as FileHandle["read"];
    const source = readFileHandleChunks({ read }, { start: 5, end: 7 });
    expect(source.readCoverage()).toEqual({ kind: "incomplete", bytes: 0n });
    expect(
      Buffer.compare(
        await buffer(source),
        Buffer.alloc(boundary === "range" ? 3 : 1, 0x61),
      ),
    ).toBe(0);
    const coverage = source.readCoverage();
    expect(coverage).toEqual({
      kind: "complete",
      bytes: boundary === "range" ? 3n : 1n,
      boundary,
    });
    expect(Object.isFrozen(coverage)).toBe(true);
    expect(calls).toBe(boundary === "range" ? 1 : 2);
  },
);
