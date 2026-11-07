import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { CPU, fatImage, machoImage } from "./apple/MachoImage.fixture.js";
import { MachOSliceArtifactReader } from "./MachOSliceArtifactReader.js";
import { err, ok } from "../domain/result.js";
import { openRegularFile } from "../filesystem/RegularFile.js";
import { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import type { NativeCommandRunner } from "../native/CommandRunner.js";
import { NativeCommandFailure } from "../native/CommandRunner.js";
import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import type { ArtifactEntry } from "./ArtifactReader.js";

const sliceOwnershipFixture = async () => {
  const root = await createTestTempDirectory("rea-slice-ownership-");
  const path = join(root, "fat");
  const bytes = Buffer.concat([
    Buffer.from(machoImage({ cpu: CPU.x86_64 })),
    Buffer.alloc(256 * 1024),
  ]);
  await writeFile(path, fatImage([{ cpu: CPU.x86_64, bytes }]));
  const runner: NativeCommandRunner = {
    run: async () =>
      ok({
        tool: "lipo",
        executable: "/usr/bin/lipo",
        executableSha256: "1".repeat(64),
        toolVersion: null,
        versionReason: "fixture",
        arguments: ["-detailed_info", path],
        stdout: `architecture x86_64\n cputype 16777223\n cpusubtype 3\n offset 4096\n size ${String(bytes.length)}\n align 2^12 (4096)\n`,
        stderr: "",
        stdoutBytes: 1,
        stderrBytes: 0,
        exitCode: 0,
        signal: null,
      }),
  };
  return { path, runner };
};

const sliceEntries = async (
  reader: MachOSliceArtifactReader,
): Promise<ArtifactEntry[]> => {
  const entries: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) entries.push(entry);
  return entries;
};

const cleanupOwner = (runId: string): ProviderProcessSupervisor => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: () => true,
  });
  return new ProviderProcessSupervisor({
    process: child,
    ownsProcessLifetime: true,
    ownership: {
      runId,
      leaderPid: 45_000,
      processGroupId: 45_000,
      expectedParentPid: process.pid,
    },
    cleanup: async () => ({ cleaned: false, reason: "still running" }),
  });
};

describe("Mach-O cleanup exceptions", () => {
  it("retains an undefined cleanup rejection as an explicit failure", async () => {
    const reader = new MachOSliceArtifactReader(
      "/unused/macho",
      {},
      {
        run: async () => {
          throw new Error("Unexpected command");
        },
        retryCleanup: async () => {
          throw undefined;
        },
      },
    );
    await expect(reader.close()).rejects.toMatchObject({
      cleanup: {
        reason: "undefined",
        resources: ["native-command-process-cleanup"],
      },
    });
  });
});

describe("Mach-O command cleanup lifecycle", () => {
  it("waits for active lipo capture before cleanup and preserves its failure", async () => {
    const root = await createTestTempDirectory("rea-slices-close-race-");
    const binary = join(root, "input");
    await writeFile(binary, Buffer.from("fixture"));
    let finishCommand!: (
      result: Awaited<ReturnType<NativeCommandRunner["run"]>>,
    ) => void;
    let commandStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commandStarted = resolve;
    });
    const command = new Promise<
      Awaited<ReturnType<NativeCommandRunner["run"]>>
    >((resolve) => {
      finishCommand = resolve;
    });
    let cleanupRetries = 0;
    const runner: NativeCommandRunner = {
      run: () => {
        commandStarted();
        return command;
      },
      retryCleanup: async () => {
        cleanupRetries += 1;
        if (cleanupRetries > 1) return [];
        return [
          {
            owner: cleanupOwner("run:first"),
            reason: "first process group remains live",
            resources: ["run:first", "process-group:1234"],
          },
          {
            owner: cleanupOwner("run:second"),
            reason: "second process group remains live",
            resources: ["run:second", "process-group:5678"],
          },
        ];
      },
    };
    const reader = new MachOSliceArtifactReader(binary, {}, runner);
    const iteration = reader.entries();
    const firstEntry = iteration[Symbol.asyncIterator]().next();
    await started;
    const closing = reader.close();
    await Promise.resolve();
    expect(cleanupRetries).toBe(0);
    finishCommand(
      err(
        new NativeCommandFailure(
          "lipo",
          "timeout",
          null,
          undefined,
          {
            stdout: "partial lipo output",
            stderr: "partial lipo diagnostic",
            stdoutBytes: 19,
            stderrBytes: 23,
            exitCode: null,
            signal: null,
            truncated: false,
          },
          "capture process group remains unverified",
          ["capture-group:9999"],
        ),
      ),
    );

    await expect(firstEntry).rejects.toMatchObject({
      reason: "unavailable",
      cause: expect.objectContaining({
        cleanupFailure: "capture process group remains unverified",
      }),
      cleanup: {
        reason: "capture process group remains unverified",
        resources: ["capture-group:9999"],
      },
    });
    await expect(closing).rejects.toMatchObject({
      cleanup: {
        reason:
          "run:first, process-group:1234: first process group remains live; run:second, process-group:5678: second process group remains live",
        resources: [
          "run:first",
          "process-group:1234",
          "run:second",
          "process-group:5678",
        ],
      },
    });
    await reader.close();
    expect(cleanupRetries).toBe(2);
  });
});

describe("MachOSliceArtifactReader hidden architectures", () => {
  it("retains Apple's hidden ARM64 row separately from the declared FAT count", async () => {
    const root = await createTestTempDirectory("rea-hidden-arm64-slices-");
    const binary = join(root, "fat");
    const armv7 = { type: 12, subtype: 9 };
    const armv7Image = machoImage({ cpu: armv7, wide: false });
    const arm64Image = machoImage({ cpu: CPU.arm64 });
    const bytes = Buffer.from(
      fatImage([
        { cpu: armv7, bytes: armv7Image },
        { cpu: CPU.arm64, bytes: arm64Image },
      ]),
    );
    bytes.writeUInt32BE(1, 4);
    await writeFile(binary, bytes);
    const stdout = `fat_magic 0xcafebabe\nnfat_arch 1 (+1 hidden)\narchitecture armv7\n cputype 12\n cpusubtype 9\n offset 4096\n size ${String(armv7Image.length)}\n align 2^12 (4096)\narchitecture arm64 (hidden)\n cputype 16777228\n cpusubtype 0\n offset 8192\n size ${String(arm64Image.length)}\n align 2^12 (4096)\n`;
    const reader = new MachOSliceArtifactReader(
      binary,
      {},
      {
        run: async () =>
          ok({
            tool: "lipo",
            executable: "/usr/bin/lipo",
            executableSha256: "1".repeat(64),
            toolVersion: null,
            versionReason: "fixture",
            arguments: [],
            stdout,
            stderr: "",
            stdoutBytes: Buffer.byteLength(stdout),
            stderrBytes: 0,
            exitCode: 0,
            signal: null,
          }),
      },
    );
    onTestFinished(() => reader.close());
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries.map(({ path }) => path)).toEqual([
      "slices/armv7",
      "slices/arm64",
    ]);
  });

  it("rejects a lipo hidden ARM64 claim when its physical header disagrees", async () => {
    const root = await createTestTempDirectory("rea-hidden-arm64-mismatch-");
    const binary = join(root, "fat");
    const armv7 = { type: 12, subtype: 9 };
    const armv7Image = machoImage({ cpu: armv7, wide: false });
    const arm64Image = machoImage({ cpu: CPU.arm64 });
    const bytes = Buffer.from(
      fatImage([
        { cpu: armv7, bytes: armv7Image },
        { cpu: CPU.arm64, bytes: arm64Image },
      ]),
    );
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32LE(7, 8196); // Hidden FAT row claims ARM64; thin header says x86.
    await writeFile(binary, bytes);
    const stdout = `fat_magic 0xcafebabe\nnfat_arch 1 (+1 hidden)\narchitecture armv7\n cputype 12\n cpusubtype 9\n offset 4096\n size ${String(armv7Image.length)}\n align 2^12 (4096)\narchitecture arm64 (hidden)\n cputype 16777228\n cpusubtype 0\n offset 8192\n size ${String(arm64Image.length)}\n align 2^12 (4096)\n`;
    const reader = new MachOSliceArtifactReader(
      binary,
      {},
      {
        run: async () =>
          ok({
            tool: "lipo",
            executable: "/usr/bin/lipo",
            executableSha256: "1".repeat(64),
            toolVersion: null,
            versionReason: "fixture",
            arguments: [],
            stdout,
            stderr: "",
            stdoutBytes: Buffer.byteLength(stdout),
            stderrBytes: 0,
            exitCode: 0,
            signal: null,
          }),
      },
    );
    onTestFinished(() => reader.close());
    const enumerate = async (): Promise<void> => {
      for await (const _entry of reader.entries()) {
        /* enumerate */
      }
    };
    await expect(enumerate()).rejects.toMatchObject({ reason: "integrity" });
  });
});

describe("MachOSliceArtifactReader", () => {
  it("classifies malformed successful lipo output at the reader boundary", async () => {
    const root = await createTestTempDirectory("rea-slices-malformed-lipo-");
    const binary = join(root, "fat");
    await writeFile(
      binary,
      fatImage([
        { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
        { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
      ]),
    );
    const reader = new MachOSliceArtifactReader(
      binary,
      {},
      {
        run: async () =>
          ok({
            tool: "lipo",
            executable: "/usr/bin/lipo",
            executableSha256: "1".repeat(64),
            toolVersion: null,
            versionReason: "fixture",
            arguments: ["-detailed_info", binary],
            stdout: "Fat header in: fixture\n",
            stderr: "",
            stdoutBytes: 23,
            stderrBytes: 0,
            exitCode: 0,
            signal: null,
          }),
      },
    );
    onTestFinished(() => reader.close());

    await expect(
      reader.entries()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({
      reason: "format",
      message:
        "lipo did not produce readable architecture records: lipo output contained no architectures",
      cause: new TypeError("lipo output contained no architectures"),
    });
  });

  it("keeps a borrowed source usable after idle and active cancelled slice reads", async () => {
    const root = await createTestTempDirectory("rea-slices-cancelled-");
    const binary = join(root, "fat");
    const x86 = machoImage({ cpu: CPU.x86_64 });
    const arm = Buffer.concat([
      Buffer.from(machoImage({ cpu: CPU.arm64 })),
      Buffer.alloc(160_000, 0x5a),
    ]);
    await writeFile(
      binary,
      fatImage([
        { cpu: CPU.x86_64, bytes: x86 },
        { cpu: CPU.arm64, bytes: arm },
      ]),
    );
    const source = await openRegularFile(binary, { symlinks: "reject" });
    const { handle } = source;
    const runner: NativeCommandRunner = {
      run: () =>
        Promise.resolve(
          ok({
            tool: "lipo",
            executable: "/usr/bin/lipo",
            executableSha256: "1".repeat(64),
            toolVersion: null,
            versionReason: "fixture",
            arguments: ["-detailed_info", binary],
            stdout: `architecture x86_64\n cputype 16777223\n cpusubtype 3\n offset 4096\n size ${String(x86.length)}\n align 2^12 (4096)\narchitecture arm64\n cputype 16777228\n cpusubtype 0\n offset 8192\n size ${String(arm.length)}\n align 2^12 (4096)\n`,
            stderr: "",
            stdoutBytes: 1,
            stderrBytes: 0,
            exitCode: 0,
            signal: null,
          }),
        ),
    };
    const reader = new MachOSliceArtifactReader(binary, {}, runner, source);
    onTestFinished(async () => {
      await reader.close();
      await handle.close();
    });

    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const armEntry = entries.find((entry) => entry.path === "slices/arm64");
    if (armEntry === undefined) throw new Error("Expected an arm64 slice");

    const idleController = new AbortController();
    const idle = await reader.open(armEntry, idleController.signal);
    const idleFailure = new Promise<Error>((resolve) =>
      idle.once("error", resolve),
    );
    idleController.abort(null);
    await expect(idleFailure).resolves.toMatchObject({
      reason: "cancelled",
      cancellation: { reason: null },
    });
    expect((await handle.stat()).isFile()).toBe(true);

    const controller = new AbortController();
    const cancelledRead = await reader.open(armEntry, controller.signal);
    const iterator = cancelledRead[Symbol.asyncIterator]();
    const firstChunk = await iterator.next();
    expect(firstChunk.value).toHaveLength(64 * 1024);
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({
      reason: "cancelled",
    });

    const verifiedEntries = [];
    for await (const entry of reader.entries()) verifiedEntries.push(entry);
    const verifiedArmEntry = verifiedEntries.find(
      (entry) => entry.path === "slices/arm64",
    );
    if (verifiedArmEntry === undefined)
      throw new Error("Expected arm64 after re-verifying the borrowed source");
    const verifiedChunks: Buffer[] = [];
    const verifiedRead = await reader.open(verifiedArmEntry);
    for await (const chunk of verifiedRead)
      verifiedChunks.push(Buffer.from(chunk));
    expect(Buffer.compare(Buffer.concat(verifiedChunks), arm)).toBe(0);

    const truncatedController = new AbortController();
    const truncated = await reader.open(
      verifiedArmEntry,
      truncatedController.signal,
    );
    await truncate(binary, 8193);
    let readEOF = false;
    const read = handle.read.bind(handle);
    vi.spyOn(handle, "read").mockImplementation((async (...args: unknown[]) => {
      const result = (await Reflect.apply(read, handle, args)) as {
        bytesRead: number;
        buffer: Buffer;
      };
      if (result.bytesRead === 0) readEOF = true;
      return result;
    }) as typeof handle.read);
    const failed = new Promise<Error>((resolve) =>
      truncated.once("error", resolve),
    );
    truncated.read(0);
    await expect.poll(() => readEOF).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(truncated.readableLength).toBeGreaterThan(0);
    truncatedController.abort(null);
    await expect(failed).resolves.toMatchObject({ reason: "integrity" });
  });
});

describe("universal slices outside the structural index", () => {
  const PPC = { type: 18, subtype: 0 } as const;
  /** A minimal big-endian 32-bit Mach-O header, as a PowerPC slice stores it. */
  const bigEndianImage = (): Uint8Array => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(0xfeed_face, 0);
    bytes.writeUInt32BE(PPC.type, 4);
    bytes.writeUInt32BE(1, 12);
    return bytes;
  };
  /** An arm64 image whose load commands claim more bytes than the slice holds. */
  const malformedImage = (): Uint8Array => {
    const bytes = machoImage({ cpu: CPU.arm64 });
    new DataView(bytes.buffer).setUint32(20, 4096, true);
    return bytes;
  };
  const lipoRunner = (
    binary: string,
    slices: readonly {
      readonly name: string;
      readonly cpu: { readonly type: number; readonly subtype: number };
      readonly offset: number;
      readonly size: number;
    }[],
    withRanges = true,
  ): NativeCommandRunner => ({
    run: () =>
      Promise.resolve(
        ok({
          tool: "lipo",
          executable: "/usr/bin/lipo",
          executableSha256: "1".repeat(64),
          toolVersion: null,
          versionReason: "fixture",
          arguments: ["-detailed_info", binary],
          stdout: slices
            .map(
              ({ name, cpu, offset, size }) =>
                `architecture ${name}\n cputype ${String(cpu.type)}\n cpusubtype ${String(cpu.subtype)}\n${withRanges ? ` offset ${String(offset)}\n size ${String(size)}\n` : ""} align 2^12 (4096)\n`,
            )
            .join(""),
          stderr: "",
          stdoutBytes: 1,
          stderrBytes: 0,
          exitCode: 0,
          signal: null,
        }),
      ),
  });
  const readAll = async (
    slices: readonly {
      readonly name: string;
      readonly cpu: { readonly type: number; readonly subtype: number };
      readonly bytes: Uint8Array;
    }[],
    withRanges = true,
  ) => {
    const root = await createTestTempDirectory("rea-slices-unsupported-");
    const binary = join(root, "fat");
    await writeFile(binary, fatImage(slices));
    const reader = new MachOSliceArtifactReader(
      binary,
      {},
      lipoRunner(
        binary,
        slices.map(({ name, cpu, bytes }, index) => ({
          name,
          cpu,
          offset: 4096 * (index + 1),
          size: bytes.length,
        })),
        withRanges,
      ),
    );
    onTestFinished(() => reader.close());
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    return entries;
  };

  it("inventories every lipo range beside a big-endian slice", async () => {
    const entries = await readAll([
      { name: "ppc", cpu: PPC, bytes: bigEndianImage() },
      { name: "arm64", cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
    ]);
    expect(entries.map(({ path, byteOffset }) => [path, byteOffset])).toEqual([
      ["slices/ppc", 4096],
      ["slices/arm64", 8192],
    ]);
    expect(entries[0]?.limitations).toContain(
      "Structural Mach-O facts were unsupported (big-endian Mach-O slices are not supported); slice range is based on lipo output.",
    );
  });

  it("reports missing lipo ranges for an unindexed slice as unavailable support", async () => {
    await expect(
      readAll(
        [
          { name: "ppc", cpu: PPC, bytes: bigEndianImage() },
          {
            name: "arm64",
            cpu: CPU.arm64,
            bytes: machoImage({ cpu: CPU.arm64 }),
          },
        ],
        false,
      ),
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it.each([
    ["before", true],
    ["after", false],
  ])(
    "rejects a malformed slice %s a big-endian slice",
    async (_order, malformedFirst) => {
      const ppc = { name: "ppc", cpu: PPC, bytes: bigEndianImage() };
      const broken = { name: "arm64", cpu: CPU.arm64, bytes: malformedImage() };
      await expect(
        readAll(malformedFirst ? [broken, ppc] : [ppc, broken]),
      ).rejects.toMatchObject({ reason: "integrity" });
    },
  );
});

describe("Mach-O slice stream ownership", () => {
  it.each(["unread", "abandoned", "cancelled"] as const)(
    "retires an %s opened slice before closing its carrier",
    async (mode) => {
      const fixture = await sliceOwnershipFixture();
      const reader = new MachOSliceArtifactReader(
        fixture.path,
        {},
        fixture.runner,
      );
      try {
        const [entry] = await sliceEntries(reader);
        const caller = new AbortController();
        const stream = await reader.open(entry!, caller.signal);
        await once(stream, "readable");
        if (mode === "abandoned") {
          for await (const _chunk of stream) break;
        } else if (mode === "cancelled") {
          const failure = once(stream, "error");
          const reason = { caller: "slice owner cancellation" };
          caller.abort(reason);
          await expect(failure).resolves.toMatchObject([
            { reason: "cancelled", cause: reason },
          ]);
        }
        await Promise.all([reader.close(), reader.close()]);
        expect(stream.destroyed).toBe(true);
        expect(stream.closed).toBe(true);
        await reader.close();
      } finally {
        await reader.close();
      }
    },
  );

  it("joins an admitted descriptor read before reader close completes", async () => {
    const fixture = await sliceOwnershipFixture();
    const source = await openRegularFile(fixture.path, { symlinks: "reject" });
    const reader = new MachOSliceArtifactReader(
      fixture.path,
      {},
      fixture.runner,
      source,
    );
    const reached = createDeferred<void>();
    const release = createDeferred<void>();
    const nativeRead = source.handle.read.bind(source.handle);
    let reads: { mockRestore(): void } | undefined;
    try {
      const [entry] = await sliceEntries(reader);
      reads = vi.spyOn(source.handle, "read").mockImplementation((async (
        ...args: unknown[]
      ) => {
        reached.resolve();
        await release.promise;
        return Reflect.apply(nativeRead, source.handle, args);
      }) as typeof source.handle.read);
      const stream = await reader.open(entry!);
      stream.read(0);
      await reached.promise;
      let closed = false;
      const closing = reader.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      release.resolve();
      await closing;
      expect(stream.closed).toBe(true);
    } finally {
      release.resolve();
      await reader.close();
      reads?.mockRestore();
      await source.handle.close();
    }
  });

  it("keeps descriptor closure retryable after retiring its slice", async () => {
    const fixture = await sliceOwnershipFixture();
    const reader = new MachOSliceArtifactReader(
      fixture.path,
      {},
      fixture.runner,
    );
    const [entry] = await sliceEntries(reader);
    const stream = await reader.open(entry!);
    const failure = new Error("Mach-O descriptor close denied");
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockRejectedValueOnce(failure);
    try {
      await expect(reader.close()).rejects.toBe(failure);
      expect(stream.closed).toBe(true);
      await reader.close();
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      close.mockRestore();
      await reader.close();
    }
  });

  it.runIf(process.platform === "darwin")(
    "retires a slice discovered by the installed lipo",
    async () => {
      const fixture = await sliceOwnershipFixture();
      const reader = new MachOSliceArtifactReader(fixture.path, process.env);
      try {
        const [entry] = await sliceEntries(reader);
        const stream = await reader.open(entry!);
        await once(stream, "readable");
        await reader.close();
        expect(stream.closed).toBe(true);
        expect(reader.provenance()).toMatchObject([
          { tool: "lipo", exit_code: 0 },
        ]);
      } finally {
        await reader.close();
      }
    },
  );
});

it("joins Mach-O structural enumeration reads admitted before close", async () => {
  const fixture = await sliceOwnershipFixture();
  const source = await openRegularFile(fixture.path, { symlinks: "reject" });
  const reader = new MachOSliceArtifactReader(
    fixture.path,
    {},
    fixture.runner,
    source,
  );
  const reached = createDeferred<void>();
  const release = createDeferred<void>();
  const nativeRead = source.handle.read.bind(source.handle);
  const reads = vi.spyOn(source.handle, "read").mockImplementation((async (
    ...args: unknown[]
  ) => {
    reached.resolve();
    await release.promise;
    return Reflect.apply(nativeRead, source.handle, args);
  }) as typeof source.handle.read);
  const traversal = reader.entries()[Symbol.asyncIterator]();
  const next = traversal.next();
  try {
    await reached.promise;
    let closed = false;
    const closing = reader.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await expect(next).rejects.toMatchObject({ reason: "unavailable" });
    await closing;
  } finally {
    release.resolve();
    await next.catch(() => undefined);
    await reader.close();
    reads.mockRestore();
    await source.handle.close();
  }
});
