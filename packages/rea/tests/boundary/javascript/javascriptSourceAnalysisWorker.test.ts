import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import { createJavaScriptSourceAnalysis } from "../../../src/artifacts/javascript/JavaScriptSourceAnalysis.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "../../../src/process/ProcessOwnershipEvidence.js";
import type { OwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { javaScriptWorkerMemoryLimitBytes } from "../../../src/process/JavaScriptWorkerMemoryLimit.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";

const source = (path: string, value: string): JavaScriptArtifactFile => ({
  path,
  sha256: createHash("sha256").update(value).digest("hex"),
  container_sha256: "1".repeat(64),
  bytes: Buffer.byteLength(value),
  inventory_artifact_id: "fixture-source",
  kind: "javascript",
  unpacked: false,
  text: { included: true, value },
});

/** The Job Object limit the worker requests for its 128 MiB heap budget, if any. */
const processLimit = javaScriptWorkerMemoryLimitBytes(128);

it("reuses one real owned analyzer while retaining distinct source identities and exported returns", async () => {
  const launches: number[] = [];
  let runtimeRoot: string | undefined;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      runtimeRoot = request.cwd;
      const spawned = await spawnOwnedProviderProcess(request);
      const pid = spawned.process.pid;
      if (pid === undefined)
        throw new Error("Owned analyzer has no observed PID");
      launches.push(pid);
      return spawned;
    },
  );
  try {
    const first = source(
      "first.mjs",
      "export function create() { return { observed: 7 }; }",
    );
    const second = source(
      "second.mjs",
      "export function next() { return { observed: 8 }; }",
    );
    for (const [index, file] of [first, second].entries()) {
      const phases: string[] = [];
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        undefined,
        async (phase) => {
          phases.push(phase);
        },
      );
      if (!result.ok) throw result.error.error;
      expect(phases).toEqual([
        "parse",
        "static",
        "semantic",
        "projection",
        "transfer",
      ]);
      expect(result.value.javascript.parse_status).toBe("complete");
      expect(
        result.value.module?.callables[0]?.returnSites[0]?.value,
      ).toMatchObject({
        status: "object",
        properties: [
          { name: "observed", value: { status: "literal", value: index + 7 } },
        ],
      });
      expect(
        result.value.projection?.nodes.every(
          ({ identity }) => identity.artifact_sha256 === file.sha256,
        ),
      ).toBe(true);
      expect(
        result.value.projection?.nodes.some(
          ({ identity }) => identity.module_path === file.path,
        ),
      ).toBe(true);
    }
    expect(launches).toHaveLength(1);
    if (runtimeRoot === undefined)
      throw new Error(
        "Owned analyzer did not expose its runtime root to launcher",
      );
    expect(
      (await readdir(runtimeRoot)).filter((name) =>
        /\.(?:source|static\.json|records)$/u.test(name),
      ),
    ).toEqual([]);
  } finally {
    await worker.close();
  }
});

it("reuses one owned worker across analyses on the same resource scope", async () => {
  const scope = new ArtifactResourceScope();
  const launches: number[] = [];
  const exits = new Map<number, Promise<void>>();
  const launcher: typeof spawnOwnedProviderProcess = async (request) => {
    const previous = launches.at(-1);
    if (previous !== undefined) await exits.get(previous);
    const spawned = await spawnOwnedProviderProcess(request);
    const pid = spawned.process.pid;
    if (pid === undefined)
      throw new Error("Owned analyzer has no observed PID");
    exits.set(
      pid,
      new Promise((resolve) => {
        spawned.process.once("exit", () => {
          resolve();
        });
      }),
    );
    launches.push(pid);
    return spawned;
  };
  const limits = { heapMb: 128, timeoutMs: 30_000 };
  const first = source("first.mjs", "export const observed = 1;");
  const second = source("second.mjs", "export const observed = 2;");
  const files = [first, second];
  try {
    for (const file of files) {
      const worker = await createJavaScriptSourceAnalysis(limits, 1, {
        scope,
        launcher,
      });
      try {
        const result = await worker.analyze(file, {
          nodes: 100,
          unknowns: 100,
        });
        if (!result.ok) throw result.error.error;
        expect(result.value.javascript.parse_status).toBe("complete");
      } finally {
        await worker.close();
      }
    }
    expect(launches).toHaveLength(1);
    const replaced = await createJavaScriptSourceAnalysis(
      { heapMb: 256, timeoutMs: 30_000 },
      1,
      { scope, launcher },
    );
    try {
      const result = await replaced.analyze(first, {
        nodes: 100,
        unknowns: 100,
      });
      if (!result.ok) throw result.error.error;
      expect(result.value.javascript.parse_status).toBe("complete");
    } finally {
      await replaced.close();
    }
    expect(launches).toHaveLength(2);
    await scope.close();
    const reopened = await createJavaScriptSourceAnalysis(limits, 1, {
      scope,
      launcher,
    });
    try {
      const result = await reopened.analyze(first, {
        nodes: 100,
        unknowns: 100,
      });
      if (!result.ok) throw result.error.error;
    } finally {
      await reopened.close();
    }
    expect(launches).toHaveLength(3);
  } finally {
    await scope.close();
  }
});

it("keeps a worker parked while a limit change closes the previous process", async () => {
  const scope = new ArtifactResourceScope();
  const launches: number[] = [];
  const exited = new Set<number>();
  const exits = new Map<number, Promise<void>>();
  const launcher: typeof spawnOwnedProviderProcess = async (request) => {
    const spawned = await spawnOwnedProviderProcess(request);
    const pid = spawned.process.pid;
    if (pid === undefined)
      throw new Error("Owned analyzer has no observed PID");
    exits.set(
      pid,
      new Promise((resolve) => {
        spawned.process.once("exit", () => {
          exited.add(pid);
          resolve();
        });
      }),
    );
    launches.push(pid);
    return spawned;
  };
  const limits = { heapMb: 128, timeoutMs: 30_000 };
  const file = source("parked.mjs", "export const observed = 1;");
  const originalClose = JavaScriptAnalysisWorker.prototype.close;
  let releaseClose = (): void => {};
  const gate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  let closeCalls = 0;
  let markCloseStarted = (): void => {};
  const closeStarted = new Promise<void>((resolve) => {
    markCloseStarted = resolve;
  });
  let replacement:
    | ReturnType<typeof createJavaScriptSourceAnalysis>
    | undefined;
  await withVerifierCleanup(async () => {
    const initial = await createJavaScriptSourceAnalysis(limits, 1, {
      scope,
      launcher,
    });
    const first = await initial.analyze(file, { nodes: 100, unknowns: 100 });
    if (!first.ok) throw first.error.error;
    await initial.close();
    const replacedPid = launches[0];
    if (replacedPid === undefined)
      throw new Error("Replaced analyzer has no observed PID");

    JavaScriptAnalysisWorker.prototype.close = async function (
      this: JavaScriptAnalysisWorker,
    ) {
      closeCalls += 1;
      if (closeCalls === 1) {
        markCloseStarted();
        await gate;
      }
      return originalClose.call(this);
    };
    replacement = createJavaScriptSourceAnalysis(
      { heapMb: 256, timeoutMs: 30_000 },
      1,
      { scope, launcher },
    );
    await awaitAcknowledgement(closeStarted, replacement, "worker close");

    const concurrent = await createJavaScriptSourceAnalysis(limits, 1, {
      scope,
      launcher,
    });
    const concurrentResult = await concurrent.analyze(file, {
      nodes: 100,
      unknowns: 100,
    });
    if (!concurrentResult.ok) throw concurrentResult.error.error;
    await concurrent.close();
    const parkedPid = launches[1];
    if (parkedPid === undefined)
      throw new Error("Parked analyzer has no observed PID");

    releaseClose();
    const extra = await replacement;
    const extraResult = await extra.analyze(file, {
      nodes: 100,
      unknowns: 100,
    });
    if (!extraResult.ok) throw extraResult.error.error;
    const extraPid = launches[2];
    if (extraPid === undefined)
      throw new Error("Replacement analyzer has no observed PID");
    await extra.close();
    await exits.get(replacedPid);
    await exits.get(extraPid);
    expect(exited.has(replacedPid)).toBe(true);
    expect(exited.has(extraPid)).toBe(true);
    expect(exited.has(parkedPid)).toBe(false);

    await scope.close();
    await exits.get(parkedPid);
    expect(exited.has(parkedPid)).toBe(true);
  }, [
    releaseClose,
    async () => {
      const port = await replacement?.catch(() => undefined);
      await port?.close();
    },
    async () => {
      await scope.close();
    },
    () => {
      JavaScriptAnalysisWorker.prototype.close = originalClose;
    },
  ]);
});

it("does not start a replacement when closing the previous worker fails", async () => {
  const scope = new ArtifactResourceScope();
  const launches: number[] = [];
  const exited = new Set<number>();
  const exits = new Map<number, Promise<void>>();
  const launcher: typeof spawnOwnedProviderProcess = async (request) => {
    const previous = launches.at(-1);
    if (previous !== undefined) await exits.get(previous);
    const spawned = await spawnOwnedProviderProcess(request);
    const pid = spawned.process.pid;
    if (pid === undefined)
      throw new Error("Owned analyzer has no observed PID");
    exits.set(
      pid,
      new Promise((resolve) => {
        spawned.process.once("exit", () => {
          exited.add(pid);
          resolve();
        });
      }),
    );
    launches.push(pid);
    return spawned;
  };
  const limits = { heapMb: 128, timeoutMs: 30_000 };
  const file = source("replaced.mjs", "export const observed = 1;");
  const originalClose = JavaScriptAnalysisWorker.prototype.close;
  let closeCalls = 0;
  try {
    const initial = await createJavaScriptSourceAnalysis(limits, 1, {
      scope,
      launcher,
    });
    const first = await initial.analyze(file, { nodes: 100, unknowns: 100 });
    if (!first.ok) throw first.error.error;
    await initial.close();
    const replacedPid = launches[0];
    if (replacedPid === undefined)
      throw new Error("Replaced analyzer has no observed PID");

    JavaScriptAnalysisWorker.prototype.close = async function (
      this: JavaScriptAnalysisWorker,
    ) {
      closeCalls += 1;
      if (closeCalls === 1) throw new Error("worker still owned");
      return originalClose.call(this);
    };
    await expect(
      createJavaScriptSourceAnalysis({ heapMb: 256, timeoutMs: 30_000 }, 1, {
        scope,
        launcher,
      }),
    ).rejects.toThrow("worker still owned");
    expect(launches).toEqual([replacedPid]);
    expect(exited.has(replacedPid)).toBe(false);

    JavaScriptAnalysisWorker.prototype.close = originalClose;
    const replacement = await createJavaScriptSourceAnalysis(
      { heapMb: 256, timeoutMs: 30_000 },
      1,
      { scope, launcher },
    );
    try {
      const result = await replacement.analyze(file, {
        nodes: 100,
        unknowns: 100,
      });
      if (!result.ok) throw result.error.error;
    } finally {
      await replacement.close();
    }
    expect(launches).toHaveLength(2);
    expect(exited.has(replacedPid)).toBe(true);
    const replacementPid = launches[1];
    if (replacementPid === undefined)
      throw new Error("Replacement analyzer has no observed PID");
    expect(exited.has(replacementPid)).toBe(false);
  } finally {
    JavaScriptAnalysisWorker.prototype.close = originalClose;
    await scope.close();
  }
});

it("reports an actual startup deadline and closes its owned resources before subsequent analysis", async () => {
  const file = source("app.mjs", "export const observed = 7;");
  const expired = new JavaScriptAnalysisWorker({ heapMb: 128, timeoutMs: 1 });
  try {
    const result = await expired.analyze(file, { nodes: 100, unknowns: 100 });
    if (result.ok)
      throw new Error(
        "A one-millisecond fresh process deadline unexpectedly completed",
      );
    expect(result.error.error).toMatchObject({
      _tag: "AnalysisTimeoutError",
      timeoutMs: 1,
    });
  } finally {
    await expired.close();
  }
  const next = new JavaScriptAnalysisWorker({ heapMb: 128, timeoutMs: 30_000 });
  try {
    const result = await next.analyze(file, { nodes: 100, unknowns: 100 });
    if (!result.ok) throw result.error.error;
    expect(result.value.javascript.parse_status).toBe("complete");
  } finally {
    await next.close();
  }
});

it("preserves a failed owned cleanup retry when the next caller cancels before acquisition", async () => {
  const controller = new AbortController();
  let releaseAllowed = false;
  let cleanupAttempts = 0;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess(request);
      return {
        ...launched,
        async cleanup() {
          cleanupAttempts += 1;
          if (!releaseAllowed) {
            if (cleanupAttempts > 1) controller.abort();
            throw new Error("Fixture owned cleanup is unavailable");
          }
          return launched.cleanup === undefined
            ? cleanupOwnedProcessGroup(launched.ownership)
            : launched.cleanup();
        },
      };
    },
  );
  const next = new JavaScriptAnalysisWorker({ heapMb: 128, timeoutMs: 30_000 });
  try {
    const file = source("app.mjs", "export const observed = 7;");
    const first = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    if (!first.ok) throw first.error.error;
    const closing = worker.close();
    await expect(closing).rejects.toBeInstanceOf(ProviderCleanupError);
    await expect(closing).rejects.toMatchObject({
      cause: { message: "Fixture owned cleanup is unavailable" },
    });
    const interrupted = await next.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    if (interrupted.ok)
      throw new Error("Unreleased ownership must block subsequent analysis");
    expect(controller.signal.aborted).toBe(true);
    expect(projectAnalysisError(interrupted.error.error)).toMatchObject({
      code: "cleanup_incomplete",
    });
    releaseAllowed = true;
    await worker.close();
    const recovered = await next.analyze(file, { nodes: 100, unknowns: 100 });
    if (!recovered.ok) throw recovered.error.error;
    expect(recovered.value.javascript.parse_status).toBe("complete");
  } finally {
    releaseAllowed = true;
    await worker.close();
    await next.close();
  }
});

it("ends worker stdin and unreferences process handles when cleanup reports inspection uncertainty", async () => {
  let stdinEnded = false;
  let unreferenced = false;
  let permitCleanup = false;
  let childStdin: typeof process.stdin | undefined;
  let childExit: Promise<void> | undefined;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess(request);
      childExit = new Promise((resolve) => {
        launched.process.once("exit", () => resolve());
      });
      const originalUnref = launched.process.unref;
      launched.process.unref = () => {
        unreferenced = true;
        originalUnref?.call(launched.process);
      };
      childStdin = launched.process.stdin as unknown as typeof process.stdin;
      launched.process.stdin?.once("finish", () => {
        stdinEnded = true;
      });
      return {
        ...launched,
        cleanup: async () =>
          permitCleanup
            ? launched.cleanup === undefined
              ? cleanupOwnedProcessGroup(launched.ownership)
              : launched.cleanup()
            : {
                cleaned: false,
                reason: "process table could not be inspected: spawn EPERM",
              },
      };
    },
  );
  try {
    const file = source("app.mjs", "export const observed = 7;");
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    if (!result.ok) throw result.error.error;
    const closing = worker.close();
    await expect(closing).rejects.toBeInstanceOf(ProviderCleanupError);
    await expect(closing).rejects.toMatchObject({
      cause: {
        message: "process table could not be inspected: spawn EPERM",
      },
    });
    expect(childStdin?.writableEnded || stdinEnded).toBe(true);
    expect(unreferenced).toBe(true);
    const errorListeners = childStdin?.listenerCount("error");
    for (let retry = 0; retry < 3; retry++)
      await expect(worker.close()).rejects.toBeInstanceOf(ProviderCleanupError);
    expect(childStdin?.listenerCount("error")).toBeLessThanOrEqual(
      errorListeners ?? 0,
    );
    await childExit;
    permitCleanup = true;
    await worker.close();
  } finally {
    permitCleanup = true;
    await worker.close().catch(() => {});
  }
});

it("lets a separate host exit while its live worker cleanup remains incomplete", async () => {
  const root = await createTestTempDirectory("rea-worker-incomplete-host-");
  const ownershipPath = join(root, "ownership.json");
  const workerUrl = new URL(
    "../../../dist/javascript/analysis/JavaScriptAnalysisWorker.js",
    import.meta.url,
  ).href;
  const launcherUrl = new URL(
    "../../../dist/process/ProviderProcess.js",
    import.meta.url,
  ).href;
  const script = `
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { JavaScriptAnalysisWorker } from ${JSON.stringify(workerUrl)};
import { spawnOwnedProviderProcess } from ${JSON.stringify(launcherUrl)};
const worker = new JavaScriptAnalysisWorker({ heapMb: 128, timeoutMs: 10000 }, async request => {
  const entry = pathToFileURL(request.arguments.at(-1)).href;
  const launched = await spawnOwnedProviderProcess({ ...request, arguments: [
    ...request.arguments.slice(0, -1), "--input-type=module", "-e",
    "const interval = setInterval(() => {}, 1000); setTimeout(() => clearInterval(interval), 60000); await import(" + JSON.stringify(entry) + ");"
  ] });
  // The launcher is deliberately orphaned when this host exits; cleanup still
  // requires its run token and executable identity, rather than its old parent.
  // The live ledger belongs to this host and cannot be serialized. Transfer
  // only the process facts needed for the independent fixture cleanup.
  const { expectedParentPid, evidenceOwner, ...ownership } = launched.ownership;
  await writeFile(${JSON.stringify(ownershipPath)}, JSON.stringify(ownership));
  return { ...launched, cleanup: async () => ({ cleaned: false, reason: "fixture inspection unavailable" }) };
});
const analyzed = await worker.analyze(${JSON.stringify(source("app.mjs", "export const value = 1;"))}, { nodes: 100, unknowns: 100 });
if (!analyzed.ok) throw analyzed.error.error;
try { await worker.close(); throw new Error("cleanup unexpectedly completed"); }
catch (error) {
  if (error.cleanupIncomplete !== true) throw error;
  process.stdout.write(JSON.stringify({ code: "cleanup_incomplete", reason: error.cause.message }) + "\\n");
}
`;
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      { timeout: 10_000 },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "cleanup_incomplete",
      reason: "fixture inspection unavailable",
    });
  } finally {
    const ownership = JSON.parse(
      await readFile(ownershipPath, "utf8"),
    ) as OwnedProcessGroup;
    expect(
      await cleanupOwnedProcessGroup({
        ...ownership,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      }),
    ).toMatchObject({ cleaned: true });
  }
});

// The real server reports a parent-declined semantic budget through its
// resource frame.
it("formats a real worker's declined semantic budget once", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const spawned = await spawnOwnedProviderProcess(request);
      const stdin = spawned.process.stdin;
      if (stdin === null || stdin === undefined)
        throw new Error("Owned analyzer has no stdin");
      const write = stdin.write.bind(stdin) as (
        chunk: string,
        callback: (error?: Error | null) => void,
      ) => boolean;
      stdin.write = ((
        chunk: string,
        callback: (error?: Error | null) => void,
      ) =>
        write(
          chunk.replace(
            /"semantic_result_budget_bytes":\d+/u,
            '"semantic_result_budget_bytes":0',
          ),
          callback,
        )) as typeof stdin.write;
      return spawned;
    },
  );
  try {
    const result = await worker.analyze(
      source("main.js", "export const observed = 7;"),
      { nodes: 100, unknowns: 100 },
    );
    if (result.ok) throw new Error("expected a declined semantic budget");
    const { error } = result.error;
    expect(error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reason:
        "The parent reserved its remaining result capacity for static observations; semantic analysis of main.js was not started",
      reportedLimits: { semantic_result_budget_bytes: 0 },
    });
    expect(error.message.match(/Resource constraint during/gu)).toHaveLength(1);
    expect(error.message.match(/main\.js:/gu)).toBeNull();
    expect(result.error.javascript?.parse_status).toBe("complete");
  } finally {
    await worker.close();
  }
});

// The handshake mirrors the real server: only Node.js reports an enforced V8 heap limit.
const resourceFailureWorker = (heapLimit: string) =>
  new JavaScriptAnalysisWorker({ heapMb: 128, timeoutMs: 30_000 }, (request) =>
    spawnOwnedProviderProcess({
      ...request,
      arguments: [
        "-e",
        `const heap = ${heapLimit};
process.stdout.write(JSON.stringify({ kind: "ready", heap_limit_bytes: heap }) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).once("line", (line) => {
  const { id } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ kind: "failure", id, reason: "resource", resource: "memory", limits: null, message: "fixture" }) + "\\n");
});`,
      ],
    }),
  );

it("reports the worker heap limit only when the runtime enforces V8 heap flags", async () => {
  const worker = resourceFailureWorker(
    'process.versions.bun === undefined ? require("node:v8").getHeapStatistics().heap_size_limit : null',
  );
  try {
    const result = await worker.analyze(
      source("app.mjs", "export const observed = 7;"),
      { nodes: 100, unknowns: 100 },
    );
    if (result.ok) throw new Error("expected a reported resource failure");
    expect(result.error.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits:
        process.versions.bun === undefined
          ? {
              worker_old_space_mb: 128,
              worker_heap_limit_bytes: expect.any(Number),
              worker_timeout_ms: 30_000,
            }
          : {
              worker_heap_limit_bytes: null,
              ...(processLimit === null
                ? {}
                : { worker_process_memory_limit_bytes: processLimit }),
              worker_timeout_ms: 30_000,
            },
    });
  } finally {
    await worker.close();
  }
});

it("rejects a worker heap report that contradicts the launching runtime", async () => {
  const worker = resourceFailureWorker(
    "process.versions.bun === undefined ? null : 1",
  );
  try {
    const result = await worker.analyze(
      source("app.mjs", "export const observed = 7;"),
      { nodes: 100, unknowns: 100 },
    );
    if (result.ok) throw new Error("expected a handshake failure");
    expect(result.error.error._tag).toBe("AnalysisOutputError");
  } finally {
    await worker.close();
  }
});

// The launcher runs a real child without a job limit, so any artifact can run
// it, and its handle reports the notification an owned Windows job records
// before exit. Bun exits 3 (panic) or 1 (exception) at a reached job limit.
it.each([true, false])(
  "classifies a worker exit by the job memory notification (reached: %s)",
  async (reached) => {
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async ({ memoryLimitBytes, ...request }) => {
        expect(memoryLimitBytes).toBe(processLimit ?? undefined);
        const spawned = await spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `const heap = process.versions.bun === undefined ? require("node:v8").getHeapStatistics().heap_size_limit : null;
process.stdout.write(JSON.stringify({ kind: "ready", heap_limit_bytes: heap }) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).once("line", () => {
  process.stderr.write("panic: out of memory");
  process.exit(3);
});`,
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
    );
    try {
      const result = await worker.analyze(
        source("app.mjs", "export const observed = 7;"),
        { nodes: 100, unknowns: 100 },
      );
      if (result.ok) throw new Error("expected the worker to fail");
      expect(result.error.error).toMatchObject(
        reached
          ? {
              _tag: "AnalysisResourceConstraintError",
              resource: "memory",
              reason: expect.stringContaining("process memory limit"),
              reportedLimits:
                processLimit === null
                  ? expect.not.objectContaining({
                      worker_process_memory_limit_bytes: expect.anything(),
                    })
                  : { worker_process_memory_limit_bytes: processLimit },
              capturedOutput: { stderr: "panic: out of memory" },
            }
          : {
              _tag: "ProviderAdapterError",
              diagnostics: { exit_code: 3 },
            },
      );
    } finally {
      await worker.close();
    }
  },
);

it("retains legacy routes and a bounded route-fact prefix inside one checkpoint budget", async () => {
  const count = 12000;
  const text = Array.from(
    { length: count },
    (_, index) => `route('/reports/${index}/${"x".repeat(96)}');`,
  ).join("\n");
  const worker = new JavaScriptAnalysisWorker({
    heapMb: 512,
    timeoutMs: 30000,
  });
  try {
    const analyzed = await worker.analyze(source("routes.js", text), {
      nodes: 1,
      unknowns: 8,
    });
    const facts = analyzed.ok
      ? analyzed.value.javascript
      : analyzed.error.javascript;
    expect(
      facts,
      analyzed.ok ? undefined : analyzed.error.error.message,
    ).not.toBeNull();
    expect(facts!.endpoints).toHaveLength(count);
    expect(facts!.routes!.candidates.length).toBeGreaterThan(0);
    expect(facts!.routes!.candidates.length).toBeLessThan(count);
    expect(facts!.routes!.capacity).toMatchObject({ kind: "result-bytes" });
    expect(Buffer.byteLength(JSON.stringify(facts))).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
  } finally {
    await worker.close();
  }
}, 60000);

it("keeps wrapped route ancestry, navigation and unknown named parents in the real worker", async () => {
  const worker = new JavaScriptAnalysisWorker({
    heapMb: 128,
    timeoutMs: 30000,
  });
  try {
    const analyzed = await worker.analyze(
      source(
        "routes.ts",
        "const detail={_$:'detail'};defineRoutes({reports:{_$:'reports',detail:(detail as typeof detail)}});router.push(({pathname:'/users'} as const));router.push(({pathname:'/settings'} satisfies {pathname:string}));router.addRoute('admin',({path:'settings',component:View} as const));router.addRoute('admin',{path:'relative',children:[{path:'/public',component:View},{path:'relative'}]});defineRoutes({generated:buildRoutes()});",
      ),
      { nodes: 1, unknowns: 8 },
    );
    if (!analyzed.ok) throw analyzed.error.error;
    expect(
      analyzed.value.javascript.routes!.candidates.map(({ path }) => path),
    ).toEqual([
      "/users",
      "/settings",
      "/reports",
      "/reports/detail",
      "/public",
    ]);
    expect(analyzed.value.javascript.routes!.unresolved).toHaveLength(3);
    expect(analyzed.value.javascript.routes!.unresolved[0]!.reason).toContain(
      "parent",
    );
  } finally {
    await worker.close();
  }
});
