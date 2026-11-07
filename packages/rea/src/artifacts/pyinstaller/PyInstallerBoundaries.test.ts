import { withPyInstallerReader } from "../../../tests/fixtures/pyinstallerReader.js";
import { dirname, join } from "node:path";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { createHash, randomBytes } from "node:crypto";
import { rename, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { PyInstallerArtifactReader } from "../PyInstallerArtifactReader.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { hashReadable } from "../ArtifactHash.js";
import { translateArtifactFailure } from "../ArtifactOperationFailure.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { marshalCode } from "../../python/PythonPyc.fixture.js";
import { PyInstallerPyzStore } from "./PyInstallerPyzStore.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../ArtifactReader.js";
import {
  cArchiveExecutable,
  pyzArchive,
  PYTHON_39_MAGIC,
} from "./CArchive.fixture.js";

const hash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const archive = (body: Buffer) =>
  cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    members: [{ name: "data", typeCode: "x", payload: body, compress: false }],
  });
const members = async (
  reader: PyInstallerArtifactReader,
  signal?: AbortSignal,
) => {
  const entries: ArtifactEntry[] = [];
  for await (const entry of reader.entries(signal)) entries.push(entry);
  return entries;
};
const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it.each(["success", "io", "caller cancellation", "reader close"] as const)(
  "joins the pending descriptor read after a module prefix stop (%s)",
  async (outcome) => {
    const payload = marshalCode("py38", {
      bytecode: randomBytes(256 * 1024),
    });
    const compressedBytes = deflateSync(payload).length;
    expect(compressedBytes).toBeGreaterThan(128 * 1024);
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: "module", typeCode: "m", payload, compress: true },
          {
            name: "PYZ.pyz",
            typeCode: "z",
            payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
            compress: false,
          },
        ],
      }),
      async (reader, handle) => {
        const entered = deferred(),
          prefixStopped = deferred(),
          release = deferred();
        const caller = new AbortController();
        const cancelled = new Error("caller leaves during prefix drain");
        const io = Object.assign(new Error("late module prefix read EIO"), {
          code: "EIO",
        });
        const memberSource = PyInstallerPyzStore.prototype.memberSource;
        let prefixSignal: AbortSignal | undefined;
        const source = vi
          .spyOn(PyInstallerPyzStore.prototype, "memberSource")
          .mockImplementation(function (this: PyInstallerPyzStore, ...args) {
            prefixSignal = args[2];
            prefixSignal.addEventListener("abort", prefixStopped.resolve, {
              once: true,
            });
            return memberSource.apply(this, args);
          });
        const read = handle.read.bind(handle);
        let memberReads = 0;
        let requestedMemberBytes = 0;
        const descriptor = vi
          .spyOn(handle, "read")
          .mockImplementation(async (...args: unknown[]) => {
            if (prefixSignal !== undefined) {
              memberReads++;
              // Inflate can deliver this prefix while the next native read is pending.
              if (memberReads === 1) args[2] = 64;
              requestedMemberBytes += Number(args[2]);
              if (memberReads === 2) {
                entered.resolve();
                await release.promise;
                if (outcome === "io") throw io;
              }
            }
            return Reflect.apply(read, handle, args);
          });
        let settled = false;
        const listing = members(reader, caller.signal).finally(() => {
          settled = true;
        });
        void listing.catch(() => undefined);
        let closing: Promise<void> | undefined;
        try {
          await Promise.all([entered.promise, prefixStopped.promise]);
          expect(prefixSignal?.aborted).toBe(true);
          expect(caller.signal.aborted).toBe(false);
          expect(memberReads).toBe(2);
          expect(settled).toBe(false);
          if (outcome === "caller cancellation") {
            caller.abort(cancelled);
            await setImmediate();
          }
          if (outcome === "reader close") {
            let closed = false;
            closing = reader.close().then(() => {
              closed = true;
            });
            await setImmediate();
            expect(closed).toBe(false);
            expect(handle.fd).toBeGreaterThanOrEqual(0);
          }
          expect(settled).toBe(false);
          release.resolve();
          if (outcome === "success") {
            const module = (await listing).find(
              (entry) => entry.path === "module",
            );
            expect(module).toMatchObject({
              formatMetadata: { bytecode_header: "derived" },
            });
          } else {
            const failure: unknown = await listing.catch(
              (cause: unknown) => cause,
            );
            expect(failure).toBeInstanceOf(ArtifactReaderFailure);
            if (!(failure instanceof ArtifactReaderFailure))
              throw new Error("Expected module prefix failure");
            expect(failure.reason).toBe(outcome === "io" ? "io" : "cancelled");
            if (outcome !== "reader close")
              expect(failure.cause).toBe(outcome === "io" ? io : cancelled);
            else
              expect(failure.cause).toMatchObject({
                reason: "unavailable",
                message: "PyInstaller reader closed",
              });
          }
          await closing;
          expect(memberReads).toBe(2);
          expect(requestedMemberBytes).toBeLessThan(compressedBytes);
        } finally {
          release.resolve();
          await Promise.allSettled([
            listing,
            ...(closing === undefined ? [] : [closing]),
          ]);
          descriptor.mockRestore();
          source.mockRestore();
        }
      },
    );
  },
);

it.each([false, true])(
  "settles independent private and carrier closes and retries only failed owners (carrier failure: %s)",
  async (failCarrier) => {
    const path = join(await createTestTempDirectory("rea-pyi-cleanup-"), "app");
    await writeFile(
      path,
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: ["one", "two"].map((name) => ({
          name: `${name}.pyz`,
          typeCode: "z",
          compress: true,
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "app", typeCode: 0, body: Buffer.from(name) }],
          }),
        })),
      }),
    );
    const reader = new PyInstallerArtifactReader(path);
    const entries = (await members(reader)).filter((entry) =>
      entry.path.endsWith("app.pyc"),
    );
    expect(entries).toHaveLength(2);
    const nativeClose = OwnedFileHandle.prototype.close;
    const privateOwners = new Set<OwnedFileHandle>();
    const attempts: OwnedFileHandle[] = [];
    let collecting = true;
    let failing = true;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        attempts.push(this);
        if (collecting) privateOwners.add(this);
        if (failing && (privateOwners.has(this) || failCarrier))
          throw new Error(
            privateOwners.has(this) ? "private close EIO" : "carrier close EIO",
          );
        await nativeClose.call(this);
      });
    try {
      for (const entry of entries)
        await expect(buffer(await reader.open(entry))).rejects.toMatchObject({
          cleanup: { reason: "private close EIO" },
        });
      expect(privateOwners.size).toBe(2);
      collecting = false;
      attempts.length = 0;
      const failure = await reader.close().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(attempts).toHaveLength(3);
      expect(new Set(attempts).size).toBe(3);
      expect(failure).toMatchObject({
        cleanup: {
          resources: expect.arrayContaining(failCarrier ? [path] : []),
        },
      });
      expect(
        (failure as ArtifactReaderFailure).cleanup?.resources,
      ).toHaveLength(failCarrier ? 3 : 2);
      expect((failure as ArtifactReaderFailure).cleanup?.reason).toContain(
        "private close EIO",
      );
      if (failCarrier)
        expect((failure as ArtifactReaderFailure).cleanup?.reason).toContain(
          "carrier close EIO",
        );
      const carrier = attempts.find((owner) => !privateOwners.has(owner))!;
      expect(carrier.handle.fd >= 0).toBe(failCarrier);
      for (const owner of privateOwners)
        expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
      failing = false;
      attempts.length = 0;
      await reader.close();
      expect(attempts).toHaveLength(failCarrier ? 3 : 2);
      for (const owner of [...privateOwners, carrier])
        expect(owner.handle.fd).toBe(-1);
      attempts.length = 0;
      await reader.close();
      expect(attempts).toEqual([]);
    } finally {
      close.mockRestore();
      await reader.close();
    }
  },
);

it("binds materialization to the inventoried digest and checks cached carrier freshness", async () => {
  const bytes = archive(Buffer.from("first"));
  await withPyInstallerReader(bytes, async (reader, _handle, path) => {
    await expect(reader.prepareContainer("0".repeat(64))).rejects.toMatchObject(
      { reason: "integrity" },
    );
    await reader.prepareContainer(hash(bytes));
    await reader.prepareContainer(hash(bytes));
    await writeFile(path, archive(Buffer.from("other")));
    await expect(reader.prepareContainer(hash(bytes))).rejects.toMatchObject({
      reason: "integrity",
    });
  });
});

it.each(["ENOENT", "ENOTDIR"] as const)(
  "retains changed-source evidence when an admitted carrier becomes unaddressable (%s)",
  async (code) => {
    const body = Buffer.from("observed before the source moved");
    const bytes = archive(body);
    await withPyInstallerReader(bytes, async (reader, handle, path) => {
      await reader.prepareContainer(hash(bytes));
      const [entry] = await members(reader);
      if (entry === undefined) throw new Error("Missing original member");
      const observed = await hashReadable(await reader.open(entry));
      expect(observed).toMatchObject({
        sha256: hash(body),
        bytes: body.length,
      });
      const moved = code === "ENOENT" ? path : dirname(path);
      await rename(moved, `${moved}.moved`);
      if (code === "ENOTDIR") await writeFile(moved, "replaced ancestor");
      try {
        const attempts = [
          () => reader.prepareContainer(hash(bytes)),
          () => members(reader),
          () => reader.open(entry),
        ];
        for (const attempt of attempts) {
          const cause = await attempt().then(
            () => undefined,
            (failure: unknown) => failure,
          );
          expect(cause).toMatchObject({
            reason: "integrity",
            message: `PyInstaller source identity changed: ${path}`,
          });
          expect(
            projectAnalysisError(
              translateArtifactFailure("extract_artifact", cause),
            ),
          ).toMatchObject({
            category: "integrity_mismatch",
            details: {
              reason: "integrity",
              detail: `PyInstaller source identity changed: ${path}`,
            },
          });
        }
        expect(handle.fd).toBeGreaterThanOrEqual(0);
      } finally {
        if (code === "ENOTDIR") await unlink(moved);
        await rename(`${moved}.moved`, moved);
      }
    });
  },
);

it("bounds descriptor reads while hashing a selected stored member", async () => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x61);
  await withPyInstallerReader(archive(payload), async (reader, handle) => {
    const entry = (await members(reader))[0]!;
    const read = handle.read.bind(handle);
    let maximum = 0;
    const spy = vi
      .spyOn(handle, "read")
      .mockImplementation((...args: unknown[]) => {
        if (typeof args[2] === "number") maximum = Math.max(maximum, args[2]);
        return Reflect.apply(read, handle, args);
      });
    try {
      const observed = await hashReadable(await reader.open(entry));
      expect(observed.sha256).toBe(hash(payload));
      expect(observed.bytes).toBe(payload.length);
      expect(maximum).toBeGreaterThan(0);
      expect(maximum).toBeLessThanOrEqual(64 * 1024);
    } finally {
      spy.mockRestore();
    }
  });
});

it.each([false, true])(
  "joins pending native reads during cancellation/close (I/O failure: %s)",
  async (fail) => {
    await withPyInstallerReader(
      archive(Buffer.alloc(256 * 1024, 0x61)),
      async (reader, handle) => {
        const entry = (await members(reader))[0]!;
        const entered = deferred(),
          release = deferred();
        const read = handle.read.bind(handle);
        const io = Object.assign(new Error("native read failed"), {
          code: "EIO",
        });
        const caller = new Error("caller stopped reading");
        const controller = new AbortController();
        let held = false;
        const spy = vi
          .spyOn(handle, "read")
          .mockImplementation(async (...args: unknown[]) => {
            if (!held) {
              held = true;
              entered.resolve();
              await release.promise;
              if (fail) throw io;
            }
            return Reflect.apply(read, handle, args);
          });
        const consumed = reader
          .open(entry, controller.signal)
          .then((stream) => buffer(stream));
        void consumed.catch(() => undefined);
        let closing: Promise<void> | undefined;
        try {
          await entered.promise;
          controller.abort(caller);
          let closed = false;
          closing = reader.close().then(() => {
            closed = true;
          });
          await setImmediate();
          expect(closed).toBe(false);
          expect(handle.fd).toBeGreaterThanOrEqual(0);
          release.resolve();
          await expect(consumed).rejects.toMatchObject({
            reason: fail ? "io" : "cancelled",
            cause: fail ? io : caller,
          });
          await closing;
          expect(handle.fd).toBeGreaterThanOrEqual(0);
        } finally {
          release.resolve();
          await Promise.allSettled([
            consumed,
            ...(closing === undefined ? [] : [closing]),
          ]);
          spy.mockRestore();
        }
      },
    );
  },
);

it("preserves BOM characters in length-delimited UTF-8 fields", async () => {
  const bytes = cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    pythonLibrary: "\ufefflibpython.so",
    members: [
      {
        name: "\ufeffasset",
        typeCode: "x",
        payload: Buffer.from("data"),
        compress: false,
      },
      {
        name: "PYZ.pyz",
        typeCode: "z",
        compress: false,
        payload: pyzArchive({
          magic: PYTHON_39_MAGIC,
          modules: [
            { name: "\ufeffmodule", typeCode: 0, body: Buffer.from("module") },
          ],
        }),
      },
    ],
  });
  await withPyInstallerReader(bytes, async (reader) => {
    const entries = await members(reader);
    expect(reader.formatMetadata()).toMatchObject({
      python_library: "\ufefflibpython.so",
    });
    expect(entries.map((entry) => entry.path)).toContain("\ufeffasset");
    expect(
      entries.find((entry) => entry.path === "\ufeffasset")?.formatMetadata,
    ).toMatchObject({ source_name: "\ufeffasset" });
    expect(
      entries.find((entry) => entry.path === "PYZ.pyz/\ufeffmodule.pyc")
        ?.formatMetadata,
    ).toMatchObject({ source_name: "\ufeffmodule" });
  });
});

it("keeps runtime options as declarations with literal names and distinct source indices", async () => {
  const option = "pyi-runtime-tmpdir /tmp/../chosen";
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: option,
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: option,
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "data",
          typeCode: "x",
          payload: Buffer.from("data"),
          compress: false,
        },
      ],
    }),
    async (reader) => {
      const entries = await members(reader);
      const options = entries.filter((entry) => entry.kind === "metadata");
      expect(options.map((entry) => entry.path)).toEqual([
        "__pyinstaller__/runtime-options/0",
        "__pyinstaller__/runtime-options/1",
      ]);
      expect(options.map((entry) => entry.formatMetadata)).toMatchObject([
        { source_name: option, index: 0 },
        { source_name: option, index: 1 },
      ]);
      expect(reader.formatMetadata()).toMatchObject({
        runtime_option_count: 2,
        entry_count: 3,
      });
      await expect(reader.open(options[0]!)).rejects.toMatchObject({
        reason: "format",
      });
    },
  );
});

it("rejects metadata expansion before retaining every repeated long container path", async () => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: Array.from({ length: 3000 }, (_, index) => ({
      name: `module${String(index)}`,
      typeCode: 0,
      body: Buffer.from("x"),
    })),
  });
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "a".repeat(40000),
          typeCode: "z",
          payload: image,
          compress: false,
        },
      ],
    }),
    async (reader) => {
      let failure: unknown;
      try {
        for await (const entry of reader.entries()) {
          void entry;
        }
      } catch (cause: unknown) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      expect(failure).toMatchObject({ reason: "limit", boundary: "memory" });
    },
  );
});

it.each([false, true])(
  "validates compressed member bounds through the stream (truncated: %s)",
  async (truncated) => {
    const payload = Buffer.from("complete module payload");
    const encoded = deflateSync(payload);
    const bytes = cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "data",
          typeCode: "x",
          payload,
          compress: true,
          declaredUncompressedSize: truncated ? payload.length : 4,
        },
      ],
    });
    if (truncated)
      bytes.writeUInt32BE(encoded.length - 2, 64 + encoded.length + 8);
    await withPyInstallerReader(bytes, async (reader) => {
      const entry = (await members(reader))[0]!;
      await expect(buffer(await reader.open(entry))).rejects.toMatchObject({
        reason: truncated ? "format" : "limit",
      });
    });
  },
);

it("joins a late private-file close and retries its failed owner after cancellation", async () => {
  const bytes = cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    members: [
      {
        name: "PYZ.pyz",
        typeCode: "z",
        payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
        compress: true,
      },
    ],
  });
  await withPyInstallerReader(bytes, async (reader, borrowed) => {
    const entered = deferred(),
      release = deferred();
    const nativeClose = OwnedFileHandle.prototype.close;
    const failure = new Error("private final close failed");
    let owner: OwnedFileHandle | undefined;
    let attempts = 0;
    const spy = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        if (owner === undefined) {
          owner = this;
          entered.resolve();
          await release.promise;
          throw failure;
        }
        if (this === owner) attempts += 1;
        await nativeClose.call(this);
      });
    const signal = new AbortController();
    const listing = reader
      .entries(signal.signal)
      [Symbol.asyncIterator]()
      .next()
      .catch((cause: unknown) => cause);
    try {
      await entered.promise;
      let settled = false;
      const closing = reader.close().then(() => {
        settled = true;
      });
      signal.abort(new Error("cancel during final cleanup"));
      await setImmediate();
      expect(settled).toBe(false);
      expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
      release.resolve();
      expect(await listing).toBe(failure);
      await closing;
      expect(attempts).toBe(1);
      expect(owner?.handle.fd).toBe(-1);
      expect(borrowed.fd).toBeGreaterThanOrEqual(0);
    } finally {
      release.resolve();
      spy.mockRestore();
      await listing;
      await reader.close();
    }
  });
});

for (const cancel of [false, true]) {
  it.each([false, true])(
    `awaits private member close before completion (cancel: ${cancel}, close failure: %s)`,
    async (failClose) => {
      const bytes = cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: "PYZ.pyz",
            typeCode: "z",
            compress: true,
            payload: pyzArchive({
              magic: PYTHON_39_MAGIC,
              modules: [
                { name: "app", typeCode: 0, body: Buffer.from("body") },
              ],
            }),
          },
        ],
      });
      await withPyInstallerReader(bytes, async (reader, borrowed) => {
        const entry = (await members(reader)).find((item) =>
          item.path.endsWith("app.pyc"),
        )!;
        const entered = deferred(),
          release = deferred();
        const signal = new AbortController();
        const failure = new Error("private member final close failed");
        const nativeClose = OwnedFileHandle.prototype.close;
        let owner: OwnedFileHandle | undefined;
        let attempts = 0;
        const spy = vi
          .spyOn(OwnedFileHandle.prototype, "close")
          .mockImplementation(async function (this: OwnedFileHandle) {
            if (owner === undefined) {
              owner = this;
              attempts += 1;
              entered.resolve();
              await release.promise;
              if (failClose) throw failure;
            } else if (this === owner) attempts += 1;
            await nativeClose.call(this);
          });
        const output = await reader.open(entry, signal.signal);
        const reading = buffer(output).then(
          (value) => ({ ok: true as const, value }),
          (cause: unknown) => ({ ok: false as const, cause }),
        );
        try {
          await entered.promise;
          expect(output.readableEnded).toBe(false);
          expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
          if (cancel) {
            signal.abort(new Error("cancel during member cleanup"));
            await setImmediate();
            expect(output.destroyed).toBe(false);
          }
          release.resolve();
          const result = await reading;
          if (failClose || cancel) {
            expect(result.ok).toBe(false);
            if (result.ok) throw new Error("Expected read failure");
            expect(result.cause).toMatchObject(
              failClose
                ? { reason: "io", message: failure.message }
                : { reason: "cancelled" },
            );
            if (failClose) expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
          } else {
            expect(result.ok).toBe(true);
            if (!result.ok) throw result.cause;
            expect(
              Buffer.compare(result.value.subarray(16), Buffer.from("body")),
            ).toBe(0);
          }
          await reader.close();
          expect(attempts).toBe(failClose ? 2 : 1);
          expect(owner?.handle.fd).toBe(-1);
          expect(borrowed.fd).toBeGreaterThanOrEqual(0);
        } finally {
          release.resolve();
          await reading;
          spy.mockRestore();
          await reader.close();
        }
      });
    },
  );
}

it("preserves a private-image read failure when its descriptor close also fails", async () => {
  const bytes = cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    members: [
      {
        name: "PYZ.pyz",
        typeCode: "z",
        payload: pyzArchive({
          magic: PYTHON_39_MAGIC,
          modules: [{ name: "app", typeCode: 0, body: Buffer.from("body") }],
        }),
        compress: true,
      },
    ],
  });
  await withPyInstallerReader(bytes, async (reader, borrowed) => {
    const entry = (await members(reader)).find((item) =>
      item.path.endsWith("app.pyc"),
    )!;
    const nativeClose = OwnedFileHandle.prototype.close;
    const nativeRead = borrowed.read;
    const io = Object.assign(new Error("private read EIO"), { code: "EIO" });
    let failedOwner: OwnedFileHandle | undefined;
    const read = vi
      .spyOn(Object.getPrototypeOf(borrowed), "read")
      .mockImplementation(function (this: FileHandle, ...args: unknown[]) {
        return this === borrowed
          ? Reflect.apply(nativeRead, this, args)
          : Promise.reject(io);
      });
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        if (this.handle !== borrowed) {
          failedOwner = this;
          throw new Error("private close EIO");
        }
        await nativeClose.call(this);
      });
    try {
      await expect(buffer(await reader.open(entry))).rejects.toMatchObject({
        reason: "io",
        cause: io,
      });
      await expect(reader.close()).rejects.toMatchObject({
        cleanup: { reason: "private close EIO" },
      });
      expect(failedOwner?.handle.fd).toBeGreaterThanOrEqual(0);
    } finally {
      read.mockRestore();
      close.mockRestore();
      await reader.close();
    }
    expect(failedOwner?.handle.fd).toBe(-1);
    expect(borrowed.fd).toBeGreaterThanOrEqual(0);
  });
});

it.each([false, true])(
  "shares owned carrier admission across callers and joins late admission (owner closes: %s)",
  async (ownerCloses) => {
    const bytes = archive(Buffer.from("shared admission"));
    await withPyInstallerReader(
      bytes,
      async (_borrowedReader, borrowed, path) => {
        const reader = new PyInstallerArtifactReader(path);
        const entered = deferred(),
          release = deferred();
        const handles = new Set<FileHandle>();
        const stat = borrowed.stat;
        const prototype: Pick<FileHandle, "stat"> =
          Object.getPrototypeOf(borrowed);
        const spy = vi
          .spyOn(prototype, "stat")
          .mockImplementation(async function (
            this: FileHandle,
            ...args: Parameters<FileHandle["stat"]>
          ) {
            if (this !== borrowed) {
              handles.add(this);
              entered.resolve();
              await release.promise;
            }
            return stat.call(this, ...args);
          });
        const caller = new AbortController(),
          reason = new Error("one admission waiter leaves");
        const first = reader
          .prepareContainer(hash(bytes), caller.signal)
          .catch((cause: unknown) => cause);
        const peer = reader
          .prepareContainer(hash(bytes))
          .catch((cause: unknown) => cause);
        let closing: Promise<void> | undefined;
        try {
          await entered.promise;
          await setImmediate();
          expect(handles.size).toBe(1);
          caller.abort(reason);
          if (ownerCloses) {
            let closed = false;
            closing = reader.close().then(() => {
              closed = true;
            });
            await setImmediate();
            expect(closed).toBe(false);
          }
          release.resolve();
          expect(await first).toMatchObject({
            reason: "cancelled",
            cause: reason,
          });
          if (ownerCloses) {
            expect(await peer).toMatchObject({ reason: "cancelled" });
            await closing;
          } else expect(await peer).toBeUndefined();
          await reader.close();
          for (const handle of handles) expect(handle.fd).toBe(-1);
        } finally {
          release.resolve();
          await Promise.allSettled([first, peer]);
          spy.mockRestore();
          await reader.close();
          await closing;
          for (const handle of handles) {
            await handle.close();
          }
        }
      },
    );
  },
);
