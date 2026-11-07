import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { finished } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type {
  ArtifactReader,
  ArtifactEntry,
} from "../../src/artifacts/ArtifactReader.js";
import {
  openRegularFile,
  type StableRegularFileDescriptor,
} from "../../src/filesystem/RegularFile.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";
import { createDeferred } from "./binarySession.js";
import { awaitAcknowledgement } from "./lifecycleAcknowledgement.js";

interface LifecycleFixture {
  readonly image: () => Buffer;
  readonly createReader: (
    path: string,
    admitted?: StableRegularFileDescriptor,
  ) => ArtifactReader;
}

const fixture = async (bytes: Buffer): Promise<string> => {
  const path = join(
    await createTestTempDirectory("rea-reader-lifecycle-"),
    "image",
  );
  await writeFile(path, bytes);
  return path;
};
const entries = async (reader: ArtifactReader): Promise<ArtifactEntry[]> => {
  const result: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) result.push(entry);
  return result;
};

const consumptionCases = ({ image, createReader }: LifecycleFixture): void => {
  it("does not complete paused inventory after its reader closes", async () => {
    const reader = createReader(await fixture(image()));
    const iterator = reader.entries()[Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).done).toBe(false);
      await reader.close();
      await expect(iterator.next()).rejects.toMatchObject({
        reason: "unavailable",
      });
    } finally {
      await reader.close();
    }
  });
  it.each(["cancel", "close"] as const)(
    "retires fully buffered, unconsumed member bytes on %s",
    async (action) => {
      const reader = createReader(await fixture(image()));
      const controller = new AbortController();
      const reason = new Error("cancel buffered member");
      try {
        const [entry] = await entries(reader);
        const stream = await reader.open(entry!, controller.signal);
        await finished(stream, { readable: false, cleanup: true });
        await setImmediate();
        expect(stream.readableLength).toBeGreaterThan(0);
        if (action === "cancel") controller.abort(reason);
        else await reader.close();
        await expect(buffer(stream)).rejects.toMatchObject(
          action === "cancel"
            ? { reason: "cancelled", cause: reason }
            : { reason: "unavailable" },
        );
        expect(stream.destroyed).toBe(true);
      } finally {
        await reader.close();
      }
    },
  );
};

const descriptorCases = ({ image, createReader }: LifecycleFixture): void => {
  it("joins a member's outstanding positional read before descriptor closure", async () => {
    const path = await fixture(image());
    const admitted = await openRegularFile(path, { symlinks: "reject" });
    const reader = createReader(path, admitted);
    const reached = createDeferred<void>(),
      release = createDeferred<void>();
    const nativeRead = admitted.handle.read.bind(admitted.handle);
    const reads = vi.spyOn(admitted.handle, "read");
    let outcome: Promise<unknown> | undefined;
    let closing: Promise<void> | undefined;
    try {
      const [entry] = await entries(reader);
      reads.mockImplementation((async (...args: unknown[]) => {
        reached.resolve();
        await release.promise;
        return Reflect.apply(nativeRead, admitted.handle, args);
      }) as typeof admitted.handle.read);
      const stream = await reader.open(entry!);
      outcome = buffer(stream).then(
        () => ({ ok: true }),
        (cause: unknown) => ({ ok: false, cause }),
      );
      await awaitAcknowledgement(
        reached.promise,
        outcome,
        "member positional read",
      );
      let closed = false;
      closing = reader.close().then(() => {
        closed = true;
      });
      await setImmediate();
      expect(closed).toBe(false);
      release.resolve();
      await closing;
      expect(stream.closed).toBe(true);
    } finally {
      release.resolve();
      await outcome;
      await closing;
      await reader.close();
      reads.mockRestore();
      await admitted.handle.close();
    }
  });

  it("retains failed descriptor cleanup for retry", async () => {
    const reader = createReader(await fixture(image()));
    try {
      const [entry] = await entries(reader);
      const stream = await reader.open(entry!);
      const failure = new Error("artifact close denied");
      const close = vi
        .spyOn(OwnedFileHandle.prototype, "close")
        .mockRejectedValueOnce(failure);
      try {
        await expect(reader.close()).rejects.toBe(failure);
        await expect(reader.open(entry!)).rejects.toMatchObject({
          reason: "unavailable",
        });
        expect(stream.closed).toBe(true);
        await reader.close();
        expect(close).toHaveBeenCalledTimes(2);
      } finally {
        close.mockRestore();
      }
    } finally {
      await reader.close();
    }
  });
};

const validationCases = ({ image, createReader }: LifecycleFixture): void => {
  it.each(["cancel", "cancel-with-validation-error", "close"] as const)(
    "joins final freshness validation during %s",
    async (action) => {
      const path = await fixture(image());
      const admitted = await openRegularFile(path, { symlinks: "reject" });
      const reader = createReader(path, admitted);
      const reached = createDeferred<void>(),
        release = createDeferred<void>();
      const nativeStat = admitted.handle.stat.bind(admitted.handle);
      const nativeRead = admitted.handle.read.bind(admitted.handle);
      const reads = vi.spyOn(admitted.handle, "read");
      const stats = vi.spyOn(admitted.handle, "stat");
      const controller = new AbortController(),
        reason = new Error("cancel final validation");
      const validationFailure = new Error("final descriptor stat failed");
      let outcome: Promise<unknown> | undefined;
      let closing: Promise<void> | undefined;
      try {
        const [entry] = await entries(reader);
        const memberEnd = BigInt(entry!.byteOffset! + entry!.declaredSize!);
        let memberReadComplete = false;
        reads.mockImplementation((async (...args: unknown[]) => {
          const result = (await Reflect.apply(
            nativeRead,
            admitted.handle,
            args,
          )) as {
            bytesRead: number;
            buffer: Buffer;
          };
          if (typeof args[3] === "bigint")
            memberReadComplete =
              args[3] + BigInt(result.bytesRead) === memberEnd;
          return result;
        }) as typeof admitted.handle.read);
        stats.mockImplementation((async (...args: unknown[]) => {
          const result = await Reflect.apply(nativeStat, admitted.handle, args);
          if (memberReadComplete) {
            memberReadComplete = false;
            reached.resolve();
            await release.promise;
            if (action === "cancel-with-validation-error")
              throw validationFailure;
          }
          return result;
        }) as typeof admitted.handle.stat);
        const stream = await reader.open(entry!, controller.signal);
        outcome = buffer(stream).then(
          () => ({ ok: true }) as const,
          (cause: unknown) => ({ ok: false, cause }) as const,
        );
        await awaitAcknowledgement(
          reached.promise,
          outcome,
          "post-read freshness validation",
        );
        let closed = false;
        if (action !== "close") controller.abort(reason);
        else
          closing = reader.close().then(() => {
            closed = true;
          });
        await setImmediate();
        expect(closed).toBe(false);
        release.resolve();
        expect(await outcome).toMatchObject({
          ok: false,
          cause:
            action === "cancel-with-validation-error"
              ? validationFailure
              : action === "cancel"
                ? { reason: "cancelled", cause: reason }
                : { reason: "unavailable" },
        });
        await closing;
      } finally {
        release.resolve();
        await outcome;
        await closing;
        await reader.close();
        stats.mockRestore();
        reads.mockRestore();
        await admitted.handle.close();
      }
    },
  );
};

/** Stored-member readers share ownership and native I/O regression oracles.
 * The fixture must have a nonempty first entry with a physical byte range.
 */
export const artifactReaderLifecycleCases = (setup: LifecycleFixture): void => {
  describe("stored member lifecycle", () => {
    consumptionCases(setup);
    descriptorCases(setup);
    validationCases(setup);
  });
};
