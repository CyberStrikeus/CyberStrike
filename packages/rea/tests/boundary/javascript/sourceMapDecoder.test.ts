import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { webSourceMapReportSchema } from "../../../src/domain/webSourceLocation.js";
import { SourceMapDecoder } from "../../../src/javascript/sourceMaps/SourceMapDecoder.js";
import {
  SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
  type SourceMapDecoderDependencies,
} from "../../../src/javascript/sourceMaps/SourceMapCommand.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import {
  webSourceLocationArgs,
  webSourceLocationFixture,
} from "../../fixtures/webSourceLocation.js";

const realDecoder = (dependencies: SourceMapDecoderDependencies = {}) =>
  new SourceMapDecoder({
    ...dependencies,
    launcher:
      dependencies.launcher ??
      ((options) =>
        spawnOwnedProviderProcess({
          ...options,
          arguments: options.arguments.map((argument) =>
            argument.endsWith("/SourceMapCodecProcess.js") ||
            argument.endsWith("\\SourceMapCodecProcess.js")
              ? fileURLToPath(
                  new URL(
                    "../../../dist/javascript/sourceMaps/SourceMapCodecProcess.js",
                    import.meta.url,
                  ),
                )
              : argument,
          ),
        })),
  });

const fixture = webSourceLocationFixture();
const input = {
  text: fixture.sourceMap.text,
  url: fixture.sourceMap.url,
  path: fixture.sourceMap.file.path,
  position: webSourceLocationArgs.generated_position,
};

it("starts the codec deadline after cold ownership preparation", async () => {
  vi.useFakeTimers();
  try {
    let prepared = false;
    const responsePromise = realDecoder({
      prepareOwnership: async (signal) => {
        await vi.advanceTimersByTimeAsync(20_001);
        expect(signal?.aborted).not.toBe(true);
        prepared = true;
      },
      launcher: (options) => {
        expect(prepared).toBe(true);
        expect(options.signal?.aborted).not.toBe(true);
        return Promise.reject(new Error("observed launch after preparation"));
      },
    }).trace(input);
    const response = await responsePromise;
    if (response.ok) throw new Error("expected launch failure");
    expect(response.error).toMatchObject({
      diagnostics: { error_message: "observed launch after preparation" },
    });
  } finally {
    vi.useRealTimers();
  }
});

it("runs the real pinned codec with an independent heap and removes its private request directory", async () => {
  let path: string | undefined;
  const environment = {
    ...process.env,
    NODE_OPTIONS: "--require=/rea-file-that-does-not-exist",
  };
  const decoder = realDecoder({
    environment,
    createRuntime: async () => {
      const root = await PrivateRuntimeRoot.create();
      path = root.path;
      return root;
    },
  });
  const response = await decoder.trace(input);
  if (!response.ok) throw response.error;
  expect(response.value).toMatchObject({
    engine: { id: "jridgewell-trace-mapping", version: "0.3.31" },
    matches: [{ content: { text: "original" } }],
  });
  if (process.versions.bun === undefined) {
    expect(response.value.runtime).toMatchObject({
      id: "node-v8",
      version: process.version,
    });
    expect(response.value.runtime.v8_heap_limit_bytes).toBeLessThanOrEqual(
      256 * 1024 * 1024,
    );
  } else
    expect(response.value.runtime).toEqual({
      id: "bun",
      version: process.versions.bun,
      node_compatibility_version: process.versions.node,
      v8_heap_limit_bytes: null,
      // Windows enforces a Job Object commit limit in place of the heap flags.
      process_memory_limit_bytes: SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
    });
  expect(environment.NODE_OPTIONS).toBe(
    "--require=/rea-file-that-does-not-exist",
  );
  if (path === undefined) throw new Error("runtime not acquired");
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  { cancel: false, denyCleanup: false },
  { cancel: true, denyCleanup: false },
  { cancel: false, denyCleanup: true },
  { cancel: true, denyCleanup: true },
])(
  "retains completed real-codec matches through finalization (cancel=$cancel, denied=$denyCleanup)",
  async ({ cancel, denyCleanup }) => {
    const controller = new AbortController();
    const reason = { phase: "source-map root finalization" };
    let path: string | undefined;
    let cleanupAttempts = 0;
    const decoder = realDecoder({
      createRuntime: async () => {
        const root = await PrivateRuntimeRoot.create();
        path = root.path;
        return {
          path: root.path,
          close: async () => {
            cleanupAttempts += 1;
            if (cancel) controller.abort(reason);
            if (denyCleanup && cleanupAttempts === 1)
              throw new Error("controlled source-map cleanup denial");
            await root.close();
          },
        };
      },
    });
    try {
      const response = await decoder.trace(input, {
        signal: controller.signal,
      });
      expect(response.ok).toBe(!cancel && !denyCleanup);
      const report = webSourceMapReportSchema.parse(
        response.ok ? response.value : response.error.partialObservation,
      );
      expect(report).toMatchObject({
        source_map_sha256: fixture.sourceMap.file.sha256,
        url_context: input.url,
        lookup: { requested: input.position },
        matches: [{ state: "mapped", content: { text: "original" } }],
      });
      if (path === undefined) throw new Error("runtime not acquired");
      if (!response.ok) {
        expect(response.error).toMatchObject({
          operation: "trace_web_source_location",
        });
        expect(projectAnalysisError(response.error)).toMatchObject({
          details: { partial_observation: report },
        });
        if (cancel) {
          const primary = response.error.cleanupPrimary ?? response.error;
          expect(primary._tag).toBe("AnalysisCancelledError");
          expect(primary.cause).toBe(reason);
        }
        expect(response.error.cleanupIncomplete).toBe(denyCleanup);
        if (denyCleanup) {
          expect(response.error.cleanupResources).toEqual([path]);
          await expect(access(path)).resolves.toBeUndefined();
          await decoder.close();
          expect(cleanupAttempts).toBe(2);
          expect(response.error.cleanupIncomplete).toBe(false);
          expect(response.error.cleanupResources).toEqual([]);
          expect(response.error.partialObservation).toEqual(report);
        }
      }
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await decoder.close();
    }
  },
);

it.each([false, true])(
  "keeps the completed codec refusal primary over late cancellation (denied=%s)",
  async (denyCleanup) => {
    const controller = new AbortController();
    const reason = new Error("cancel after codec refusal");
    let cleanupAttempts = 0;
    const decoder = realDecoder({
      createRuntime: async () => {
        const root = await PrivateRuntimeRoot.create();
        return {
          path: root.path,
          close: async () => {
            cleanupAttempts += 1;
            controller.abort(reason);
            if (denyCleanup && cleanupAttempts === 1)
              throw new Error("controlled refusal cleanup denial");
            await root.close();
          },
        };
      },
    });
    try {
      const response = await decoder.trace(
        { ...input, text: "{" },
        { signal: controller.signal },
      );
      if (response.ok) throw new Error("Expected malformed-map refusal");
      expect(controller.signal.reason).toBe(reason);
      expect(response.error.cleanupPrimary ?? response.error).toBeInstanceOf(
        AnalysisInputError,
      );
      expect(response.error.partialObservation).toBeUndefined();
      expect(response.error.cleanupIncomplete).toBe(denyCleanup);
      await decoder.close();
      expect(response.error.cleanupIncomplete).toBe(false);
      expect(cleanupAttempts).toBe(denyCleanup ? 2 : 1);
    } finally {
      await decoder.close();
    }
  },
);

it.each([
  {
    failure: "malformed JSON",
    text: "{",
    error: {
      _tag: "AnalysisInputError",
      issues: [{ reason: "invalid_format" }],
    },
  },
  {
    failure: "external section",
    text: JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          url: "https://app.test/external.map",
        },
      ],
    }),
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      reason: "unsupported_source_map_profile",
      userMessage: expect.stringContaining("https://app.test/external.map"),
    },
  },
  {
    failure: "malformed embedded map before row admission",
    text: JSON.stringify({
      version: 3,
      sections: [{ offset: { line: 1000000000, column: 0 }, map: {} }],
    }),
    error: {
      _tag: "AnalysisInputError",
      issues: [
        {
          reason: "invalid_format",
          message: expect.stringContaining("not a version 3 map"),
        },
      ],
    },
  },
  {
    failure: "indexed row limit",
    text: JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 1000000000, column: 0 },
          map: JSON.parse(fixture.sourceMap.text) as unknown,
        },
      ],
    }),
    error: {
      _tag: "ArtifactOperationError",
      reason: "limit",
      detail: expect.stringContaining("generated-row decoder budget"),
    },
  },
])("preserves actual producer failures: $failure", async ({ text, error }) => {
  const response = await realDecoder().trace({ ...input, text });
  if (response.ok) throw new Error("expected failed map");
  expect(response.error).toMatchObject({
    operation: "trace_web_source_location",
    ...error,
  });
});

it("keeps indexed section overlap typed as a malformed source map", async () => {
  const text = JSON.stringify({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: {
          version: 3,
          sources: ["a.js"],
          sourcesContent: ["x();"],
          names: [],
          mappings: "AAAA,EAAA",
        },
      },
      {
        offset: { line: 0, column: 1 },
        map: {
          version: 3,
          sources: ["b.js"],
          sourcesContent: ["y();"],
          names: [],
          mappings: "AAAA",
        },
      },
    ],
  });
  const response = await realDecoder().trace({ ...input, text });
  if (response.ok) throw new Error("expected overlapping map rejection");
  expect(response.error).toBeInstanceOf(AnalysisInputError);
  if (!(response.error instanceof AnalysisInputError))
    throw new Error("expected malformed source-map input error");
  expect(response.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reason: "invalid_format",
        message: expect.stringContaining("overlap"),
      }),
    ]),
  );
});
it("cancels a real owned process and removes the runtime request", async () => {
  const controller = new AbortController();
  let path: string | undefined;
  const response = await realDecoder({
    createRuntime: async () => {
      const root = await PrivateRuntimeRoot.create();
      path = root.path;
      return root;
    },
    launcher: async (options) => {
      const child = await spawnOwnedProviderProcess({
        ...options,
        arguments: [
          "-e",
          'process.stdout.write("ready\\n"); setInterval(() => undefined, 1000)',
        ],
      });
      await waitForProviderProcessReady(child.process);
      setImmediate(() => controller.abort());
      return child;
    },
  }).trace(input, { signal: controller.signal });
  if (response.ok) throw new Error("expected cancellation");
  expect(response.error._tag).toBe("AnalysisCancelledError");
  if (path === undefined) throw new Error("runtime not acquired");
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});
it("retains final diagnostic bytes for an actual failed codec process", async () => {
  const response = await realDecoder({
    launcher: (options) =>
      spawnOwnedProviderProcess({
        ...options,
        arguments: [
          "-e",
          'process.stderr.write("final diagnostic"); process.exitCode = 7',
        ],
      }),
  }).trace(input);
  if (response.ok) throw new Error("expected exit failure");
  expect(response.error).toMatchObject({
    diagnostics: { exit_code: 7, stderr: "final diagnostic" },
  });
});
it("reports complete evidence amplification as a resource failure before serializing an oversized reply", async () => {
  const text = JSON.stringify({
    version: 3,
    sources: ["large.ts"],
    sourcesContent: ["a".repeat(600000)],
    names: [],
    mappings: Array.from({ length: 60 }, () => "AAAA").join(","),
  });
  const response = await realDecoder().trace({ ...input, text });
  if (response.ok) throw new Error("expected complete-evidence budget failure");
  expect(response.error).toMatchObject({
    _tag: "ArtifactOperationError",
    reason: "limit",
    detail: expect.stringContaining("no partial"),
  });
});
it("rejects a malformed actual subprocess reply", async () => {
  const response = await realDecoder({
    launcher: (options) =>
      spawnOwnedProviderProcess({
        ...options,
        arguments: ["-e", 'process.stdout.write("not JSON")'],
      }),
  }).trace(input);
  if (response.ok) throw new Error("expected malformed reply");
  expect(response.error._tag).toBe("AnalysisOutputError");
  expect(response.error.partialObservation).toBeUndefined();
});
it("rejects a codec report from a runtime other than the launching one", async () => {
  const actual = await realDecoder().trace(input);
  if (!actual.ok) throw actual.error;
  const replay = (report: unknown) =>
    realDecoder({
      launcher: (options) =>
        spawnOwnedProviderProcess({
          ...options,
          arguments: [
            "-e",
            `process.stdout.write(${JSON.stringify(JSON.stringify({ state: "success", report }))})`,
          ],
        }),
    }).trace(input);
  const unchanged = await replay(actual.value);
  if (!unchanged.ok) throw unchanged.error;
  expect(unchanged.value).toEqual(actual.value);
  const response = await replay({
    ...actual.value,
    runtime:
      actual.value.runtime.id === "bun"
        ? { id: "node-v8", version: "v24.18.0", v8_heap_limit_bytes: 1 }
        : {
            id: "bun",
            version: "1.4.2",
            node_compatibility_version: "24.18.0",
            v8_heap_limit_bytes: null,
            process_memory_limit_bytes: null,
          },
  });
  if (response.ok) throw new Error("expected runtime mismatch");
  expect(response.error._tag).toBe("AnalysisOutputError");
  expect(response.error.partialObservation).toBeUndefined();
  if (actual.value.runtime.id !== "bun") return;
  // A Bun codec must report exactly the process limit its launcher enforced.
  const limit = await replay({
    ...actual.value,
    runtime: {
      ...actual.value.runtime,
      process_memory_limit_bytes:
        SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES === null ? 4096 : null,
    },
  });
  if (limit.ok) throw new Error("expected process limit mismatch");
  expect(limit.error.message).toContain("process memory limit");
});
it.each([true, false])(
  "classifies a codec exit by the job memory notification (reached: %s)",
  async (reached) => {
    const response = await realDecoder({
      launcher: async ({ memoryLimitBytes, ...options }) => {
        expect(memoryLimitBytes).toBe(
          SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES ?? undefined,
        );
        // Without a job limit any artifact runs the child; its handle reports
        // the notification an owned Windows job records before exit.
        const spawned = await spawnOwnedProviderProcess({
          ...options,
          arguments: [
            "-e",
            'process.stderr.write("panic: out of memory"); process.exit(3)',
          ],
        });
        let exited = false;
        spawned.process.once("exit", () => {
          exited = true;
        });
        Object.defineProperty(spawned.process, "memoryLimitReached", {
          get: () => reached && exited,
        });
        return spawned;
      },
    }).trace(input);
    if (response.ok) throw new Error("expected codec failure");
    expect(response.error).toMatchObject(
      reached
        ? {
            _tag: "AnalysisResourceConstraintError",
            resource: "memory",
            reason: expect.stringContaining("process memory limit"),
            reportedLimits: {
              codec_process_memory_limit_bytes:
                SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
            },
            capturedOutput: { stderr: "panic: out of memory" },
          }
        : { diagnostics: { exit_code: 3, stderr: "panic: out of memory" } },
    );
  },
);
it("removes the private request when launching the codec fails", async () => {
  let path: string | undefined;
  const response = await realDecoder({
    createRuntime: async () => {
      const root = await PrivateRuntimeRoot.create();
      path = root.path;
      return root;
    },
    launcher: () => Promise.reject(new Error("observed launch failure")),
  }).trace(input);
  if (response.ok) throw new Error("expected launch failure");
  expect(response.error).toMatchObject({
    diagnostics: { error_message: "observed launch failure" },
  });
  if (path === undefined) throw new Error("runtime not acquired");
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});
