import { execFile } from "node:child_process";
import { writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  root: "",
  blocked: new Set<FileHandle>(),
  handles: [] as FileHandle[],
  onOpen: undefined as (() => void) | undefined,
  onClose: undefined as ((handle: FileHandle) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (!fault.root || !String(args[0]).startsWith(fault.root)) return handle;
      const close = handle.close.bind(handle);
      fault.handles.push(handle);
      fault.blocked.add(handle);
      handle.close = async () => {
        await fault.onClose?.(handle);
        if (fault.blocked.has(handle))
          throw new Error("controlled Cutter descriptor close failure");
        await close();
      };
      fault.onOpen?.();
      return handle;
    },
  };
});

import { CutterBridgeClient } from "../../src/cutter/CutterBridgeClient.js";
import { AnalysisCancelledError } from "../../src/domain/analysisErrorCore.js";
import { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../fixtures/lifecycleAcknowledgement.js";
import { cliTest } from "../support/cli/cliFixture.js";

beforeEach(() => {
  fault.root = "";
  fault.blocked.clear();
  fault.handles = [];
  fault.onClose = undefined;
  fault.onOpen = undefined;
});
afterEach(async () => {
  fault.blocked.clear();
  fault.onClose = undefined;
  for (const handle of fault.handles) await handle.close();
});

const descriptor = async (root: string, index: number) => {
  const session_id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const path = join(root, `cutter-${process.pid}-${session_id}.json`);
  await writeFile(
    path,
    JSON.stringify({
      session_id,
      pid: process.pid,
      host: "127.0.0.1",
      port: 9,
      token: "fixture-token-never-sent-to-network",
      document_generation: 0,
      current_file: null,
      cutter_version: null,
      identity_status: "partial",
    }),
    { mode: 0o600 },
  );
  return path;
};

cliTest.skipIf(process.platform === "win32")(
  "public CLI skips a named-pipe descriptor without waiting for a writer",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-cutter-fifo-");
    const fifo = join(
      root,
      "cutter-1-00000000-0000-4000-8000-000000000001.json",
    );
    await promisify(execFile)("mkfifo", [fifo]);
    const resultInvocation = await cli.run({
      arguments: ["list-cutter-sessions", "--json"],
      environment: {
        ...process.env,
        REA_CUTTER_BRIDGE_DIR: root,
      },
    });
    expect(resultInvocation.exitCode, resultInvocation.stderr).toBe(0);
    expect(resultInvocation.signal).toBeNull();
    const result = resultInvocation.json;
    expect(result).toMatchObject({
      sessions: [],
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    });
  },
);

it("retains exact failed descriptors and keeps aggregate status until every close succeeds", async () => {
  const root = await createTestTempDirectory("rea-cutter-descriptor-owners-");
  await Promise.all([descriptor(root, 1), descriptor(root, 2)]);
  fault.root = root;
  const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: root });
  try {
    const original = await client
      .listDescriptors()
      .catch((cause: unknown) => cause);
    if (!(original instanceof AnalysisError))
      throw new Error("Expected typed cleanup aggregate");
    expect(original.cleanupIncomplete).toBe(true);
    expect(original.cleanupResources).toHaveLength(2);
    expect(fault.handles).toHaveLength(2);
    const retry = await client
      .listDescriptors()
      .catch((cause: unknown) => cause);
    if (!(retry instanceof AnalysisError))
      throw new Error("Expected blocked retry");
    expect(fault.handles).toHaveLength(2);
    const [first, second] = fault.handles;
    if (first === undefined || second === undefined)
      throw new Error("Missing exact descriptors");
    fault.blocked.delete(first);
    const mixed = await client.close().catch((cause: unknown) => cause);
    if (!(mixed instanceof AnalysisError))
      throw new Error("Expected mixed cleanup failure");
    expect(first.fd).toBe(-1);
    expect(second.fd).toBeGreaterThanOrEqual(0);
    expect(original.cleanupIncomplete).toBe(true);
    expect(retry.cleanupIncomplete).toBe(true);
    expect(mixed.cleanupResources).toHaveLength(1);
    fault.blocked.clear();
    await client.close();
    expect(second.fd).toBe(-1);
    expect(original.cleanupIncomplete).toBe(false);
    expect(retry.cleanupIncomplete).toBe(false);
    expect(mixed.cleanupIncomplete).toBe(false);
  } finally {
    fault.blocked.clear();
    await client.close();
  }
});

it("shutdown waits for descriptor finalization before retrying retained cleanup", async () => {
  const root = await createTestTempDirectory(
    "rea-cutter-descriptor-finalization-",
  );
  await descriptor(root, 1);
  fault.root = root;
  let entered!: () => void;
  let release!: () => void;
  const closing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fault.onClose = async () => {
    entered();
    await gate;
  };
  const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: root });
  const reading = client.listDescriptors();
  let shutdown: Promise<void> | undefined;
  try {
    await awaitAcknowledgement(closing, reading, "descriptor finalization");
    let settled = false;
    shutdown = client.close().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    fault.blocked.clear();
    release();
    expect(await reading).toHaveLength(1);
    await shutdown;
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    release();
    fault.onClose = undefined;
    fault.blocked.clear();
    await Promise.allSettled([reading, ...(shutdown ? [shutdown] : [])]);
    await client.close();
  }
});

it.each([null, "primitive abort", new Error("selected abort")])(
  "preserves admission cancellation %s when descriptor close fails",
  async (reason) => {
    const root = await createTestTempDirectory("rea-cutter-cancel-admission-");
    await descriptor(root, 1);
    fault.root = root;
    const controller = new AbortController();
    fault.onOpen = () => controller.abort(reason);
    const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: root });
    try {
      const failure = await client
        .listSessions({ signal: controller.signal })
        .catch((cause: unknown) => cause);
      if (!(failure instanceof AnalysisError))
        throw new Error("Expected typed cancellation with cleanup");
      expect(failure.cleanupIncomplete).toBe(true);
      const aggregate = failure.cause;
      if (!(aggregate instanceof AggregateError))
        throw new Error("Missing primary cancellation");
      const primary = aggregate.errors[0];
      expect(primary).toBeInstanceOf(AnalysisCancelledError);
      expect(primary.cause).toBe(reason);
      fault.blocked.clear();
      await client.close();
      expect(failure.cleanupIncomplete).toBe(false);
      expect(primary.cause).toBe(reason);
    } finally {
      fault.blocked.clear();
      await client.close();
    }
  },
);

it("does not assign a peer's later cancellation to a descriptor that already failed close", async () => {
  const root = await createTestTempDirectory("rea-cutter-peer-finalization-");
  await Promise.all([descriptor(root, 1), descriptor(root, 2)]);
  fault.root = root;
  const controller = new AbortController();
  const reason = new Error("cancel after the first descriptor failure");
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fault.onClose = async (handle) => {
    if (handle === fault.handles[0]) return;
    entered();
    await gate;
  };
  const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: root });
  const reading = client
    .listSessions({ signal: controller.signal })
    .catch((cause: unknown) => cause);
  try {
    await awaitAcknowledgement(
      waiting,
      reading,
      "peer descriptor finalization",
    );
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(reason);
    release();
    const failure = await reading;
    if (
      !(failure instanceof AnalysisError) ||
      !(failure.cause instanceof AggregateError)
    )
      throw new Error("Expected mixed descriptor cleanup failures");
    const failures: unknown[] = failure.cause.errors;
    expect(failures).toHaveLength(2);
    const cancelled = failures.filter(
      (error): error is AnalysisError =>
        error instanceof AnalysisError &&
        error.cause instanceof AggregateError &&
        error.cause.errors[0] instanceof AnalysisCancelledError,
    );
    expect(cancelled).toHaveLength(1);
    const cancelledCause = cancelled[0]?.cause;
    if (!(cancelledCause instanceof AggregateError))
      throw new Error("Expected descriptor cancellation failure");
    expect(cancelledCause.errors[0].cause).toBe(reason);
    expect(failure.cleanupIncomplete).toBe(true);
    fault.blocked.clear();
    await client.close();
    expect(failure.cleanupIncomplete).toBe(false);
  } finally {
    release();
    fault.onClose = undefined;
    fault.blocked.clear();
    await reading;
    await client.close();
  }
});

it.each(["command", "completion"] as const)(
  "attributes retained descriptor cleanup to the requesting %s",
  async (operation) => {
    const root = await createTestTempDirectory(
      "rea-cutter-command-descriptor-",
    );
    await descriptor(root, 1);
    fault.root = root;
    const client = new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: root });
    try {
      const original =
        operation === "command"
          ? await client
              .execute({
                sessionId: "00000000-0000-4000-8000-000000000001",
                expectedGeneration: 0,
                command: "ij",
                json: false,
              })
              .catch((cause: unknown) => cause)
          : await client
              .confirmCommandCompletion(
                "00000000-0000-4000-8000-000000000001",
                "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
              )
              .then((result) => {
                if (result.ok) throw new Error("Expected descriptor failure");
                return result.error;
              });
      if (!(original instanceof AnalysisError))
        throw new Error("Expected typed descriptor cleanup");
      expect(projectAnalysisError(original)).toMatchObject({
        code: "cleanup_incomplete",
        details: { operation: "cutter_command" },
      });
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
      await expect(client.retryDescriptorCleanup()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      expect(original.cleanupIncomplete).toBe(true);
      fault.blocked.clear();
      await client.close();
      expect(fault.handles[0]?.fd).toBe(-1);
      expect(original.cleanupIncomplete).toBe(false);
    } finally {
      fault.blocked.clear();
      await client.close();
    }
  },
);
