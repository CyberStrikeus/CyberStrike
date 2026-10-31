import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi, onTestFinished } from "vitest";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { ok, type Result } from "../domain/result.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { NativeCallTrace, NativeCallTracer } from "./LldbCallTracer.js";
import { observeNativeCalls } from "./NativeCallObservation.js";
import { nativeMachoTargetForFile } from "../../tests/fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

class NeverStartedTracer implements NativeCallTracer {
  calls = 0;
  trace(): Promise<Result<NativeCallTrace, AnalysisError>> {
    this.calls += 1;
    throw new Error("tracer must not run after hash refusal");
  }
  close(): Promise<Result<null, AnalysisError>> {
    return Promise.resolve(ok(null));
  }
}

const fixture = async () => {
  const root = await createTestTempDirectory("rea-native-digest-");
  const path = join(root, "fixture");
  await writeFile(path, "selected executable");
  const target = await nativeMachoTargetForFile(path);
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  return { target, prototype, resources, tracer: new NeverStartedTracer() };
};
const parameters = { breakpoints: [{ kind: "function", name: "main" }] };

it.each([null, 0, new ProviderCleanupError("foreign", ["unowned"], {})])(
  "preserves exact hash cancellation reason %s without borrowing authority",
  async (reason) => {
    const { target, prototype, resources, tracer } = await fixture();
    const controller = new AbortController();
    const original = prototype.read;
    const read = vi
      .spyOn(prototype, "read")
      .mockImplementationOnce(async function (
        this: FileHandle,
        ...args: Parameters<FileHandle["read"]>
      ) {
        const result = await Reflect.apply(original, this, args);
        controller.abort(reason);
        return result;
      });
    onTestFinished(() => read.mockRestore());
    const result = await observeNativeCalls(
      target,
      parameters,
      tracer,
      resources,
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected owned hash cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(tracer.calls).toBe(0);
  },
);

it.each([false, true])(
  "preserves a physical read failure despite AbortError naming or signal state (aborts: %s)",
  async (aborts) => {
    const { target, prototype, resources, tracer } = await fixture();
    const controller = new AbortController();
    const failure = aborts
      ? new Error("physical I/O failure")
      : new DOMException("unrelated physical AbortError", "AbortError");
    const read = vi
      .spyOn(prototype, "read")
      .mockImplementationOnce(async () => {
        if (aborts) controller.abort(null);
        throw failure;
      });
    onTestFinished(() => read.mockRestore());
    const result = await observeNativeCalls(
      target,
      parameters,
      tracer,
      resources,
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected physical read failure");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      cause: failure,
      cleanupIncomplete: false,
    });
    expect(tracer.calls).toBe(0);
  },
);
