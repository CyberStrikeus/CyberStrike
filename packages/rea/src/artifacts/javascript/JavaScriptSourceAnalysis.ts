import type {
  JavaScriptSourceAnalysisLimits,
  JavaScriptSourceAnalysisPort,
} from "../../domain/javascript/javascriptSourceAnalysis.js";
import { JavaScriptAnalysisWorker } from "../../javascript/analysis/JavaScriptAnalysisWorker.js";
import type { spawnOwnedProviderProcess } from "../../process/ProviderProcess.js";
import { WorkerCleanupRegistry } from "../../process/OwnedWorkerRuntime.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";

interface RetainedJavaScriptSourceAnalysis {
  readonly worker: JavaScriptAnalysisWorker;
  readonly limits: JavaScriptSourceAnalysisLimits;
  busy: boolean;
}

const retained = new WeakMap<
  ArtifactResourceScope,
  RetainedJavaScriptSourceAnalysis
>();
const closeHookRegistered = new WeakSet<ArtifactResourceScope>();
const workerCleanups = new WeakMap<
  ArtifactResourceScope,
  WorkerCleanupRegistry
>();

const workerCleanupFor = (
  scope: ArtifactResourceScope,
): WorkerCleanupRegistry => {
  let cleanup = workerCleanups.get(scope);
  if (cleanup === undefined) {
    cleanup = new WorkerCleanupRegistry();
    workerCleanups.set(scope, cleanup);
  }
  return cleanup;
};

export interface JavaScriptSourceAnalysisAcquisition {
  /** Keep a healthy worker until this scope closes. */
  readonly scope?: ArtifactResourceScope;
  /** Test seam. Reuse keeps the process already launched for the scope. */
  readonly launcher?: typeof spawnOwnedProviderProcess;
}

/** Construct the inert artifact analyzer; resources are acquired on the first source. */
export const createJavaScriptSourceAnalysis = (
  limits: JavaScriptSourceAnalysisLimits,
  sourceCount: number,
  acquisition: JavaScriptSourceAnalysisAcquisition = {},
): Promise<JavaScriptSourceAnalysisPort> => {
  if (acquisition.scope === undefined)
    return Promise.resolve(
      new JavaScriptAnalysisWorker(limits, acquisition.launcher, sourceCount),
    );
  return checkoutJavaScriptSourceAnalysis(
    acquisition.scope,
    limits,
    sourceCount,
    acquisition.launcher,
  );
};

const checkoutJavaScriptSourceAnalysis = async (
  scope: ArtifactResourceScope,
  limits: JavaScriptSourceAnalysisLimits,
  sourceCount: number,
  launcher: typeof spawnOwnedProviderProcess | undefined,
): Promise<JavaScriptSourceAnalysisPort> => {
  registerJavaScriptSourceAnalysisClose(scope);
  const current = retained.get(scope);
  if (current !== undefined && !current.busy) {
    if (
      sameLimits(current.limits, limits) &&
      current.worker.prepareForAnotherAnalysis(sourceCount)
    ) {
      current.busy = true;
      return new ScopeJavaScriptSourceAnalysis(scope, current.worker);
    }
    retained.delete(scope);
    try {
      await current.worker.close();
    } catch (cause) {
      // The old process is still alive. Keep it owned and fail this request
      // before another worker is constructed, including on MCP where the
      // analysis result is returned without a later cleanup retry.
      if (retained.get(scope) === undefined) {
        retained.set(scope, {
          worker: current.worker,
          limits: current.limits,
          busy: false,
        });
      } else {
        scope.retain({
          kind: "lease",
          resource: "replaced JavaScript source analyzer",
          lease: { release: () => current.worker.close() },
        });
      }
      throw cause;
    }
  }
  const worker = new JavaScriptAnalysisWorker(
    limits,
    launcher,
    sourceCount,
    workerCleanupFor(scope),
  );
  // A concurrent analysis may have parked another healthy worker while the
  // replaced process was closing. Claim the slot only when it is still empty.
  // This extra process is closed through the port returned below.
  if (retained.get(scope) === undefined)
    retained.set(scope, { worker, limits, busy: true });
  return new ScopeJavaScriptSourceAnalysis(scope, worker);
};

const registerJavaScriptSourceAnalysisClose = (
  scope: ArtifactResourceScope,
): void => {
  if (closeHookRegistered.has(scope)) return;
  closeHookRegistered.add(scope);
  scope.addCloseHook(async () => {
    const current = retained.get(scope);
    if (current === undefined) return;
    await current.worker.close();
    if (retained.get(scope) === current) retained.delete(scope);
  });
};

const sameLimits = (
  left: JavaScriptSourceAnalysisLimits,
  right: JavaScriptSourceAnalysisLimits,
): boolean =>
  left.heapMb === right.heapMb && left.timeoutMs === right.timeoutMs;

/**
 * Park a healthy worker on its scope. The next checkout with the same limits
 * reuses that process; scope close is what actually stops it.
 */
class ScopeJavaScriptSourceAnalysis implements JavaScriptSourceAnalysisPort {
  #failed = false;
  #closed = false;

  constructor(
    private readonly scope: ArtifactResourceScope,
    private readonly worker: JavaScriptAnalysisWorker,
  ) {}

  analyze(
    ...args: Parameters<JavaScriptSourceAnalysisPort["analyze"]>
  ): ReturnType<JavaScriptSourceAnalysisPort["analyze"]> {
    return this.worker.analyze(...args).then((result) => {
      if (!result.ok) this.#failed = true;
      return result;
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      const current = retained.get(this.scope);
      if (
        current?.worker === this.worker &&
        !this.#failed &&
        this.worker.canReuse()
      ) {
        current.busy = false;
        return;
      }
      if (current?.worker === this.worker) retained.delete(this.scope);
      await this.worker.close();
    } catch (cause) {
      this.#closed = false;
      throw cause;
    }
  }
}
