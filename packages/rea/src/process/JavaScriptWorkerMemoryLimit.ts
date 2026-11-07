import { javaScriptRuntime } from "../domain/runtimeVersion.js";

const MIB = 1024 * 1024;

/**
 * Commit reserved for Bun itself above a worker's heap budget.
 *
 * Measured on Windows x64 (Bun 1.4.2, 32 logical processors) as the peak Job
 * Object commit of each REA worker on a trivial input: `bun -e 1` commits
 * 52 MiB, while the source-map codec (278-368 MiB), HAR decoder (300-345 MiB)
 * and JavaScript analysis worker (321-346 MiB) commit up to 368 MiB before any
 * real workload because JavaScriptCore commits parsed and compiled module code
 * and per-thread runtime state. 512 MiB covers that peak with about 40%
 * margin for hosts with other processor counts or module layouts.
 */
export const BUN_WORKER_RUNTIME_RESERVE_BYTES = 512 * MIB;

/** Runtime facts that decide whether V8 heap flags bound a worker. */
export interface JavaScriptWorkerHost {
  readonly platform: NodeJS.Platform;
  readonly versions: {
    readonly node: string;
    readonly bun?: string | undefined;
  };
}

/**
 * Process commit limit for a JavaScript worker launched on `process.execPath`.
 *
 * Node.js enforces each worker's V8 heap flags, so it receives no process
 * limit (null) and its launch is unchanged. Bun ignores those flags; on Windows
 * the owned Job Object then enforces the worker's heap budget plus Bun's
 * runtime reserve. Bun elsewhere has no owned enforcement and also gets null.
 */
export const javaScriptWorkerMemoryLimitBytes = (
  heapBudgetMiB: number,
  host: JavaScriptWorkerHost = process,
): number | null =>
  host.platform === "win32" && javaScriptRuntime(host.versions).id === "bun"
    ? heapBudgetMiB * MIB + BUN_WORKER_RUNTIME_RESERVE_BYTES
    : null;
