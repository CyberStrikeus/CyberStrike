import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { createPackageWithOptions } from "@electron/asar";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  controller: undefined as AbortController | undefined,
  reason: null as unknown,
  failure: undefined as Error | undefined,
  abortAfterRead: false,
  abortAtFinalIdentity: false,
  readFinished: false,
  opened: [] as FileHandle[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    lstat: async (...args: Parameters<typeof original.lstat>) => {
      const value = await original.lstat(...args);
      if (
        args[0] === fault.path &&
        fault.readFinished &&
        fault.abortAtFinalIdentity
      ) {
        fault.abortAtFinalIdentity = false;
        fault.controller?.abort(fault.reason);
      }
      return value;
    },
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      const flags = args[1];
      if (
        args[0] !== fault.path ||
        typeof flags !== "number" ||
        (flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0
      )
        return handle;
      fault.opened.push(handle);
      const read = handle.read.bind(handle);
      handle.read = (async (...readArgs: unknown[]) => {
        if (fault.failure !== undefined) {
          fault.controller?.abort(fault.reason);
          throw fault.failure;
        }
        const result = (await Reflect.apply(read, handle, readArgs)) as {
          bytesRead: number;
          buffer: Buffer;
        };
        if (result.bytesRead === 0) {
          fault.readFinished = true;
          if (fault.abortAfterRead) fault.controller?.abort(fault.reason);
        }
        return result;
      }) as FileHandle["read"];
      return handle;
    },
  };
});

import { AsarArtifactReader } from "../../src/artifacts/AsarArtifactReader.js";
import { SafeOutputTree } from "../../src/artifacts/SafeOutputTree.js";
import { ArtifactReaderFailure } from "../../src/artifacts/ArtifactReader.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const trees: SafeOutputTree[] = [];
beforeEach(() => {
  fault.path = "";
  fault.controller = undefined;
  fault.reason = null;
  fault.failure = undefined;
  fault.abortAfterRead = false;
  fault.abortAtFinalIdentity = false;
  fault.readFinished = false;
  fault.opened = [];
});
afterEach(async () => {
  fault.path = "";
  await Promise.all(trees.splice(0).map((tree) => tree.rollback()));
});

const fixture = async () => {
  const root = await createTestTempDirectory("rea-artifact-read-precedence-");
  const tree = await SafeOutputTree.create(join(root, "output"));
  trees.push(tree);
  const bytes = Buffer.from("durable readback bytes");
  fault.path = join(tree.outputRoot, "file.bin");
  const controller = new AbortController();
  fault.controller = controller;
  return {
    tree,
    controller,
    write: () =>
      tree.write(
        "file.bin",
        Readable.from(bytes),
        {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        },
        controller.signal,
      ),
  };
};

it("preserves a readback IO failure when cancellation arrives in the same read completion", async () => {
  const { tree, write } = await fixture();
  const failure = Object.assign(new Error("controlled readback IO failure"), {
    code: "EIO",
  });
  fault.failure = failure;
  await expect(write()).rejects.toBe(failure);
  fault.failure = undefined;
  await tree.rollback();
  await expect(access(tree.outputRoot)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  null,
  "caller reason",
  new ArtifactReaderFailure("io", "caller reason"),
])(
  "preserves the exact reason when cancellation is observed at read EOF: %s",
  async (reason) => {
    const { write } = await fixture();
    fault.reason = reason;
    fault.abortAfterRead = true;
    const error = await write().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ArtifactReaderFailure);
    if (!(error instanceof ArtifactReaderFailure))
      throw new Error("Expected typed cancellation");
    expect(error.reason).toBe("cancelled");
    expect(error.cancellation?.reason).toBe(reason);
  },
);

it("observes cancellation during final readback identity validation", async () => {
  const { write } = await fixture();
  fault.abortAtFinalIdentity = true;
  const error = await write().catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(ArtifactReaderFailure);
  if (error instanceof ArtifactReaderFailure) {
    expect(error.reason).toBe("cancelled");
    expect(error.cancellation?.reason).toBeNull();
  }
});

it.each(["idle", "active", "read-failure"])(
  "preserves unpacked ASAR cancellation and exact descriptor ownership: %s",
  async (stage) => {
    const root = await createTestTempDirectory(
      "rea-asar-unpacked-read-cancel-",
    );
    const input = join(root, "input");
    const archive = join(root, "fixture.asar");
    await mkdir(input);
    await writeFile(join(input, "member.bin"), "unpacked member bytes");
    await createPackageWithOptions(input, archive, { unpack: "*.bin" });
    const reader = new AsarArtifactReader(archive);
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      const entry = entries.find((value) => value.path === "member.bin");
      if (entry === undefined || !entry.unpacked)
        throw new Error("Expected unpacked member");
      fault.path = join(`${archive}.unpacked`, "member.bin");
      fault.controller = new AbortController();
      fault.reason = "unpacked cancellation";
      const failure = Object.assign(
        new Error("controlled unpacked read failure"),
        { code: "EIO", errno: -5, syscall: "read" },
      );
      if (stage === "read-failure") fault.failure = failure;
      const source = await reader.open(entry, fault.controller.signal);
      expect(fault.opened).toHaveLength(1);
      const result =
        stage === "idle"
          ? new Promise<unknown>((resolve) => source.once("error", resolve))
          : buffer(source).catch((cause: unknown) => cause);
      if (stage !== "read-failure") fault.controller.abort(fault.reason);
      if (stage === "read-failure")
        await expect(result).resolves.toMatchObject({
          reason: "io",
          cause: failure,
        });
      else
        await expect(result).resolves.toMatchObject({
          reason: "cancelled",
          cancellation: { reason: fault.reason },
        });
      fault.failure = undefined;
      await reader.close();
      expect(fault.opened[0]?.fd).toBe(-1);
    } finally {
      fault.failure = undefined;
      await reader.close();
    }
  },
);
