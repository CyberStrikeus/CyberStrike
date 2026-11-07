import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi, onTestFinished } from "vitest";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import { ArtifactFileCleanupFailure } from "../../../../src/artifacts/ArtifactFileOperation.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { resolvedAnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { AnalysisCleanupLease } from "../../../../src/artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../../../../src/artifacts/ArtifactReader.js";
import { err, ok } from "../../../../src/domain/result.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { inspectPlistSchema } from "../../../../src/domain/native/nativeInspection.js";

const fixture = async () => {
  const root = await createTestTempDirectory("rea-native-plist-lifetime-");
  const path = join(root, "selected.plist");
  await writeFile(path, "<plist><string>value</string></plist>");
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const runner = new NativeFixtureRunner({
    file: "ASCII text",
    plutil: '"value"',
  });
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    nativeMachoTarget(join(root, "target")),
  );
  onTestFinished(async () => {
    await client.close();
  });
  return { path, prototype, runner, client };
};

it("does not adopt a command's arbitrary thrown cleanup marker as a file owner", async () => {
  const { client, path, runner } = await fixture();
  const foreign = ArtifactReaderFailure.withCleanup(
    new Error("opaque command failure"),
    { resources: ["unowned"], reason: "foreign marker" },
  );
  const run = vi.spyOn(runner, "run").mockRejectedValueOnce(foreign);
  onTestFinished(() => run.mockRestore());
  const result = await client.execute("inspect_plist", { path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected opaque command failure");
  expect(result.error.cause).toBe(foreign);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
});

it("keeps mixed client cleanup live until both file and tracer owners resolve", async () => {
  const root = await createTestTempDirectory("rea-native-mixed-close-");
  const path = join(root, "selected.plist");
  await writeFile(path, "<plist><string>value</string></plist>");
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const traceFailure = new ProviderCleanupError(
    "native-macos",
    ["trace-owner"],
    {},
  );
  const traceLease = new AnalysisCleanupLease(async () => {}, ["trace-owner"]);
  traceLease.bindCleanupError(traceFailure);
  let traceAttempts = 0;
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner({ file: "ASCII text", plutil: '"value"' }),
    "darwin",
    () => ({
      trace: async () => {
        throw new Error("Trace not requested");
      },
      close: async () => {
        traceAttempts += 1;
        if (traceAttempts < 3) return err(traceFailure);
        await traceLease.release();
        return ok(null);
      },
    }),
  ).createClient(nativeMachoTarget(join(root, "target")));
  let release: (() => Promise<void>) | undefined;
  const original = prototype.read;
  let fileAttempts = 0;
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["read"]>
    ) {
      release = this.close.bind(this);
      this.close = async () => {
        fileAttempts += 1;
        if (fileAttempts < 3) throw new Error("file close failed");
        await release!();
      };
      return Reflect.apply(original, this, args);
    });
  onTestFinished(async () => {
    read.mockRestore();
    await release?.();
    await traceLease.release();
    await client.close();
  });
  expect((await client.execute("inspect_plist", { path })).ok).toBe(false);
  const first = await client.close();
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error("Expected both pending owners");
  expect(new Set(first.error.cleanupResources)).toEqual(
    new Set([path, "trace-owner"]),
  );
  expect((await client.close()).ok).toBe(false);
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(first.error.cleanupResources).toEqual(["trace-owner"]);
  expect((await client.close()).ok).toBe(true);
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(first.error.cleanupResources).toEqual([]);
});

it.for(["path-input", "target"] as const)(
  "retains %s prefix read and close failures through repeated client cleanup",
  async (selection, { onTestFinished }) => {
    const root = await createTestTempDirectory("rea-native-plist-close-");
    const path = join(root, "selected.plist");
    await writeFile(path, "<plist><string>value</string></plist>");
    const probe = await open(path, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    await probe.close();
    const primary = Object.assign(new Error("controlled prefix read failure"), {
      code: "EIO",
    });
    const cleanup = new Error("controlled prefix close failure");
    let attempts = 0;
    let release: (() => Promise<void>) | undefined;
    const read = vi
      .spyOn(prototype, "read")
      .mockImplementationOnce(async function (this: FileHandle) {
        release = this.close.bind(this);
        this.close = async () => {
          attempts += 1;
          if (attempts <= 2) throw cleanup;
          await release!();
        };
        throw primary;
      });
    onTestFinished(async () => {
      read.mockRestore();
      await release?.();
    });
    const runner = new NativeFixtureRunner({
      file: "ASCII text",
      plutil: '"value"',
    });
    const commands = vi.spyOn(runner, "run");
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      selection === "target"
        ? { kind: "artifact", format: "plist", path, sha256: "0".repeat(64) }
        : nativeMachoTarget(join(root, "target")),
    );
    onTestFinished(async () => {
      await client.close();
    });
    const result = await client.execute(
      "inspect_plist",
      selection === "target" ? {} : { path },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained cleanup failure");
    expect(result.error).toMatchObject({
      cleanupIncomplete: true,
      operation: "inspect_plist",
    });
    expect(result.error.cleanupResources).toContain(path);
    expect(result.error.capturedOutput).toBeUndefined();
    const projected = projectAnalysisError(result.error);
    expect(JSON.stringify(projected)).not.toContain("captured_output");
    expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
    const failure = result.error.cause as ArtifactFileCleanupFailure;
    expect(failure.fileCleanupFailure.outcome).toEqual({
      kind: "failed",
      cause: primary,
    });
    expect(failure.fileCleanupFailure.cleanupCause).toBe(cleanup);
    const first = await client.close();
    expect(first.ok).toBe(false);
    expect(attempts).toBe(2);
    const retried = await client.close();
    expect(retried.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(resolvedAnalysisError(result.error).cause).toBe(primary);
    expect(resolvedAnalysisError(result.error).capturedOutput).toBeUndefined();
    expect(commands.mock.calls.map(([tool]) => tool)).toEqual(["file"]);
    if (!first.ok) expect(first.error.cleanupIncomplete).toBe(false);
  },
);

for (const readFails of [false, true])
  it(`retains a ${readFails ? "failed" : "completed"} read when cancellation and close failure coincide`, async () => {
    const { client, path, prototype } = await fixture();
    const controller = new AbortController();
    const primary = new Error("physical read failed before cancellation");
    const cleanup = new Error("physical close failed");
    const reason = { caller: "final-close" };
    const original = prototype.read;
    let release: (() => Promise<void>) | undefined;
    let attempts = 0;
    const read = vi
      .spyOn(prototype, "read")
      .mockImplementationOnce(async function (
        this: FileHandle,
        ...args: Parameters<FileHandle["read"]>
      ) {
        release = this.close.bind(this);
        this.close = async () => {
          attempts += 1;
          if (attempts === 1) {
            controller.abort(reason);
            throw cleanup;
          }
          await release!();
        };
        if (readFails) throw primary;
        return Reflect.apply(original, this, args);
      });
    onTestFinished(async () => {
      read.mockRestore();
      await release?.();
    });
    const result = await client.execute(
      "inspect_plist",
      { path },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained close failure");
    const failure = result.error.cause;
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(failure instanceof ArtifactFileCleanupFailure))
      throw new Error("Expected physical owner");
    expect(failure.fileCleanupFailure.outcome).toEqual(
      readFails
        ? { kind: "failed", cause: primary }
        : { kind: "completed", value: "xml" },
    );
    expect(result.error.cleanupIncomplete).toBe(true);
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(resolvedAnalysisError(result.error).cause).toBe(
      readFails ? primary : reason,
    );
  });

it.each([null, 0, new ProviderCleanupError("foreign", ["unowned"], {})])(
  "preserves pre-admission abort reason %s without adopting its resource authority",
  async (reason) => {
    const { client, path, runner } = await fixture();
    const run = vi.spyOn(runner, "run");
    onTestFinished(() => run.mockRestore());
    const controller = new AbortController();
    controller.abort(reason);
    const result = await client.execute(
      "inspect_plist",
      { path },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected pre-admission cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  },
);

it("retains a failed admission close before any native command", async () => {
  const { client, path, runner } = await fixture();
  const run = vi.spyOn(runner, "run");
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockRejectedValueOnce(new Error("controlled admission close failure"));
  onTestFinished(() => {
    close.mockRestore();
    run.mockRestore();
  });
  const result = await client.execute("inspect_plist", { path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed admission close");
  expect(result.error.cleanupResources).toContain(path);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(run).not.toHaveBeenCalled();
  expect((await client.close()).ok).toBe(true);
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("preserves an opaque cancellation observed during successful prefix close", async () => {
  const { client, path, prototype } = await fixture();
  const controller = new AbortController();
  const reason = new ProviderCleanupError("foreign", ["unowned-resource"], {});
  const original = prototype.read;
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["read"]>
    ) {
      const closed = this.close.bind(this);
      this.close = async () => {
        await closed();
        controller.abort(reason);
      };
      return Reflect.apply(original, this, args);
    });
  onTestFinished(() => read.mockRestore());
  const result = await client.execute(
    "inspect_plist",
    { path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error).toMatchObject({
    operation: "inspect_plist",
    cause: reason,
    cleanupIncomplete: false,
  });
  expect(result.error.cleanupResources).not.toContain("unowned-resource");
  expect((await client.close()).ok).toBe(true);
});

it.for([
  ["prefix", "source"],
  ["source", "source"],
  ["prefix", "json"],
  ["prefix", "xml"],
] as const)(
  "joins an admitted %s read and final %s command when client close starts concurrently",
  async ([phase, route]) => {
    const { client, path, prototype, runner } = await fixture();
    if (route !== "source") await writeFile(path, "{ name = value; }");
    let enter!: () => void;
    let resume!: () => void;
    let enterValidation!: () => void;
    let resumeValidation!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const validationEntered = new Promise<void>((resolve) => {
      enterValidation = resolve;
    });
    const validationGate = new Promise<void>((resolve) => {
      resumeValidation = resolve;
    });
    const original = prototype.read;
    let reads = 0;
    const read = vi.spyOn(prototype, "read").mockImplementation(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["read"]>
    ) {
      reads += 1;
      if (reads === (phase === "prefix" ? 1 : 2)) {
        enter();
        await gate;
      }
      return Reflect.apply(original, this, args);
    });
    let validationStarted = false;
    const run = runner.run.bind(runner);
    const commands = vi
      .spyOn(runner, "run")
      .mockImplementation(async (tool, args, options) => {
        if (tool === "plutil" && (route !== "xml" || args[1] === "xml1")) {
          validationStarted = true;
          enterValidation();
          await validationGate;
        }
        const result = await run(tool, args, options);
        if (route !== "xml" || tool !== "plutil" || !result.ok) return result;
        const stdout =
          args[1] === "xml1" ? "<plist><string>value</string></plist>" : "";
        return ok({
          ...result.value,
          stdout,
          stdoutBytes: Buffer.byteLength(stdout),
          exitCode: args[1] === "json" ? 1 : 0,
        });
      });
    onTestFinished(() => {
      resume();
      resumeValidation();
      read.mockRestore();
      commands.mockRestore();
    });
    const inspecting = client.execute("inspect_plist", {
      path,
      native_command_timeout_ms: 1500,
    });
    await entered;
    let finished = false;
    const closing = client.close().then((result) => {
      finished = true;
      return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(await client.execute("inspect_plist", { path })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
    resume();
    await Promise.race([validationEntered, inspecting]);
    expect(validationStarted).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    resumeValidation();
    const inspected = await inspecting;
    if (!inspected.ok) throw inspected.error;
    expect((await closing).ok).toBe(true);
    const result = inspectPlistSchema.parse(inspected.value.result);
    expect(result.value).toBe("value");
    expect(result.source_path).toBe(path);
    const expectedCommands = [
      ["file", ["-b", path]],
      [
        "plutil",
        route === "source"
          ? ["-lint", "--", path]
          : ["-convert", "json", "-o", "-", "--", path],
      ],
      ...(route === "xml"
        ? [["plutil", ["-convert", "xml1", "-o", "-", "--", path]]]
        : []),
    ];
    expect(commands.mock.calls.map(([tool, args]) => [tool, args])).toEqual(
      expectedCommands,
    );
    expect(result.provenance.map(({ tool }) => tool)).toEqual(
      expectedCommands.map(([tool]) => tool),
    );
    expect(commands.mock.calls.at(-1)?.[2]).toEqual({
      timeoutMs: 1500,
      acceptNonZero: true,
    });
  },
);

it("preserves a failed app plist read and its cleanup when the executable changes", async () => {
  const root = await createTestTempDirectory("rea-app-plist-primary-");
  const path = join(root, "Info.plist");
  const executable = join(root, "program");
  await writeFile(path, "<plist><string>value</string></plist>");
  await writeFile(executable, "original executable");
  const target = {
    ...(await nativeMachoTargetForFile(executable)),
    bundleInfoPlist: path,
  };
  const probe = await open(path, "r");
  const inode = (await probe.stat()).ino;
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const primary = Object.assign(new Error("controlled plist read failure"), {
    code: "EIO",
  });
  const cleanup = new Error("controlled plist close failure");
  const original = prototype.read;
  let release: (() => Promise<void>) | undefined;
  let closeAttempts = 0;
  const read = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<FileHandle["read"]>
  ) {
    if ((await this.stat()).ino !== inode)
      return Reflect.apply(original, this, args);
    await writeFile(executable, "changed executable");
    release = this.close.bind(this);
    this.close = async () => {
      closeAttempts += 1;
      if (closeAttempts === 1) throw cleanup;
      await release!();
    };
    throw primary;
  });
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner({ file: "ASCII text" }),
    "darwin",
  ).createClient(target);
  onTestFinished(async () => {
    read.mockRestore();
    await release?.();
    await client.close();
  });
  const result = await client.execute("inspect_plist", {});
  if (result.ok) throw new Error("Expected retained plist failure");
  expect(result.error.cleanupResources).toEqual([path]);
  expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
  const failure = result.error.cause as ArtifactFileCleanupFailure;
  expect(failure.fileCleanupFailure.outcome).toEqual({
    kind: "failed",
    cause: primary,
  });
  expect(failure.fileCleanupFailure.cleanupCause).toBe(cleanup);
  expect(closeAttempts).toBe(1);
  expect((await client.close()).ok).toBe(true);
  expect(closeAttempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(result.error).cause).toBe(primary);
});
