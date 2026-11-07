import { parseConfig } from "../../../../src/config/parseConfig.js";
import { GhidraProvider } from "../../../../src/ghidra/GhidraProvider.js";
import { fixtureDosLoadImage } from "../../../../src/ghidra/GhidraLoadImage.fixture.js";
import { jsonValueSchema } from "../../../../src/domain/jsonValue.js";
import { artifactFilePrimaryFacts } from "../../../../src/artifacts/ArtifactFileOperation.js";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  writeFile,
  open,
  type FileHandle,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import pino from "pino";
import { withVerifierCleanup } from "../../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../../fixtures/lifecycleAcknowledgement.js";
import type { Logger } from "pino";
import type { ProgressUpdate } from "../../../../src/application/ProgressReporter.js";

import { err, ok } from "../../../../src/domain/result.js";
import * as GhidraTransport from "../../../../src/ghidra/GhidraTransport.js";
import { GhidraClient } from "../../../../src/ghidra/GhidraClient.js";
import { ProviderRunLineage } from "../../../../src/process/ProviderRunLineage.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { GHIDRA_PROCESS_DIAGNOSTIC_BYTES } from "../../../../src/ghidra/GhidraDiagnostics.js";
import {
  GhidraHeadlessLauncher,
  GhidraLaunchError,
} from "../../../../src/ghidra/GhidraLauncher.js";
import type { GhidraDiagnostic } from "../../../../src/ghidra/GhidraClientTypes.js";
import type {
  GhidraLaunchSession,
  GhidraLauncher,
} from "../../../../src/ghidra/GhidraLauncher.js";
import type { ProviderProcessHandle } from "../../../../src/process/ProviderProcess.js";
import type { GhidraTransportKind } from "../../../../src/ghidra/GhidraTransport.js";
import {
  GHIDRA_MUTATING_OPERATIONS,
  GHIDRA_SESSION_CAPABILITIES,
} from "../../../../src/ghidra/GhidraSessionValues.js";
import { waitForExit as waitForChildExit } from "../../../support/process/processFixture.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  GhidraFixtureLauncher as FixtureLauncher,
  ghidraFixturePath as fixturePath,
} from "./ghidraClient.fixture.js";

const PROFILE_DIGEST = "a".repeat(64);
const PROVIDER_VERSION = "12.1.4";
const TARGET_SHA256 = createHash("sha256")
  .update(readFileSync(fixturePath))
  .digest("hex");
const HOST_TRANSPORT: GhidraTransportKind =
  process.platform === "win32" ? "authenticated-loopback-tcp" : "unix-socket";

const preExitedProcessLauncher = (options: {
  readonly output: string;
  readonly closeOutput: boolean;
  readonly outputDelayMs?: number;
}) => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const process_: ProviderProcessHandle = {
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    pid: undefined,
    stdout,
    stderr,
    exitCode: 73,
    signalCode: null,
    kill: () => false,
  };
  const finishOutput = () => {
    if (!stdout.writableEnded) stdout.end();
    if (!stderr.writableEnded) stderr.end();
  };
  let endedStreams = 0;
  const maybeClose = () => {
    endedStreams += 1;
    if (endedStreams === 2) emitter.emit("close", 73, null);
  };
  stdout.once("end", maybeClose);
  stderr.once("end", maybeClose);
  const launcher: GhidraLauncher = {
    launch: async (session) => {
      const projectRoot = join(session.runtimeRoot, "project");
      await mkdir(projectRoot, { recursive: true });
      setTimeout(() => {
        if (options.closeOutput) {
          if (!stdout.writableEnded) stdout.end(options.output);
          if (!stderr.writableEnded) stderr.end();
        } else if (!stdout.writableEnded) stdout.write(options.output);
      }, options.outputDelayMs ?? 15);
      return ok({
        process: process_,
        ownsProcessLifetime: true as const,
        projectRoot,
        ghidraLogPath: join(session.runtimeRoot, "ghidra.log"),
        scriptLogPath: join(session.runtimeRoot, "script.log"),
      });
    },
  };
  return { launcher, stdout, stderr, finishOutput };
};

const clients: GhidraClient[] = [];
const clientFor = (
  launcher: GhidraLauncher,
  options: {
    readonly startupTimeoutMs?: number;
    readonly onDiagnostic?: (event: GhidraDiagnostic) => void;
    readonly transport?: GhidraTransportKind;
    readonly runId?: string;
    readonly logger?: Logger;
    readonly targetPath?: string;
    readonly targetSha256?: string;
  } = {},
): GhidraClient => {
  const client = new GhidraClient({
    launcher,
    targetPath: options.targetPath ?? fixturePath,
    targetSha256: options.targetSha256 ?? TARGET_SHA256,
    transport: options.transport ?? HOST_TRANSPORT,
    providerVersion: PROVIDER_VERSION,
    profileDigest: PROFILE_DIGEST,
    startupTimeoutMs: options.startupTimeoutMs ?? 1_000,
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.onDiagnostic === undefined
      ? {}
      : { onDiagnostic: options.onDiagnostic }),
  });
  clients.push(client);
  return client;
};

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("GhidraClient ready-only dispatch", () => {
  it("does not start cold and preserves the normal result once ready", async () => {
    const launcher = new FixtureLauncher();
    const client = clientFor(launcher);

    await expect(client.callToolIfReady("list_strings", {})).resolves.toBe(
      undefined,
    );
    expect(launcher.processes).toEqual([]);

    const started = await client.start();
    if (!started.ok) throw started.error;
    await expect(client.callToolIfReady("list_strings", {})).resolves.toEqual({
      ok: true,
      value: [expect.objectContaining({ value: "fixture value" })],
    });
    expect(launcher.processes).toHaveLength(1);
  });
});

it("reports unknown startup work and stops notifications when cancellation releases the process", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const launcher = new FixtureLauncher("silent");
  const client = clientFor(launcher, { startupTimeoutMs: 30_000 });
  const controller = new AbortController();
  const updates: ProgressUpdate[] = [];
  const started = client.start(controller.signal, {
    report: async (update) => {
      updates.push(update);
      controller.abort();
    },
  });
  const child = await launcher.started;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await started).toMatchObject({
    ok: false,
    error: { kind: "cancelled" },
  });
  expect(updates).toEqual([
    expect.objectContaining({
      phase: "ghidra_startup",
      completed: 0,
      total: null,
      message: expect.stringContaining("Waiting for Ghidra startup"),
    }),
  ]);
  await client.close();
  await expect(waitForChildExit(child, 5_000)).resolves.toBe(true);
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(updates).toHaveLength(1);
});

it("keeps one shared startup despite a failed progress sink and stops reports after readiness", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const launcher = new FixtureLauncher();
  let releaseLaunch: (() => void) | undefined;
  let markLaunchPending: (() => void) | undefined;
  const launchPending = new Promise<void>((resolve) => {
    markLaunchPending = resolve;
  });
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  const client = clientFor(
    {
      async launch(session) {
        markLaunchPending?.();
        await launchGate;
        return launcher.launch(session);
      },
    },
    { startupTimeoutMs: 30_000 },
  );
  let reports = 0;
  const started = client.start(undefined, {
    report: async () => {
      reports += 1;
      throw new Error("notification unavailable");
    },
  });
  const concurrent = client.start();
  await launchPending;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reports).toBe(1);
  releaseLaunch?.();
  await expect(started).resolves.toMatchObject({ ok: true });
  await expect(concurrent).resolves.toMatchObject({ ok: true });
  expect(launcher.processes).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reports).toBe(1);
});

it.each(["descriptor-close", "result-consumption"] as const)(
  "preserves DOS cancellation at the actual snapshot %s boundary",
  async (phase) => {
    const fixture = fixtureDosLoadImage();
    const directory = await createTestTempDirectory("rea-dos-cancel-");
    const targetPath = join(directory, "fixture.exe");
    await writeFile(targetPath, fixture.bytes);
    const live = clientFor(new FixtureLauncher(), {
      targetPath,
      targetSha256: fixture.sha256,
    });
    const started = await live.start();
    if (!started.ok) throw started.error;
    const caller = new AbortController();
    const reason = { caller: phase };
    const config = parseConfig({
      GHIDRA_INSTALL_DIR: "/controlled/ghidra_12.1.4_PUBLIC",
    });
    if (!config.ok) throw config.error;
    const provider = new GhidraProvider(
      config.value,
      pino({ level: "silent" }),
      {},
      {
        platform: "linux",
        architecture: "x64",
        readText: () => "application.version=12.1.4\napplication.java.min=21\n",
        executable: () => true,
        probeJava: () =>
          ok({
            osArch: "amd64",
            osName: "Linux",
            version: "21.0.11",
            major: 21,
            home: "/controlled/jdk21",
            bits: 64,
            runtime: "jdk",
          }),
      },
      () => ({
        start: () => live.start(),
        callTool: async () => ok(jsonValueSchema.parse(fixture.observation)),
        attestDosTargetSnapshot: async (observations, signal) => {
          const result = await live.attestDosTargetSnapshot(
            observations,
            signal,
          );
          if (phase === "result-consumption" && result.ok) caller.abort(reason);
          return result;
        },
        close: () => live.close(),
      }),
    );
    const target = {
      path: targetPath,
      sha256: fixture.sha256,
      kind: "executable" as const,
      format: "dos-mz" as const,
      architecture: "x86" as const,
      availableArchitectures: ["x86" as const],
    };
    const profile = await provider.resolveAnalysisProfile(target);
    if (!profile.ok || profile.value.profile === null)
      throw new Error("Expected DOS profile");
    const client = provider.createClient(target, profile.value.profile);
    let closedOwner: OwnedFileHandle | undefined;
    const original = OwnedFileHandle.prototype.close;
    const close =
      phase === "descriptor-close"
        ? vi
            .spyOn(OwnedFileHandle.prototype, "close")
            .mockImplementationOnce(async function (this: OwnedFileHandle) {
              closedOwner = this;
              await original.call(this);
              caller.abort(reason);
            })
        : undefined;
    onTestFinished(async () => {
      close?.mockRestore();
      await client.close();
    });
    const result = await client.execute(
      "inspect_native_load_image",
      {},
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("Expected DOS cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    if (phase === "descriptor-close") {
      expect(closedOwner?.handle.fd).toBe(-1);
      expect(result.error.partialObservation).toMatchObject({
        kind: "native-load-image",
        stage: "completed",
        result: { status: "verified", observations: fixture.observation },
      });
      expect(result.error.diagnostics).toMatchObject({
        load_image_observations: fixture.observation,
      });
    } else {
      expect(result.error.partialObservation).toMatchObject({
        kind: "native-load-image",
        stage: "completed",
        result: { status: "verified", observations: fixture.observation },
      });
    }
    close?.mockRestore();
    expect((await client.close()).ok).toBe(true);
  },
);

it.each([false, true])(
  "retains a completed bounded MZ comparison through failed close (cancel=%s)",
  async (cancel) => {
    const fixture = fixtureDosLoadImage();
    const directory = await createTestTempDirectory("rea-mz-finalization-");
    const targetPath = join(directory, "inert.exe");
    await writeFile(targetPath, fixture.bytes);
    const client = clientFor(new FixtureLauncher(), {
      targetPath,
      targetSha256: fixture.sha256,
    });
    const started = await client.start();
    if (!started.ok) throw started.error;
    const caller = new AbortController();
    const reason = { stage: "MZ descriptor close" };
    let allowClose = false;
    const original = OwnedFileHandle.prototype.close;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(function (this: OwnedFileHandle) {
        if (allowClose) return original.call(this);
        if (cancel) caller.abort(reason);
        return Promise.reject(
          new Error("controlled MZ descriptor close failure"),
        );
      });
    onTestFinished(async () => {
      allowClose = true;
      await client.close();
      close.mockRestore();
    });
    const result = await client.attestDosTargetSnapshot(
      fixture.observation,
      caller.signal,
    );
    if (result.ok) throw new Error("Expected finalization failure");
    expect(result.error.kind).toBe(cancel ? "cancelled" : "protocol");
    if (cancel) expect(result.error.cancellation?.reason).toBe(reason);
    expect(result.error.partialObservation).toMatchObject({
      kind: "native-load-image",
      stage: "completed",
      result: { status: "verified", observations: fixture.observation },
    });
    expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
    const blocked = await client.attestDosTargetSnapshot(fixture.observation);
    expect(blocked.ok).toBe(false);
    expect(new Set(close.mock.contexts).size).toBe(1);
    allowClose = true;
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupFailure?.cleanupResources).toEqual([]);
  },
);

it.each([false, true])(
  "preserves an explicit MZ refusal through finalization (failed close=%s)",
  async (failClose) => {
    const fixture = fixtureDosLoadImage();
    fixture.bytes[0] = 0;
    const directory = await createTestTempDirectory("rea-mz-refusal-");
    const targetPath = join(directory, "inert.exe");
    await writeFile(targetPath, fixture.bytes);
    const client = clientFor(new FixtureLauncher(), {
      targetPath,
      targetSha256: createHash("sha256").update(fixture.bytes).digest("hex"),
    });
    const started = await client.start();
    if (!started.ok) throw started.error;
    const close = failClose
      ? vi
          .spyOn(OwnedFileHandle.prototype, "close")
          .mockRejectedValueOnce(new Error("controlled refusal close failure"))
      : undefined;
    onTestFinished(async () => {
      close?.mockRestore();
      await client.close();
    });
    const result = await client.attestDosTargetSnapshot(fixture.observation);
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "protocol",
        message: "invalid or truncated DOS MZ header",
        diagnostics: { failure_message: "invalid or truncated DOS MZ header" },
      },
    });
    if (result.ok) throw new Error("Expected MZ refusal");
    expect(result.error.cleanupFailure?.cleanupIncomplete ?? false).toBe(
      failClose,
    );
  },
);

it("hashes snapshot section ranges in the same pass as the whole-file digest", async () => {
  const client = clientFor(new FixtureLauncher());
  const started = await client.start();
  if (!started.ok) throw started.error;
  onTestFinished(async () => {
    await client.close();
  });
  const bytes = readFileSync(fixturePath);
  const digest = (chunk: Buffer): string =>
    createHash("sha256").update(chunk).digest("hex");
  const result = await client.hashTargetSnapshotRanges([
    { start: 0, end: 4 },
    { start: 4, end: bytes.length },
    { start: 2, end: 2 },
  ]);
  expect(result).toEqual({
    ok: true,
    value: {
      sha256: digest(bytes),
      bytes: bytes.length,
      rangeSha256: [
        digest(bytes.subarray(0, 4)),
        digest(bytes.subarray(4)),
        digest(Buffer.alloc(0)),
      ],
    },
  });
});

it("reports snapshot descriptor cleanup immediately and resolves its exact error on retry", async () => {
  const client = clientFor(new FixtureLauncher());
  const started = await client.start();
  if (!started.ok) throw started.error;
  let allowClose = false;
  const original = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      return allowClose
        ? original.call(this)
        : Promise.reject(new Error("controlled snapshot close failure"));
    });
  onTestFinished(async () => {
    allowClose = true;
    close.mockRestore();
    await client.close();
  });
  const result = await client.hashTargetSnapshot();
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected snapshot final close failure");
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
  expect(result.error.partialObservation).toMatchObject({
    sha256: TARGET_SHA256,
    bytes: readFileSync(fixturePath).length,
  });
  const blocked = await client.hashTargetSnapshot();
  expect(blocked.ok).toBe(false);
  if (blocked.ok)
    throw new Error("Expected cleanup to block snapshot admission");
  expect(blocked.error.cleanupFailure?.cleanupIncomplete).toBe(true);
  expect(new Set(close.mock.contexts).size).toBe(1);
  const retry = await client.close();
  expect(retry.ok).toBe(false);
  allowClose = true;
  expect((await client.close()).ok).toBe(true);
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupFailure?.cleanupResources).toEqual([]);
  expect(blocked.error.cleanupFailure?.cleanupIncomplete).toBe(false);
  if (!retry.ok) expect(retry.error.cleanupIncomplete).toBe(false);
});

it("preserves completed snapshot hashing and exact cancellation during descriptor close", async () => {
  const client = clientFor(new FixtureLauncher());
  const started = await client.start();
  if (!started.ok) throw started.error;
  const controller = new AbortController();
  const reason = { phase: "snapshot-final-close" };
  const original = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementationOnce(async function (this: OwnedFileHandle) {
      await original.call(this);
      controller.abort(reason);
    });
  onTestFinished(() => close.mockRestore());
  const result = await client.hashTargetSnapshot(controller.signal);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected final-close cancellation");
  expect(result.error.kind).toBe("cancelled");
  expect(result.error.cancellation?.reason).toBe(reason);
  expect(result.error).toMatchObject({
    partialObservation: {
      sha256: TARGET_SHA256,
      bytes: readFileSync(fixturePath).length,
    },
  });
});

it.each([undefined, 0])(
  "retains completed snapshot capture facts through failed close (limit=%s)",
  async (limit) => {
    const client = clientFor(new FixtureLauncher());
    const started = await client.start();
    if (!started.ok) throw started.error;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockRejectedValueOnce(new Error("controlled capture close failure"));
    onTestFinished(async () => {
      close.mockRestore();
      await client.close();
    });
    const result = await client.readTargetSnapshot(limit);
    if (result.ok) throw new Error("Expected capture cleanup failure");
    expect(result.error.partialObservation).toEqual({
      kind: "file-snapshot-read",
      path: expect.any(String),
      admitted_sha256: TARGET_SHA256,
      capture:
        limit === undefined
          ? { status: "captured", bytes: readFileSync(fixturePath).length }
          : {
              status: "over-capacity",
              source_bytes_at_least: readFileSync(fixturePath).length,
              maximum_bytes: limit,
            },
    });
    expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
  },
);

it("joins a snapshot read before closing its descriptor and runtime", async () => {
  const launcher = new FixtureLauncher();
  const client = clientFor(launcher);
  const started = await client.start();
  if (!started.ok) throw started.error;
  const child = launcher.processes[0];
  if (child === undefined) throw new Error("Missing bounded fixture child");
  const childClosed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  const probe = await open(fixturePath, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  let markRead!: () => void, resume!: () => void;
  const reading = new Promise<void>((resolve) => {
    markRead = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let captured: FileHandle | undefined;
  const original = prototype.read;
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["read"]>
    ) {
      captured = this;
      markRead();
      await gate;
      return Reflect.apply(original, this, args);
    });
  let pending: ReturnType<GhidraClient["hashTargetSnapshot"]> | undefined;
  onTestFinished(async () => {
    resume();
    await pending;
    read.mockRestore();
    await client.close();
  });
  pending = client.hashTargetSnapshot();
  await reading;
  const closing = client.close();
  await childClosed;
  // Cross the event-loop phase after the owned child closed, rather than
  // guessing shutdown progress from an elapsed dispatch delay.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(captured?.fd).toBeGreaterThanOrEqual(0);
  const root = launcher.runtimeRoots[0];
  if (root === undefined) throw new Error("Missing runtime root");
  await expect(access(root)).resolves.toBeUndefined();
  resume();
  expect((await pending).ok).toBe(true);
  expect((await closing).ok).toBe(true);
  expect(captured?.fd).toBe(-1);
  await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves snapshot cancellation and completed hash while final close also fails", async () => {
  const client = clientFor(new FixtureLauncher());
  const started = await client.start();
  if (!started.ok) throw started.error;
  const controller = new AbortController();
  const reason = { phase: "snapshot-cancel-and-failed-close" };
  let allowClose = false;
  const original = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      if (allowClose) return original.call(this);
      controller.abort(reason);
      return Promise.reject(new Error("controlled cancellation close failure"));
    });
  onTestFinished(async () => {
    allowClose = true;
    await client.close();
    close.mockRestore();
  });
  const result = await client.hashTargetSnapshot(controller.signal);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation and cleanup failure");
  expect(result.error.kind).toBe("cancelled");
  expect(result.error.cancellation?.reason).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    sha256: TARGET_SHA256,
    bytes: readFileSync(fixturePath).length,
  });
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
  allowClose = true;
  expect((await client.close()).ok).toBe(true);
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
});

it.each(
  (["hash", "capture"] as const).flatMap((operation) =>
    [null, "caller stopped", new Error("caller stopped")].flatMap((reason) =>
      [false, true].map((failClose) => ({ operation, reason, failClose })),
    ),
  ),
)(
  "preserves active snapshot cancellation: $operation, $reason, failed close=$failClose",
  async ({ operation, reason, failClose }) => {
    const client = clientFor(new FixtureLauncher());
    const started = await client.start();
    if (!started.ok) throw started.error;
    const controller = new AbortController();
    const probe = await open(fixturePath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    await probe.close();
    const originalRead = prototype.read;
    const read = vi
      .spyOn(prototype, "read")
      .mockImplementationOnce(async function (
        this: FileHandle,
        ...args: Parameters<FileHandle["read"]>
      ) {
        // Fulfill a real short read, then abort before the next checkpoint.
        const result = await Reflect.apply(originalRead, this, [
          args[0],
          0,
          1,
          null,
        ]);
        controller.abort(reason);
        return result;
      });
    let allowClose = !failClose;
    const originalClose = OwnedFileHandle.prototype.close;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(function (this: OwnedFileHandle) {
        return allowClose
          ? originalClose.call(this)
          : Promise.reject(new Error("controlled active-read close failure"));
      });
    onTestFinished(async () => {
      allowClose = true;
      read.mockRestore();
      await client.close();
      close.mockRestore();
    });
    const result =
      operation === "hash"
        ? await client.hashTargetSnapshot(controller.signal)
        : await client.readTargetSnapshot(undefined, controller.signal);
    if (result.ok) throw new Error("Expected active read cancellation");
    expect(result.error.kind).toBe("cancelled");
    expect(result.error.cancellation?.reason).toBe(reason);
    expect(result.error.partialObservation).toBeUndefined();
    expect(result.error.cleanupFailure?.cleanupIncomplete ?? false).toBe(
      failClose,
    );
    allowClose = true;
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupFailure?.cleanupIncomplete ?? false).toBe(false);
  },
);

it("keeps a snapshot read failure primary across late cancellation and failed close", async () => {
  const client = clientFor(new FixtureLauncher());
  const started = await client.start();
  if (!started.ok) throw started.error;
  const controller = new AbortController();
  const physical = new Error("controlled snapshot physical read failure");
  const probe = await open(fixturePath, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const read = vi.spyOn(prototype, "read").mockRejectedValueOnce(physical);
  let allowClose = false;
  const original = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      if (allowClose) return original.call(this);
      controller.abort({ phase: "late-snapshot-close" });
      return Promise.reject(
        new Error("controlled close failure after read failure"),
      );
    });
  onTestFinished(async () => {
    allowClose = true;
    read.mockRestore();
    await client.close();
    close.mockRestore();
  });
  const result = await client.hashTargetSnapshot(controller.signal);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected read and cleanup failure");
  expect(result.error.kind).toBe("protocol");
  expect(result.error.cancellation).toBeUndefined();
  expect(artifactFilePrimaryFacts(result.error.cause)).toEqual({
    cause: physical,
    origin: "owned-or-classified",
  });
  expect(result.error.partialObservation).toBeUndefined();
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
  allowClose = true;
  expect((await client.close()).ok).toBe(true);
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
});

it("keeps runtime cleanup pending after a snapshot descriptor releases and shrinks live resources", async () => {
  const launcher = new FixtureLauncher();
  const client = clientFor(launcher);
  const started = await client.start();
  if (!started.ok) throw started.error;
  let allowClose = false;
  const original = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      return allowClose
        ? original.call(this)
        : Promise.reject(new Error("controlled snapshot close failure"));
    });
  let restoreRoot: (() => void) | undefined;
  onTestFinished(async () => {
    allowClose = true;
    close.mockRestore();
    restoreRoot?.();
    await client.close();
  });
  const result = await client.hashTargetSnapshot();
  if (result.ok) throw new Error("Expected file cleanup failure");
  const first = await client.close();
  if (first.ok) throw new Error("Expected pending descriptor cleanup");
  allowClose = true;
  const rootClose = vi
    .spyOn(PrivateRuntimeRoot.prototype, "close")
    .mockRejectedValueOnce(new Error("controlled root removal failure"));
  restoreRoot = () => rootClose.mockRestore();
  const second = await client.close();
  if (second.ok) throw new Error("Expected pending root cleanup");
  expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupFailure?.cleanupResources).toEqual([]);
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(first.error.cleanupResources).toEqual([launcher.runtimeRoots[0]]);
  expect(second.error.cleanupResources).toEqual([launcher.runtimeRoots[0]]);
  expect((await client.close()).ok).toBe(true);
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(second.error.cleanupIncomplete).toBe(false);
});

describe("GhidraClient captured source snapshot", () => {
  it("retains a snapshot descriptor whose close failed until session cleanup succeeds", async () => {
    const client = clientFor(new FixtureLauncher());
    const started = await client.start();
    if (!started.ok) throw started.error;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockRejectedValueOnce(new Error("snapshot descriptor close failed"))
      .mockRejectedValueOnce(new Error("snapshot descriptor close failed"));
    try {
      await expect(client.hashTargetSnapshot()).resolves.toMatchObject({
        ok: false,
        error: { kind: "protocol" },
      });
      const owner = close.mock.contexts[0];
      expect(owner).toBeInstanceOf(OwnedFileHandle);
      await expect(client.close()).resolves.toMatchObject({
        ok: false,
        error: { cleanupIncomplete: true },
      });
      expect(client.operationHealthSnapshot()).toMatchObject({
        state: "unknown",
      });
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
      expect(client.operationHealthSnapshot()).toBeUndefined();
      expect(
        close.mock.contexts.filter((context) => context === owner),
      ).toHaveLength(3);
    } finally {
      close.mockRestore();
    }
  });

  it("hashes complete private snapshots with bounded chunks and abortable reads", async () => {
    const root = await createTestTempDirectory("rea-ghidra-hash-");
    const source = join(root, "firmware.bin");
    const bytes = Buffer.alloc(512 * 1024 + 3, 0xa5);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(source, bytes);
    const client = clientFor(new FixtureLauncher(), {
      targetPath: source,
      targetSha256: sha256,
    });
    await expect(client.hashTargetSnapshot()).resolves.toMatchObject({
      ok: false,
      error: { kind: "protocol" },
    });
    const started = await client.start();
    if (!started.ok) throw started.error;
    // Observe the admitted private snapshot even if the original path changes.
    await writeFile(source, "changed original");
    const allocate = Buffer.allocUnsafe;
    const allocations = vi.spyOn(Buffer, "allocUnsafe");
    try {
      const identity = await client.hashTargetSnapshot();
      if (!identity.ok) throw identity.error;
      expect(identity.value).toEqual({ sha256, bytes: bytes.length });
      expect(allocations.mock.calls.length).toBeGreaterThan(1);
      expect(
        Math.max(...allocations.mock.calls.map(([size]) => size)),
      ).toBeLessThan(bytes.length);
      const controller = new AbortController();
      allocations.mockImplementationOnce((size) => {
        controller.abort();
        return allocate(size);
      });
      await expect(
        client.hashTargetSnapshot(controller.signal),
      ).resolves.toMatchObject({ ok: false, error: { kind: "cancelled" } });
    } finally {
      allocations.mockRestore();
    }
    await expect(client.hashTargetSnapshot()).resolves.toMatchObject({
      ok: true,
      value: { sha256, bytes: bytes.length },
    });
    await client.close();
    await expect(client.hashTargetSnapshot()).resolves.toMatchObject({
      ok: false,
      error: { kind: "protocol" },
    });
  });

  it("exposes the immutable import snapshot only during the live session", async () => {
    const client = clientFor(new FixtureLauncher());
    await expect(client.readTargetSnapshot()).resolves.toMatchObject({
      ok: false,
      error: { kind: "protocol" },
    });
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    const abortedRead = new AbortController();
    abortedRead.abort();
    await expect(
      client.readTargetSnapshot(1024, abortedRead.signal),
    ).resolves.toMatchObject({ ok: false, error: { kind: "cancelled" } });
    const snapshot = await client.readTargetSnapshot();
    expect(snapshot.ok).toBe(true);
    const expected = readFileSync(fixturePath);
    if (snapshot.ok)
      expect(snapshot.value).toEqual({
        kind: "captured",
        bytes: expected,
      });
    await expect(
      client.readTargetSnapshot(expected.length),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "captured", bytes: expected },
    });
    const bounded = await client.readTargetSnapshot(0);
    expect(bounded).toMatchObject({
      ok: true,
      value: {
        kind: "over-capacity",
        maximumBytes: 0,
        sourceBytesAtLeast: readFileSync(fixturePath).length,
      },
    });
    await client.close();
    await expect(client.readTargetSnapshot()).resolves.toMatchObject({
      ok: false,
      error: { kind: "protocol" },
    });
  });
});

it("scopes authenticated input-failure diagnostics to the request while retaining session output", async () => {
  const client = clientFor(new FixtureLauncher("remote_error"));

  const result = await client.callTool("list_procedures", {
    document: null,
    offset: 0,
    limit: 500,
  });

  expect(result).toMatchObject({
    ok: false,
    error: {
      kind: "remote",
      remoteCode: "not_found",
      diagnostics: {
        diagnostic_scope: "request",
        remote_code: "not_found",
        remote_message: "Unknown Ghidra procedure name",
        failure_output: {
          stdout: { text: "Fixture request rejected: missing procedure\n" },
          complete: true,
        },
      },
    },
  });
  if (result.ok) throw new Error("Expected remote lookup failure");
  expect(result.error.diagnostics).not.toHaveProperty("stdout");
  expect(result.error.diagnostics).not.toHaveProperty("stderr");
  expect(result.error.diagnostics).not.toHaveProperty("launch_support");
  expect(client.diagnostics()).toMatchObject({
    stdout: {
      text: "Fixture launcher startup output\nFixture request rejected: missing procedure\n",
    },
  });
  expect(client.isReady()).toBe(true);
  await expect(
    client.callTool("list_strings", { document: null }),
  ).resolves.toMatchObject({ ok: true });
  await client.close();
  expect(client.diagnostics()).toMatchObject({
    stdout: {
      text: expect.stringContaining("Fixture launcher startup output"),
    },
  });
});

it("retains launcher diagnostics when an input error rejects the startup handshake", async () => {
  const client = clientFor(new FixtureLauncher("remote_startup_error"));
  const result = await client.start();
  expect(result).toMatchObject({
    ok: false,
    error: {
      kind: "remote",
      remoteCode: "invalid_request",
      diagnostics: {
        stdout: {
          text: expect.stringContaining("Fixture launcher startup output"),
        },
      },
    },
  });
  if (result.ok) throw new Error("Expected startup failure");
  expect(result.error.diagnostics).not.toHaveProperty("diagnostic_scope");
});

describe("GhidraClient", () => {
  it("completes an exact, fragmented post-analysis handshake", async () => {
    const launcher = new FixtureLauncher("fragmented");
    const client = clientFor(launcher);

    const started = await client.start();
    const expectedCapabilities = GHIDRA_SESSION_CAPABILITIES.filter(
      (value) =>
        HOST_TRANSPORT === "unix-socket" ||
        !GHIDRA_MUTATING_OPERATIONS.has(value),
    );
    expect(started).toMatchObject({
      ok: true,
      value: {
        provider: { id: "ghidra", version: PROVIDER_VERSION },
        profile_digest: PROFILE_DIGEST,
        read_only: HOST_TRANSPORT !== "unix-socket",
        analysis_complete: true,
        analysis_timed_out: false,
        target: {
          image_base: "0x1000",
          default_address_space: "ram",
        },
      },
    });
    if (started.ok) {
      // Capability identity is an exact set; bridge declaration order is not a contract.
      expect(new Set(started.value.capabilities)).toEqual(
        new Set(expectedCapabilities),
      );
      expect(started.value.capabilities).toHaveLength(
        expectedCapabilities.length,
      );
      expect(started.value).not.toHaveProperty("bridge_version");
    }
    if (HOST_TRANSPORT === "unix-socket")
      expect(Buffer.byteLength(launcher.endpointPaths[0] ?? "")).toBeLessThan(
        108,
      );
    else expect(launcher.endpointPaths[0]).toMatch(/bridge-endpoint\.json$/u);

    await expect(
      client.callTool("list_strings", { document: null }),
    ).resolves.toMatchObject({
      ok: true,
      value: [{ address: "0x2000", value: "fixture 雪🦊" }],
    });
  });

  it("accepts an owned-socket result above the former 64 MiB ceiling", async () => {
    const client = clientFor(new FixtureLauncher("oversized_result"));
    const result = await client.callTool("list_strings", { document: null });

    if (!result.ok) throw result.error;
    if (!Array.isArray(result.value))
      throw new TypeError("Ghidra fixture result was not an inventory array");
    const first = result.value[0];
    if (typeof first !== "object" || first === null || Array.isArray(first))
      throw new TypeError("Ghidra fixture inventory item was not an object");
    const value = first.value;
    if (typeof value !== "string")
      throw new TypeError("Ghidra fixture string value was missing");
    expect(value.length).toBe(64 * 1024 * 1024 + 1);
    expect(value.slice(0, 4)).toBe("xxxx");
    expect(value.slice(-4)).toBe("xxxx");
  });

  it("completes the same authenticated handshake over loopback TCP", async () => {
    const launcher = new FixtureLauncher();
    const client = clientFor(launcher, {
      transport: "authenticated-loopback-tcp",
    });

    await expect(client.start()).resolves.toMatchObject({
      ok: true,
      value: {
        target: { sha256: TARGET_SHA256 },
      },
    });
    expect(launcher.endpointPaths[0]).toMatch(/bridge-endpoint\.json$/u);
  });

  it("correlates an admitted inventory request after startup", async () => {
    const client = clientFor(new FixtureLauncher());

    await expect(
      client.callTool("list_procedures", {
        document: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: [
        {
          address: "0x1000",
          value: "fixture_main",
          procedure: { external: false, thunk: false },
        },
      ],
    });
  });

  it.each([
    ["wrong_identity", "protocol"],
    ["malformed", "protocol"],
    ["contradictory", "protocol"],
    ["future_id", "protocol"],
    ["analysis_timeout", "analysis_timeout"],
    ["exit", "process"],
  ] as const)("projects %s startup as %s", async (mode, expectedKind) => {
    const client = clientFor(new FixtureLauncher(mode));
    const result = await client.start();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(expectedKind);
  });
});

it("reports owner closure to live startup callers without cancelling their signals", async () => {
  let entered: (() => void) | undefined;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = ProviderRunLineage.prototype.observe;
  const observe = vi
    .spyOn(ProviderRunLineage.prototype, "observe")
    .mockImplementationOnce(async function (this: ProviderRunLineage, launch) {
      entered?.();
      await gate;
      await original.call(this, launch);
    });
  const client = clientFor(new FixtureLauncher(), {
    startupTimeoutMs: 10_000,
  });
  const controllers = [new AbortController(), new AbortController()];
  const waits = controllers.map(({ signal }) => client.start(signal));
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      pending,
      Promise.race(waits),
      "startup observation",
    );
    const closing = client.close();
    release?.();
    for (const wait of waits)
      await expect(wait).resolves.toMatchObject({
        ok: false,
        error: {
          kind: "process",
          message: "Ghidra session closed during startup",
        },
      });
    await expect(closing).resolves.toEqual({ ok: true, value: null });
    expect(controllers.every(({ signal }) => !signal.aborted)).toBe(true);
    expect(client.isReady()).toBe(false);
  }, [
    () => release?.(),
    async () => {
      const result = await client.close();
      if (!result.ok) throw result.error;
    },
    async () => {
      await Promise.allSettled(waits);
    },
    () => observe.mockRestore(),
  ]);
});

it.skipIf(process.platform === "win32")(
  "retains a failed socket-root cleanup owner and the original startup error",
  async () => {
    const parent = join(
      await createTestTempDirectory("rea-ghidra-socket-retry-"),
      "long-".repeat(20),
    );
    await mkdir(parent);
    const roots = new Set<PrivateRuntimeRoot>();
    const originalCreate = PrivateRuntimeRoot.create;
    const originalClose = PrivateRuntimeRoot.prototype.close;
    let allowCleanup = false;
    const create = vi
      .spyOn(PrivateRuntimeRoot, "create")
      .mockImplementation(async (options) => {
        const root = await originalCreate.call(
          PrivateRuntimeRoot,
          options?.prefix === "rea-ghidra-" ? { ...options, parent } : options,
        );
        roots.add(root);
        return root;
      });
    const close = vi
      .spyOn(PrivateRuntimeRoot.prototype, "close")
      .mockImplementation(async function (this: PrivateRuntimeRoot) {
        if (
          !allowCleanup &&
          basename(this.path).startsWith("rea-ghidra-socket-")
        )
          throw new Error("Socket root cleanup denied");
        await originalClose.call(this);
      });
    const launcher = new FixtureLauncher();
    const controller = new AbortController();
    const client = clientFor({
      async launch(session) {
        const launched = await launcher.launch(session);
        if (launcher.processes.length === 1) controller.abort();
        return launched;
      },
    });
    try {
      const first = await client.start(controller.signal);
      expect(first).toMatchObject({
        ok: false,
        error: {
          kind: "cancelled",
          cleanupFailure: { cleanupIncomplete: true },
        },
      });
      if (first.ok) throw new Error("Expected retained cleanup");
      const socketRoot = [...roots].find(({ path }) =>
        basename(path).startsWith("rea-ghidra-socket-"),
      );
      if (socketRoot === undefined)
        throw new Error("Expected a separate socket root");
      await expect(
        access(launcher.runtimeRoots[0] ?? ""),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(socketRoot.path)).resolves.toBeUndefined();
      const retry = await client.start();
      if (retry.ok) throw new Error("Restart lost the retained socket root");
      expect(retry.error).toBe(first.error);
      expect(launcher.processes).toHaveLength(1);
      expect(client.operationHealthSnapshot()).toMatchObject({
        state: "unknown",
        retryAction: "unknown",
      });
      allowCleanup = true;
      await expect(client.close()).resolves.toEqual({
        ok: true,
        value: null,
      });
      await expect(access(socketRoot.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(client.start()).resolves.toMatchObject({ ok: true });
      expect(launcher.processes).toHaveLength(2);
    } finally {
      allowCleanup = true;
      await client.close();
      for (const root of roots) await originalClose.call(root);
      create.mockRestore();
      close.mockRestore();
    }
  },
);

it.each([0, 1])(
  "cancels startup waiter %s without interrupting its peer",
  async (cancelledIndex) => {
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const launchPending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const launchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const launcher = new FixtureLauncher();
    const client = clientFor(
      {
        async launch(session) {
          entered?.();
          await launchGate;
          return launcher.launch(session);
        },
      },
      { startupTimeoutMs: 10_000 },
    );
    const controllers = [new AbortController(), new AbortController()];
    const waits = controllers.map(({ signal }) => client.start(signal));
    try {
      await launchPending;
      let cancelled: Awaited<ReturnType<GhidraClient["start"]>> | undefined;
      void waits[cancelledIndex]?.then((result) => {
        cancelled = result;
      });
      controllers[cancelledIndex]?.abort();
      await vi.waitFor(() =>
        expect(cancelled).toMatchObject({
          ok: false,
          error: { kind: "cancelled" },
        }),
      );
      expect(launcher.processes).toHaveLength(0);
      release?.();
      await expect(waits[1 - cancelledIndex]).resolves.toMatchObject({
        ok: true,
      });
      expect(launcher.processes).toHaveLength(1);
      expect(client.isReady()).toBe(true);
    } finally {
      release?.();
      await Promise.all(waits);
    }
  },
);

it("retains startup failure and cleans up when lineage observation rejects", async () => {
  const cause = new TypeError("Lineage reader rejected");
  const observe = vi.spyOn(ProviderRunLineage.prototype, "observe");
  onTestFinished(() => observe.mockRestore());
  observe.mockRejectedValueOnce(cause);
  const launcher = new FixtureLauncher();
  const client = clientFor(launcher);

  const result = await client.start();
  expect(result).toMatchObject({
    ok: false,
    error: {
      kind: "start",
      message: "Ghidra process lineage observation failed",
    },
  });
  if (result.ok) throw new Error("Expected lineage observation failure");
  expect(result.error.cause).toBe(cause);
  const child = launcher.processes[0];
  if (child === undefined) throw new Error("fixture child was not launched");
  await expect(waitForChildExit(child, 5_000)).resolves.toBe(true);
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(client.isReady()).toBe(false);
  await expect(client.start()).resolves.toMatchObject({ ok: true });
  expect(launcher.processes).toHaveLength(2);
});

it("cleans up when the final waiter cancels during lineage observation", async () => {
  let markObservationPending: (() => void) | undefined;
  const observationPending = new Promise<void>((resolve) => {
    markObservationPending = resolve;
  });
  let releaseObservation: (() => void) | undefined;
  const observationGate = new Promise<void>((resolve) => {
    releaseObservation = resolve;
  });
  const originalObserve = ProviderRunLineage.prototype.observe;
  const observe = vi.spyOn(ProviderRunLineage.prototype, "observe");
  onTestFinished(() => observe.mockRestore());
  observe.mockImplementationOnce(async function (
    this: ProviderRunLineage,
    launch,
  ) {
    markObservationPending?.();
    await observationGate;
    return await originalObserve.call(this, launch);
  });

  const launcher = new FixtureLauncher();
  const client = clientFor(launcher);
  const controller = new AbortController();
  const starting = client.start(controller.signal);
  await observationPending;
  const child = launcher.processes[0];
  if (child === undefined) throw new Error("fixture child was not launched");

  controller.abort();
  releaseObservation?.();

  await expect(starting).resolves.toMatchObject({
    ok: false,
    error: { kind: "cancelled" },
  });
  await expect(waitForChildExit(child, 5_000)).resolves.toBe(true);
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(client.callToolIfReady("list_strings", {})).resolves.toBe(
    undefined,
  );

  await expect(client.start()).resolves.toMatchObject({ ok: true });
  expect(launcher.processes).toHaveLength(2);
});

it("cancels a retry waiter without taking ownership of startup cleanup", async () => {
  let markLaunchPending: (() => void) | undefined;
  const launchPending = new Promise<void>((resolve) => {
    markLaunchPending = resolve;
  });
  let releaseLaunch: (() => void) | undefined;
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  let markStartupAborted: (() => void) | undefined;
  const startupAborted = new Promise<void>((resolve) => {
    markStartupAborted = resolve;
  });
  const launcher = new FixtureLauncher();
  const client = clientFor({
    async launch(session, options) {
      options?.signal?.addEventListener("abort", () => markStartupAborted?.(), {
        once: true,
      });
      markLaunchPending?.();
      await launchGate;
      return launcher.launch(session);
    },
  });
  const firstController = new AbortController();
  const first = client.start(firstController.signal);
  let retry: ReturnType<typeof client.start> | undefined;
  try {
    await launchPending;
    firstController.abort();
    // The retry starts after the shared owner has observed the final departure.
    await startupAborted;

    const retryController = new AbortController();
    retry = client.start(retryController.signal);
    retryController.abort();
    await expect(retry).resolves.toMatchObject({
      ok: false,
      error: { kind: "cancelled" },
    });
  } finally {
    releaseLaunch?.();
    await Promise.allSettled([first, retry]);
  }
  await expect(first).resolves.toMatchObject({
    ok: false,
    error: { kind: "cancelled" },
  });
  expect(launcher.processes).toHaveLength(1);
  const child = launcher.processes[0];
  if (child === undefined) throw new Error("fixture child was not launched");
  await expect(waitForChildExit(child, 5_000)).resolves.toBe(true);
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("applies one startup deadline and removes the private runtime", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const launcher = new FixtureLauncher("silent");
  const client = clientFor(launcher, { startupTimeoutMs: 30 });

  const pending = client.start();
  const child = await launcher.started;
  await vi.advanceTimersByTimeAsync(30);
  const result = await vi.waitFor(() => pending, { timeout: 10_000 });
  vi.useRealTimers();

  expect(result).toMatchObject({
    ok: false,
    error: { kind: "timeout", timeoutMs: 30 },
  });
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await client.close();
  await expect(waitForExit(child)).resolves.toBe(true);
});

it("cancels startup promptly and leaves no project or process", async () => {
  const launcher = new FixtureLauncher("silent");
  const client = clientFor(launcher, { startupTimeoutMs: 10_000 });
  const controller = new AbortController();
  const pending = client.start(controller.signal);
  const process_ = await launcher.started;
  controller.abort();

  const result = await pending;

  expect(result).toMatchObject({ ok: false, error: { kind: "cancelled" } });
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await client.close();
  await expect(waitForExit(process_)).resolves.toBe(true);
});

describe("GhidraClient established requests", () => {
  it("preserves an expired ping deadline through the request queue", async () => {
    const client = clientFor(new FixtureLauncher());
    await expect(client.start()).resolves.toMatchObject({ ok: true });

    await expect(client.ping({ timeoutMs: 0 })).resolves.toMatchObject({
      ok: false,
      error: { kind: "timeout", timeoutMs: 0 },
    });
  });

  it("fails an established function request when the provider process exits", async () => {
    const client = clientFor(new FixtureLauncher("exit_tools"));
    await expect(client.start()).resolves.toMatchObject({ ok: true });

    await expect(
      client.callTool("procedure_pseudo_code", {
        document: null,
        procedure: "fixture_main",
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: "process" } });
  });

  it("cancels queued work and stops active provider work on cancellation", async () => {
    const launcher = new FixtureLauncher("hang_tools");
    const client = clientFor(launcher);
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    const activeController = new AbortController();
    const active = client.callTool(
      "procedure_pseudo_code",
      { document: null, procedure: "fixture_main" },
      { signal: activeController.signal },
    );
    await vi.waitFor(() =>
      expect(launcher.requests).toContain("procedure_pseudo_code"),
    );
    const queuedController = new AbortController();
    const queued = client.callTool(
      "procedure_info",
      { document: null, procedure: "fixture_main" },
      { signal: queuedController.signal },
    );
    queuedController.abort();

    await expect(queued).resolves.toMatchObject({
      ok: false,
      error: { kind: "cancelled" },
    });
    const waiting = client.callTool("procedure_info", {
      document: null,
      procedure: "fixture_main",
    });
    expect(launcher.requests).not.toContain("procedure_info");
    const process_ = launcher.processes[0];
    activeController.abort();
    await expect(active).resolves.toMatchObject({
      ok: false,
      error: { kind: "cancelled" },
    });
    expect(await waitForExit(process_)).toBe(true);
    await expect(waiting).resolves.toMatchObject({
      ok: false,
      error: { kind: "process" },
    });
  });
});

describe("GhidraClient runtime removal failures", () => {
  it
    .skipIf(process.platform === "win32" || process.getuid?.() === 0)
    .each(["close", "active cancellation"] as const)(
    "retains a runtime root after %s cleanup failure and removes it on retry",
    async (stage) => {
      const launcher = new FixtureLauncher(
        stage === "active cancellation" ? "hang_tools" : "success",
      );
      const client = clientFor(launcher);
      await expect(client.start()).resolves.toMatchObject({ ok: true });
      const runtimeRoot = launcher.runtimeRoots[0] ?? "";
      // Without write permission its entries cannot be removed.
      await chmod(runtimeRoot, 0o500);
      try {
        if (stage === "close") {
          await expect(client.close()).resolves.toMatchObject({
            ok: false,
            error: {
              cleanupIncomplete: true,
              cleanupResources: [runtimeRoot],
              diagnostics: { leftover_paths: [runtimeRoot] },
            },
          });
        } else {
          const controller = new AbortController();
          const active = client.callTool(
            "procedure_pseudo_code",
            { document: null, procedure: "fixture_main" },
            { signal: controller.signal },
          );
          await vi.waitFor(() =>
            expect(launcher.requests).toContain("procedure_pseudo_code"),
          );
          const queued = client.callTool("procedure_info", {
            document: null,
            procedure: "fixture_main",
          });
          controller.abort();
          await expect(active).resolves.toMatchObject({
            ok: false,
            error: {
              kind: "cancelled",
              cleanupFailure: {
                cleanupIncomplete: true,
                cleanupResources: [runtimeRoot],
                diagnostics: { leftover_paths: [runtimeRoot] },
              },
            },
          });
          await expect(queued).resolves.toMatchObject({
            ok: false,
            error: { kind: "process" },
          });
        }
        await expect(access(runtimeRoot)).resolves.toBeUndefined();
        expect(client.operationHealthSnapshot()).toMatchObject({
          state: "unknown",
        });
      } finally {
        await chmod(runtimeRoot, 0o700);
      }

      await expect(client.close()).resolves.toEqual({ ok: true, value: null });
      expect(client.operationHealthSnapshot()).toBeUndefined();
      await expect(access(runtimeRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

describe("GhidraClient cleanup and diagnostics", () => {
  it("makes double close idempotent and releases its process runtime", async () => {
    const launcher = new FixtureLauncher();
    const client = clientFor(launcher);
    await expect(client.start()).resolves.toMatchObject({ ok: true });

    await Promise.all([client.close(), client.close()]);
    await client.close();

    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const process_ = launcher.processes[0];
    expect(exited(process_)).toBe(true);
    if (process_ === undefined)
      throw new Error("Fixture process was not captured");
  });

  it("retains actionable runtime coordinates after successful cleanup", async () => {
    const launcher = new FixtureLauncher();
    const client = clientFor(launcher, {
      runId: "11111111-1111-4111-8111-111111111111",
    });
    expect(client.operationHealthSnapshot()).toBeUndefined();
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    expect(client.operationHealthSnapshot()).toBeUndefined();
    const child = await launcher.started;

    await client.close();

    expect(client.operationHealthSnapshot()).toBeUndefined();
    expect(client.diagnostics()).toMatchObject({
      runtime_root: launcher.runtimeRoots[0],
      transport: HOST_TRANSPORT,
      endpoint_path: launcher.endpointPaths[0],
      project_root: join(launcher.runtimeRoots[0] ?? "", "project"),
      process_id: expect.any(Number),
      exit_code: child.exitCode,
      run_id: "11111111-1111-4111-8111-111111111111",
    });
    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("bounds long-lived launcher diagnostics without interrupting the session", async () => {
    const launcher = new FixtureLauncher("diagnostic_output");
    const client = clientFor(launcher);
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    await expect(
      client.callTool("list_strings", { document: null }),
    ).resolves.toMatchObject({ ok: true });

    await vi.waitFor(() => {
      expect(client.diagnostics()).toMatchObject({
        diagnostic_truncated: true,
      });
    });
    const diagnostics = client.diagnostics();
    const stdout = diagnostics.stdout as {
      bytes: number;
      retained_bytes: number;
      text: string;
    };
    const stderr = diagnostics.stderr as {
      bytes: number;
      retained_bytes: number;
      text: string;
    };
    expect(stdout.bytes + stderr.bytes).toBeGreaterThan(
      GHIDRA_PROCESS_DIAGNOSTIC_BYTES,
    );
    expect(stdout.retained_bytes + stderr.retained_bytes).toBeLessThanOrEqual(
      GHIDRA_PROCESS_DIAGNOSTIC_BYTES,
    );
    expect(stdout.bytes).toBeGreaterThanOrEqual(stdout.retained_bytes);
    expect(stderr.bytes).toBeGreaterThanOrEqual(stderr.retained_bytes);
    expect(JSON.stringify(diagnostics)).not.toContain(launcher.tokens[0] ?? "");
    expect(`${stdout.text}${stderr.text}`).toContain("[REDACTED]");
    expect(
      stderr.text.endsWith(
        "source=/tmp/local-evidence.bin?cursor=keep&[REDACTED]",
      ),
    ).toBe(true);

    await client.close();
    expect(exited(launcher.processes[0])).toBe(true);
    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains actionable diagnostics without retaining its token", async () => {
    const launcher = new FixtureLauncher("exit");
    const events: GhidraDiagnostic[] = [];
    const client = clientFor(launcher, {
      onDiagnostic: (event) => events.push(event),
    });
    const result = await client.start();
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const encoded = JSON.stringify(result.error.diagnostics);
    expect(result.error.diagnostics.target_path).toBe(fixturePath);
    expect(encoded).toContain(PROFILE_DIGEST);
    expect(encoded).not.toContain(launcher.tokens[0] ?? "missing-token");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "launcher-exit" }),
    );
  });
});

const exited = (process_: ChildProcess | undefined): boolean =>
  process_ !== undefined &&
  (process_.exitCode !== null || process_.signalCode !== null);

const waitForExit = async (
  process_: ChildProcess | undefined,
): Promise<boolean> => {
  return process_ !== undefined && waitForChildExit(process_, 10_000);
};

describe("GhidraClient rejected requests", () => {
  it("redacts authentication after failed startup cleanup and retry", async () => {
    const fixture = new FixtureLauncher();
    const tokens: string[] = [];
    const launcher: GhidraLauncher = {
      launch: async (session) => {
        tokens.push(session.token);
        if (tokens.length === 1)
          throw new Error("Launch rejected before process creation");
        return fixture.launch(session);
      },
    };
    let rejectCompletion = false;
    const logger = pino(
      {
        level: "debug",
        hooks: {
          logMethod(args, method) {
            const fields = args[0];
            if (
              rejectCompletion &&
              typeof fields === "object" &&
              fields !== null &&
              "method" in fields &&
              fields.method === "list_procedures"
            )
              throw new Error(
                `Late failure ${tokens.join(" ")} /tmp/public-fixture`,
              );
            method.apply(this, args);
          },
        },
      },
      { write: () => undefined },
    );
    const client = clientFor(launcher, { logger });
    await expect(client.start()).resolves.toMatchObject({
      ok: false,
      error: { kind: "start" },
    });
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    expect(tokens).toHaveLength(2);
    rejectCompletion = true;
    const result = await client.callTool("list_procedures", { document: null });
    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: {
          failure_cause: {
            message: "Late failure [REDACTED] [REDACTED] /tmp/public-fixture",
          },
        },
      },
    });
    if (result.ok) throw new Error("Expected late failure");
    for (const token of tokens)
      expect(JSON.stringify(result.error.diagnostics)).not.toContain(token);
  });

  it("retains an unexpected wire rejection and continues serial requests", async () => {
    const launcher = new FixtureLauncher();
    const cause = Object.assign(new TypeError("Request completion rejected"), {
      code: "ECOMPLETION",
    });
    let rejectCompletion = true;
    const logger = pino(
      {
        level: "debug",
        hooks: {
          logMethod(args, method) {
            const fields = args[0];
            if (
              rejectCompletion &&
              typeof fields === "object" &&
              fields !== null &&
              "method" in fields &&
              fields.method === "list_procedures"
            ) {
              rejectCompletion = false;
              throw cause;
            }
            method.apply(this, args);
          },
        },
      },
      { write: () => undefined },
    );
    const client = clientFor(launcher, { logger });
    const first = client.callTool("list_procedures", { document: null });
    const second = client.callTool("list_procedures", { document: null });
    const result = await first;
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "protocol",
        diagnostics: {
          failure_cause: {
            name: "TypeError",
            message: cause.message,
            code: "ECOMPLETION",
          },
        },
      },
    });
    if (result.ok) throw new Error("Expected rejected request");
    expect(result.error.cause).toBe(cause);
    await expect(second).resolves.toMatchObject({ ok: true });
  });
});

describe("GhidraClient process output drain before startup failure", () => {
  const oomeOutput = [
    "ERROR Abort due to Headless analyzer error: Java heap space (HeadlessAnalyzer) java.lang.OutOfMemoryError:",
    "\tat ghidra.app.plugin.core.analysis.GolangSymbolAnalyzer.applyTo",
  ].join("\n");

  it("captures deferred stdio from a child that exited before supervision", async () => {
    const { launcher, finishOutput } = preExitedProcessLauncher({
      output: oomeOutput,
      closeOutput: true,
    });
    onTestFinished(finishOutput);
    const client = clientFor(launcher, { startupTimeoutMs: 5_000 });
    const result = await client.start();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("process");
    expect(result.error.diagnostics).toMatchObject({
      exit_code: 73,
      stdout: { text: oomeOutput },
      failure_output: { complete: true, stdout: { text: oomeOutput } },
    });
    expect(result.error.diagnostics).not.toHaveProperty(
      "output_incomplete",
      true,
    );
  });

  it("bounds an output stream that never closes and marks its snapshot incomplete", async () => {
    const { launcher, finishOutput } = preExitedProcessLauncher({
      output: oomeOutput,
      closeOutput: false,
    });
    onTestFinished(finishOutput);
    const client = clientFor(launcher, { startupTimeoutMs: 5_000 });
    const result = await client.start();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.diagnostics).toMatchObject({
      exit_code: 73,
      output_incomplete: true,
      stdout: { text: oomeOutput },
    });
  });

  it("preserves an observed process exit when cancellation interrupts diagnostic drain", async () => {
    const { launcher, finishOutput } = preExitedProcessLauncher({
      output: oomeOutput,
      closeOutput: true,
      outputDelayMs: 150,
    });
    onTestFinished(finishOutput);
    const controller = new AbortController();
    let abortScheduled = false;
    const client = clientFor(launcher, {
      startupTimeoutMs: 5_000,
      onDiagnostic: (event) => {
        if (event.type !== "launcher-exit" || abortScheduled) return;
        abortScheduled = true;
        setTimeout(() => controller.abort(), 25);
      },
    });
    const result = await client.start(controller.signal);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("process");
    expect(result.error.diagnostics).toMatchObject({
      exit_code: 73,
      output_incomplete: true,
    });
  });
});

describe("GhidraClient operation-scoped failure output", () => {
  it("keeps earlier successful-operation OOME in history but out of later failure evidence", async () => {
    const client = clientFor(new FixtureLauncher("old_oom_then_malformed"));
    const started = await client.start();
    if (!started.ok) throw started.error;

    const earlier = await client.callTool("list_documents", {});
    expect(earlier.ok).toBe(true);
    const later = await client.callTool("list_procedures", {});
    expect(later.ok).toBe(false);
    if (later.ok) return;

    expect(later.error.kind).toBe("protocol");
    expect(later.error.diagnostics.stderr).toMatchObject({
      text: expect.stringContaining("java.lang.OutOfMemoryError:"),
    });
    expect(later.error.diagnostics.failure_output).toMatchObject({
      complete: false,
      stdout: { text: "" },
      stderr: { text: "Current operation diagnostic: 雪\n" },
    });
  });
});

describe("GhidraClient shutdown diagnostics", () => {
  it("logs an unexpected shutdown rejection and still removes its process and runtime", async () => {
    const launcher = new FixtureLauncher();
    const logs: string[] = [];
    const logger = pino(
      {
        level: "debug",
        hooks: {
          logMethod(args, method) {
            const fields = args[0];
            if (
              typeof fields === "object" &&
              fields !== null &&
              "method" in fields &&
              fields.method === "shutdown"
            )
              throw Object.assign(
                new Error(
                  `Shutdown rejected ${launcher.tokens[0]} /tmp/password-fixture`,
                ),
                { code: "ESHUTDOWN" },
              );
            method.apply(this, args);
          },
        },
      },
      {
        write: (line) => {
          logs.push(line);
        },
      },
    );
    const client = clientFor(launcher, { logger });
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    await expect(client.close()).resolves.toEqual({ ok: true, value: null });
    const warning: unknown[] = logs.map((line) => JSON.parse(line));
    expect(warning).toContainEqual(
      expect.objectContaining({
        status: "failed",
        kind: "process",
        message: "Ghidra shutdown request failed",
        diagnostics: expect.objectContaining({
          failure_cause: {
            name: "Error",
            message: "Shutdown rejected [REDACTED] /tmp/password-fixture",
            code: "ESHUTDOWN",
          },
        }),
      }),
    );
    expect(logs.join("")).not.toContain(launcher.tokens[0]);
    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(waitForExit(launcher.processes[0])).resolves.toBe(true);
  });

  it.each(["shutdown_error", "invalid_shutdown_ack"] as const)(
    "keeps cleanup best effort for %s",
    async (mode) => {
      const launcher = new FixtureLauncher(mode);
      const logs: string[] = [];
      const logger = pino(
        { level: "warn" },
        {
          write: (line) => {
            logs.push(line);
          },
        },
      );
      const client = clientFor(launcher, { logger });
      await expect(client.start()).resolves.toMatchObject({ ok: true });
      await expect(client.close()).resolves.toEqual({ ok: true, value: null });
      const warning: unknown[] = logs.map((line) => JSON.parse(line));
      expect(warning).toContainEqual(
        expect.objectContaining({
          msg: "Ghidra bridge shutdown was not confirmed",
          status:
            mode === "shutdown_error" ? "failed" : "invalid-acknowledgement",
        }),
      );
      if (mode === "shutdown_error") {
        expect(warning).toContainEqual(
          expect.objectContaining({
            kind: "remote",
            diagnostics: expect.objectContaining({
              remote_code: "shutdown_fixture_failure",
              remote_message:
                "Shutdown denied for [REDACTED]: /tmp/password-fixture http://localhost/secret?token=public-value",
            }),
          }),
        );
      }
      expect(logs.join("")).not.toContain(launcher.tokens[0]);
      await expect(
        access(launcher.runtimeRoots[0] ?? ""),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(waitForExit(launcher.processes[0])).resolves.toBe(true);
    },
  );
});

it("preserves failed startup and retained Ghidra cleanup capabilities until a verified retry", async () => {
  const fixture = new FixtureLauncher("wrong_identity");
  let cleanupAllowed = false;
  let cleanupAttempts = 0;
  const launcher: GhidraLauncher = {
    launch: async (session) => {
      const launched = await fixture.launch(session);
      if (!launched.ok) return launched;
      return ok({
        ...launched.value,
        cleanup: async () => {
          cleanupAttempts += 1;
          return cleanupAllowed
            ? { cleaned: true as const, signaled: false }
            : {
                cleaned: false as const,
                reason: "fixture process cleanup unconfirmed",
              };
        },
      });
    },
  };
  const client = clientFor(launcher);
  onTestFinished(async () => {
    cleanupAllowed = true;
    await client.close();
  });
  expect(await client.start()).toMatchObject({
    ok: false,
    error: { kind: "protocol", cleanupFailure: { cleanupIncomplete: true } },
  });
  const runtime = fixture.runtimeRoots[0];
  if (runtime === undefined)
    throw new Error("Fixture runtime was not captured");
  await access(runtime);
  expect(cleanupAttempts).toBe(1);
  expect(await client.close()).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  cleanupAllowed = true;
  expect(await client.close()).toEqual(ok(null));
  expect(cleanupAttempts).toBe(3);
  await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
});

describe.skipIf(process.platform === "win32")(
  "Ghidra launcher rollback ownership",
  () => {
    it.each([
      ["ownership manifest write failure", false, "start"],
      ["cancellation after process creation", true, "cancelled"],
    ] as const)(
      "retains the original process and runtime roots after %s until cleanup succeeds",
      async (failureMode, cancelAfterSpawn, expectedKind) => {
        const root = await createTestTempDirectory("rea-ghidra-rollback-");
        const java = join(root, "jdk", "bin", "java");
        await mkdir(join(root, "jdk", "bin"), { recursive: true });
        await writeFile(
          java,
          "#!/usr/bin/env node\n// LaunchSupport fixture emits no optional values.\n",
        );
        await chmod(java, 0o755);

        const controller = new AbortController();
        let cleanupAllowed = false;
        let child: ChildProcess | undefined;
        let runtimeRoot: string | undefined;
        const headless = new GhidraHeadlessLauncher({
          environment: process.env,
          javaHome: join(root, "jdk"),
          analyzeHeadlessPath: "/unused/ghidra/support/analyzeHeadless",
          configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
          bridgeScriptPath: "/unused/rea/ReaGhidraBridge.java",
          spawnProcess: async ({ runId }) => {
            const spawned = spawn(
              process.execPath,
              ["-e", "setInterval(() => {}, 1000)"],
              { detached: true, stdio: ["ignore", "pipe", "pipe"] },
            );
            child = spawned;
            await new Promise<void>((resolve, reject) => {
              spawned.once("spawn", () => resolve());
              spawned.once("error", reject);
            });
            if (cancelAfterSpawn)
              controller.abort(new Error("rollback cancellation fixture"));
            const pid = spawned.pid;
            if (pid === undefined) throw new Error("fixture child has no PID");
            return {
              process: spawned,
              ownership: {
                runId,
                leaderPid: pid,
                processGroupId: pid,
                expectedParentPid: process.pid,
              },
              cleanup: async () => {
                if (!cleanupAllowed)
                  return {
                    cleaned: false as const,
                    reason: `${failureMode} cleanup is still unavailable`,
                  };
                if (spawned.exitCode === null && spawned.signalCode === null)
                  spawned.kill("SIGTERM");
                const exited = await waitForChildExit(spawned, 5_000);
                return exited
                  ? { cleaned: true as const, signaled: true }
                  : {
                      cleaned: false as const,
                      reason: "fixture child did not exit",
                    };
              },
            };
          },
        });
        const launcher: GhidraLauncher = {
          async launch(session, options) {
            runtimeRoot = session.runtimeRoot;
            if (!cancelAfterSpawn)
              await mkdir(join(session.runtimeRoot, "ownership.json"));
            return headless.launch(session, options);
          },
        };
        const client = clientFor(launcher, { startupTimeoutMs: 10_000 });
        onTestFinished(async () => {
          cleanupAllowed = true;
          await client.close();
        });

        const started = await client.start(
          cancelAfterSpawn ? controller.signal : undefined,
        );
        expect(started).toMatchObject({
          ok: false,
          error: {
            kind: expectedKind,
            cleanupFailure: { cleanupIncomplete: true },
          },
        });
        if (started.ok) throw new Error("expected startup rollback failure");
        expect(started.error.message).toContain(
          cancelAfterSpawn ? "startup was cancelled" : "headless launch failed",
        );
        if (!cancelAfterSpawn)
          expect(started.error.message).toContain("ownership.json");
        if (runtimeRoot === undefined || child === undefined)
          throw new Error("fixture did not retain the started process owner");
        await access(runtimeRoot);
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();

        cleanupAllowed = true;
        await expect(client.close()).resolves.toEqual(ok(null));
        await expect(access(runtimeRoot)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(waitForExit(child)).resolves.toBe(true);
      },
    );
  },
);

it("reconnects a dropped preauthentication loopback socket within the original startup deadline", async () => {
  const launcher = new FixtureLauncher("reject_first_connection");
  const client = clientFor(launcher, {
    transport: "authenticated-loopback-tcp",
  });
  const started = await client.start();
  expect(started.ok).toBe(true);
  expect(launcher.processes).toHaveLength(1);
  const result = await client.callToolIfReady("list_strings", {});
  expect(result).toMatchObject({ ok: true });
});

it("bounds retries when loopback preauthentication keeps failing", async () => {
  const launcher = new FixtureLauncher("reject_all_connections");
  const client = clientFor(launcher, {
    transport: "authenticated-loopback-tcp",
  });
  expect(await client.start()).toMatchObject({
    ok: false,
    error: { kind: "process" },
  });
  expect(launcher.processes).toHaveLength(1);
  await expect(waitForChildExit(launcher.processes[0]!, 5_000)).resolves.toBe(
    true,
  );
});

it.each([null, "caller stopped", new Error("caller stopped")])(
  "preserves exact active and queued request cancellation reasons %j",
  async (reason) => {
    const launcher = new FixtureLauncher("hang_tools");
    const client = clientFor(launcher);
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    const activeController = new AbortController();
    const active = client.callTool(
      "procedure_pseudo_code",
      { document: null, procedure: "fixture_main" },
      { signal: activeController.signal },
    );
    await vi.waitFor(() =>
      expect(launcher.requests).toContain("procedure_pseudo_code"),
    );
    const queuedController = new AbortController();
    const queued = client.callTool(
      "procedure_info",
      {},
      { signal: queuedController.signal },
    );
    queuedController.abort(reason);
    const queuedResult = await queued;
    activeController.abort(reason);
    const activeResult = await active;
    for (const result of [queuedResult, activeResult]) {
      if (result.ok) throw new Error("Expected request cancellation");
      expect(result.error.kind).toBe("cancelled");
      expect(result.error.cancellation?.reason).toBe(reason);
    }
    expect(await waitForExit(launcher.processes[0])).toBe(true);
    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("preserves the observed protocol failure when cancellation interrupts request diagnostic drain", async () => {
  const controller = new AbortController();
  let abortScheduled = false;
  const logger = pino(
    {
      level: "warn",
      hooks: {
        logMethod(args, method) {
          const fields = args[0];
          if (
            typeof fields === "object" &&
            fields !== null &&
            "method" in fields &&
            fields.method === "list_procedures" &&
            !abortScheduled
          ) {
            abortScheduled = true;
            setImmediate(() => controller.abort(null));
          }
          method.apply(this, args);
        },
      },
    },
    { write: () => {} },
  );
  const launcher = new FixtureLauncher("old_oom_then_malformed");
  const client = clientFor(launcher, { logger });
  await expect(client.start()).resolves.toMatchObject({ ok: true });
  await expect(client.callTool("list_documents", {})).resolves.toMatchObject({
    ok: true,
  });
  const result = await client.callTool(
    "list_procedures",
    {},
    { signal: controller.signal },
  );
  expect(abortScheduled).toBe(true);
  if (result.ok) throw new Error("Expected protocol failure");
  expect(result.error.kind).toBe("protocol");
  expect(result.error.diagnostics).toMatchObject({
    failure_output: { complete: false },
  });
  expect(await waitForExit(launcher.processes[0])).toBe(true);
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([null, "caller stopped", new Error("caller stopped")])(
  "retains the exact reason during startup endpoint polling %j",
  async (reason) => {
    const observed = vi.spyOn(GhidraTransport, "observeGhidraEndpoint");
    onTestFinished(() => observed.mockRestore());
    const launcher = new FixtureLauncher("silent");
    const client = clientFor(launcher, { startupTimeoutMs: 10000 });
    const controller = new AbortController();
    const pending = client.start(controller.signal);
    await vi.waitFor(() => expect(observed).toHaveBeenCalled());
    controller.abort(reason);
    const result = await pending;
    if (result.ok) throw new Error("Expected startup cancellation");
    expect(result.error.kind).toBe("cancelled");
    expect(result.error.cancellation?.reason).toBe(reason);
    expect(await waitForExit(launcher.processes[0])).toBe(true);
    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("preserves a handshake protocol error observed before the final startup caller cancels", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const logger = pino(
    {
      level: "warn",
      hooks: {
        logMethod(args, method) {
          const fields = args[0];
          if (
            typeof fields === "object" &&
            fields !== null &&
            "method" in fields &&
            fields.method === "ping" &&
            !cancelled
          ) {
            cancelled = true;
            controller.abort(null);
          }
          method.apply(this, args);
        },
      },
    },
    { write: () => {} },
  );
  const launcher = new FixtureLauncher("malformed");
  const client = clientFor(launcher, { logger });
  const result = await client.start(controller.signal);
  expect(cancelled).toBe(true);
  if (result.ok) throw new Error("Expected handshake protocol failure");
  expect(result.error.kind).toBe("protocol");
  expect(await waitForExit(launcher.processes[0])).toBe(true);
  await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("redacts the transport credential when refreshing startup diagnostics", async () => {
  let token = "";
  const client = clientFor({
    launch: async (session) => {
      token = session.token;
      return err(new GhidraLaunchError(`Launcher refused ${token}`));
    },
  });
  const result = await client.start();
  if (result.ok) throw new Error("Expected launcher refusal");
  expect(token.length).toBeGreaterThan(0);
  expect(result.error.message).toContain("[REDACTED]");
  expect(result.error.message).not.toContain(token);
  expect(JSON.stringify(result.error.diagnostics)).not.toContain(token);
});

it("preserves a failed launcher result when the final caller aborts before consumption", async () => {
  const controller = new AbortController();
  const physical = new GhidraLaunchError("controlled earlier launch failure", {
    cause: new Error("physical failure"),
  });
  const client = clientFor({
    launch: async (_session, options) => {
      controller.abort(null);
      if (options?.signal?.aborted !== true)
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      return err(physical);
    },
  });
  const result = await client.start(controller.signal);
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "start", cause: physical },
  });
});

it.each([null, "helper owner stopped"])(
  "consumes a producer cancellation without an aborted client deadline %j",
  async (reason) => {
    const cancellation = new AnalysisCancelledError("open_binary", {
      cause: reason,
    });
    const client = clientFor({
      launch: async () =>
        err(
          new GhidraLaunchError("producer helper cancelled", {
            primaryFailure: cancellation,
          }),
        ),
    });
    const result = await client.start();
    expect(result).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cancellation?.reason).toBe(reason);
  },
);

it("preserves a producer failure while its result waits for the startup deadline", async () => {
  const physical = new GhidraLaunchError(
    "controlled physical failure before finalization",
  );
  const client = clientFor(
    {
      launch: async (_session, options) => {
        if (options?.signal === undefined)
          throw new Error("Expected owned startup signal");
        if (!options.signal.aborted)
          await new Promise<void>((resolve) =>
            options.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        return err(physical);
      },
    },
    { startupTimeoutMs: 500 },
  );
  expect(await client.start()).toMatchObject({
    ok: false,
    error: { kind: "start", cause: physical },
  });
});

it.each(["search_procedures", "search_strings"] as const)(
  "%s retains native candidate rows for normal and ready-only dispatch",
  async (operation) => {
    const client = clientFor(new FixtureLauncher("unicode_search"));
    const query = {
      pattern: "source",
      mode: "literal",
      case_sensitive: false,
      document: null,
    };
    const expected = {
      ok: true,
      value: [
        { address: "0x1000", value: "ſource" },
        { address: "0x1001", value: "SOURCE" },
        { address: "0x1002", value: "İource" },
        { address: "0x1003", value: "unrelated" },
      ],
    };
    await expect(client.callTool(operation, query)).resolves.toEqual(expected);
    await expect(client.callToolIfReady(operation, query)).resolves.toEqual(
      expected,
    );
    for (const pattern of ["ſOURCE", "Σ"]) {
      await expect(
        client.callTool(operation, { ...query, pattern }),
      ).resolves.toEqual(expected);
      await expect(
        client.callToolIfReady(operation, { ...query, pattern }),
      ).resolves.toEqual(expected);
    }
    const regex = await client.callTool(operation, { ...query, mode: "regex" });
    expect(regex.ok && Array.isArray(regex.value) && regex.value.length).toBe(
      4,
    );
    const sensitive = await client.callTool(operation, {
      ...query,
      case_sensitive: true,
    });
    expect(
      sensitive.ok && Array.isArray(sensitive.value) && sensitive.value.length,
    ).toBe(4);
  },
);
