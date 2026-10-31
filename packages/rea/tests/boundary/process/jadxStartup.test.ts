import { RegularFileCleanupFailure } from "../../../src/filesystem/OwnedRegularFile.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { StableFileHashFailure } from "../../../src/filesystem/StableFileHash.js";
import { z } from "zod";
import { AnalysisResourceConstraintError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { JadxSession } from "../../../src/android/JadxSession.js";
import { createJadxProtocolFixture } from "../../fixtures/android/jadx.js";
import { access, open } from "node:fs/promises";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it as test, vi } from "vitest";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createJadxStartupFixture as setup } from "../../fixtures/android/jadxStartup.js";

const it = test.skipIf(process.platform === "win32");

it.each(["exit", "process", "stdout", "protocol"])(
  "retains %s failure and final diagnostics when cancellation arrives during cleanup",
  async (kind) => {
    const f = await setup();
    const controller = new AbortController();
    const outcome = f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: controller.signal },
    );
    await f.request;
    const physical = new Error("controlled physical startup failure");
    if (kind === "exit") f.process.exit();
    else if (kind === "process") f.process.emit("error", physical);
    else if (kind === "stdout") f.process.stdout.emit("error", physical);
    else f.process.stdout.write("{malformed\n");
    await f.cleanup;
    controller.abort({ later: "caller cancellation" });
    f.release();
    const result = await outcome;
    if (result.ok) throw new Error("Expected startup failure");
    expect(result.error).toMatchObject({
      _tag:
        kind === "protocol"
          ? "AnalysisOutputError"
          : "AnalysisCapabilityUnavailableError",
      capturedOutput: {
        stderr: "late startup diagnostic",
        // stdout carries the failed protocol; the retained stderr closes completely.
        truncated: false,
        exit_code: 17,
      },
    });
    if (kind === "process" || kind === "stdout")
      expect(result.error.cause).toBe(physical);
    expect(result.error.partialObservation).toMatchObject({
      provider_id: "jadx",
      operation: "inspect_android_package",
    });
    expect(projectAnalysisError(result.error).message).not.toContain(
      "Select a full JDK",
    );
    await expect(access(f.workspace()!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("keeps observed exit ahead of an abort before the SDK rejection is consumed", async () => {
  const f = await setup();
  const controller = new AbortController();
  const outcome = f.service.execute(
    "inspect_android_package",
    { path: f.apk },
    { signal: controller.signal },
  );
  await f.request;
  f.process.exit();
  controller.abort("after physical exit");
  await f.cleanup;
  f.release();
  const result = await outcome;
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
});

const typedReason = () =>
  new AnalysisResourceConstraintError(
    "unrelated_operation",
    "memory",
    "caller-owned reason",
    null,
  );
const foreignCleanup = () =>
  new ProviderCleanupError("foreign", ["/foreign/owned-resource"], {
    reason: "foreign cleanup pending",
  });

it.each([
  null,
  "caller stopped",
  { caller: "exact reason" },
  typedReason(),
  foreignCleanup(),
  new z.ZodError([]),
  new StableFileHashFailure(
    "/foreign/source",
    new Error("foreign hash failed"),
  ),
])(
  "preserves first cancellation reason %j through later process errors and final output",
  async (reason) => {
    const f = await setup();
    const controller = new AbortController();
    const outcome = f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: controller.signal },
    );
    await f.request;
    controller.abort(reason);
    await f.cleanup;
    f.process.stdin.emit("error", new Error("later teardown error"));
    f.release();
    const result = await outcome;
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      capturedOutput: { stderr: "late startup diagnostic" },
    });
    expect(result.error.cause).toBe(reason);
  },
);

it("keeps a first deadline and its reason ahead of later caller cancellation", async () => {
  const f = await setup();
  const deadline = new AbortController();
  const caller = new AbortController();
  const reason = new Error("controlled first deadline");
  const clock = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(deadline.signal);
  try {
    const outcome = f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: caller.signal },
    );
    await f.request;
    deadline.abort(reason);
    await f.cleanup;
    caller.abort("later caller cancellation");
    f.release();
    const result = await outcome;
    if (result.ok) throw new Error("Expected timeout");
    expect(result.error).toMatchObject({
      _tag: "AnalysisTimeoutError",
      capturedOutput: { stderr: "late startup diagnostic" },
    });
    expect(result.error.cause).toBe(reason);
  } finally {
    clock.mockRestore();
  }
});

it.each([null, "admission stopped", { caller: "admission" }])(
  "preserves pre-admission cancellation reason %j",
  async (reason) => {
    const f = await setup();
    const caller = new AbortController();
    caller.abort(reason);
    const result = await f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("Expected admission cancellation");
    expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(result.error.cause).toBe(reason);
    expect(f.workspace()).toBeUndefined();
  },
);

it("retains an independently queued caller's exact cancellation reason", async () => {
  const f = await setup();
  const first = new AbortController();
  const queued = new AbortController();
  const active = f.service.execute(
    "inspect_android_package",
    { path: f.apk },
    { signal: first.signal },
  );
  await f.request;
  const target = await parseBinaryTarget(f.apk);
  if (!target.ok) throw target.error;
  const waiting = f.provider.execute(
    target.value,
    { operation: "inspect_android_package", input: { path: f.apk } },
    { signal: queued.signal },
  );
  const reason = { caller: "queued owner" };
  queued.abort(reason);
  const result = await waiting;
  if (result.ok) throw new Error("Expected queued cancellation");
  expect(result.error.cause).toBe(reason);
  first.abort("finish active fixture");
  await f.cleanup;
  f.release();
  expect(await active).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
});

it("preserves the frozen physical failure when the operation deadline elapses during cleanup", async () => {
  const f = await setup();
  const deadline = new AbortController();
  const clock = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(deadline.signal);
  try {
    const outcome = f.service.execute("inspect_android_package", {
      path: f.apk,
    });
    await f.request;
    f.process.exit();
    await f.cleanup;
    deadline.abort(new Error("controlled deadline"));
    f.release();
    const result = await outcome;
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        capturedOutput: { stderr: "late startup diagnostic" },
      },
    });
  } finally {
    clock.mockRestore();
  }
});

it("retains the startup primary across cleanup failure and retry", async () => {
  const f = await setup();
  f.failCleanup(true);
  const outcome = f.service.execute("inspect_android_package", { path: f.apk });
  await f.request;
  f.process.exit();
  await f.cleanup;
  f.process.stderr.write("available before failed cleanup");
  f.release();
  const result = await outcome;
  if (result.ok) throw new Error("Expected retained cleanup failure");
  const error = result.error;
  expect(error.cleanupIncomplete).toBe(true);
  expect(error.cleanupPrimary).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    capturedOutput: {
      stderr: "available before failed cleanup",
      truncated: true,
    },
  });
  expect(error.cleanupResources).toContain(f.workspace());
  f.failCleanup(false);
  await f.provider.close();
  expect(projectAnalysisError(error)).toMatchObject({
    code: "capability_unavailable",
    details: {
      captured_output: {
        stderr: "available before failed cleanup",
        truncated: true,
      },
    },
  });
  expect(error.cleanupResources).toEqual([]);
});

it("returns terminal startup diagnostics and partial identity through the MCP contract", async () => {
  const f = await setup();
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected native provider");
  });
  const server = createServer(
    { kind: "session", session },
    { androidAnalysis: f.provider },
  );
  const client = new Client({
    name: "jadx-startup-finalization",
    version: "1",
  });
  try {
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await client.connect(local);
    const pending = client.callTool({
      name: "inspect_android_package",
      arguments: { path: f.apk },
    });
    await f.request;
    f.process.exit();
    await f.cleanup;
    f.release();
    const response = await pending;
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "capability_unavailable",
      details: {
        captured_output: {
          stderr: "late startup diagnostic",
          truncated: false,
          exit_code: 17,
        },
        partial_observation: {
          provider_id: "jadx",
          target: { selected_path: f.apk },
        },
      },
    });
  } finally {
    f.release();
    await client.close();
    await server.close();
    await session.close();
  }
});

it("does not adopt a typed caller reason's foreign cleanup across failed retirement and retry", async () => {
  const f = await setup();
  const caller = new AbortController();
  const reason = foreignCleanup();
  f.failCleanup(true);
  const outcome = f.service.execute(
    "inspect_android_package",
    { path: f.apk },
    { signal: caller.signal },
  );
  await f.request;
  caller.abort(reason);
  await f.cleanup;
  f.release();
  const result = await outcome;
  if (result.ok) throw new Error("Expected cancellation with retained cleanup");
  expect(result.error.cleanupPrimary).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
  });
  expect(result.error.cleanupResources).not.toContain(
    "/foreign/owned-resource",
  );
  f.failCleanup(false);
  await f.provider.close();
  expect(projectAnalysisError(result.error).code).toBe("cancelled");
  expect(reason.cleanupIncomplete).toBe(true);
  expect(reason.cleanupResources).toEqual(["/foreign/owned-resource"]);
});

it("preserves an independently recorded typed physical failure sharing the later abort reason", async () => {
  const f = await setup();
  const caller = new AbortController();
  const reason = typedReason();
  const outcome = f.service.execute(
    "inspect_android_package",
    { path: f.apk },
    { signal: caller.signal },
  );
  await f.request;
  f.process.emit("error", reason);
  caller.abort(reason);
  await f.cleanup;
  f.release();
  const result = await outcome;
  if (result.ok) throw new Error("Expected physical failure");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
  });
  expect(result.error.cause).toBe(reason);
});

it("preserves typed cancellation at the completed-analysis handoff", async () => {
  const f = await createJadxProtocolFixture();
  const caller = new AbortController();
  const reason = typedReason();
  const execute = JadxSession.prototype.execute;
  const checkpoint = vi
    .spyOn(JadxSession.prototype, "execute")
    .mockImplementationOnce(async function (this: JadxSession, context) {
      const result = await execute.call(this, context);
      caller.abort(reason);
      return result;
    });
  try {
    const result = await f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: caller.signal },
    );
    if (result.ok)
      throw new Error("Expected cancellation at completion handoff");
    expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(result.error.cause).toBe(reason);
  } finally {
    checkpoint.mockRestore();
  }
});

it("normalizes a typed reason at the session's already-aborted checkpoint", async () => {
  const f = await createJadxProtocolFixture();
  const caller = new AbortController();
  const reason = foreignCleanup();
  const execute = JadxSession.prototype.execute;
  const checkpoint = vi
    .spyOn(JadxSession.prototype, "execute")
    .mockImplementationOnce(async function (this: JadxSession, context) {
      caller.abort(reason);
      return execute.call(this, context);
    });
  try {
    const result = await f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: caller.signal },
    );
    if (result.ok)
      throw new Error("Expected cancellation before session acquisition");
    expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(f.launches).toEqual([]);
    expect(reason.cleanupIncomplete).toBe(true);
    expect(reason.cleanupResources).toEqual(["/foreign/owned-resource"]);
  } finally {
    checkpoint.mockRestore();
  }
});

it("keeps a foreign file-cleanup abort reason opaque at the session checkpoint", async () => {
  const f = await createJadxProtocolFixture();
  const caller = new AbortController();
  const handle = await open(f.apk, "r");
  const owner = new OwnedFileHandle(handle);
  const reason = new RegularFileCleanupFailure({
    path: f.apk,
    owner,
    outcome: { kind: "failed", cause: new Error("foreign read failed") },
    cleanupCause: new Error("foreign close failed"),
  });
  const execute = JadxSession.prototype.execute;
  const checkpoint = vi
    .spyOn(JadxSession.prototype, "execute")
    .mockImplementationOnce(async function (this: JadxSession, context) {
      caller.abort(reason);
      return execute.call(this, context);
    });
  try {
    const result = await f.service.execute(
      "inspect_android_package",
      { path: f.apk },
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("Expected checkpoint cancellation");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cleanupIncomplete: false,
    });
    expect(result.error.cause).toBe(reason);
    // The foreign owner is still open and under this test's authority.
    expect((await handle.stat()).isFile()).toBe(true);
  } finally {
    checkpoint.mockRestore();
    await owner.close();
  }
});
