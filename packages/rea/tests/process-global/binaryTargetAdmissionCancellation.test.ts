import type { FileHandle } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

const admission = vi.hoisted(() => ({
  path: "",
  statCount: 0,
  abortAt: 0,
  controller: undefined as AbortController | undefined,
  reason: undefined as unknown,
  statFailure: undefined as Error | undefined,
  closeFailure: undefined as Error | undefined,
  handles: [] as FileHandle[],
  afterStat: undefined as ((count: number) => Promise<void>) | undefined,
}));

// Only control when cancellation arrives; preserve real open/stat/close IO.
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (args[0] !== admission.path) return handle;
      admission.handles.push(handle);
      const stat = handle.stat.bind(handle);
      const close = handle.close.bind(handle);
      handle.stat = (async (...options: Parameters<FileHandle["stat"]>) => {
        const metadata = await stat(...options);
        admission.statCount += 1;
        await admission.afterStat?.(admission.statCount);
        if (admission.statCount === admission.abortAt) {
          admission.controller?.abort(admission.reason);
          if (admission.statFailure !== undefined) throw admission.statFailure;
        }
        return metadata;
      }) as FileHandle["stat"];
      handle.close = async () => {
        if (admission.closeFailure !== undefined) {
          const failure = admission.closeFailure;
          admission.closeFailure = undefined;
          throw failure;
        }
        await close();
      };
      return handle;
    },
  };
});

import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { RegularFileOperationCancelled } from "../../src/filesystem/RegularFile.js";
import {
  RetainedRegularFileCleanupFailure,
  retryRegularFileCleanup,
} from "../../src/application/RegularFileRead.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { createApplicationMcpHarness } from "../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { advertisedMcpToolSchemas } from "../fixtures/advertisedMcpTool.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const fixture = async (abortAt: number, reason?: unknown) => {
  const root = await createTestTempDirectory("rea-target-admission-cancel-");
  const path = join(root, "sample.bin");
  await writeFile(path, "sample-bytes");
  const controller = new AbortController();
  Object.assign(admission, {
    path,
    abortAt,
    reason,
    statCount: 0,
    controller,
  });
  return { path, controller };
};

afterEach(async () => {
  admission.closeFailure = undefined;
  for (const handle of admission.handles)
    if (handle.fd >= 0) await handle.close();
  Object.assign(admission, {
    path: "",
    statCount: 0,
    abortAt: 0,
    controller: undefined,
    reason: undefined,
    statFailure: undefined,
    afterStat: undefined,
    handles: [],
  });
});

it.each([
  { checkpoint: 1, reason: undefined, name: "default" },
  { checkpoint: 1, reason: new Error("caller cancelled"), name: "Error" },
  { checkpoint: 1, reason: "caller cancelled", name: "string" },
  { checkpoint: 2, reason: undefined, name: "default" },
  { checkpoint: 2, reason: new Error("caller cancelled"), name: "Error" },
  { checkpoint: 2, reason: "caller cancelled", name: "string" },
])(
  "classifies $name cancellation at descriptor stat $checkpoint and closes the file",
  async ({ checkpoint, reason }) => {
    const { path, controller } = await fixture(checkpoint, reason);
    // A valid selected load reaches the second stat during hash finalization.
    const resolved = await parseBinaryTarget(path, {
      signal: controller.signal,
      formatHint: "raw-binary",
      architecture: "x86",
      entryPoint: "0x1000",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("cancelled target was admitted");
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "cancelled",
      category: "cancelled",
      retryable: true,
      details: { operation: "resolve_binary_target", cleanup: "complete" },
    });
    expect(admission.handles[0]?.fd).toBe(-1);
    expect(await readFile(path, "utf8")).toBe("sample-bytes");
  },
);

it("preserves unsupported-format diagnostics when admission is not cancelled", async () => {
  const { path, controller } = await fixture(0);
  const resolved = await parseBinaryTarget(path, {
    signal: controller.signal,
  });
  expect(resolved).toMatchObject({
    ok: false,
    error: { _tag: "BinaryTargetError", constraint: "file_format_rejected" },
  });
  expect(admission.handles[0]?.fd).toBe(-1);
});

it("does not replace an unrelated stat failure with cancellation", async () => {
  const { path, controller } = await fixture(1);
  const failure = Object.assign(new Error("disk read failed"), { code: "EIO" });
  admission.statFailure = failure;
  expect(
    await parseBinaryTarget(path, { signal: controller.signal }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "BinaryTargetError",
      cause: failure,
      reason: expect.stringContaining("(EIO)"),
    },
  });
  expect(admission.handles[0]?.fd).toBe(-1);
});

it("retains the cleanup failure and its file owner when cancelled admission cannot close", async () => {
  const reason = new Error("caller cancelled");
  const { path, controller } = await fixture(1, reason);
  const cleanup = new Error("descriptor close failed");
  admission.closeFailure = cleanup;
  const result = await parseBinaryTarget(path, {
    signal: controller.signal,
  });
  if (result.ok) throw new Error("Expected typed admission cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  const failure = result.error.cause;
  expect(failure).toBeInstanceOf(RetainedRegularFileCleanupFailure);
  if (!(failure instanceof RetainedRegularFileCleanupFailure)) throw failure;
  expect(failure.outcome.kind).toBe("failed");
  if (failure.outcome.kind !== "failed")
    throw new Error("Expected failed admission");
  expect(failure.outcome.cause).toBeInstanceOf(RegularFileOperationCancelled);
  if (!(failure.outcome.cause instanceof RegularFileOperationCancelled))
    throw failure.outcome.cause;
  expect(failure.outcome.cause.reason).toBe(reason);
  expect(failure.cleanupCause).toBe(cleanup);
  expect(failure.owner.handle).toBe(admission.handles[0]);
  expect(failure.owner.handle.fd).toBeGreaterThanOrEqual(0);
  const resources = new ArtifactResourceScope();
  await retryRegularFileCleanup(failure, resources);
  await resources.close();
  expect(failure.owner.handle.fd).toBe(-1);
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("settles SDK cancellation at the admission boundary and reuses the same MCP connection", async () => {
  const { path, controller } = await fixture(0);
  const createClient = vi.fn(() => {
    throw new Error("native provider must not start during target admission");
  });
  const session = createTestBinarySession(createClient);
  const harness = await createApplicationMcpHarness({ session });
  let resume = () => {};
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let reached = () => {};
  const firstStat = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let finished = (_result: unknown) => {};
  const completed = new Promise<unknown>((resolve) => {
    finished = resolve;
  });
  let cancelled = () => {};
  const serverCancelled = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const open = session.open.bind(session);
  vi.spyOn(session, "open").mockImplementation((input, options) => {
    options?.signal?.addEventListener("abort", cancelled, { once: true });
    return open(input, options).then(
      (result) => {
        finished(result);
        return result;
      },
      (cause: unknown) => {
        finished(cause);
        throw cause;
      },
    );
  });
  onTestFinished(async () => {
    resume();
    vi.restoreAllMocks();
    await harness.close();
  });
  admission.afterStat = async (count) => {
    if (count === 1) {
      reached();
      await resumed;
    }
  };
  const { client } = harness;
  const { name, ajv, inputSchema } = await advertisedMcpToolSchemas(
    client,
    "open_binary",
  );
  const args = { path };
  expect(ajv.validate(inputSchema, args)).toBe(true);
  const request = client
    .callTool({ name, arguments: args }, { signal: controller.signal })
    .then(
      () => "completed",
      (cause: unknown) => cause,
    );
  await firstStat;
  await client.ping();
  controller.abort(new Error("SDK target cancellation"));
  expect(await request).toMatchObject({
    message: expect.stringContaining("SDK target cancellation"),
  });
  await serverCancelled;
  resume();
  const settled = await completed;
  expect(settled).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      operation: "resolve_binary_target",
    },
  });
  expect(admission.handles[0]?.fd).toBe(-1);
  expect(createClient).not.toHaveBeenCalled();
  await client.ping();
  const retry = await client.callTool({ name, arguments: args });
  expect(parseMcpToolError(retry)).toMatchObject({
    error: {
      code: "target_unavailable",
      details: { constraint: "file_format_rejected" },
    },
  });
  await client.ping();
  expect(await readFile(path, "utf8")).toBe("sample-bytes");
  expect(admission.handles.every((handle) => handle.fd === -1)).toBe(true);
});
