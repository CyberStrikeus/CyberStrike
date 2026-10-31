import { createHash } from "node:crypto";
import { lstat, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";

import { AdbProvider } from "../../../../src/adb/AdbProvider.js";
import {
  execFileBytes,
  execFileOutput,
} from "../../../../src/process/ExecFileOutput.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { AdbInputSnapshotFailure } from "../../../../src/adb/AdbInputSnapshot.js";
import { AnalysisOutputError } from "../../../../src/domain/analysisErrorCore.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";

vi.mock(
  "../../../../src/process/ExecFileOutput.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/process/ExecFileOutput.js")
    >()),
    execFileBytes: vi.fn(),
    execFileOutput: vi.fn(),
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm),
  };
});

afterEach(() => vi.restoreAllMocks());

const fixture = async () => {
  const root = await createTestTempDirectory("rea-adb-input-owner-");
  const binary = join(root, "adb");
  const source = join(root, "payload.bin");
  const devicePath = "/data/local/tmp/payload.bin";
  const bytes = Buffer.from("immutable payload");
  await writeFile(source, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  let snapshotPath = "";
  let consumedBytes: Buffer | undefined;
  const output = (stdout: string) => ({
    stdout,
    stderr: "",
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
  });
  vi.mocked(execFileOutput).mockImplementation(async (_binary, args) => {
    if (args[0] === "version")
      return output(
        `Android Debug Bridge version 1.0.41\nVersion 34.0.5-stub\nInstalled as ${binary}\n`,
      );
    throw new Error(`Unexpected ADB fixture command: ${JSON.stringify(args)}`);
  });
  vi.mocked(execFileBytes).mockImplementation(async (_binary, args) => {
    if (args[2] === "shell" && args[3] === "test" && args[5] === devicePath) {
      if (args[4] === "-d")
        throw Object.assign(new Error("Selected destination is a file"), {
          code: 1,
          stdout: "",
          stderr: "",
          signal: null,
          killed: false,
        });
      if (args[4] === "-e")
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    if (args[2] === "push" && args[4] === devicePath) {
      snapshotPath = args[3]!;
      consumedBytes = await readFile(snapshotPath);
      if (consumedBytes.byteLength === 0)
        throw new Error("adb received an empty local snapshot");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    if (
      args[2] === "shell" &&
      args[3] === "sha256sum" &&
      args[4] === devicePath
    ) {
      if (consumedBytes === undefined)
        throw new Error("checksum requested before a push was consumed");
      const consumedDigest = createHash("sha256")
        .update(consumedBytes)
        .digest("hex");
      return {
        stdout: Buffer.from(`${consumedDigest}  ${devicePath}\n`),
        stderr: Buffer.alloc(0),
      };
    }
    throw new Error(`Unexpected ADB fixture command: ${JSON.stringify(args)}`);
  });
  const provider = new AdbProvider({ environment: { REA_ADB_PATH: binary } });
  onTestFinished(() => provider.close());
  return {
    root,
    source,
    digest,
    snapshotPath: () => snapshotPath,
    provider,
    request: {
      operation: "push_adb_file" as const,
      input: {
        serial: "device",
        local_path: source,
        device_path: devicePath,
        overwrite: true,
      },
    },
  };
};

test("retains failed snapshot cleanup ownership and retries it on close", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(rm).mockImplementationOnce(async (path, options) => {
    if (basename(String(path)).startsWith("rea-adb-input-"))
      throw new Error("snapshot cleanup denied");
    return actualFs.rm(path, options);
  });

  const result = await f.provider.execute(f.request);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected snapshot cleanup failure");
  expect(result.error.cleanupResources).toContain(dirname(f.snapshotPath()));
  const evidence = parseEvidence(result.error.partialObservation);
  expect(evidence).toMatchObject({
    provider: { id: "adb" },
    operation: "push_adb_file",
    confidence: "observed",
    parameters: { local_path: f.source },
    normalized_result: {
      local_path: f.source,
      bytes: 17,
      sha256: f.digest,
    },
  });
  expect(
    Buffer.compare(await readFile(f.snapshotPath()), await readFile(f.source)),
  ).toBe(0);

  await f.provider.close();
  await expect(lstat(dirname(f.snapshotPath()))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("closes retained snapshot handles before removing their runtime root", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  let runtimePath = "";
  let snapshotHandleOpen = false;
  const closeAttempts = new Map<string, number>();
  let rootClosedWithHandleOpen = false;
  const runtime = await PrivateRuntimeRoot.create({ prefix: "rea-adb-order-" });
  runtimePath = runtime.path;
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: join(f.root, "adb") },
    createRuntimeRoot: async () => ({
      path: runtime.path,
      close: async () => {
        if (snapshotHandleOpen) {
          rootClosedWithHandleOpen = true;
          throw new Error("runtime root removed while snapshot handle is open");
        }
        await runtime.close();
      },
    }),
  });
  const originalOpen = actualFs.open;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const path = String(args[0]);
    const isSource = path === f.source;
    const isSnapshot = path.startsWith(`${runtimePath}/`);
    if (!isSource && !isSnapshot) return handle;
    if (isSnapshot) snapshotHandleOpen = true;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "close")
          return async () => {
            const attempts = (closeAttempts.get(path) ?? 0) + 1;
            closeAttempts.set(path, attempts);
            if (attempts === 1)
              throw new Error("controlled handle close fault");
            await target.close();
            if (isSnapshot) snapshotHandleOpen = false;
          };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  const result = await provider.execute(f.request);
  expect(result.ok).toBe(false);
  expect(closeAttempts.get(f.source)).toBe(2);
  expect(closeAttempts.get(join(runtimePath, "payload.bin"))).toBe(2);
  expect(rootClosedWithHandleOpen).toBe(false);
  if (!result.ok) {
    // Both close owners failed in the snapshot boundary and recovered in the
    // immediate runtime-root drain. Their old cleanup flags must not survive.
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(result.error.cause).toBeDefined();
  }
  await provider.close();
});

test("retries the same retained snapshot owner before removing its root", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const runtime = await PrivateRuntimeRoot.create({
    prefix: "rea-adb-persistent-order-",
  });
  const snapshotPath = join(runtime.path, basename(f.source));
  const rawHandles = new Map<
    string,
    Awaited<ReturnType<typeof actualFs.open>>
  >();
  let rootCloseAttempts = 0;
  let sourceCloseDenials = 3;
  let retainedSourceOwner: OwnedFileHandle | undefined;
  const sourceOwnerAttempts: OwnedFileHandle[] = [];
  const destinationOwnerAttempts: OwnedFileHandle[] = [];
  const originalOwnerClose = OwnedFileHandle.prototype.close;
  const ownerClose = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      if (this.handle === rawHandles.get(f.source)) {
        retainedSourceOwner ??= this;
        sourceOwnerAttempts.push(this);
        if (sourceCloseDenials > 0) {
          sourceCloseDenials -= 1;
          throw new Error("controlled persistent snapshot close fault");
        }
      } else if (this.handle === rawHandles.get(snapshotPath)) {
        destinationOwnerAttempts.push(this);
      }
      return originalOwnerClose.call(this);
    });
  vi.mocked(open).mockImplementation(async (...args) => {
    const path = String(args[0]);
    const handle = await actualFs.open(...args);
    if (path === f.source || path === snapshotPath)
      rawHandles.set(path, handle);
    return handle;
  });

  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: join(f.root, "adb") },
    createRuntimeRoot: async () => ({
      path: runtime.path,
      close: async () => {
        rootCloseAttempts += 1;
        if (rawHandles.get(f.source)?.fd !== -1)
          throw new Error("runtime root removal attempted with source open");
        await runtime.close();
      },
    }),
  });
  try {
    const result = await provider.execute(f.request);
    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error("expected persistent snapshot cleanup failure");
    const originatingError = result.error;
    const originatingCause = originatingError.cause;
    expect(originatingError.cleanupIncomplete).toBe(true);
    expect(sourceOwnerAttempts).toHaveLength(2);
    expect(sourceOwnerAttempts[0]).toBe(sourceOwnerAttempts[1]);
    expect(sourceOwnerAttempts[0]).toBe(retainedSourceOwner);
    expect(destinationOwnerAttempts).toHaveLength(1);
    expect(rawHandles.get(f.source)?.fd).toBeGreaterThanOrEqual(0);
    await expect(lstat(runtime.path)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });

    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: expect.arrayContaining([
        `${f.source} (ADB snapshot source handle)`,
      ]),
    });
    expect(sourceOwnerAttempts).toHaveLength(3);
    expect(
      sourceOwnerAttempts.every((owner) => owner === retainedSourceOwner),
    ).toBe(true);
    expect(destinationOwnerAttempts).toHaveLength(1);
    expect(rootCloseAttempts).toBe(0);
    expect(originatingError.cleanupIncomplete).toBe(true);
    expect(originatingError.cause).toBe(originatingCause);
    expect(rawHandles.get(f.source)?.fd).toBeGreaterThanOrEqual(0);
    await expect(lstat(runtime.path)).resolves.toBeDefined();

    await provider.close();
    expect(sourceOwnerAttempts).toHaveLength(4);
    expect(
      sourceOwnerAttempts.every((owner) => owner === retainedSourceOwner),
    ).toBe(true);
    expect(destinationOwnerAttempts).toHaveLength(1);
    expect(rootCloseAttempts).toBe(1);
    expect(originatingError.cleanupIncomplete).toBe(false);
    expect(originatingError.cause).toBe(originatingCause);
    await expect(lstat(runtime.path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    sourceCloseDenials = 0;
    ownerClose.mockRestore();
    await provider.close();
  }
});

test.each([
  { label: "read failure", cancel: false, tag: "AnalysisOutputError" },
  { label: "cancellation", cancel: true, tag: "AnalysisCancelledError" },
])(
  "preserves the $label chain when immediate snapshot cleanup recovers",
  async ({ cancel, tag }) => {
    const f = await fixture();
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const controller = new AbortController();
    let sourceCloseAttempts = 0;
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) !== f.source) return handle;
      const close = handle.close.bind(handle);
      handle.read = (async () => {
        if (cancel) {
          controller.abort();
        }
        throw new Error("controlled snapshot read failure");
      }) as typeof handle.read;
      handle.close = async () => {
        sourceCloseAttempts += 1;
        if (sourceCloseAttempts === 1)
          throw new Error("controlled snapshot handle close failure");
        await close();
      };
      return handle;
    });

    const result = await f.provider.execute(f.request, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected snapshot operation failure");
    expect(result.error._tag).toBe(tag);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(sourceCloseAttempts).toBe(2);
    expect(result.error.cause).toMatchObject({
      message: "controlled snapshot read failure",
    });
    expect(result.error.secondaryFailures).toHaveLength(1);
    const secondary = result.error.secondaryFailures[0];
    expect(secondary).toBeInstanceOf(AnalysisOutputError);
    expect(secondary?.cause).toBeInstanceOf(AdbInputSnapshotFailure);
    const snapshotFailure = secondary?.cause;
    if (!(snapshotFailure instanceof AdbInputSnapshotFailure))
      throw new Error("Expected snapshot cleanup failure");
    expect(snapshotFailure.cleanupCause).toBeDefined();
  },
);

test.each([
  { cancelDuringClose: false, failRead: false, failClose: true },
  { cancelDuringClose: true, failRead: false, failClose: true },
  { cancelDuringClose: false, failRead: true, failClose: true },
  { cancelDuringClose: true, failRead: false, failClose: false },
])(
  "pull preserves the digest outcome through descriptor finalization (%#)",
  async ({ cancelDuringClose, failRead, failClose }) => {
    const f = await fixture();
    const controller = new AbortController();
    const reason = new Error("caller cancelled during digest close");
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const outputDirectory = join(f.root, "pull-output");
    const localPath = join(outputDirectory, "remote.bin");
    const pulledBytes = Buffer.from("device bytes");
    let closeAttempts = 0;
    vi.mocked(execFileBytes).mockImplementation(async (_binary, args) => {
      if (args[2] === "pull") {
        await actualFs.writeFile(args[4]!, pulledBytes);
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.mocked(open).mockImplementation(async (path, ...args) => {
      const handle = await actualFs.open(path, ...args);
      if (String(path) === localPath) {
        if (failRead)
          handle.read = (async () => {
            throw new Error("controlled digest read failure");
          }) as typeof handle.read;
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closeAttempts += 1;
          if (closeAttempts === 1 && failClose) {
            if (cancelDuringClose) controller.abort(reason);
            throw new Error("controlled descriptor close");
          }
          await close();
          if (closeAttempts === 1 && cancelDuringClose)
            controller.abort(reason);
        };
      }
      return handle;
    });

    const result = await f.provider.execute(
      {
        operation: "pull_adb_file",
        input: {
          serial: "device",
          device_path: "/data/local/tmp/remote.bin",
          output_directory: outputDirectory,
        },
      },
      cancelDuringClose ? { signal: controller.signal } : undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected retained digest cleanup failure");
    expect(result.error._tag).toBe(
      cancelDuringClose ? "AnalysisCancelledError" : "ProviderAdapterError",
    );
    expect(result.error.cleanupIncomplete).toBe(failClose);
    if (failClose)
      expect(result.error.cleanupResources).toContain(
        `${localPath} (ADB digest handle)`,
      );
    else {
      expect(result.error.cleanupResources).toEqual([]);
      expect(result.error.cause).toBe(reason);
    }
    expect(result.error.partialObservation).toMatchObject({
      provider_id: "adb",
      operation: "pull_adb_file",
      result: {
        local_path: localPath,
        device_path: "/data/local/tmp/remote.bin",
        ...(failRead
          ? { digest_status: "unknown" }
          : {
              bytes: pulledBytes.byteLength,
              sha256: createHash("sha256").update(pulledBytes).digest("hex"),
            }),
      },
    });
    expect(Buffer.compare(await readFile(localPath), pulledBytes)).toBe(0);
    const originatingError = result.error;
    await f.provider.close();
    expect(closeAttempts).toBe(failClose ? 2 : 1);
    expect(originatingError.cleanupIncomplete).toBe(false);
  },
);

test.each([false, true])(
  "package pull retains digests through close or cancellation (%s)",
  async (cancelDuringClose) => {
    const f = await fixture();
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const outputDirectory = join(f.root, "package-output");
    const packageDirectory = join(outputDirectory, "com.example.app");
    const splitPath = join(packageDirectory, "split.apk");
    const baseBytes = Buffer.from("base apk");
    const splitBytes = Buffer.from("split apk");
    const controller = new AbortController();
    const reason = new Error("caller cancelled after split digest close");
    let closeAttempts = 0;
    const version = `Android Debug Bridge version 1.0.41\nVersion 34.0.5-stub\nInstalled as ${f.root}/adb\n`;
    vi.mocked(execFileOutput).mockImplementation(async (_binary, args) => {
      if (args[0] === "version")
        return {
          stdout: version,
          stderr: "",
          stdoutBytes: Buffer.byteLength(version),
          stderrBytes: 0,
        };
      return { stdout: "", stderr: "", stdoutBytes: 0, stderrBytes: 0 };
    });
    vi.mocked(execFileBytes).mockImplementation(async (_binary, args) => {
      if (args.includes("path"))
        return {
          stdout: Buffer.from(
            "package:/data/app/com.example.app/base.apk\npackage:/data/app/com.example.app/split.apk\n",
          ),
          stderr: Buffer.alloc(0),
        };
      if (args[2] === "pull")
        await actualFs.writeFile(
          args[4]!,
          args[3]!.endsWith("base.apk") ? baseBytes : splitBytes,
        );
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.mocked(open).mockImplementation(async (path, ...args) => {
      const handle = await actualFs.open(path, ...args);
      if (String(path) === splitPath) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closeAttempts += 1;
          if (closeAttempts === 1 && !cancelDuringClose)
            throw new Error("controlled descriptor close");
          await close();
          if (closeAttempts === 1 && cancelDuringClose)
            controller.abort(reason);
        };
      }
      return handle;
    });

    const result = await f.provider.execute(
      {
        operation: "pull_adb_package",
        input: {
          serial: "device",
          package: "com.example.app",
          output_directory: outputDirectory,
        },
      },
      cancelDuringClose ? { signal: controller.signal } : undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error("expected retained package digest cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(!cancelDuringClose);
    if (cancelDuringClose) {
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupResources).toEqual([]);
    }
    expect(result.error.partialObservation).toMatchObject({
      provider_id: "adb",
      operation: "pull_adb_package",
      result: {
        coverage: "partial",
        artifacts: [
          {
            local_path: join(packageDirectory, "base.apk"),
            bytes: baseBytes.byteLength,
            sha256: createHash("sha256").update(baseBytes).digest("hex"),
          },
          {
            local_path: splitPath,
            bytes: splitBytes.byteLength,
            sha256: createHash("sha256").update(splitBytes).digest("hex"),
          },
        ],
        failures: [
          {
            stage: "digest",
            device_path: "/data/app/com.example.app/split.apk",
          },
        ],
      },
    });
    await f.provider.close();
    expect(closeAttempts).toBe(cancelDuringClose ? 1 : 2);
  },
);

test("resolves package-directory cleanup on the originating pull error", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const outputDirectory = join(f.root, "package-cleanup-output");
  const packageDirectory = join(outputDirectory, "com.example.app");
  let removeAttempts = 0;
  vi.mocked(execFileBytes).mockImplementation(async (_binary, args) => {
    if (args.includes("path"))
      return {
        stdout: Buffer.from("package:/data/app/com.example.app/base.apk\n"),
        stderr: Buffer.alloc(0),
      };
    if (args[2] === "pull") throw new Error("controlled ADB pull failure");
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (String(path) === packageDirectory && ++removeAttempts === 1)
      throw new Error("controlled package directory removal failure");
    return actualFs.rm(path, options);
  });

  const result = await f.provider.execute({
    operation: "pull_adb_package",
    input: {
      serial: "device",
      package: "com.example.app",
      output_directory: outputDirectory,
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected pull and cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(packageDirectory);
  expect(result.error.cause).toBeDefined();
  const originatingError = result.error;
  expect(removeAttempts).toBe(1);

  await f.provider.close();
  expect(removeAttempts).toBe(2);
  expect(originatingError.cleanupIncomplete).toBe(false);
  await f.provider.close();
  expect(removeAttempts).toBe(2);
  await expect(lstat(packageDirectory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test.each([false, true])(
  "preserves cancellation and push receipt during final snapshot cleanup (cleanup failure: %s)",
  async (failCleanup) => {
    const f = await fixture();
    const controller = new AbortController();
    const abortReason = new Error("caller stopped after snapshot cleanup");
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(rm).mockImplementationOnce(async (path, options) => {
      if (basename(String(path)).startsWith("rea-adb-input-")) {
        controller.abort(abortReason);
        if (failCleanup) throw new Error("snapshot cleanup denied");
      }
      return actualFs.rm(path, options);
    });

    const result = await f.provider.execute(f.request, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    if (failCleanup) {
      expect(result.error.cause).toBeInstanceOf(AggregateError);
      const causes = (result.error.cause as AggregateError).errors as [
        { readonly cause: unknown },
        { readonly cleanupIncomplete: boolean },
      ];
      expect(causes[0].cause).toBe(abortReason);
      expect(causes[1].cleanupIncomplete).toBe(true);
    } else expect(result.error.cause).toBe(abortReason);
    const evidence = parseEvidence(result.error.partialObservation);
    expect(evidence).toMatchObject({
      provider: { id: "adb" },
      operation: "push_adb_file",
      confidence: "observed",
      parameters: { local_path: f.source },
      normalized_result: {
        local_path: f.source,
        bytes: 17,
        sha256: f.digest,
        device_path: "/data/local/tmp/payload.bin",
      },
    });
    if (failCleanup)
      expect(result.error.cleanupResources).toContain(
        dirname(f.snapshotPath()),
      );
    else expect(result.error.cleanupIncomplete).toBe(false);
    expect(
      Buffer.compare(
        await readFile(f.source),
        Buffer.from("immutable payload"),
      ),
    ).toBe(0);
    await f.provider.close();
  },
);

test("cancels after the input snapshot copy and before contacting the device", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(open).mockImplementation(async (path, ...args) => {
    const handle = await actualFs.open(path, ...args);
    if (
      String(path).endsWith("payload.bin") &&
      basename(dirname(String(path))).startsWith("rea-adb-input-")
    ) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        controller.abort();
      };
    }
    return handle;
  });

  const result = await f.provider.execute(f.request, {
    signal: controller.signal,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(execFileOutput).toHaveBeenCalledTimes(1);
  expect(await readFile(f.source, "utf8")).toBe("immutable payload");
  await f.provider.close();
});

test("reports input snapshot capacity failures before contacting the device", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const capacityFailure = Object.assign(new Error("no space left"), {
    code: "ENOSPC",
  });
  vi.mocked(open).mockImplementation(async (path, ...args) => {
    if (
      String(path).endsWith("payload.bin") &&
      basename(dirname(String(path))).startsWith("rea-adb-input-")
    )
      throw capacityFailure;
    return actualFs.open(path, ...args);
  });

  const result = await f.provider.execute(f.request);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected snapshot capacity failure");
  expect(result.error._tag).toBe("AnalysisOutputError");
  expect(result.error.cause).toBe(capacityFailure);
  expect(execFileOutput).toHaveBeenCalledTimes(1);
  await f.provider.close();
});
