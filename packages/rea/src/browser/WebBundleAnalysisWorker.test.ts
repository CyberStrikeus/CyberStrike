import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { expect, it } from "vitest";

import { createWebTextArtifact } from "../domain/webContentArtifact.js";
import type { IncludedScript } from "../domain/webBundleAnalyzerState.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import {
  resolvedAnalysisError,
  type AnalysisError,
} from "../domain/analysisErrorBase.js";
import { javaScriptRuntime } from "../domain/runtimeVersion.js";
import {
  webBundleHeapExhaustedReason,
  webBundleHeapExhaustedRemediation,
  webBundleMemoryExhaustion,
} from "../domain/webBundleAnalysis.js";
import { javaScriptWorkerMemoryLimitBytes } from "../process/JavaScriptWorkerMemoryLimit.js";
import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessHandle,
} from "../process/ProviderProcess.js";
import { WebBundleAnalysisWorker } from "./WebBundleAnalysisWorker.js";
import { WEB_BUNDLE_WORKER_LIMITS } from "./WebBundleAnalysisWorkerProtocol.js";

const makeScript = (text: string): IncludedScript => ({
  script_key: `scr_${createHash("sha256").update(text).digest("hex")}`,
  frame_id: "frame-1",
  url: "https://app.example.test/app.js",
  origin: "https://app.example.test",
  cdp_hash: null,
  length: Buffer.byteLength(text),
  is_module: false,
  language: "JavaScript",
  source_map_url: null,
  resource_reconciliation: {
    status: "unmatched",
    reason: "no_exact_sanitized_url",
  },
  source: {
    included: true,
    artifact: createWebTextArtifact(text, "application/javascript"),
  },
});

const sourceWorkerProgram = (
  hangMarker?: string,
  oomMarker?: string,
  stderrMarker?: string,
): string => `
  const { serveWebBundleAnalysisWorker } = await import(${JSON.stringify(new URL("./WebBundleAnalysisWorkerServer.ts", import.meta.url).href)});
  const { analyzeCapturedWebScript } = await import(${JSON.stringify(new URL("../domain/webBundleAnalyzer.ts", import.meta.url).href)});
  const analyze = (script) => {
    if (${JSON.stringify(hangMarker)} !== undefined && script.source.artifact.text === ${JSON.stringify(hangMarker)}) {
      for (;;) {}
    }
    if (${JSON.stringify(oomMarker)} !== undefined && script.source.artifact.text === ${JSON.stringify(oomMarker)}) {
      const retained = [];
      for (;;) retained.push(new Array(50_000).fill({ marker: "bounded-child-oom" }));
    }
    if (${JSON.stringify(stderrMarker)} !== undefined)
      process.stderr.write(${JSON.stringify(stderrMarker)} + "\\n");
    return analyzeCapturedWebScript(script);
  };
  await serveWebBundleAnalysisWorker(analyze);
`;

type TestMode =
  | {
      readonly kind: "source";
      readonly hangMarker?: string;
      readonly oomMarker?: string;
      readonly stderrMarker?: string;
    }
  | {
      readonly kind: "result";
      readonly encoding:
        | "invalid-utf8"
        | "replacement"
        | "bom"
        | "malformed-json";
    }
  | { readonly kind: "delayed-ready" }
  | { readonly kind: "exit-before-ready" }
  | {
      readonly kind: "protocol";
      readonly failure:
        | "wrong-id"
        | "oversized-control"
        | "oversized-result"
        | "late-failure"
        | "exit-7"
        | "truncated-exit"
        | "abort-first-exit"
        | "tail-exit"
        | "malformed"
        | "wrong-job-failure"
        | "resource-failure"
        | "final-frame-held-pipe"
        | "zero-exit-held-pipe"
        | "heap-exit";
    };

const protocolWorkerProgram = (
  failure:
    | "wrong-id"
    | "oversized-control"
    | "oversized-result"
    | "late-failure"
    | "exit-7"
    | "truncated-exit"
    | "abort-first-exit"
    | "tail-exit"
    | "malformed"
    | "wrong-job-failure"
    | "resource-failure"
    | "final-frame-held-pipe"
    | "zero-exit-held-pipe"
    | "heap-exit",
): string => `
  import { createInterface } from "node:readline";
  import { spawn } from "node:child_process";
  import { getHeapStatistics } from "node:v8";
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
  send({ kind: "ready", heap_limit_bytes: getHeapStatistics().heap_size_limit });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.once("line", (line) => {
    const request = JSON.parse(line);
    ${
      failure === "heap-exit"
        ? `process.stderr.write("allocation failed\\n", () => process.exit(7));`
        : failure === "zero-exit-held-pipe"
          ? `const program = "setTimeout(() => process.exit(0), 300);";
           spawn(process.execPath, ["-e", program], { stdio: ["ignore", "inherit", "inherit"] });
           process.exit(0);`
          : failure === "exit-7"
            ? `process.stderr.write("controlled exit 7\\n", () => process.exit(7));`
            : failure === "tail-exit"
              ? `const lateProgram = "setTimeout(() => { process.stderr.write('late tail marker'); setTimeout(() => process.exit(0), 500); }, 50);";
             spawn(process.execPath, ["-e", lateProgram], { stdio: ["ignore", "ignore", "inherit"] });
             process.stderr.write("early exit marker\\n", () => process.exit(7));`
              : failure === "truncated-exit"
                ? `process.stderr.write("x".repeat(300 * 1024), () => process.exit(7));`
                : failure === "abort-first-exit"
                  ? `process.stderr.write("late natural exit 7\\n", () => process.exit(7));`
                  : failure === "malformed"
                    ? `process.stdout.write("{not-json}\\n"); setInterval(() => {}, 1_000);`
                    : failure === "wrong-job-failure"
                      ? `send({ kind: "failure", id: ${JSON.stringify(randomUUID())}, reason: "output", message: "failure for another request" });
               setInterval(() => {}, 1_000);`
                      : failure === "resource-failure"
                        ? `send({ kind: "failure", id: request.id, reason: "resource", message: "bounded result capacity" });
                 setInterval(() => {}, 1_000);`
                        : failure === "final-frame-held-pipe"
                          ? `const frame = JSON.stringify({ kind: "failure", id: request.id, reason: "output", message: "final frame from descendant" });
               const program = "setTimeout(() => { process.stdout.write(" + JSON.stringify(frame + "\\n") + "); setInterval(() => {}, 1000); }, 100);";
               spawn(process.execPath, ["-e", program], { stdio: ["ignore", "inherit", "inherit"] });
               process.exit(7);`
                          : failure === "late-failure"
                            ? `process.stdout.write(JSON.stringify({ kind: "failure", id: request.id, reason: "output", message: "failure frame before abort" }) + "\\n");
           setInterval(() => {}, 1_000);`
                            : failure === "wrong-id"
                              ? `send({ kind: "phase", id: ${JSON.stringify(randomUUID())}, phase: "analyze" });`
                              : failure === "oversized-control"
                                ? `process.stdout.write("x".repeat(70 * 1024) + "\\n");`
                                : `send({ kind: "complete", id: request.id, result: { bytes: request.result_budget_bytes + 1, sha256: "${"0".repeat(64)}" } });`
    }
  });
`;

const resultWorkerProgram = (encoding: string): string => `
  import { readFile, writeFile } from "node:fs/promises";
  import { createHash } from "node:crypto";
  import { createInterface } from "node:readline";
  import { getHeapStatistics } from "node:v8";
  const { analyzeCapturedWebScript } = await import(${JSON.stringify(new URL("../domain/webBundleAnalyzer.ts", import.meta.url).href)});
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
  send({ kind: "ready", heap_limit_bytes: getHeapStatistics().heap_size_limit });
  createInterface({ input: process.stdin, crlfDelay: Infinity }).once("line", async (line) => {
    const request = JSON.parse(line);
    const script = JSON.parse(await readFile(request.id + ".source", "utf8"));
    const facts = analyzeCapturedWebScript(script);
    let bytes = Buffer.from(JSON.stringify(facts));
    const encoding = ${JSON.stringify(encoding)};
    if (encoding === "invalid-utf8") {
      const index = bytes.indexOf(Buffer.from("result-marker"));
      if (index < 0) throw new Error("Expected endpoint marker in schema-valid facts");
      bytes[index] = 0xff;
    } else if (encoding === "bom") bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
    else if (encoding === "malformed-json") bytes = bytes.subarray(0, bytes.length - 1);
    await writeFile(request.id + ".result", bytes);
    send({ kind: "complete", id: request.id, result: {
      bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    } });
  });
`;

const delayedReadyProgram = `
  import { createInterface } from "node:readline";
  import { getHeapStatistics } from "node:v8";
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ kind: "ready", heap_limit_bytes: getHeapStatistics().heap_size_limit }) + "\\n");
  }, 1_500);
  createInterface({ input: process.stdin, crlfDelay: Infinity });
`;

const exitBeforeReadyProgram = `process.exit(0);`;

interface SpawnedTestProcess {
  readonly process: ProviderProcessHandle;
  readonly root: string | undefined;
}

const launcherFor = (
  mode: TestMode,
  options: {
    readonly failCleanupOnce?: boolean;
    readonly onSpawn?: (spawned: SpawnedTestProcess) => void;
  } = {},
): typeof spawnOwnedProviderProcess => {
  let failCleanup = options.failCleanupOnce ?? false;
  return async (request) => {
    const loader = import.meta.resolve("tsx");
    const program =
      mode.kind === "source"
        ? sourceWorkerProgram(
            mode.hangMarker,
            mode.oomMarker,
            mode.stderrMarker,
          )
        : mode.kind === "delayed-ready"
          ? delayedReadyProgram
          : mode.kind === "exit-before-ready"
            ? exitBeforeReadyProgram
            : mode.kind === "result"
              ? resultWorkerProgram(mode.encoding)
              : protocolWorkerProgram(mode.failure);
    const spawned = await spawnOwnedProviderProcess({
      ...request,
      arguments: [
        ...request.arguments.slice(0, -1),
        "--import",
        loader,
        "--input-type=module",
        "-e",
        program,
      ],
    });
    options.onSpawn?.({ process: spawned.process, root: request.cwd });
    return {
      ...spawned,
      cleanup: async () => {
        if (failCleanup) {
          failCleanup = false;
          return { cleaned: false, reason: "controlled worker cleanup retry" };
        }
        return spawned.cleanup === undefined
          ? cleanupOwnedProcessGroup(spawned.ownership)
          : spawned.cleanup();
      },
    };
  };
};

const failureOf = <Value>(
  result: Awaited<ReturnType<WebBundleAnalysisWorker["analyze"]>>,
): AnalysisError => {
  if (result.ok) throw new Error("Expected web worker failure");
  return result.error.error;
};

const waitForExit = async (child: ProviderProcessHandle): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      child.off("exit", onExit);
      resolve();
    };
    const onExit = (): void => finish();
    child.once("exit", onExit);
    timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("Owned child did not exit"));
    }, 3_000);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
};

it("reuses one real owned worker for completed facts from consecutive scripts", async () => {
  const children: ProviderProcessHandle[] = [];
  const worker = new WebBundleAnalysisWorker(
    WEB_BUNDLE_WORKER_LIMITS.heapMb,
    launcherFor(
      { kind: "source" },
      { onSpawn: ({ process: child }) => children.push(child) },
    ),
  );
  try {
    const first = await worker.analyze(makeScript("fetch('/users');"), 10_000);
    const second = await worker.analyze(
      makeScript("fetch('/orders');"),
      10_000,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok)
      throw new Error("Expected both captured scripts to complete");
    expect(first.value).toMatchObject({
      status: "analyzed",
      script_key: makeScript("fetch('/users');").script_key,
    });
    expect(second.value).toMatchObject({
      status: "analyzed",
      script_key: makeScript("fetch('/orders');").script_key,
    });
    expect(children).toHaveLength(1);
  } finally {
    await worker.close();
  }
});

it("preserves an observed failure frame and the opaque later abort reason", async () => {
  const reason = { opaque: "caller cancellation reason" };
  const controller = new AbortController();
  const worker = new WebBundleAnalysisWorker(
    WEB_BUNDLE_WORKER_LIMITS.heapMb,
    launcherFor(
      { kind: "protocol", failure: "late-failure" },
      {
        onSpawn: ({ process: child }) => {
          child.stdout?.on("data", (chunk) => {
            if (String(chunk).includes("failure frame before abort"))
              queueMicrotask(() => controller.abort(reason));
          });
        },
      },
    ),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/late');"),
      5_000,
      controller.signal,
    );
    const error = failureOf(result);
    expect(error).toBeInstanceOf(AnalysisOutputError);
    expect(error.message).toContain("failure frame before abort");
    expect(error.secondaryFailures).toHaveLength(1);
    expect(error.secondaryFailures[0]).toBeInstanceOf(AnalysisCancelledError);
    expect(error.secondaryFailures[0]?.cause).toBe(reason);
  } finally {
    await worker.close();
  }
});

it("retains exit-7 output when abort follows the observed exit", async () => {
  for (const abortAfterExit of [false, true]) {
    const reason = { opaque: "exit observed before abort" };
    const controller = new AbortController();
    const worker = new WebBundleAnalysisWorker(
      128,
      launcherFor(
        { kind: "protocol", failure: "exit-7" },
        {
          onSpawn: ({ process: child }) => {
            if (abortAfterExit)
              child.once("exit", () =>
                queueMicrotask(() => controller.abort(reason)),
              );
          },
        },
      ),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/exit-7');"),
        5_000,
        controller.signal,
      );
      const error = failureOf(result);
      expect(error).toBeInstanceOf(AnalysisOutputError);
      expect(error.capturedOutput?.exit_code).toBe(7);
      expect(error.capturedOutput?.stderr).toContain("controlled exit 7");
      if (abortAfterExit) {
        expect(error.secondaryFailures).toHaveLength(1);
        expect(error.secondaryFailures[0]).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(error.secondaryFailures[0]?.cause).toBe(reason);
      } else {
        expect(error.secondaryFailures).toHaveLength(0);
      }
    } finally {
      await worker.close();
    }
  }
});

it("keeps cancellation when abort is observed before a later child exit", async () => {
  const controller = new AbortController();
  let childExit: Promise<number | null> | undefined;
  const launch = launcherFor(
    { kind: "protocol", failure: "abort-first-exit" },
    {
      onSpawn: ({ process: child }) => {
        childExit = new Promise((resolve) =>
          child.once("exit", (code) => resolve(code)),
        );
        child.stdout?.once("data", () =>
          queueMicrotask(() => controller.abort(null)),
        );
      },
    },
  );
  const worker = new WebBundleAnalysisWorker(128, async (request) => {
    const spawned = await launch(request);
    return {
      ...spawned,
      cleanup: async () => {
        // Cancellation is already observed. Explicitly release the fixture's
        // later exit before invoking the real process-group cleanup owner.
        spawned.process.stdin?.write("{}\n");
        await waitForExit(spawned.process);
        return spawned.cleanup === undefined
          ? cleanupOwnedProcessGroup(spawned.ownership)
          : spawned.cleanup();
      },
    };
  });
  try {
    const result = await worker.analyze(
      makeScript("fetch('/abort-first');"),
      5_000,
      controller.signal,
    );
    const error = failureOf(result);
    expect(error).toBeInstanceOf(AnalysisCancelledError);
    expect(error.cause).toBeNull();
    expect(error.capturedOutput).toBeUndefined();
    expect(await childExit).toBe(7);
  } finally {
    await worker.close();
  }
});

it("keeps a code-0 exit pending while an inherited output pipe can still produce a frame", async () => {
  for (const abortAfterExit of [false, true]) {
    const reason = { opaque: "code-0 exit while inherited pipe is open" };
    const controller = new AbortController();
    const worker = new WebBundleAnalysisWorker(
      128,
      launcherFor(
        { kind: "protocol", failure: "zero-exit-held-pipe" },
        {
          onSpawn: ({ process: child }) => {
            if (abortAfterExit)
              child.once("exit", () =>
                queueMicrotask(() => controller.abort(reason)),
              );
          },
        },
      ),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/zero-exit-held-pipe');"),
        5_000,
        controller.signal,
      );
      const error = failureOf(result);
      if (abortAfterExit) {
        expect(error).toBeInstanceOf(AnalysisCancelledError);
        expect(error.cause).toBe(reason);
      } else {
        expect(error).toBeInstanceOf(AnalysisOutputError);
        expect(error.capturedOutput?.exit_code).toBe(0);
      }
    } finally {
      await worker.close();
    }
  }
});

it("retains EOF without a terminal response when abort follows the close event", async () => {
  const reason = { opaque: "abort queued after owned output close" };
  const controller = new AbortController();
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor(
      { kind: "protocol", failure: "zero-exit-held-pipe" },
      {
        onSpawn: ({ process: child }) => {
          child.once("close", () =>
            queueMicrotask(() => controller.abort(reason)),
          );
        },
      },
    ),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/eof-before-abort');"),
      5_000,
      controller.signal,
    );
    const error = failureOf(result);
    expect(error).toBeInstanceOf(AnalysisOutputError);
    expect(error.message).toContain("output closed before completing");
    expect(error.capturedOutput?.exit_code).toBe(0);
    expect(error.secondaryFailures).toHaveLength(1);
    expect(error.secondaryFailures[0]).toBeInstanceOf(AnalysisCancelledError);
    expect(error.secondaryFailures[0]?.cause).toBe(reason);
  } finally {
    await worker.close();
  }
});

it("retains startup EOF without a ready frame when abort follows the close event", async () => {
  for (const abortAfterClose of [false, true]) {
    const reason = { opaque: "abort queued after startup output close" };
    const controller = new AbortController();
    const worker = new WebBundleAnalysisWorker(
      128,
      launcherFor(
        { kind: "exit-before-ready" },
        {
          onSpawn: ({ process: child }) => {
            if (abortAfterClose)
              child.once("close", () =>
                queueMicrotask(() => controller.abort(reason)),
              );
          },
        },
      ),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/startup-eof');"),
        5_000,
        controller.signal,
      );
      const error = failureOf(result);
      expect(error).toBeInstanceOf(AnalysisOutputError);
      expect(error.message).toContain("output closed before completing");
      expect(error.capturedOutput?.exit_code).toBe(0);
      if (abortAfterClose) {
        expect(error.secondaryFailures).toHaveLength(1);
        expect(error.secondaryFailures[0]).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(error.secondaryFailures[0]?.cause).toBe(reason);
      } else {
        expect(error.secondaryFailures).toHaveLength(0);
      }
    } finally {
      await worker.close();
    }
  }
});

it("retains exit-time truncation when abort follows an oversized stderr exit", async () => {
  const reason = { opaque: "oversized stderr exit observed before abort" };
  const controller = new AbortController();
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor(
      { kind: "protocol", failure: "truncated-exit" },
      {
        onSpawn: ({ process: child }) => {
          child.once("exit", () =>
            queueMicrotask(() => controller.abort(reason)),
          );
        },
      },
    ),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/truncated-exit');"),
      5_000,
      controller.signal,
    );
    const error = failureOf(result);
    expect(error).toBeInstanceOf(AnalysisOutputError);
    expect(error.capturedOutput?.exit_code).toBe(7);
    expect(error.capturedOutput?.truncated).toBe(true);
    expect(Buffer.byteLength(error.capturedOutput?.stderr ?? "")).toBeLessThan(
      300 * 1024,
    );
    expect(error.secondaryFailures[0]?.cause).toBe(reason);
  } finally {
    await worker.close();
  }
});

it("keeps malformed protocol output primary when abort follows its observation", async () => {
  const reason = { opaque: "malformed frame observed before abort" };
  for (const abortAfterFrame of [false, true]) {
    const controller = new AbortController();
    const worker = new WebBundleAnalysisWorker(
      128,
      launcherFor(
        { kind: "protocol", failure: "malformed" },
        {
          onSpawn: ({ process: child }) => {
            if (abortAfterFrame)
              child.stdout?.on("data", (chunk) => {
                if (String(chunk).includes("{not-json}"))
                  queueMicrotask(() => controller.abort(reason));
              });
          },
        },
      ),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/malformed');"),
        5_000,
        controller.signal,
      );
      const error = failureOf(result);
      expect(error).toBeInstanceOf(AnalysisOutputError);
      expect(error.message).toContain("Invalid web analyzer control frame");
      if (abortAfterFrame) {
        expect(error.secondaryFailures).toHaveLength(1);
        expect(error.secondaryFailures[0]?.cause).toBe(reason);
      } else {
        expect(error.secondaryFailures).toHaveLength(0);
      }
    } finally {
      await worker.close();
    }
  }
});

it("does not let a failure frame for another job replace cancellation", async () => {
  const reason = { opaque: "unrelated frame observed before abort" };
  const controller = new AbortController();
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor(
      { kind: "protocol", failure: "wrong-job-failure" },
      {
        onSpawn: ({ process: child }) => {
          child.stdout?.on("data", (chunk) => {
            if (String(chunk).includes("failure for another request"))
              queueMicrotask(() => controller.abort(reason));
          });
        },
      },
    ),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/wrong-job');"),
      5_000,
      controller.signal,
    );
    const error = failureOf(result);
    expect(error).toBeInstanceOf(AnalysisCancelledError);
    expect(error.cause).toBe(reason);
    expect(error.secondaryFailures).toHaveLength(0);
  } finally {
    await worker.close();
  }
});

it("keeps the resource budget on an observed worker resource frame", async () => {
  const reason = { opaque: "resource frame before abort" };
  const controller = new AbortController();
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor(
      { kind: "protocol", failure: "resource-failure" },
      {
        onSpawn: ({ process: child }) => {
          child.stdout?.on("data", (chunk) => {
            if (String(chunk).includes("bounded result capacity"))
              queueMicrotask(() => controller.abort(reason));
          });
        },
      },
    ),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/resource-failure');"),
      5_000,
      controller.signal,
    );
    const error = failureOf(result);
    if (!(error instanceof AnalysisResourceConstraintError))
      throw new Error("Expected a worker resource constraint failure");
    expect(error.reportedLimits?.result_budget_bytes).toBeGreaterThan(0);
    expect(error.secondaryFailures[0]?.cause).toBe(reason);
  } finally {
    await worker.close();
  }
});

it("consumes a final frame before an inherited descendant pipe closes", async () => {
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor({ kind: "protocol", failure: "final-frame-held-pipe" }),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/descendant-frame');"),
      5_000,
    );
    const error = failureOf(result);
    expect(error).toBeInstanceOf(AnalysisOutputError);
    expect(error.message).toContain("final frame from descendant");
  } finally {
    await worker.close();
  }
});

it("projects a heap-marker exit with the runtime's exhausted resource", async () => {
  const heapMb = 256;
  const worker = new WebBundleAnalysisWorker(
    heapMb,
    launcherFor({ kind: "protocol", failure: "heap-exit" }),
  );
  try {
    const error = failureOf(
      await worker.analyze(makeScript("report heap exit"), 15_000),
    );
    expect(error).toBeInstanceOf(AnalysisResourceConstraintError);
    const exhaustion = webBundleMemoryExhaustion({
      runtime: javaScriptRuntime(process.versions).id,
      heapMb,
      memoryLimitReached: false,
      processMemoryLimitBytes: javaScriptWorkerMemoryLimitBytes(heapMb),
    });
    expect(error.message).toContain(webBundleHeapExhaustedReason(exhaustion));
    expect(error).toMatchObject({
      remediationAction: webBundleHeapExhaustedRemediation(exhaustion),
      reportedLimits: {
        max_heap_mb: heapMb,
        worker_process_memory_limit_bytes:
          javaScriptWorkerMemoryLimitBytes(heapMb),
      },
    });
  } finally {
    await worker.close();
  }
});

it("does not classify heap-marker stderr from a healthy worker as exhaustion", async () => {
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor({
      kind: "source",
      stderrMarker:
        "FATAL ERROR: Allocation failed - JavaScript heap out of memory",
    }),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/healthy');"),
      5_000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("analyzed");
  } finally {
    await worker.close();
  }
});

it("projects late stderr tails with completeness from the actual selection point", async () => {
  for (const abortAfterExit of [false, true]) {
    const reason = { opaque: "abort after exit but after late stderr tail" };
    const controller = new AbortController();
    const worker = new WebBundleAnalysisWorker(
      128,
      launcherFor(
        { kind: "protocol", failure: "tail-exit" },
        {
          onSpawn: ({ process: child }) => {
            if (abortAfterExit)
              child.once("exit", () =>
                setTimeout(() => controller.abort(reason), 150),
              );
          },
        },
      ),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/late-tail');"),
        5_000,
        controller.signal,
      );
      const error = failureOf(result);
      expect(error).toBeInstanceOf(AnalysisOutputError);
      expect(error.capturedOutput?.stderr).toContain("early exit marker");
      expect(error.capturedOutput?.stderr).toContain("late tail marker");
      expect(error.capturedOutput?.truncated).toBe(abortAfterExit);
      if (abortAfterExit)
        expect(error.secondaryFailures[0]?.cause).toBe(reason);
      else expect(error.secondaryFailures).toHaveLength(0);
    } finally {
      await worker.close();
    }
  }
});

it("kills a hung owned child at the deadline and starts a fresh worker for the next script", async () => {
  const children: ProviderProcessHandle[] = [];
  const worker = new WebBundleAnalysisWorker(
    WEB_BUNDLE_WORKER_LIMITS.heapMb,
    launcherFor(
      { kind: "source", hangMarker: "hang forever" },
      { onSpawn: ({ process: child }) => children.push(child) },
    ),
  );
  try {
    const timedOut = await worker.analyze(makeScript("hang forever"), 500);
    expect(failureOf(timedOut)).toBeInstanceOf(AnalysisTimeoutError);
    await waitForExit(children[0]!);
    expect(
      children[0]?.exitCode !== null || children[0]?.signalCode !== null,
    ).toBe(true);
    const recovered = await worker.analyze(
      makeScript("fetch('/after-timeout');"),
      10_000,
    );
    expect(recovered.ok).toBe(true);
    expect(children).toHaveLength(2);
  } finally {
    await worker.close();
  }
});

it("contains child heap exhaustion and reuses the host for a later script", async () => {
  const children: ProviderProcessHandle[] = [];
  const roots: string[] = [];
  const worker = new WebBundleAnalysisWorker(
    128,
    launcherFor(
      { kind: "source", oomMarker: "exhaust child heap" },
      {
        onSpawn: ({ process: child, root }) => {
          children.push(child);
          if (root !== undefined) roots.push(root);
        },
      },
    ),
  );
  try {
    const exhausted = await worker.analyze(
      makeScript("exhaust child heap"),
      15_000,
    );
    expect(failureOf(exhausted)).toBeInstanceOf(
      AnalysisResourceConstraintError,
    );
    await waitForExit(children[0]!);
    expect(
      children[0]?.exitCode !== null || children[0]?.signalCode !== null,
    ).toBe(true);
    const recovered = await worker.analyze(
      makeScript("fetch('/after-oom');"),
      10_000,
    );
    expect(recovered.ok).toBe(true);
    expect(children).toHaveLength(2);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBe(roots[1]);
    await access(roots[0]!);
    await worker.close();
    await expect(access(roots[0]!)).rejects.toThrow();
  } finally {
    await worker.close();
  }
});

it("cancels during the late ready handshake and retains failed cleanup until exact retry", async () => {
  const children: SpawnedTestProcess[] = [];
  let announceSpawn: () => void = () => {};
  const spawned = new Promise<void>((resolve) => {
    announceSpawn = resolve;
  });
  const worker = new WebBundleAnalysisWorker(
    WEB_BUNDLE_WORKER_LIMITS.heapMb,
    launcherFor(
      { kind: "delayed-ready" },
      {
        failCleanupOnce: true,
        onSpawn: (child) => {
          children.push(child);
          announceSpawn();
        },
      },
    ),
  );
  const controller = new AbortController();
  const reason = { source: "late-handshake-test" };
  try {
    const analyzing = worker.analyze(
      makeScript("fetch('/cancelled');"),
      10_000,
      controller.signal,
    );
    await spawned;
    controller.abort(reason);
    const result = await analyzing;
    const error = failureOf(result);
    expect(error.cleanupIncomplete).toBe(true);
    expect(error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
    expect(error.cleanupPrimary?.cause).toBe(reason);
    expect(children[0]?.root).toBeDefined();
    await access(children[0]?.root ?? "");

    await worker.close();
    expect(error.cleanupIncomplete).toBe(false);
    expect(resolvedAnalysisError(error).cause).toBe(reason);
    await expect(access(children[0]?.root ?? "")).rejects.toThrow();
    await waitForExit(children[0]!.process);
  } finally {
    if (
      children[0]?.process.exitCode === null &&
      children[0]?.process.signalCode === null
    )
      children[0]?.process.kill("SIGKILL");
    await worker.close().catch(() => undefined);
    await WebBundleAnalysisWorker.retryPending().catch(() => undefined);
  }
});

it.each([
  ["wrong-id", AnalysisOutputError],
  ["oversized-control", AnalysisOutputError],
  ["oversized-result", AnalysisResourceConstraintError],
] as const)(
  "rejects %s before accepting unverified result bytes",
  async (failure, ErrorType) => {
    const worker = new WebBundleAnalysisWorker(
      WEB_BUNDLE_WORKER_LIMITS.heapMb,
      launcherFor({ kind: "protocol", failure }),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/not-read');"),
        10_000,
      );
      expect(failureOf(result)).toBeInstanceOf(ErrorType);
      if (failure === "oversized-result")
        expect(failureOf(result).message).toContain(
          "exceed the host's remaining reserved result capacity",
        );
    } finally {
      await worker.close();
    }
  },
);

it.each(["invalid-utf8", "bom", "malformed-json"] as const)(
  "rejects %s worker result bytes with a matching descriptor",
  async (encoding) => {
    let root: string | undefined;
    const worker = new WebBundleAnalysisWorker(
      WEB_BUNDLE_WORKER_LIMITS.heapMb,
      launcherFor(
        { kind: "result", encoding },
        {
          onSpawn: (spawned) => {
            root = spawned.root;
          },
        },
      ),
    );
    try {
      const result = await worker.analyze(
        makeScript("fetch('/result-marker');"),
        10_000,
      );
      const error = failureOf(result);
      expect(error).toBeInstanceOf(AnalysisOutputError);
      expect(error.cause).toBeInstanceOf(
        encoding === "invalid-utf8" ? TypeError : SyntaxError,
      );
      expect(error.cleanupIncomplete).toBe(false);
    } finally {
      await worker.close();
    }
    expect(root).toBeDefined();
    await expect(access(root!)).rejects.toMatchObject({
      code: "ENOENT",
      path: root,
    });
  },
);

it("preserves literal replacement characters in valid UTF-8 worker facts", async () => {
  let root: string | undefined;
  const worker = new WebBundleAnalysisWorker(
    WEB_BUNDLE_WORKER_LIMITS.heapMb,
    launcherFor(
      { kind: "result", encoding: "replacement" },
      {
        onSpawn: (spawned) => {
          root = spawned.root;
        },
      },
    ),
  );
  try {
    const result = await worker.analyze(
      makeScript("fetch('/literal-�');"),
      10_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.error.message);
    if (result.value.status !== "analyzed")
      throw new Error("Expected analyzed worker facts");
    expect(result.value.observations.endpoints).toContainEqual(
      expect.objectContaining({ value: "/literal-�" }),
    );
  } finally {
    await worker.close();
  }
  expect(root).toBeDefined();
  await expect(access(root!)).rejects.toMatchObject({
    code: "ENOENT",
    path: root,
  });
});
