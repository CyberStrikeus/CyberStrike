import type { FileHandle } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { withPyInstallerReader } from "../../../tests/fixtures/pyinstallerReader.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import type { ArtifactEntry } from "../ArtifactReader.js";
import { PyInstallerPyzStore } from "./PyInstallerPyzStore.js";
import {
  cArchiveExecutable,
  pyzArchive,
  PYTHON_39_MAGIC,
} from "./CArchive.fixture.js";

const compressedImages = (count: number, modules = false) =>
  cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    members: Array.from({ length: count }, (_, index) => ({
      name: `PYZ-${index}.pyz`,
      typeCode: "z",
      compress: true,
      payload: pyzArchive({
        magic: PYTHON_39_MAGIC,
        modules: modules
          ? [{ name: "app", typeCode: 0, body: Buffer.from("body") }]
          : [],
      }),
    })),
  });

it("refuses excess private images before creating any temporary file", async () => {
  const spool = vi
    .spyOn(PyInstallerPyzStore.prototype, "spool")
    .mockRejectedValue(new Error("unexpected private file creation"));
  try {
    await withPyInstallerReader(compressedImages(129), async (reader) => {
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        reason: "limit",
        boundary: "capacity",
      });
      expect(spool).not.toHaveBeenCalled();
    });
  } finally {
    spool.mockRestore();
  }
});

it("accepts the private-image capacity and retires all image owners", async () => {
  const spool = vi.spyOn(PyInstallerPyzStore.prototype, "spool");
  try {
    await withPyInstallerReader(compressedImages(128), async (reader, root) => {
      const listed: ArtifactEntry[] = [];
      for await (const entry of reader.entries()) listed.push(entry);
      expect(listed).toHaveLength(128);
      expect(spool).toHaveBeenCalledTimes(128);
      await reader.close();
      expect(root.fd).toBeGreaterThanOrEqual(0);
    });
  } finally {
    spool.mockRestore();
  }
});

it.each([false, true])(
  "preserves private-image admission cancellation (failed cleanup: %s)",
  async (failClose) => {
    await withPyInstallerReader(
      compressedImages(1, true),
      async (reader, root) => {
        let selected: ArtifactEntry | undefined;
        for await (const entry of reader.entries())
          if (entry.path.endsWith("app.pyc")) selected = entry;
        if (selected === undefined) throw new Error("Missing child");
        let entered!: () => void, release!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const prototype = Object.getPrototypeOf(root) as FileHandle;
        const nativeStat = prototype.stat,
          nativeClose = OwnedFileHandle.prototype.close;
        let admitted: FileHandle | undefined,
          retained: OwnedFileHandle | undefined,
          attempts = 0;
        const cancelled = new Error("cancel private-image admission"),
          cleanup = new Error("admission cleanup EIO");
        const signal = new AbortController();
        const stat = vi
          .spyOn(prototype, "stat")
          .mockImplementation(async function (
            this: FileHandle,
            ...args: Parameters<FileHandle["stat"]>
          ) {
            if (this !== root && admitted === undefined) {
              admitted = this;
              entered();
              await gate;
            }
            return Reflect.apply(nativeStat, this, args);
          });
        const close = vi
          .spyOn(OwnedFileHandle.prototype, "close")
          .mockImplementation(async function (this: OwnedFileHandle) {
            if (this.handle === admitted) {
              retained = this;
              attempts++;
              if (failClose && attempts === 1) throw cleanup;
            }
            await nativeClose.call(this);
          });
        const opening = reader.open(selected, signal.signal);
        void opening.catch(() => undefined);
        try {
          await started;
          signal.abort(cancelled);
          release();
          await expect(opening).rejects.toMatchObject({
            reason: "cancelled",
            cancellation: { reason: cancelled },
            ...(failClose ? { cleanup: { reason: cleanup.message } } : {}),
          });
          if (failClose) expect(retained?.handle.fd).toBeGreaterThanOrEqual(0);
          await reader.close();
          expect(attempts).toBe(failClose ? 2 : 1);
          expect(admitted?.fd).toBe(-1);
          expect(root.fd).toBeGreaterThanOrEqual(0);
        } finally {
          release();
          await opening.catch(() => undefined);
          stat.mockRestore();
          close.mockRestore();
        }
      },
    );
  },
);
