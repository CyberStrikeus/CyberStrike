import { createHash } from "node:crypto";
import { link, lstat, open, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";

import { AdbProvider } from "../../../../src/adb/AdbProvider.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import {
  execFileBytes,
  execFileOutput,
} from "../../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";

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
    link: vi.fn(actual.link),
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm),
  };
});

afterEach(() => vi.restoreAllMocks());

const fixture = async () => {
  const root = await createTestTempDirectory("rea-adb-screen-cancel-");
  const binary = join(root, "adb");
  const stdout = `Android Debug Bridge version 1.0.41\nVersion 34.0.5-stub\nInstalled as ${binary}\n`;
  vi.mocked(execFileOutput).mockResolvedValue({
    stdout,
    stderr: "",
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
  });
  const provider = new AdbProvider({ environment: { REA_ADB_PATH: binary } });
  onTestFinished(() => provider.close());
  return {
    root,
    provider,
    png: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  };
};

test("does not publish a screen capture cancelled before the commit point", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const abortReason = new Error("caller stopped after screencap");
  vi.mocked(execFileBytes).mockImplementationOnce(async () => {
    controller.abort(abortReason);
    return { stdout: f.png, stderr: Buffer.alloc(0) };
  });
  const output = join(f.root, "captures");
  const result = await f.provider.execute(
    {
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: output },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(abortReason);
  await expect(readFile(join(output, "screen.png"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await f.provider.close();
});

test("retains a committed screen capture receipt when cancellation arrives after commit", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const abortReason = new Error("caller stopped after screen commit");
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(link).mockImplementationOnce(async (...args) => {
    await actualFs.link(...args);
    controller.abort(abortReason);
  });
  const output = join(f.root, "captures");
  const result = await f.provider.execute(
    {
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: output },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(abortReason);
  const evidence = parseEvidence(result.error.partialObservation);
  expect(evidence).toMatchObject({
    provider: { id: "adb" },
    operation: "capture_adb_screen",
    confidence: "observed",
    parameters: { serial: "device", output_directory: output },
    normalized_result: {
      local_path: join(output, "screen.png"),
      bytes: f.png.byteLength,
      sha256: createHash("sha256").update(f.png).digest("hex"),
      width: 1,
      height: 1,
    },
  });
  expect(
    Buffer.compare(await readFile(join(output, "screen.png")), f.png),
  ).toBe(0);
  await f.provider.close();
});

test.each([1, 2])(
  "resolves a staged screen error after %i close faults",
  async (closeFaults) => {
    const f = await fixture();
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const output = join(f.root, "captures");
    const destination = join(output, "screen.png");
    let stagedPath: string | undefined;
    let stagedRoot: string | undefined;
    let closeAttempts = 0;
    let rawHandle: Awaited<ReturnType<typeof actualFs.open>> | undefined;
    const closeHandleIdentities: Awaited<ReturnType<typeof actualFs.open>>[] =
      [];
    vi.mocked(execFileBytes).mockResolvedValueOnce({
      stdout: f.png,
      stderr: Buffer.alloc(0),
    });
    vi.mocked(open).mockImplementation(async (...args) => {
      const path = String(args[0]);
      const handle = await actualFs.open(...args);
      if (basename(path) === "screen.png" && path.includes(".rea-screen-")) {
        stagedPath = path;
        stagedRoot = dirname(path);
        rawHandle = handle;
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closeAttempts += 1;
          closeHandleIdentities.push(handle);
          if (closeAttempts <= closeFaults)
            throw new Error("controlled staged screen close fault");
          await close();
        };
      }
      return handle;
    });

    const result = await f.provider.execute({
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: output },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected staged screen cleanup failure");
    const originatingError = result.error;
    const originatingCause = originatingError.cause;
    expect(originatingError.cleanupIncomplete).toBe(closeFaults === 2);
    expect(originatingError.partialObservation).toBeUndefined();
    expect(closeAttempts).toBe(2);
    expect(stagedPath).toBeDefined();
    expect(stagedRoot).toBeDefined();
    if (closeFaults === 2) expect(rawHandle?.fd).toBeGreaterThanOrEqual(0);
    else expect(rawHandle?.fd).toBe(-1);
    expect(closeHandleIdentities).toHaveLength(2);
    expect(closeHandleIdentities.every((handle) => handle === rawHandle)).toBe(
      true,
    );
    if (closeFaults === 2)
      await expect(lstat(stagedRoot!)).resolves.toBeDefined();
    else
      await expect(lstat(stagedRoot!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    await expect(readFile(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const linkedCleanupError = (
      closeFaults === 2
        ? (originatingCause as AggregateError).errors[0]
        : originatingError
    ) as {
      readonly cause: unknown;
      readonly cleanupIncomplete: boolean;
    };
    const originalCloseCause = linkedCleanupError.cause;
    expect(linkedCleanupError.cleanupIncomplete).toBe(closeFaults === 2);
    await f.provider.close();
    expect(closeAttempts).toBe(closeFaults + 1);
    expect(closeHandleIdentities.every((handle) => handle === rawHandle)).toBe(
      true,
    );
    expect(linkedCleanupError.cleanupIncomplete).toBe(false);
    expect(linkedCleanupError.cause).toBe(originalCloseCause);
    expect(originatingError.cleanupIncomplete).toBe(false);
    expect(originatingError.cause).toBe(originatingCause);
    await expect(lstat(stagedRoot!)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

test("retains the committed receipt and cleanup observation when cancellation races with root cleanup", async () => {
  const f = await fixture();
  const runtime = await PrivateRuntimeRoot.create({
    prefix: "rea-adb-receipt-",
  });
  const controller = new AbortController();
  const abortReason = new Error("caller stopped after screen commit");
  let closeAttempts = 0;
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: join(f.root, "adb") },
    createRuntimeRoot: async () => ({
      path: runtime.path,
      close: async () => {
        closeAttempts += 1;
        if (closeAttempts === 1) throw new Error("controlled cleanup fault");
        await runtime.close();
      },
    }),
  });
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockImplementationOnce(async (...args) => {
    await actualFs.link(...args);
    controller.abort(abortReason);
  });
  const output = join(f.root, "captures");
  const destination = join(output, "screen.png");
  const result = await provider.execute(
    {
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: output },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cause).toBeInstanceOf(AggregateError);
  const causes = (result.error.cause as AggregateError).errors as [
    { readonly cause: unknown },
    { readonly cleanupIncomplete: boolean },
  ];
  expect(causes[0].cause).toBe(abortReason);
  expect(causes[1].cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(runtime.path);
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "capture_adb_screen",
    confidence: "observed",
    normalized_result: { local_path: destination, bytes: f.png.byteLength },
  });
  expect(Buffer.compare(await readFile(destination), f.png)).toBe(0);
  await provider.close();
  expect(closeAttempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(false);
});

test("publishes screen captures when the output filesystem does not support hard links", async () => {
  const f = await fixture();
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockRejectedValueOnce(
    Object.assign(new Error("hard links are unsupported"), { code: "EPERM" }),
  );
  const output = join(f.root, "captures");
  const result = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: output },
  });
  expect(result.ok).toBe(true);
  expect(
    Buffer.compare(await readFile(join(output, "screen.png")), f.png),
  ).toBe(0);
  await f.provider.close();
});

test("does not replace a destination created after the initial existence check", async () => {
  const f = await fixture();
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const output = join(f.root, "captures");
  const destination = join(output, "screen.png");
  vi.mocked(link).mockImplementationOnce(async (...args) => {
    await actualFs.writeFile(destination, "caller-owned");
    throw Object.assign(new Error("hard links are unsupported"), {
      code: "EPERM",
    });
  });
  const result = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: output },
  });
  expect(result.ok).toBe(false);
  expect(await readFile(destination, "utf8")).toBe("caller-owned");
  await f.provider.close();
});

test("cancellation after a failed hard link but before exclusive creation does not publish", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const abortReason = new Error("caller stopped before exclusive creation");
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockImplementationOnce(async () => {
    controller.abort(abortReason);
    throw Object.assign(new Error("hard links are unsupported"), {
      code: "EPERM",
    });
  });
  const output = join(f.root, "captures");
  const result = await f.provider.execute(
    {
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: output },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(abortReason);
  await expect(readFile(join(output, "screen.png"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await f.provider.close();
});

test("retains a receipt when cancellation arrives after exclusive output creation", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const abortReason = new Error("caller stopped after exclusive creation");
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const output = join(f.root, "captures");
  const destination = join(output, "screen.png");
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockRejectedValueOnce(
    Object.assign(new Error("hard links are unsupported"), { code: "EPERM" }),
  );
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actualFs.open(...args);
    if (String(args[0]) === destination) controller.abort(abortReason);
    return handle;
  });
  const result = await f.provider.execute(
    {
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: output },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(abortReason);
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "capture_adb_screen",
    confidence: "observed",
    normalized_result: { local_path: destination, bytes: f.png.byteLength },
  });
  expect(Buffer.compare(await readFile(destination), f.png)).toBe(0);
  await f.provider.close();
});

test("closes and retains ownership when exclusive output stat fails", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const output = join(f.root, "captures");
  const destination = join(output, "screen.png");
  let handleOpen = false;
  let statAttempts = 0;
  let removeAttempts = 0;
  let closeAttempts = 0;
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockRejectedValueOnce(
    Object.assign(new Error("hard links are unsupported"), { code: "EPERM" }),
  );
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actualFs.open(...args);
    if (String(args[0]) !== destination) return handle;
    handleOpen = true;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "stat")
          return async () => {
            statAttempts += 1;
            if (statAttempts <= 2)
              throw new Error("controlled descriptor stat fault");
            return target.stat();
          };
        if (property === "close")
          return async () => {
            closeAttempts += 1;
            await target.close();
            handleOpen = false;
          };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  const result = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: output },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected stat failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(destination);
  expect(closeAttempts).toBe(0);
  expect(handleOpen).toBe(true);
  expect(Buffer.compare(await readFile(destination), Buffer.alloc(0))).toBe(0);
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (String(path) === destination && ++removeAttempts === 1)
      throw new Error("controlled rollback removal fault");
    return actualFs.rm(path, options);
  });
  await expect(f.provider.close()).rejects.toBeDefined();
  expect(statAttempts).toBe(3);
  expect(closeAttempts).toBe(1);
  expect(handleOpen).toBe(false);
  await f.provider.close();
  expect(statAttempts).toBe(3);
  expect(closeAttempts).toBe(1);
  expect(result.error.cleanupIncomplete).toBe(false);
  await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
});

test("waits for descriptor close before rolling back an incomplete exclusive output", async () => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const output = join(f.root, "captures");
  const destination = join(output, "screen.png");
  let handleOpen = false;
  let closeAttempts = 0;
  const removeWhileOpen: string[] = [];
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockRejectedValueOnce(
    Object.assign(new Error("hard links are unsupported"), { code: "EPERM" }),
  );
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actualFs.open(...args);
    if (String(args[0]) !== destination) return handle;
    handleOpen = true;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "writeFile")
          return async () => {
            throw new Error("controlled screen write fault");
          };
        if (property === "close")
          return async () => {
            closeAttempts += 1;
            if (closeAttempts === 1)
              throw new Error("controlled descriptor close fault");
            await target.close();
            handleOpen = false;
          };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (String(path) === destination && handleOpen)
      removeWhileOpen.push(String(path));
    return actualFs.rm(path, options);
  });
  const result = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: output },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected write failure");
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cause).toBeInstanceOf(AggregateError);
  expect(result.error.cleanupResources).toContain(destination);
  expect(closeAttempts).toBe(2);
  expect(removeWhileOpen).toEqual([]);
  await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
  await f.provider.close();
});

const exclusiveScreenCloseFixture = async (
  fails: (attempt: number) => boolean,
) => {
  const f = await fixture();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const output = join(f.root, "captures");
  const destination = join(output, "screen.png");
  let closeAttempts = 0;
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  vi.mocked(link).mockRejectedValueOnce(
    Object.assign(new Error("hard links are unsupported"), { code: "EPERM" }),
  );
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actualFs.open(...args);
    if (String(args[0]) !== destination) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "close")
          return async () => {
            if (fails(++closeAttempts))
              throw new Error("controlled descriptor close fault");
            await target.close();
          };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  return { ...f, output, destination, closeAttempts: () => closeAttempts };
};

test.each([false, true])(
  "preserves the completed receipt after handle recovery with root failure %s",
  async (rootFails) => {
    const f = await exclusiveScreenCloseFixture((attempt) => attempt === 1);
    let runtimePath: string | undefined;
    if (rootFails)
      vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementationOnce(
        async function (this: PrivateRuntimeRoot) {
          runtimePath = this.path;
          throw new Error("controlled workspace removal fault");
        },
      );
    const result = await f.provider.execute({
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: f.output },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected close failure");
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "capture_adb_screen",
      confidence: "observed",
      normalized_result: { local_path: f.destination, bytes: f.png.byteLength },
    });
    expect(result.error.cleanupIncomplete).toBe(rootFails);
    if (rootFails) expect(result.error.cleanupResources).toEqual([runtimePath]);
    expect(Buffer.compare(await readFile(f.destination), f.png)).toBe(0);
    expect(f.closeAttempts()).toBe(2);
    await f.provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    if (runtimePath !== undefined)
      await expect(
        readFile(join(runtimePath, "screen.png")),
      ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

test("keeps a sticky publication close failure until provider close retries its owner", async () => {
  let allowClose = false;
  const f = await exclusiveScreenCloseFixture(() => !allowClose);
  const result = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: f.output },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected close failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(
    `${f.destination} (ADB publication handle)`,
  );
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "capture_adb_screen",
    confidence: "observed",
    normalized_result: { local_path: f.destination, bytes: f.png.byteLength },
  });
  expect(Buffer.compare(await readFile(f.destination), f.png)).toBe(0);
  expect(f.closeAttempts()).toBe(2);
  const linkedFailure = (result.error.cause as AggregateError).errors[0] as {
    readonly cleanupIncomplete: boolean;
  };
  expect(linkedFailure.cleanupIncomplete).toBe(true);
  allowClose = true;
  await f.provider.close();
  expect(f.closeAttempts()).toBe(3);
  expect(linkedFailure.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(Buffer.compare(await readFile(f.destination), f.png)).toBe(0);
});

test("resolves an admission cleanup error when the retained runtime-root lease closes", async () => {
  let allowClose = false;
  const f = await exclusiveScreenCloseFixture(() => !allowClose);
  const first = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: f.output },
  });
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error("expected publication close failure");
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(f.closeAttempts()).toBe(2);

  const admission = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: f.output },
  });
  expect(admission.ok).toBe(false);
  if (admission.ok) throw new Error("expected retained cleanup refusal");
  const admissionError = admission.error;
  expect(admissionError.cleanupIncomplete).toBe(true);
  expect(f.closeAttempts()).toBe(3);

  allowClose = true;
  await f.provider.close();
  expect(f.closeAttempts()).toBe(4);
  expect(admissionError.cleanupIncomplete).toBe(false);
  expect(admissionError.cause).toBeInstanceOf(AggregateError);
  expect(Buffer.compare(await readFile(f.destination), f.png)).toBe(0);
});

test("resolves the provider close aggregate after its failed root owner recovers", async () => {
  let allowClose = false;
  const f = await exclusiveScreenCloseFixture(() => !allowClose);
  const result = await f.provider.execute({
    operation: "capture_adb_screen",
    input: { serial: "device", output_directory: f.output },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected publication close failure");
  expect(result.error.cleanupIncomplete).toBe(true);

  const closeError = await f.provider.close().catch((cause: unknown) => cause);
  expect(closeError).toMatchObject({ cleanupIncomplete: true });
  expect(f.closeAttempts()).toBe(3);

  allowClose = true;
  await f.provider.close();
  expect(f.closeAttempts()).toBe(4);
  expect(closeError).toMatchObject({ cleanupIncomplete: false });
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(Buffer.compare(await readFile(f.destination), f.png)).toBe(0);
});

test("retains incomplete cleanup on a cancelled capture while keeping cancellation typed", async () => {
  const f = await fixture();
  const runtime = await PrivateRuntimeRoot.create({
    prefix: "rea-adb-cancel-",
  });
  const controller = new AbortController();
  let closeAttempts = 0;
  const provider = new AdbProvider({
    environment: { REA_ADB_PATH: join(f.root, "adb") },
    createRuntimeRoot: async () => {
      controller.abort();
      return {
        path: runtime.path,
        close: async () => {
          closeAttempts += 1;
          if (closeAttempts === 1) throw new Error("controlled cleanup fault");
          await runtime.close();
        },
      };
    },
  });
  vi.mocked(execFileBytes).mockResolvedValueOnce({
    stdout: f.png,
    stderr: Buffer.alloc(0),
  });
  const result = await provider.execute(
    {
      operation: "capture_adb_screen",
      input: { serial: "device", output_directory: join(f.root, "cancelled") },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(runtime.path);
  await provider.close();
  expect(closeAttempts).toBe(2);
});
