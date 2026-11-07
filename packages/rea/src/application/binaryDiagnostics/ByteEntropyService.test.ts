import { createHash } from "node:crypto";
import { open, stat, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { byteEntropySchema } from "../../domain/native/byteEntropy.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  ByteEntropyService,
  MAX_BYTE_ENTROPY_BLOCKS,
} from "./ByteEntropyService.js";

it("keeps whole-file identity and entropy while selecting unaligned blocks and a partial tail", async () => {
  const root = await createTestTempDirectory("rea-entropy-");
  const path = join(root, "bytes");
  const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
  await writeFile(path, bytes);
  const result = await new ByteEntropyService().inspect({
    path,
    offset: 3,
    length: 513,
    block_size: 256,
  });
  if (!result.ok) throw result.error;
  const report = byteEntropySchema.parse(result.value.normalized_result);
  expect(report.blocks).toEqual([
    { offset: 3, length: 256, entropy: 8 },
    { offset: 259, length: 256, entropy: 8 },
    { offset: 515, length: 1, entropy: 0 },
  ]);
  expect(report.file_entropy).toBe(8);
  expect(report.artifact).toEqual({
    path,
    bytes: 1024,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  expect(result.value.subject?.digest.sha256).toBe(report.artifact.sha256);
  expect(result.value.confidence).toBe("observed");
});

it.each([256, 4096, 65536])(
  "keeps %i-byte blocks relative to an unaligned window across short physical reads",
  async (blockSize) => {
    const root = await createTestTempDirectory("rea-entropy-short-reads-");
    const path = join(root, "bytes");
    const bytes = Buffer.from(
      Array.from({ length: 3 * 65536 + 256 }, (_, i) => i % 256),
    );
    await writeFile(path, bytes);
    let reads = 0;
    const service = new ByteEntropyService({
      stat,
      open: async (...args) => {
        const file = await open(...args);
        const read = file.read.bind(file);
        Object.defineProperty(file, "read", {
          value: async (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ) => {
            reads += 1;
            return read(buffer, offset, Math.min(length, 3571), position);
          },
        });
        return file;
      },
    });
    try {
      const result = await service.inspect({
        path,
        offset: 3,
        length: 2 * 65536 + 1,
        block_size: blockSize,
      });
      if (!result.ok) throw result.error;
      const report = byteEntropySchema.parse(result.value.normalized_result);
      const fullBlocks = (2 * 65536) / blockSize;
      expect(report.blocks).toEqual([
        ...Array.from({ length: fullBlocks }, (_, i) => ({
          offset: 3 + i * blockSize,
          length: blockSize,
          entropy: 8,
        })),
        { offset: 3 + 2 * 65536, length: 1, entropy: 0 },
      ]);
      expect(report.runs).toEqual([
        { offset: 3, length: 2 * 65536, classification: "high" },
        { offset: 3 + 2 * 65536, length: 1, classification: "low" },
      ]);
      expect(report.file_entropy).toBe(8);
      expect(report.artifact.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      // Even with 3,571-byte short reads, finer report resolution does not
      // require hundreds of asynchronous reads of this 193 KiB file.
      expect(reads).toBeLessThan(100);
    } finally {
      await service.close();
    }
  },
);

it("rejects missing files, non-files and windows beyond EOF, but accepts empty windows", async () => {
  const root = await createTestTempDirectory("rea-entropy-input-");
  const path = join(root, "empty");
  await writeFile(path, "");
  const service = new ByteEntropyService();
  for (const input of [
    { path: join(root, "missing") },
    { path: root },
    { path, offset: 1 },
    { path, length: 1 },
    { path: "relative" },
  ]) {
    const result = await service.inspect(input);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  }
  const result = await service.inspect({ path });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    blocks: [],
    runs: [],
    file_entropy: 0,
    window: { offset: 0, length: 0 },
  });
  expect(
    byteEntropySchema.parse(result.value.normalized_result).limitations,
  ).toContainEqual(expect.stringContaining("reports a size of 0"));
});

it.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "projects real path-resolution failures as actionable input errors",
  async () => {
    const root = await createTestTempDirectory("rea-entropy-path-resolution-");
    const loop = join(root, "loop");
    await symlink("loop", loop);
    const overlong = join(root, "x".repeat(256));
    const cases = [
      [loop, "ELOOP"],
      [overlong, "ENAMETOOLONG"],
    ] as const;
    const service = new ByteEntropyService();
    try {
      for (const [path, code] of cases) {
        let observedCode: unknown;
        try {
          await stat(path);
        } catch (cause: unknown) {
          observedCode =
            cause instanceof Error && "code" in cause ? cause.code : undefined;
        }
        expect(observedCode).toBe(code);

        const result = await service.inspect({ path });
        if (result.ok) throw new Error(`Expected ${code} path failure`);
        expect(result.error).toMatchObject({
          _tag: "AnalysisInputError",
          cause: { code },
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
            },
          ],
        });
        const projected = projectAnalysisError(result.error);
        expect(projected).toMatchObject({
          code: "invalid_request",
          recovery: {
            kind: "inspect_input_contract",
            operation: "inspect_byte_entropy",
          },
          details: {
            operation: "inspect_byte_entropy",
            issues: [
              {
                path: ["path"],
                reason: "invalid_value",
                message: expect.stringContaining(code),
              },
            ],
          },
        });
        expect(JSON.stringify(projected.details)).toContain(path);
      }
    } finally {
      await service.close();
    }
  },
);

it.each([
  [{ offset: 2048 }, "offset"],
  [{ offset: 2048, length: 0 }, "offset"],
  [{ offset: 512, length: 1024 }, "length"],
])("names the selector that puts %o past EOF", async (window, field) => {
  const root = await createTestTempDirectory("rea-entropy-window-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(1024));
  const result = await new ByteEntropyService().inspect({ path, ...window });
  if (result.ok) throw new Error("Expected an out-of-file window to fail");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: { issues: [{ path: [field], reason: "invalid_value" }] },
  });
});

it.skipIf(process.platform !== "linux")(
  "marks a generated /proc file that reports size 0 as not shown empty",
  async () => {
    const result = await new ByteEntropyService().inspect({
      path: "/proc/version",
    });
    if (!result.ok) throw result.error;
    const report = byteEntropySchema.parse(result.value.normalized_result);
    expect(report.artifact.bytes).toBe(0);
    expect(report.limitations).toContainEqual(
      expect.stringContaining("Linux /proc entries"),
    );
  },
);

it("adds no zero-size limitation to a file with content", async () => {
  const root = await createTestTempDirectory("rea-entropy-nonempty-");
  const path = join(root, "one");
  await writeFile(path, "x");
  const result = await new ByteEntropyService().inspect({ path });
  if (!result.ok) throw result.error;
  expect(
    byteEntropySchema
      .parse(result.value.normalized_result)
      .limitations.join(" "),
  ).not.toContain("reports a size of 0");
});

it("honors cancellation before and during streaming", async () => {
  const root = await createTestTempDirectory("rea-entropy-cancel-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(1024 * 1024));
  const service = new ByteEntropyService();
  const reason = { request: "opaque cancellation" };
  const before = await service.inspect(
    { path },
    { signal: AbortSignal.abort(reason) },
  );
  if (before.ok) throw new Error("Expected cancellation before admission");
  expect(before.error.cause).toBe(reason);
  expect(before.error.partialObservation).toBeUndefined();
  const controller = new AbortController();
  let reads = 0;
  const streaming = new ByteEntropyService({
    stat,
    open: async (...args) => {
      const file = await open(...args);
      const read = file.read.bind(file);
      vi.spyOn(file, "read").mockImplementation(async (...readArgs) => {
        const result = await read(...readArgs);
        reads += 1;
        controller.abort(reason);
        return result;
      });
      return file;
    },
  });
  const pending = streaming.inspect(
    { path, block_size: 256 },
    { signal: controller.signal },
  );
  const during = await pending;
  if (during.ok) throw new Error("Expected cancellation during read");
  expect(during.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(during.error.cause).toBe(reason);
  expect(during.error.partialObservation).toBeUndefined();
  expect(reads).toBe(1);
});

it("maps cancellation during open to the cancelled algebra with its original cause", async () => {
  const root = await createTestTempDirectory("rea-entropy-open-cancel-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(512));
  const controller = new AbortController();
  const reason = new Error("cancelled while opening");
  const service = new ByteEntropyService({
    stat,
    open: async (...args) => {
      const file = await open(...args);
      controller.abort(reason);
      return file;
    },
  });

  const result = await service.inspect(
    { path, block_size: 256 },
    { signal: controller.signal },
  );

  if (result.ok) throw new Error("Expected cancellation during open");
  expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(result.error.cause).toBe(reason);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
  });
  await service.close();
});

it.each([false, true])(
  "retains completed Evidence when final close is cancelled (close fails: %s)",
  async (closeFails) => {
    const root = await createTestTempDirectory("rea-entropy-finalizer-cancel-");
    const path = join(root, "bytes");
    await writeFile(path, Buffer.alloc(512));
    const controller = new AbortController();
    const reason = new Error("cancelled during close");
    const closeFailure = new Error("injected close failure");
    let failClose = closeFails;
    let closes = 0;
    const service = new ByteEntropyService({
      stat,
      open: async (...args) => {
        const file = await open(...args);
        const close = file.close.bind(file);
        vi.spyOn(file, "close").mockImplementation(async () => {
          closes += 1;
          controller.abort(reason);
          if (failClose) throw closeFailure;
          await close();
        });
        return file;
      },
    });

    const result = await service.inspect(
      { path, block_size: 256 },
      { signal: controller.signal },
    );

    if (result.ok) throw new Error("Expected cancellation during finalization");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cleanupIncomplete: closeFails,
    });
    expect(result.error.cause).toBe(reason);
    const evidence = result.error.partialObservation;
    expect(evidence).toMatchObject({
      operation: "inspect_byte_entropy",
      confidence: "observed",
      normalized_result: {
        artifact: {
          path,
          bytes: 512,
          sha256: createHash("sha256").update(Buffer.alloc(512)).digest("hex"),
        },
        window: { offset: 0, length: 512 },
        file_entropy: 0,
        blocks: [
          { offset: 0, length: 256, entropy: 0 },
          { offset: 256, length: 256, entropy: 0 },
        ],
      },
    });
    expect(closes).toBe(1);
    if (closeFails) {
      expect(result.error.secondaryFailures).toMatchObject([
        { _tag: "AnalysisOutputError", cleanupIncomplete: true },
      ]);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
        retryable: false,
        details: { cleanup: "incomplete", execution_failure: "cancelled" },
      });
    } else {
      expect(result.error.secondaryFailures).toEqual([]);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cancelled",
      });
    }
    failClose = false;
    await service.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.partialObservation).toBe(evidence);
    expect(closes).toBe(closeFails ? 2 : 1);
  },
);

it("reports a changed artifact when its parent directory moves during streaming", async () => {
  const root = await createTestTempDirectory("rea-entropy-moved-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(512));
  let moved = false;
  const service = new ByteEntropyService({
    stat,
    open: async (...args) => {
      const file = await open(...args);
      const read = file.read.bind(file);
      vi.spyOn(file, "read").mockImplementation(async (...readArgs) => {
        const result = await read(...readArgs);
        if (!moved) {
          moved = true;
          await rename(root, `${root}-moved`);
        }
        return result;
      });
      return file;
    },
  });
  try {
    expect(await service.inspect({ path, block_size: 256 })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
  } finally {
    if (moved) await rename(`${root}-moved`, root);
  }
});

it("refuses a block series above the output-row limit before scanning", async () => {
  const root = await createTestTempDirectory("rea-entropy-block-limit-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(MAX_BYTE_ENTROPY_BLOCKS * 256 + 1));
  let reads = 0;
  const service = new ByteEntropyService({
    stat,
    open: async (...args) => {
      const file = await open(...args);
      vi.spyOn(file, "read").mockImplementation(async () => {
        reads += 1;
        return { bytesRead: 0, buffer: Buffer.alloc(0) };
      });
      return file;
    },
  });

  const result = await service.inspect({ path, block_size: 256 });

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      resource: "capacity",
      reportedLimits: {
        max_blocks: MAX_BYTE_ENTROPY_BLOCKS,
        requested_blocks: MAX_BYTE_ENTROPY_BLOCKS + 1,
      },
    },
  });
  if (result.ok) throw new Error("Expected a capacity refusal");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    remediation: {
      action: expect.stringMatching(/shorter window|increase block_size/i),
    },
  });
  expect(reads).toBe(0);
  await service.close();
});

it("retains a failed descriptor close and retries it before opening another file", async () => {
  const root = await createTestTempDirectory("rea-entropy-close-retry-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(512));
  let failClose = true;
  let opens = 0;
  const service = new ByteEntropyService({
    stat,
    open: async (...args) => {
      opens += 1;
      const file = await open(...args);
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => {
        if (failClose) throw new Error("injected close failure");
        await close();
      });
      return file;
    },
  });

  const first = await service.inspect({ path, block_size: 256 });
  if (first.ok) throw new Error("Expected the first close to fail");
  expect(first.error).toMatchObject({
    _tag: "AnalysisOutputError",
    cleanupIncomplete: true,
  });
  const observation = first.error.partialObservation;
  expect(observation).toMatchObject({
    operation: "inspect_byte_entropy",
    normalized_result: { artifact: { path, bytes: 512 }, file_entropy: 0 },
  });
  expect(opens).toBe(1);

  const retryDenied = await service.inspect({ path, block_size: 256 });
  expect(retryDenied).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError", cleanupIncomplete: true },
  });
  expect(opens).toBe(1);

  failClose = false;
  const recovered = await service.inspect({ path, block_size: 256 });
  expect(recovered.ok).toBe(true);
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(first.error.partialObservation).toBe(observation);
  expect(opens).toBe(2);
  await service.close();
});

it("preserves a primary read failure through failed close and resolves it on retry", async () => {
  const root = await createTestTempDirectory("rea-entropy-primary-close-");
  const path = join(root, "bytes");
  await writeFile(path, Buffer.alloc(512));
  const readFailure = new Error("injected read failure");
  let failClose = true;
  let failRead = true;
  const service = new ByteEntropyService({
    stat,
    open: async (...args) => {
      const file = await open(...args);
      const read = file.read.bind(file);
      const close = file.close.bind(file);
      vi.spyOn(file, "read").mockImplementation(async (...readArgs) => {
        if (failRead) throw readFailure;
        return await read(...readArgs);
      });
      vi.spyOn(file, "close").mockImplementation(async () => {
        if (failClose) throw new Error("injected close failure");
        await close();
      });
      return file;
    },
  });

  const first = await service.inspect({ path, block_size: 256 });
  if (first.ok) throw new Error("Expected the read and close to fail");
  expect(first.error).toMatchObject({
    cleanupIncomplete: true,
    cleanupPrimary: { _tag: "AnalysisOutputError" },
  });
  expect(first.error.cleanupPrimary?.cause).toBe(readFailure);
  expect(first.error.cause).toBeDefined();

  failClose = false;
  failRead = false;
  const recovered = await service.inspect({ path, block_size: 256 });
  expect(recovered.ok).toBe(true);
  expect(first.error.cleanupIncomplete).toBe(false);
  await service.close();
});

it.each(["stat", "open"] as const)(
  "preserves %s access failure when the signal aborts before rejection is consumed",
  async (stage) => {
    const root = await createTestTempDirectory("rea-entropy-physical-failure-");
    const path = join(root, "bytes");
    await writeFile(path, Buffer.alloc(512));
    const controller = new AbortController();
    const failure = Object.assign(new Error("access denied"), {
      code: "EACCES",
    });
    const reject = async () => {
      controller.abort({ request: "late cancellation" });
      throw failure;
    };
    const service = new ByteEntropyService({
      stat: stage === "stat" ? reject : stat,
      open: stage === "open" ? reject : open,
    });
    const result = await service.inspect(
      { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected access failure");
    expect(result.error).toMatchObject({ _tag: "AnalysisAccessDeniedError" });
    expect(result.error.cause).toBe(failure);
    expect(result.error.partialObservation).toBeUndefined();
    await service.close();
  },
);

it.each([false, true])(
  "preserves read access failure through late cancellation (close fails: %s)",
  async (closeFails) => {
    const root = await createTestTempDirectory("rea-entropy-read-access-");
    const path = join(root, "bytes");
    await writeFile(path, Buffer.alloc(512));
    const controller = new AbortController();
    const failure = Object.assign(new Error("read access denied"), {
      code: "EACCES",
    });
    let failClose = closeFails;
    const service = new ByteEntropyService({
      stat,
      open: async (...args) => {
        const file = await open(...args);
        const close = file.close.bind(file);
        vi.spyOn(file, "read").mockImplementation(async () => {
          controller.abort({ request: "late cancellation" });
          throw failure;
        });
        vi.spyOn(file, "close").mockImplementation(async () => {
          if (failClose) throw new Error("close denied");
          await close();
        });
        return file;
      },
    });
    const result = await service.inspect(
      { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected read failure");
    const primary = result.error.cleanupPrimary ?? result.error;
    expect(primary).toMatchObject({ _tag: "AnalysisAccessDeniedError" });
    expect(primary.cause).toBe(failure);
    expect(result.error.cleanupIncomplete).toBe(closeFails);
    expect(result.error.partialObservation).toBeUndefined();
    failClose = false;
    await service.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  },
);
