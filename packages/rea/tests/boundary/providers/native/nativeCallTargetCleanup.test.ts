import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi, onTestFinished } from "vitest";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { AnalysisOutputError } from "../../../../src/domain/analysisErrorCore.js";
import { resolvedAnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { err, ok } from "../../../../src/domain/result.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { ArtifactFileCleanupFailure } from "../../../../src/artifacts/ArtifactFileOperation.js";

const parameters = { breakpoints: [{ kind: "function", name: "main" }] };
const fixture = async () => {
  const directory = await createTestTempDirectory("rea-native-call-file-");
  const path = join(directory, "inert.bin");
  await writeFile(path, "inert native call preflight bytes");
  const target = await nativeMachoTargetForFile(path);
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  return { path, target, prototype };
};

it("retains preflight read failure and exact descriptor across failed client cleanup retries", async () => {
  const { path, target, prototype } = await fixture();
  const readFailure = new Error("controlled preflight read failure");
  const closeFailure = new Error("controlled preflight close failure");
  let release: (() => Promise<void>) | undefined;
  let attempts = 0;
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (this: FileHandle) {
      release = this.close.bind(this);
      this.close = async () => {
        if (++attempts <= 3) throw closeFailure;
        await release!();
      };
      throw readFailure;
    });
  const trace = vi.fn(async () =>
    err(new AnalysisOutputError("observe_native_calls", "must not trace")),
  );
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
    () => ({ trace, close: async () => ok(null) }),
  ).createClient(target);
  onTestFinished(async () => {
    read.mockRestore();
    await release?.();
    await client.close();
  });
  const result = await client.execute("observe_native_calls", parameters);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected retained descriptor cleanup");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual([path]);
  expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
  const failure = result.error.cause as ArtifactFileCleanupFailure;
  expect(failure.fileCleanupFailure.outcome).toEqual({
    kind: "failed",
    cause: readFailure,
  });
  expect(failure.fileCleanupFailure.cleanupCause).toBe(closeFailure);
  const retry = await client.execute("observe_native_calls", parameters);
  expect(retry.ok).toBe(false);
  if (retry.ok)
    throw new Error(
      "Expected retained descriptor to block replacement admission",
    );
  expect(retry.error.cleanupIncomplete).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  const first = await client.close();
  expect(first.ok).toBe(false);
  expect(attempts).toBe(3);
  expect((await client.close()).ok).toBe(true);
  expect(attempts).toBe(4);
  expect(retry.error.cleanupIncomplete).toBe(false);
  expect(retry.error.cleanupResources).toEqual([]);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
  expect(resolvedAnalysisError(result.error).cause).toBe(readFailure);
  if (!first.ok) expect(first.error.cleanupIncomplete).toBe(false);
  expect(trace).not.toHaveBeenCalled();
});

it("joins admitted preflight before closing the tracer", async () => {
  const { target, prototype } = await fixture();
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const original = prototype.read;
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["read"]>
    ) {
      enter();
      await gate;
      return Reflect.apply(original, this, args);
    });
  const calls: string[] = [];
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
    () => ({
      trace: async () => {
        calls.push("trace");
        return err(
          new AnalysisOutputError(
            "observe_native_calls",
            "controlled tracer refusal",
          ),
        );
      },
      close: async () => {
        calls.push("close");
        return ok(null);
      },
    }),
  ).createClient(target);
  onTestFinished(async () => {
    resume();
    await observing;
    read.mockRestore();
    await client.close();
  });
  const observing = client.execute("observe_native_calls", parameters);
  await entered;
  let closed = false;
  const closing = client.close().then((result) => {
    closed = true;
    return result;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  resume();
  expect((await observing).ok).toBe(false);
  expect((await closing).ok).toBe(true);
  expect(calls).toEqual(["trace", "close"]);
});

for (const readFails of [false, true])
  it(`preserves physical hash outcome when close cancellation also fails (read fails: ${readFails})`, async () => {
    const { path, target, prototype } = await fixture();
    const controller = new AbortController();
    const reason = new ProviderCleanupError("foreign", ["unowned"], {});
    const primary = new Error("controlled hash read failure");
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
          if (++attempts === 1) {
            controller.abort(reason);
            throw new Error("controlled hash close failure");
          }
          await release!();
        };
        if (readFails) throw primary;
        return Reflect.apply(original, this, args);
      });
    const trace = vi.fn(async () =>
      err(new AnalysisOutputError("observe_native_calls", "must not trace")),
    );
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => ({ trace, close: async () => ok(null) }),
    ).createClient(target);
    onTestFinished(async () => {
      read.mockRestore();
      await client.close();
      await release?.();
    });
    const result = await client.execute("observe_native_calls", parameters, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained hash close failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([path]);
    expect((await client.close()).ok).toBe(true);
    const resolved = resolvedAnalysisError(result.error);
    expect(resolved.cause).toBe(readFails ? primary : reason);
    expect(resolved._tag).toBe(
      readFails ? "ProviderAdapterError" : "AnalysisCancelledError",
    );
    expect(result.error.cleanupResources).toEqual([]);
    expect(trace).not.toHaveBeenCalled();
  });

it("retains a completed hash when cancellation arrives after successful descriptor close", async () => {
  const { target, prototype } = await fixture();
  const controller = new AbortController();
  const reason = { caller: "hash-final-close" };
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
  const trace = vi.fn(async () =>
    err(new AnalysisOutputError("observe_native_calls", "must not trace")),
  );
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
    () => ({ trace, close: async () => ok(null) }),
  ).createClient(target);
  onTestFinished(async () => {
    read.mockRestore();
    await client.close();
  });
  const result = await client.execute("observe_native_calls", parameters, {
    signal: controller.signal,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected final hash cancellation");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
    cleanupIncomplete: false,
    diagnostics: { completed_hash: { sha256: target.sha256 } },
  });
  expect(trace).not.toHaveBeenCalled();
});

it("does not adopt an arbitrary thrown tracer cleanup marker", async () => {
  const { target } = await fixture();
  const marker = new ProviderCleanupError("foreign", ["unowned"], {});
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
    () => ({
      trace: async () => {
        throw marker;
      },
      close: async () => ok(null),
    }),
  ).createClient(target);
  onTestFinished(async () => {
    await client.close();
  });
  const result = await client.execute("observe_native_calls", parameters);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected opaque tracer failure");
  expect(result.error).toMatchObject({
    _tag: "ProviderAdapterError",
    cause: marker,
    cleanupIncomplete: false,
  });
  expect(result.error.cleanupResources).toEqual([]);
});
