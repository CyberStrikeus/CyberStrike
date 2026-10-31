import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, it } from "vitest";

it.each([
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [true, true, false],
  [false, true, true],
])(
  "retains completed web worker facts when cancellation arrives during final job cleanup (cleanup failure: %s; prior failure: %s; stop cleanup failure: %s)",
  async (failCleanup, priorFailure, stopCleanupFailure) => {
    const loaderUrl = new URL(
      "../../../scripts/lib/verifier-source-loader.mjs",
      import.meta.url,
    ).href;
    const workerUrl = new URL(
      "../../../src/browser/WebBundleAnalysisWorker.ts",
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
      const finalJobRemoval = String(path).includes('rea-web-bundle-analysis-') && String(path).endsWith('.result');
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
    const { WebBundleAnalysisWorker } = await importVerifierSource(new URL(${JSON.stringify(workerUrl)}));
    const { spawnOwnedProviderProcess } = await importVerifierSource(new URL(${JSON.stringify(processUrl)}));
    const { createWebTextArtifact } = await importVerifierSource(new URL('../../../src/domain/webContentArtifact.ts', ${JSON.stringify(import.meta.url)}));
    const value = 'export const observed = 7;';
    const source = path => ({ script_key: 'scr_' + createHash('sha256').update(value).digest('hex'),
      frame_id: 'frame-1', url: 'https://app.example.test/' + path, origin: 'https://app.example.test',
      cdp_hash: null, length: Buffer.byteLength(value), is_module: true, language: 'JavaScript', source_map_url: null,
      resource_reconciliation: {status: 'unmatched', reason: 'no_exact_sanitized_url'},
      source: {included: true, artifact: createWebTextArtifact(value, 'application/javascript')} });
    let root;
    let child;
    let launches = 0;
    const worker = new WebBundleAnalysisWorker(128, async request => {
      root = request.cwd;
      const spawned = await spawnOwnedProviderProcess(${JSON.stringify(priorFailure)} ? {
        ...request,
        arguments: ['-e', 'const send = value => process.stdout.write(JSON.stringify(value) + "\\n"); send({kind:"ready",heap_limit_bytes:require("node:v8").getHeapStatistics().heap_size_limit}); require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); send({kind:"failure",id:request.id,reason:"output",message:"fixture output failure"}); });'],
      } : request);
      child = spawned.process;
      launches += 1;
      return {
        ...spawned,
        cleanup: async () => {
          if (cancelOnCleanup && ${JSON.stringify(stopCleanupFailure)}) {
            controller.abort(reason);
            return { cleaned: false, reason: 'fixture process cleanup denied' };
          }
          const { cleanupOwnedProcessGroup } = await importVerifierSource(new URL('../../../src/process/ProcessOwnership.ts', ${JSON.stringify(import.meta.url)}));
          return spawned.cleanup ? spawned.cleanup() : cleanupOwnedProcessGroup(spawned.ownership);
        },
      };
    });
    let observed;
    try {
      const control = await worker.analyze(source('control.mjs'), 5000);

      cancelOnCleanup = true;
      const cancelled = await worker.analyze(source('cancelled.mjs'), 5000, controller.signal);
      const facts = cancelled.ok ? cancelled.value : cancelled.error;
      const primary = cancelled.ok ? undefined : (cancelled.error.error.cleanupPrimary ?? cancelled.error.error);
      const cancellation = primary?._tag === 'AnalysisCancelledError' ? primary : primary?.secondaryFailures.find(failure => failure._tag === 'AnalysisCancelledError');
      observed = { primaryOutput: primary?._tag === 'AnalysisOutputError', secondaryCount: primary?.secondaryFailures.length ?? 0, controlOk: control.ok, completedRemovals, launches,
        cancelled: cancellation !== undefined,
        exactReason: cancellation?.cause === reason,
        cleanupIncomplete: !cancelled.ok && cancelled.error.error.cleanupIncomplete,
        hasFacts: facts.status === 'analyzed' || facts.completed?.status === 'analyzed' };
    } finally {
      cancelOnCleanup = false;
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
      primaryOutput: priorFailure,
      secondaryCount: priorFailure ? 1 : 0,
      controlOk: !priorFailure,
      completedRemovals: failCleanup || stopCleanupFailure ? 1 : 2,
      launches: priorFailure ? 2 : 1,
      cancelled: true,
      exactReason: true,
      cleanupIncomplete: failCleanup || stopCleanupFailure,
      hasFacts: !priorFailure,
      rootRemoved: true,
      childExited: true,
    });
  },
);
