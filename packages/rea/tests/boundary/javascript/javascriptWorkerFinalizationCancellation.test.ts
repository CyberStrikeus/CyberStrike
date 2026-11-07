import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, it } from "vitest";

it.each([false, true])(
  "retains completed worker facts when cancellation arrives during final job cleanup (failure: %s)",
  async (failCleanup) => {
    const loaderUrl = new URL(
      "../../../scripts/lib/verifier-source-loader.mjs",
      import.meta.url,
    ).href;
    const workerUrl = new URL(
      "../../../src/javascript/analysis/JavaScriptAnalysisWorker.ts",
      import.meta.url,
    ).href;
    const processUrl = new URL(
      "../../../src/process/ProviderProcess.ts",
      import.meta.url,
    ).href;
    // Isolate the filesystem seam in a Node process. Both analyses use the real
    // analyzer. Failed final removal retains the real file for owning close retry.
    const script = `
    import fs from 'node:fs';
    import { createHash } from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';
    const { importVerifierSource } = await import(${JSON.stringify(loaderUrl)});
    const controller = new AbortController();
    const reason = new Error('cancel during final worker cleanup');
    const nativeRm = fs.promises.rm;
    let cancelOnCleanup = false;
    let completedRemovals = 0;
    fs.promises.rm = async (path, options) => {
      const finalJobRemoval = String(path).includes('rea-javascript-analysis-') && String(path).endsWith('.records');
      if (finalJobRemoval && cancelOnCleanup && ${JSON.stringify(failCleanup)}) {
        controller.abort(reason);
        throw new Error('fixture final removal denied');
      }
      await nativeRm(path, options);
      if (finalJobRemoval) {
        completedRemovals += 1;
        if (cancelOnCleanup) controller.abort(reason);
      }
    };
    syncBuiltinESMExports();
    const { JavaScriptAnalysisWorker } = await importVerifierSource(new URL(${JSON.stringify(workerUrl)}));
    const { spawnOwnedProviderProcess } = await importVerifierSource(new URL(${JSON.stringify(processUrl)}));
    const value = 'export const observed = 7;';
    const source = path => ({ path, sha256: createHash('sha256').update(value).digest('hex'),
      container_sha256: '1'.repeat(64), bytes: Buffer.byteLength(value), inventory_artifact_id: 'fixture-source',
      kind: 'javascript', unpacked: false, text: { included: true, value } });
    let root;
    let child;
    let launches = 0;
    const worker = new JavaScriptAnalysisWorker({ heapMb: 128, timeoutMs: 5000 }, async request => {
      root = request.cwd;
      const spawned = await spawnOwnedProviderProcess(request);
      child = spawned.process;
      launches += 1;
      return spawned;
    });
    let observed;
    try {
      const control = await worker.analyze(source('control.mjs'), { nodes: 100, unknowns: 100 });
      const controlReusable = worker.canReuse();
      cancelOnCleanup = true;
      const cancelled = await worker.analyze(source('cancelled.mjs'), { nodes: 100, unknowns: 100 }, controller.signal);
      const facts = cancelled.ok ? cancelled.value : cancelled.error;
      observed = { controlOk: control.ok, controlReusable, completedRemovals, launches,
        cancelled: !cancelled.ok && (cancelled.error.error.cleanupPrimary ?? cancelled.error.error)._tag === 'AnalysisCancelledError',
        exactReason: !cancelled.ok && (cancelled.error.error.cleanupPrimary ?? cancelled.error.error).cause === reason,
        cleanupIncomplete: !cancelled.ok && cancelled.error.error.cleanupIncomplete,
        parseStatus: facts.javascript?.parse_status, hasModule: facts.module !== null,
        hasProjection: facts.projection !== null, reusable: worker.canReuse() };
    } finally {
      fs.promises.rm = nativeRm;
      syncBuiltinESMExports();
      await worker.close();
    }
    const rootRemoved = await fs.promises.stat(root).then(() => false, cause => {
      if (cause.code !== 'ENOENT') throw cause;
      return true;
    });
    process.stdout.write(JSON.stringify({ ...observed, rootRemoved,
      childExited: child.exitCode !== null || child.signalCode !== null }));
  `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { timeout: 20_000 },
    );
    const observed: unknown = JSON.parse(stdout);
    expect(observed).toEqual({
      controlOk: true,
      controlReusable: true,
      completedRemovals: failCleanup ? 1 : 2,
      launches: 1,
      cancelled: true,
      exactReason: true,
      cleanupIncomplete: failCleanup,
      parseStatus: "complete",
      hasModule: true,
      hasProjection: true,
      reusable: false,
      rootRemoved: true,
      childExited: true,
    });
  },
);
