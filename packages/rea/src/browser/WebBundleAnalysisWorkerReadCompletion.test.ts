import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { expect, it, vi } from "vitest";

const closeFailure = vi.hoisted(() => ({
  enabled: false,
  resultCloseAttempts: 0,
  root: undefined as string | undefined,
  rootRemovedBeforeResultClose: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (
        closeFailure.root !== undefined &&
        String(args[0]) === closeFailure.root &&
        closeFailure.resultCloseAttempts < 2
      )
        closeFailure.rootRemovedBeforeResultClose = true;
      return await actual.rm(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const path = args[0];
      if (closeFailure.enabled && String(path).endsWith(".result")) {
        closeFailure.enabled = false;
        const close = handle.close.bind(handle);
        let failOnce = true;
        Object.defineProperty(handle, "close", {
          configurable: true,
          value: async () => {
            closeFailure.resultCloseAttempts += 1;
            if (failOnce) {
              failOnce = false;
              throw new Error("controlled completed-read close failure");
            }
            await close();
          },
        });
      }
      return handle;
    },
  };
});

import { createWebTextArtifact } from "../domain/webContentArtifact.js";
import type { IncludedScript } from "../domain/webBundleAnalyzerState.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessHandle,
} from "../process/ProviderProcess.js";
import { OwnedWorkerRuntime } from "../process/OwnedWorkerRuntime.js";
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

const ownedSourceLauncher = (
  failCleanupOnce = false,
): typeof spawnOwnedProviderProcess => {
  let failCleanup = failCleanupOnce;
  return async (request) => {
    const loader = import.meta.resolve("tsx");
    const server = new URL(
      "./WebBundleAnalysisWorkerServer.ts",
      import.meta.url,
    );
    const analyzer = new URL("../domain/webBundleAnalyzer.ts", import.meta.url);
    const program = `
      const { serveWebBundleAnalysisWorker } = await import(${JSON.stringify(server.href)});
      const { analyzeCapturedWebScript } = await import(${JSON.stringify(analyzer.href)});
      await serveWebBundleAnalysisWorker(analyzeCapturedWebScript);
    `;
    const spawned = await spawnOwnedProviderProcess({
      ...request,
      arguments: [
        `--max-old-space-size=${String(WEB_BUNDLE_WORKER_LIMITS.heapMb)}`,
        "--expose-gc",
        "--import",
        loader,
        "--input-type=module",
        "-e",
        program,
      ],
    });
    closeFailure.root = request.cwd;
    return {
      ...spawned,
      cleanup: async () => {
        if (failCleanup) {
          failCleanup = false;
          return {
            cleaned: false,
            reason: "controlled first process cleanup failure",
          };
        }
        return spawned.cleanup === undefined
          ? cleanupOwnedProcessGroup(spawned.ownership)
          : spawned.cleanup();
      },
    };
  };
};

it("retains completed facts and resolves a result-file lease through another cleanup consumer", async () => {
  const children: ProviderProcessHandle[] = [];
  const launch = ownedSourceLauncher(true);
  const worker = new WebBundleAnalysisWorker(
    WEB_BUNDLE_WORKER_LIMITS.heapMb,
    async (request) => {
      const spawned = await launch(request);
      children.push(spawned.process);
      return spawned;
    },
  );
  closeFailure.resultCloseAttempts = 0;
  closeFailure.rootRemovedBeforeResultClose = false;
  closeFailure.enabled = true;
  try {
    const result = await worker.analyze(
      makeScript("fetch('/retained');"),
      10_000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained result cleanup failure");
    expect(result.error.completed).toMatchObject({
      status: "analyzed",
      script_key: makeScript("fetch('/retained');").script_key,
      observations: {
        endpoints: [{ value: "/retained", mechanism: "call:fetch" }],
      },
    });
    expect(result.error.error.cleanupPrimary).toBeInstanceOf(
      ProviderCleanupError,
    );
    expect(result.error.error.cleanupIncomplete).toBe(true);
    expect(closeFailure.resultCloseAttempts).toBe(1);
    expect(closeFailure.root).toBeDefined();
    await access(closeFailure.root ?? "");
    expect(children).toHaveLength(1);

    await OwnedWorkerRuntime.retryPending();
    expect(result.error.error.cleanupIncomplete).toBe(false);
    expect(closeFailure.resultCloseAttempts).toBeGreaterThanOrEqual(2);
    expect(closeFailure.rootRemovedBeforeResultClose).toBe(false);
    await expect(access(closeFailure.root ?? "")).rejects.toThrow();
  } finally {
    await worker.close().catch(() => undefined);
    await OwnedWorkerRuntime.retryPending().catch(() => undefined);
  }
});
