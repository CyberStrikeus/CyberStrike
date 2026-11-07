import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  appendFile,
  open,
  mkdir,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  selected: "",
  handles: [] as FileHandle[],
  blocked: new Set<FileHandle>(),
  onClose: undefined as (() => Promise<void>) | undefined,
  malformed: false,
  onSync: undefined as (() => void) | undefined,
  onRead: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (
        !fault.selected ||
        !String(args[0]).endsWith(fault.selected) ||
        typeof args[1] !== "number"
      )
        return handle;
      const close = handle.close.bind(handle);
      const sync = handle.sync.bind(handle);
      const read = handle.read.bind(handle);
      handle.read = (async (...args: Parameters<FileHandle["read"]>) => {
        const result: Awaited<ReturnType<FileHandle["read"]>> =
          await Reflect.apply(read, handle, args);
        await fault.onRead?.();
        return result;
      }) as FileHandle["read"];
      handle.sync = async () => {
        await sync();
        fault.onSync?.();
      };
      fault.handles.push(handle);
      fault.blocked.add(handle);
      handle.close = async () => {
        await fault.onClose?.();
        if (fault.blocked.has(handle))
          throw new Error("controlled firmware descriptor close failure");
        await close();
      };
      return handle;
    },
  };
});
// Only host/tool admission and producer execution are simulated. File IO,
// normalization, provider finalization and cleanup ownership remain production code.
vi.mock("../../src/firmware/FirmwareCommand.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/firmware/FirmwareCommand.js")
    >();
  return {
    ...original,
    resolveFirmwareCommand: async () => {
      const { selectArtifactCommandPath } =
        await import("../../src/process/ArtifactCommandPath.js");
      const command = await selectArtifactCommandPath(process.execPath);
      return {
        command,
        limiter: command,
        sha256: "0".repeat(64),
        fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      };
    },
    runFirmwareCommand: async (
      context: Parameters<typeof original.runFirmwareCommand>[0],
    ) => {
      const version = context.args[0] === "--version";
      if (!version) {
        const report = context.args[context.args.indexOf("--log") + 1];
        if (report === undefined)
          throw new Error("Missing fixture report path");
        await writeFile(
          report,
          fault.malformed
            ? "{"
            : JSON.stringify([
                {
                  Analysis: {
                    file_path: context.args.at(-1),
                    file_map: [],
                    extractions: {},
                  },
                },
              ]),
        );
      }
      const text = version ? "binwalk 3.1.0" : "";
      return {
        stdout: { text, bytes: Buffer.byteLength(text), truncated: false },
        stderr: { text: "", bytes: 0, truncated: false },
        exit_code: 0,
        signal: null,
        command: context.command,
        args: context.args,
        resource_limiter: context.limiter,
      };
    },
  };
});

import { FirmwareFileAccess } from "../../src/firmware/FirmwareFiles.js";
import { publishFirmwareExtraction } from "../../src/firmware/FirmwarePublication.js";
import { normalizeUnblobReport } from "../../src/firmware/FirmwareReports.js";
import { SafeOutputTree } from "../../src/artifacts/SafeOutputTree.js";
import { AnalysisCleanupLease } from "../../src/artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../../src/artifacts/ArtifactReader.js";
import { FirmwareProvider } from "../../src/firmware/FirmwareProvider.js";
import { firmwareFailure } from "../../src/firmware/FirmwareFailures.js";
import { ArtifactFileCleanupFailure } from "../../src/artifacts/ArtifactFileOperation.js";
import { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../../src/domain/analysisErrorCore.js";
import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import { FIRMWARE_LIMITS } from "../../src/firmware/FirmwareRelease.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { firmwareRequestSchema } from "../../src/domain/firmware/firmwareAnalysis.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const providers: FirmwareProvider[] = [];
beforeEach(() => {
  fault.selected = "";
  fault.handles = [];
  fault.blocked.clear();
  fault.onClose = undefined;
  fault.malformed = false;
  fault.onSync = undefined;
  fault.onRead = undefined;
});
afterEach(async () => {
  fault.blocked.clear();
  fault.onClose = undefined;
  fault.onRead = undefined;
  vi.restoreAllMocks();
  for (const handle of fault.handles) await handle.close();
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

it.each(["snapshot", "range"] as const)(
  "preserves a native read failure when cancellation follows the same pending %s read",
  async (stage) => {
    const root = await createTestTempDirectory("rea-firmware-read-race-");
    const path = join(root, "input.bin");
    const work = join(root, "work");
    await mkdir(work);
    await writeFile(path, "firmware bytes");
    const controller = new AbortController();
    const failure = Object.assign(new Error("physical firmware read failed"), {
      code: "EIO",
    });
    fault.selected = stage === "snapshot" ? path : "firmware.bin";
    fault.onRead = async () => {
      fault.onRead = undefined;
      controller.abort("cancellation after physical read failure");
      throw failure;
    };
    const files = new FirmwareFileAccess();
    try {
      const raw = await files
        .snapshot(
          firmwareRequestSchema.parse({
            operation: "extract_firmware",
            input: {
              path,
              output_directory: join(root, "unused"),
              max_depth: 3,
              max_output_bytes: 1024,
              max_output_files: 10,
              ...(stage === "range" ? { range: { offset: 1, length: 4 } } : {}),
            },
          }),
          work,
          controller.signal,
        )
        .catch((cause: unknown) => cause);
      expect(raw).toBeInstanceOf(ArtifactFileCleanupFailure);
      if (!(raw instanceof ArtifactFileCleanupFailure)) throw raw;
      expect(raw.fileCleanupFailure.outcome).toEqual({
        kind: "failed",
        cause: failure,
      });
      expect(fault.handles).toHaveLength(1);
      expect(raw.fileCleanupFailure.owner.handle).toBe(fault.handles[0]);
      expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
      fault.blocked.clear();
      await files.retryCleanup();
      expect(fault.handles[0]?.fd).toBe(-1);
    } finally {
      fault.blocked.clear();
      await files.close();
    }
  },
);

it("copies a stable firmware file exactly at the input allowance", async () => {
  const root = await createTestTempDirectory("rea-firmware-exact-input-");
  const path = join(root, "input.bin");
  const work = join(root, "work");
  await mkdir(work);
  const prepared = await open(path, "wx");
  try {
    await prepared.truncate(FIRMWARE_LIMITS.inputBytes);
  } finally {
    await prepared.close();
  }
  const files = new FirmwareFileAccess();
  try {
    const snapshot = await files.snapshot(
      { operation: "inspect_firmware_regions", input: { path } },
      work,
      new AbortController().signal,
    );
    expect(snapshot.size).toBe(FIRMWARE_LIMITS.inputBytes);
    expect(snapshot.selection).toMatchObject({
      length: FIRMWARE_LIMITS.inputBytes,
      sha256: snapshot.subject.sha256,
    });
    const copied = await open(snapshot.inputPath, "r");
    try {
      expect((await copied.stat()).size).toBe(FIRMWARE_LIMITS.inputBytes);
    } finally {
      await copied.close();
    }
  } finally {
    await files.close();
  }
});

it.each(
  (["inspect_firmware_regions", "extract_firmware"] as const).flatMap(
    (operation) => [false, true].map((denyClose) => ({ operation, denyClose })),
  ),
)(
  "keeps typed input growth and exact descriptor ownership for $operation (close denied=$denyClose)",
  async ({ operation, denyClose }) => {
    const root = await createTestTempDirectory("rea-firmware-growth-");
    const path = join(root, "input.bin");
    const work = join(root, "work");
    await mkdir(work);
    const prepared = await open(path, "wx");
    try {
      await prepared.truncate(FIRMWARE_LIMITS.inputBytes);
    } finally {
      await prepared.close();
    }
    fault.selected = path;
    if (!denyClose)
      fault.onClose = async () => {
        fault.blocked.clear();
      };
    fault.onRead = async () => {
      fault.onRead = undefined;
      await appendFile(path, Buffer.from([1]));
    };
    const request = firmwareRequestSchema.parse(
      operation === "inspect_firmware_regions"
        ? { operation, input: { path } }
        : {
            operation,
            input: {
              path,
              output_directory: join(root, "unused"),
              max_depth: 3,
              max_output_bytes: 1024,
              max_output_files: 10,
            },
          },
    );
    const files = new FirmwareFileAccess();
    try {
      const raw = await files
        .snapshot(request, work, new AbortController().signal)
        .catch((cause: unknown) => cause);
      if (denyClose) expect(raw).toBeInstanceOf(ArtifactFileCleanupFailure);
      const error = firmwareFailure(raw, { engine: "binwalk", operation });
      const projected = projectAnalysisError(error);
      expect(projected.code).toBe(
        denyClose ? "cleanup_incomplete" : "invalid_request",
      );
      const primary = denyClose ? error.diagnostics?.primary_error : projected;
      expect(primary).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "out_of_range",
              message: expect.stringContaining(
                String(FIRMWARE_LIMITS.inputBytes),
              ),
            },
          ],
        },
      });
      expect(fault.handles).toHaveLength(1);
      if (denyClose) {
        expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
        fault.blocked.clear();
        await files.retryCleanup();
        expect(error.cleanupIncomplete).toBe(false);
        expect(error.diagnostics?.primary_error).toMatchObject({
          code: "invalid_request",
        });
        expect(projectAnalysisError(error).code).toBe("invalid_request");
      }
      expect(fault.handles[0]?.fd).toBe(-1);
    } finally {
      fault.blocked.clear();
      await files.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects writerless FIFO input, hash and report through the compiled reader",
  async () => {
    const root = await createTestTempDirectory("rea-firmware-fifo-");
    const fifo = join(root, "input.fifo");
    const work = join(root, "work");
    await mkdir(work);
    await promisify(execFile)("mkfifo", [fifo]);
    const module = pathToFileURL(
      join(process.cwd(), "dist/firmware/FirmwareFiles.js"),
    ).href;
    const script = `import { FirmwareFileAccess } from ${JSON.stringify(module)};
    const files = new FirmwareFileAccess();
    const outcomes = [];
    for (const run of [() => files.hash(process.argv[1]), () => files.report(process.argv[1], 'inspect_firmware_regions'), () => files.snapshot({ operation: 'inspect_firmware_regions', input: { path: process.argv[1] } }, process.argv[2], new AbortController().signal)]) {
      try { await run(); outcomes.push('unexpected-success'); } catch (error) { outcomes.push(error._tag ?? error.name); }
    }
    await files.close(); console.log(JSON.stringify(outcomes));`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script, fifo, work],
      { timeout: 3000 },
    );
    expect(JSON.parse(stdout)).toEqual([
      "NonRegularFileReadError",
      "AnalysisOutputError",
      "AnalysisInputError",
    ]);
  },
);

it.each(["hash", "report"] as const)(
  "retains completed %s and exact owner across rejected retry",
  async (kind) => {
    const root = await createTestTempDirectory("rea-firmware-read-owner-");
    const path = join(root, "selected.bin");
    await writeFile(path, '{"value":"固件"}');
    fault.selected = path;
    const files = new FirmwareFileAccess();
    const raw = await (
      kind === "hash"
        ? files.hash(path)
        : files.report(path, "inspect_firmware_regions")
    ).catch((cause: unknown) => cause);
    expect(raw).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(raw instanceof ArtifactFileCleanupFailure))
      throw new Error("Missing physical file outcome");
    expect(raw.fileCleanupFailure.outcome).toEqual({
      kind: "completed",
      value:
        kind === "hash"
          ? createHash("sha256").update('{"value":"固件"}').digest("hex")
          : { value: "固件" },
    });
    const original = firmwareFailure(raw, {
      engine: "binwalk",
      operation: "inspect_firmware_regions",
    });
    const retry = await files.retryCleanup().catch((cause: unknown) =>
      firmwareFailure(cause, {
        engine: "binwalk",
        operation: "inspect_firmware_regions",
      }),
    );
    expect(retry).toBeInstanceOf(AnalysisError);
    expect(fault.handles).toHaveLength(1);
    const handle = fault.handles[0];
    if (handle === undefined) throw new Error("Missing exact descriptor");
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    fault.blocked.delete(handle);
    await files.close();
    expect(handle.fd).toBe(-1);
    expect(original.cleanupIncomplete).toBe(false);
    if (retry instanceof AnalysisError)
      expect(retry.cleanupIncomplete).toBe(false);
  },
);

it("preserves malformed-report failure when cancellation arrives during failed close", async () => {
  const root = await createTestTempDirectory("rea-firmware-primary-");
  const path = join(root, "report.json");
  await writeFile(path, "{");
  fault.selected = path;
  const controller = new AbortController();
  fault.onClose = async () => controller.abort("late close cancellation");
  const files = new FirmwareFileAccess();
  const raw = await files
    .report(path, "inspect_firmware_regions", controller.signal)
    .catch((cause: unknown) => cause);
  const error = firmwareFailure(raw, {
    engine: "binwalk",
    operation: "inspect_firmware_regions",
  });
  expect(error.diagnostics?.primary_error).toMatchObject({
    code: "unreadable_output",
  });
  fault.blocked.clear();
  await files.close();
  expect(error.cleanupIncomplete).toBe(false);
});

it.each([null, "caller cancellation", new Error("caller cancellation")])(
  "preserves exact cancellation during final close: %s",
  async (reason) => {
    const root = await createTestTempDirectory("rea-firmware-final-cancel-");
    const path = join(root, "report.json");
    await writeFile(path, "{}");
    fault.selected = path;
    const controller = new AbortController();
    fault.onClose = async () => {
      controller.abort(reason);
      fault.blocked.clear();
    };
    const files = new FirmwareFileAccess();
    const raw = await files
      .report(path, "inspect_firmware_regions", controller.signal)
      .catch((cause: unknown) => cause);
    const error = firmwareFailure(raw, {
      engine: "binwalk",
      operation: "inspect_firmware_regions",
    });
    expect(
      error,
      error instanceof Error ? error.stack : String(error),
    ).toBeInstanceOf(AnalysisCancelledError);
    expect(error.cause).toBe(reason);
    await files.close();
  },
);

it.each(["descriptor-first", "workspace-first"])(
  "keeps provider mixed-owner cleanup incomplete until both release: %s",
  async (order) => {
    const root = await createTestTempDirectory("rea-firmware-mixed-owner-");
    const path = join(root, "input.bin");
    await writeFile(path, "firmware bytes");
    fault.selected = "report.json";
    let workspaceBlocked = true;
    let workspacePath = "";
    const close = PrivateRuntimeRoot.prototype.close;
    vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementation(
      async function (this: PrivateRuntimeRoot) {
        workspacePath = this.path;
        if (workspaceBlocked)
          throw new Error("controlled workspace cleanup failure");
        await close.call(this);
      },
    );
    const provider = new FirmwareProvider({});
    providers.push(provider);
    const result = await provider.execute({
      operation: "inspect_firmware_regions",
      input: { path },
    });
    if (result.ok) throw new Error("Expected descriptor and workspace failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(workspacePath);
    expect(fault.handles).toHaveLength(1);
    const blocked = await provider.execute({
      operation: "inspect_firmware_regions",
      input: { path },
    });
    expect(blocked).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(fault.handles).toHaveLength(1);
    if (order === "descriptor-first") fault.blocked.clear();
    else workspaceBlocked = false;
    const retry = await provider.close().catch((cause: unknown) => cause);
    expect(retry).toBeInstanceOf(AnalysisError);
    expect(result.error.cleanupIncomplete).toBe(true);
    if (order === "workspace-first")
      await expect(access(workspacePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    else expect(fault.handles[0]?.fd).toBe(-1);
    fault.blocked.clear();
    workspaceBlocked = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    if (retry instanceof AnalysisError)
      expect(retry.cleanupIncomplete).toBe(false);
    if (!blocked.ok) expect(blocked.error.cleanupIncomplete).toBe(false);
  },
);

it("retains completed firmware observation when cancellation arrives during workspace close", async () => {
  const root = await createTestTempDirectory("rea-firmware-workspace-cancel-");
  const path = join(root, "input.bin");
  await writeFile(path, "firmware bytes");
  const controller = new AbortController();
  const close = PrivateRuntimeRoot.prototype.close;
  vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementation(
    async function (this: PrivateRuntimeRoot) {
      controller.abort(null);
      await close.call(this);
    },
  );
  const provider = new FirmwareProvider({});
  providers.push(provider);
  const result = await provider.execute(
    { operation: "inspect_firmware_regions", input: { path } },
    { signal: controller.signal },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      cause: null,
      partialObservation: { kind: "firmware" },
    },
  });
});

it.skipIf(process.platform === "win32").each(["snapshot", "report"] as const)(
  "retains typed %s admission failure when rejecting a directory also fails close",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-firmware-rejected-admission-",
    );
    const path = join(root, "selected");
    const work = join(root, "work");
    await mkdir(path);
    await mkdir(work);
    fault.selected = path;
    const files = new FirmwareFileAccess();
    const raw = await (
      kind === "snapshot"
        ? files.snapshot(
            { operation: "inspect_firmware_regions", input: { path } },
            work,
            new AbortController().signal,
          )
        : files.report(path, "inspect_firmware_regions")
    ).catch((cause: unknown) => cause);
    const error = firmwareFailure(raw, {
      engine: "binwalk",
      operation: "inspect_firmware_regions",
    });
    expect(error.diagnostics?.primary_error).toMatchObject({
      code: kind === "snapshot" ? "invalid_request" : "unreadable_output",
    });
    expect(error.cleanupIncomplete).toBe(true);
    fault.blocked.clear();
    await files.close();
    expect(error.cleanupIncomplete).toBe(false);
  },
);

it.each([false, true])(
  "retains timeout during workspace finalization (close fails: %s)",
  async (closeFails) => {
    const root = await createTestTempDirectory("rea-firmware-final-timeout-");
    const path = join(root, "input.bin");
    await writeFile(path, "firmware bytes");
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    let blocked = closeFails;
    const close = PrivateRuntimeRoot.prototype.close;
    vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementation(
      async function (this: PrivateRuntimeRoot) {
        deadline.abort(new DOMException("controlled deadline", "TimeoutError"));
        if (blocked)
          throw new Error("controlled final workspace close failure");
        await close.call(this);
      },
    );
    const provider = new FirmwareProvider({});
    providers.push(provider);
    const result = await provider.execute({
      operation: "inspect_firmware_regions",
      input: { path },
    });
    if (result.ok) throw new Error("Expected timeout");
    expect(result.error.partialObservation).toMatchObject({ kind: "firmware" });
    if (closeFails) {
      expect(result.error.diagnostics?.primary_error).toMatchObject({
        code: "provider_timeout",
      });
      expect(result.error.cleanupIncomplete).toBe(true);
      blocked = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } else
      expect(result.error).toMatchObject({
        _tag: "AnalysisTimeoutError",
        cause: deadline.signal.reason,
      });
  },
);

it("classifies a deadline before composing failed descriptor cleanup", async () => {
  const root = await createTestTempDirectory("rea-firmware-file-timeout-");
  const path = join(root, "report.json");
  await writeFile(path, "{}");
  fault.selected = path;
  const deadline = new AbortController();
  fault.onClose = async () =>
    deadline.abort(new DOMException("controlled deadline", "TimeoutError"));
  const files = new FirmwareFileAccess();
  const raw = await files
    .report(path, "inspect_firmware_regions", deadline.signal)
    .catch((cause: unknown) => cause);
  const error = firmwareFailure(raw, {
    engine: "binwalk",
    operation: "inspect_firmware_regions",
    deadline: {
      phase: "analysis",
      signal: deadline.signal,
      timeoutMs: 120_000,
      expiresAtMs: performance.now() + 120_000,
    },
  });
  expect(error.diagnostics?.primary_error).toMatchObject({
    code: "provider_timeout",
  });
  fault.blocked.clear();
  await files.close();
  expect(error.cleanupIncomplete).toBe(false);
});

const publication = async (
  signal: AbortSignal,
  deadline = {
    phase: "publication" as const,
    signal: new AbortController().signal,
    timeoutMs: 120_000,
    expiresAtMs: performance.now() + 120_000,
  },
) => {
  const root = await createTestTempDirectory(
    "rea-firmware-publication-lifetime-",
  );
  const inputPath = join(root, "input.bin");
  const outputRoot = join(root, "extracted");
  const sha256 = "0".repeat(64);
  const normalized = normalizeUnblobReport(
    [
      {
        task: {
          path: inputPath,
          depth: 0,
          blob_id: "root",
          is_multi_file: false,
        },
        reports: [
          { __typename__: "HashReport", sha256 },
          {
            __typename__: "StatReport",
            path: inputPath,
            size: 8,
            is_dir: false,
            is_file: true,
            is_link: false,
            link_target: null,
          },
        ],
        subtasks: [],
      },
    ],
    { inputPath, outputRoot, sha256, length: 8, offset: 0, maxDepth: 3 },
  );
  const retained: AnalysisCleanupLease[] = [];
  const workspacePath = join(root, "private");
  await mkdir(workspacePath);
  const context = {
    files: new FirmwareFileAccess(),
    workspacePath,
    deadline,
    analysisTimeoutMs: 120_000,
    outputDirectory: join(root, "published"),
    entries: [],
    normalized,
    selection: { offset: 0, length: 8, sha256 },
    maxDepth: 3,
    engine: {
      name: "unblob",
      version: "26.6.4",
      executable_path: "/fixture/unblob",
      executable_sha256: sha256,
      source_revision: null,
      worker_count: 1 as const,
    },
    signal,
    retainCleanup: (
      _tree: SafeOutputTree,
      lease: AnalysisCleanupLease,
      failure: AnalysisError,
    ) => {
      const workspace = new AnalysisCleanupLease(() =>
        rm(workspacePath, { recursive: true, force: true }),
      );
      workspace.bindCleanupError(failure);
      retained.push(
        new AnalysisCleanupLease(async () => {
          await lease.release();
          await workspace.release();
        }),
      );
    },
  };
  return { context, retained };
};

it("preserves primitive cancellation before publication commit and rolls back the output", async () => {
  const controller = new AbortController();
  const fixture = await publication(controller.signal);
  const create = SafeOutputTree.create;
  vi.spyOn(SafeOutputTree, "create").mockImplementation(async (...args) => {
    const tree = await create.call(SafeOutputTree, ...args);
    controller.abort(null);
    return tree;
  });
  const error = await publishFirmwareExtraction(fixture.context).catch(
    (cause: unknown) => cause,
  );
  expect(
    error,
    error instanceof Error ? error.stack : String(error),
  ).toBeInstanceOf(AnalysisCancelledError);
  if (error instanceof AnalysisCancelledError) expect(error.cause).toBeNull();
  await expect(access(fixture.context.outputDirectory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(fixture.retained).toHaveLength(0);
  await fixture.context.files.close();
});

it.each(["caller", "deadline"])(
  "preserves %s cancellation during directory sync plus failed close and rollback",
  async (kind) => {
    const controller = new AbortController();
    const reason =
      kind === "caller"
        ? null
        : new DOMException("controlled deadline", "TimeoutError");
    const fixture = await publication(
      controller.signal,
      kind === "deadline"
        ? {
            phase: "publication" as const,
            signal: controller.signal,
            timeoutMs: 120_000,
            expiresAtMs: performance.now() + 120_000,
          }
        : undefined,
    );
    const create = SafeOutputTree.create;
    let outputTree: SafeOutputTree | undefined;
    vi.spyOn(SafeOutputTree, "create").mockImplementation(async (...args) => {
      const tree = await create.call(SafeOutputTree, ...args);
      outputTree = tree;
      fault.selected = tree.outputRoot;
      fault.onSync = () => controller.abort(reason);
      return tree;
    });
    const error = await publishFirmwareExtraction(fixture.context).catch(
      (cause: unknown) => cause,
    );
    expect(outputTree?.published).toBe(false);
    if (!(error instanceof AnalysisError))
      throw new Error("Expected typed tree failure");
    expect(
      error.cleanupIncomplete,
      JSON.stringify(projectAnalysisError(error)),
    ).toBe(true);
    expect(error.diagnostics?.primary_error).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error: {
            code: kind === "caller" ? "cancelled" : "provider_timeout",
          },
        },
      },
    });
    const aggregate = error.cause;
    if (!(aggregate instanceof AggregateError))
      throw new Error("Expected primary and cleanup causes");
    const primary = aggregate.errors[0] as AnalysisError;
    const inner = primary.cause;
    if (!(inner instanceof AggregateError))
      throw new Error("Expected primary cancellation plus commit cleanup");
    expect((inner.errors[0] as AnalysisError).cause).toBe(reason);
    expect(fixture.retained).toHaveLength(1);
    fault.blocked.clear();
    await Promise.all(fixture.retained.map((lease) => lease.release()));
    expect(error.cleanupIncomplete).toBe(false);
    await expect(access(fixture.context.outputDirectory)).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    await fixture.context.files.close();
  },
);

it("retains a completed published observation when commit cleanup and rollback both fail", async () => {
  const fixture = await publication(new AbortController().signal);
  const commit = SafeOutputTree.prototype.commit;
  vi.spyOn(SafeOutputTree.prototype, "commit").mockImplementation(
    async function (this: SafeOutputTree, signal) {
      await commit.call(this, signal);
      throw ArtifactReaderFailure.withCleanup(
        new Error("controlled published commit cleanup failure"),
        {
          reason: "controlled pending directory close",
          resources: [this.outputRoot],
        },
      );
    },
  );
  const rollback = SafeOutputTree.prototype.rollback;
  let blocked = true;
  vi.spyOn(SafeOutputTree.prototype, "rollback").mockImplementation(
    async function (this: SafeOutputTree) {
      if (blocked) throw new Error("controlled rollback failure");
      return rollback.call(this);
    },
  );
  const error = await publishFirmwareExtraction(fixture.context).catch(
    (cause: unknown) => cause,
  );
  if (!(error instanceof AnalysisError))
    throw new Error("Expected typed publication cleanup failure");
  expect(error.partialObservation).toMatchObject({
    kind: "firmware",
    result: { output_directory: fixture.context.outputDirectory, files: [] },
  });
  expect(error.cleanupIncomplete).toBe(true);
  blocked = false;
  await Promise.all(fixture.retained.map((lease) => lease.release()));
  expect(error.cleanupIncomplete).toBe(false);
  await expect(
    access(fixture.context.outputDirectory),
  ).resolves.toBeUndefined();
  await fixture.context.files.close();
});

it("waits through selected-range snapshot finalization when shutdown starts during source close", async () => {
  const root = await createTestTempDirectory("rea-firmware-selected-close-");
  const path = join(root, "input.bin");
  const work = join(root, "work");
  await mkdir(work);
  await writeFile(path, "firmware bytes");
  fault.selected = path;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fault.onClose = async () => {
    fault.blocked.clear();
    enter();
    await gate;
  };
  const files = new FirmwareFileAccess();
  const pending = files.snapshot(
    firmwareRequestSchema.parse({
      operation: "extract_firmware",
      input: {
        path,
        output_directory: join(root, "unused"),
        max_depth: 3,
        max_output_bytes: 1024,
        max_output_files: 10,
        range: { offset: 1, length: 4 },
      },
    }),
    work,
    new AbortController().signal,
  );
  try {
    await entered;
    let closed = false;
    const closing = files.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    release();
    const snapshot = await pending;
    await closing;
    expect(snapshot.selection).toMatchObject({
      offset: 1,
      length: 4,
      sha256: createHash("sha256").update("irmw").digest("hex"),
    });
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    release();
    await pending.catch(() => {});
    await files.close();
  }
});

it("retains the exact publication source descriptor when its final close fails", async () => {
  const fixture = await publication(new AbortController().signal);
  const path = join(fixture.context.workspacePath, "source.bin");
  const bytes = Buffer.from("published bytes");
  await writeFile(path, bytes);
  const tree = await SafeOutputTree.create(fixture.context.outputDirectory);
  fault.selected = path;
  const raw = await fixture.context.files
    .publish(
      {
        path,
        relativePath: "file.bin",
        size: bytes.length,
        kind: "file",
        linkTarget: null,
      },
      createHash("sha256").update(bytes).digest("hex"),
      tree,
      fixture.context.signal,
    )
    .catch((cause: unknown) => cause);
  expect(raw).toBeInstanceOf(ArtifactFileCleanupFailure);
  const error = firmwareFailure(raw, {
    engine: "unblob",
    operation: "extract_firmware",
  });
  expect(error.cleanupResources).toContain(path);
  await tree.rollback();
  expect(error.cleanupIncomplete).toBe(true);
  fault.blocked.clear();
  await fixture.context.files.close();
  expect(error.cleanupIncomplete).toBe(false);
  expect(fault.handles[0]?.fd).toBe(-1);
});

it.each(["source-first", "tree-first"])(
  "keeps nested source and destination cleanup bound to their exact owners: %s",
  async (order) => {
    const fixture = await publication(new AbortController().signal);
    const path = join(fixture.context.workspacePath, "payload.bin");
    const bytes = Buffer.from("published bytes");
    await writeFile(path, bytes);
    const hash = fixture.context.files.hash.bind(fixture.context.files);
    vi.spyOn(fixture.context.files, "hash").mockImplementation(
      async (...args) => {
        const digest = await hash(...args);
        fault.selected = "payload.bin";
        return digest;
      },
    );
    const error = await publishFirmwareExtraction({
      ...fixture.context,
      entries: [
        {
          path,
          relativePath: "payload.bin",
          size: bytes.length,
          kind: "file",
          linkTarget: null,
        },
      ],
    }).catch((cause: unknown) => cause);
    if (!(error instanceof AnalysisError))
      throw new Error("Expected nested file and tree cleanup failure");
    expect(error.cleanupIncomplete).toBe(true);
    expect(fault.handles.length).toBeGreaterThanOrEqual(2);
    expect(fixture.retained).toHaveLength(1);
    fault.blocked.clear();
    if (order === "source-first") await fixture.context.files.close();
    else await Promise.all(fixture.retained.map((lease) => lease.release()));
    expect(error.cleanupIncomplete).toBe(true);
    await fixture.context.files.close();
    await Promise.all(fixture.retained.map((lease) => lease.release()));
    expect(error.cleanupIncomplete).toBe(false);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it("shares one workspace cleanup attempt across concurrent shutdown callers", async () => {
  const root = await createTestTempDirectory("rea-firmware-concurrent-close-");
  const path = join(root, "input.bin");
  await writeFile(path, "firmware bytes");
  let blocked = true;
  let attempts = 0;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = PrivateRuntimeRoot.prototype.close;
  vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementation(
    async function (this: PrivateRuntimeRoot) {
      attempts++;
      if (blocked) throw new Error("controlled first workspace close failure");
      enter();
      await gate;
      await close.call(this);
    },
  );
  const provider = new FirmwareProvider({});
  providers.push(provider);
  const result = await provider.execute({
    operation: "inspect_firmware_regions",
    input: { path },
  });
  if (result.ok) throw new Error("Expected retained workspace cleanup");
  blocked = false;
  const first = provider.close();
  try {
    await entered;
    const second = provider.close();
    expect(second).toBe(first);
    expect(attempts).toBe(2);
    release();
    await Promise.all([first, second]);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    release();
    await first;
  }
});
