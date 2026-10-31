import { access } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { expect, it, vi, onTestFinished } from "vitest";
import * as commands from "../../../../src/process/ExecFileOutput.js";
import { createNativeUiHelperRuntime } from "../../../../src/native/NativeUiHelperRuntime.js";
import { NativeUiCleanupError } from "../../../../src/native/NativeUiCleanupError.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rm: vi.fn(original.rm) };
});

it("retains the actual helper root after failed removal and releases its exact lease on retry", async () => {
  const command = vi.spyOn(commands, "execFileOutput").mockResolvedValue({
    stdout: "{}",
    stderr: "",
    stdoutBytes: 2,
    stderrBytes: 0,
  });
  const runtime = createNativeUiHelperRuntime({});
  let restoreRemoval: (() => void) | undefined;
  onTestFinished(async () => {
    restoreRemoval?.();
    await runtime.close();
    command.mockRestore();
  });
  await runtime.invoke({});
  const root = runtime.resources()[0];
  if (root === undefined) throw new Error("Expected actual owned helper root");
  await expect(access(root)).resolves.toBeUndefined();
  const physicalFailure = new Error("controlled helper root removal failure");
  const original =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const remove = vi
    .mocked(filesystem.rm)
    .mockRejectedValueOnce(physicalFailure);
  restoreRemoval = () => {
    remove.mockReset();
    remove.mockImplementation(original.rm);
  };
  await expect(runtime.close()).rejects.toBe(physicalFailure);
  const failure = new NativeUiCleanupError(
    [{ runtime, cause: physicalFailure }],
    "observe_native_ui",
  );
  expect(runtime.cleanupLease.released).toBe(false);
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupResources).toEqual([root]);
  restoreRemoval();
  await runtime.close();
  expect(runtime.cleanupLease.released).toBe(true);
  expect(failure.cleanupIncomplete).toBe(false);
  expect(failure.cleanupResources).toEqual([]);
  await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(runtime.invoke({})).rejects.toThrow("scope is closed");
  expect(command).toHaveBeenCalledTimes(2);
});

it("keeps a mixed runtime aggregate incomplete until both exact owners release", async () => {
  const command = vi.spyOn(commands, "execFileOutput").mockResolvedValue({
    stdout: "{}",
    stderr: "",
    stdoutBytes: 2,
    stderrBytes: 0,
  });
  const first = createNativeUiHelperRuntime({});
  const second = createNativeUiHelperRuntime({});
  onTestFinished(async () => {
    await first.close();
    await second.close();
    command.mockRestore();
  });
  await first.invoke({});
  await second.invoke({});
  const firstRoot = first.resources()[0];
  const secondRoot = second.resources()[0];
  if (firstRoot === undefined || secondRoot === undefined)
    throw new Error("Missing owned roots");
  const failure = new NativeUiCleanupError(
    [
      { runtime: first, cause: new Error("first removal failed") },
      { runtime: second, cause: new Error("second removal failed") },
    ],
    "close_binary",
  );
  await first.close();
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupResources).toEqual([secondRoot]);
  await expect(access(firstRoot)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(secondRoot)).resolves.toBeUndefined();
  await second.close();
  expect(failure.cleanupIncomplete).toBe(false);
  expect(failure.cleanupResources).toEqual([]);
  // Repeated close remains a confirmed release.
  await first.close();
  expect(command).toHaveBeenCalledTimes(4);
});

it("joins admitted compilation and helper completion before removing the runtime", async () => {
  let entered!: () => void, resume!: () => void;
  const compiling = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let calls = 0;
  const command = vi
    .spyOn(commands, "execFileOutput")
    .mockImplementation(async () => {
      if (++calls === 1) {
        entered();
        await gate;
      }
      return { stdout: "{}", stderr: "", stdoutBytes: 2, stderrBytes: 0 };
    });
  const runtime = createNativeUiHelperRuntime({});
  onTestFinished(async () => {
    resume();
    await runtime.close();
    command.mockRestore();
  });
  const running = runtime.invoke({});
  await compiling;
  const root = runtime.resources()[0];
  if (root === undefined) throw new Error("Missing active root");
  const closing = runtime.close();
  expect(runtime.cleanupLease.released).toBe(false);
  await expect(access(root)).resolves.toBeUndefined();
  await expect(runtime.invoke({})).rejects.toThrow("scope is closed");
  resume();
  await expect(running).resolves.toEqual({});
  await closing;
  expect(runtime.cleanupLease.released).toBe(true);
  expect(calls).toBe(2);
  await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains one failed compilation and its root instead of overwriting ownership on retry", async () => {
  const physical = new Error("controlled compiler failure");
  const command = vi
    .spyOn(commands, "execFileOutput")
    .mockRejectedValue(physical);
  const runtime = createNativeUiHelperRuntime({});
  onTestFinished(async () => {
    await runtime.close();
    command.mockRestore();
  });
  await expect(runtime.invoke({})).rejects.toBe(physical);
  const roots = runtime.resources();
  expect(roots).toHaveLength(1);
  await expect(runtime.invoke({})).rejects.toBe(physical);
  expect(runtime.resources()).toEqual(roots);
  expect(command).toHaveBeenCalledTimes(1);
  await runtime.close();
  for (const root of roots)
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
});
