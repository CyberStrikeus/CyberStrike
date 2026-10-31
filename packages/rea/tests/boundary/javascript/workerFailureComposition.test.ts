import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  lowHeadroom: false,
  sourceRemoval: false,
  removals: 0,
  onSourceRemoval: undefined as (() => void) | undefined,
}));

vi.mock("node:v8", async (original) => {
  const actual = await original<typeof import("node:v8")>();
  return {
    ...actual,
    getHeapStatistics: () => {
      const observed = actual.getHeapStatistics();
      return faults.lowHeadroom
        ? {
            ...observed,
            heap_size_limit:
              observed.used_heap_size + 192 * 1024 * 1024 + 64 * 1024,
          }
        : observed;
    },
  };
});

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (
        String(args[0]).includes("rea-javascript-analysis-") &&
        String(args[0]).endsWith(".source")
      )
        faults.onSourceRemoval?.();
      if (
        faults.sourceRemoval &&
        String(args[0]).includes("rea-javascript-analysis-") &&
        String(args[0]).endsWith(".source")
      ) {
        faults.removals += 1;
        throw Object.assign(
          new Error("controlled source-file removal failure"),
          { code: "EACCES" },
        );
      }
      return actual.rm(...args);
    },
  };
});

import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { staticCheckpointFacts } from "../../fixtures/javascriptWorkerCheckpoint.js";
import { javaScriptWorkerStaticAnalysisSchema } from "../../../src/javascript/analysis/JavaScriptAnalysisWorkerSchemas.js";

const text = "export const observed = 1;";
const file: JavaScriptArtifactFile = {
  path: "app.mjs",
  sha256: createHash("sha256").update(text).digest("hex"),
  container_sha256: "1".repeat(64),
  bytes: Buffer.byteLength(text),
  inventory_artifact_id: "fixture-source",
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: text },
};
const ready =
  'process.stdout.write(JSON.stringify({kind:"ready",heap_limit_bytes:require("node:v8").getHeapStatistics().heap_size_limit})+"\\n");';

afterEach(() => {
  faults.lowHeadroom = false;
  faults.sourceRemoval = false;
  faults.removals = 0;
  faults.onSourceRemoval = undefined;
});

it.each([
  ["io", false, false],
  ["output", false, false],
  ["output", true, true],
  ["output", false, true],
] as const)(
  "keeps worker %s failure classification distinct at the protocol boundary (cleanup: %s; cancellation: %s)",
  async (reason, deniedCleanup, cancelCleanup) => {
    const controller = new AbortController();
    const cancellation = new Error("cancel during failed job cleanup");
    faults.sourceRemoval = deniedCleanup;
    faults.onSourceRemoval = cancelCleanup
      ? () => controller.abort(cancellation)
      : undefined;
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) =>
        spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); const response={kind:"failure",id:request.id,reason:${JSON.stringify(reason)},resource:null,limits:null,message:"ENOENT: private source copy unavailable"}; process.stdout.write(JSON.stringify(response)+"\\n"); });`,
          ],
        }),
    );
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected worker failure");
      const failure = result.error.error.cleanupPrimary ?? result.error.error;
      expect(result.error.error.cleanupIncomplete).toBe(deniedCleanup);
      if (cancelCleanup) {
        expect(failure.secondaryFailures).toHaveLength(1);
        expect(failure.secondaryFailures[0]).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: cancellation,
        });
      }
      expect(failure._tag).toBe(
        reason === "io" ? "ProviderAdapterError" : "AnalysisOutputError",
      );
      const projected = projectAnalysisError(failure);
      expect(projected.code).toBe(
        reason === "io" ? "execution_failure" : "unreadable_output",
      );
      if (reason === "io") {
        expect(JSON.stringify(projected)).toContain(
          "ENOENT: private source copy unavailable",
        );
        expect(JSON.stringify(projected)).toContain(
          '"phase":"source-transfer"',
        );
        expect(projected.message).toContain("storage failed");
      }
    } finally {
      faults.sourceRemoval = false;
      await worker.close();
    }
  },
);

it.each([false, true])(
  "retains parent projection admission across per-source cleanup failure: %s",
  async (removalFailure) => {
    faults.lowHeadroom = true;
    faults.sourceRemoval = removalFailure;
    const controller = new AbortController();
    const reason = new Error("cancel during denied source-file cleanup");
    faults.onSourceRemoval = removalFailure
      ? () => controller.abort(reason)
      : undefined;
    const sourceMapUrls = [
      {
        declared_url: "app.map",
        location: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 1 },
        },
      },
    ];
    const checkpoint = JSON.stringify(
      javaScriptWorkerStaticAnalysisSchema.parse({
        ...staticCheckpointFacts,
        source_map_urls: sourceMapUrls,
      }),
    );
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) =>
        spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} const fs=require("node:fs"); const {createHash}=require("node:crypto"); const checkpoint=${JSON.stringify(checkpoint)}; require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); if(request.file) {fs.writeFileSync(request.id+".static.json",checkpoint); process.stdout.write(JSON.stringify({kind:"static",id:request.id,bytes:Buffer.byteLength(checkpoint),sha256:createHash("sha256").update(checkpoint).digest("hex")})+"\\n");} else process.stdout.write(JSON.stringify({kind:"complete",id:request.id,descriptor:null})+"\\n"); });`,
          ],
        }),
    );
    let cleanupFailure: ProviderCleanupError | undefined;
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(result.ok).toBe(!removalFailure);
      const retained = result.ok ? result.value : result.error;
      expect(retained.javascript?.source_map_urls).toEqual(sourceMapUrls);
      expect(retained.applicationProjectionFailure).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        reason: expect.stringContaining("Expanded application relationships"),
      });
      if (!result.ok) {
        expect(result.error.error).toBeInstanceOf(ProviderCleanupError);
        expect(result.error.error.cleanupIncomplete).toBe(true);
        expect(worker.canReuse()).toBe(false);
        if (result.error.error instanceof ProviderCleanupError)
          cleanupFailure = result.error.error;
      }
      expect(faults.removals).toBe(removalFailure ? 1 : 0);
      expect(controller.signal.aborted).toBe(removalFailure);
      expect(controller.signal.reason).toBe(
        removalFailure ? reason : undefined,
      );
    } finally {
      faults.sourceRemoval = false;
      await worker.close();
    }
    expect(cleanupFailure?.cleanupIncomplete).toBe(
      removalFailure ? false : undefined,
    );
  },
);

it.each([
  { malformed: true, advertised: true },
  { malformed: false, advertised: true },
  { malformed: true, advertised: false },
  { malformed: false, advertised: false },
])(
  "reads checkpoint bytes strictly with malformed=$malformed and advertised=$advertised",
  async ({ malformed, advertised }) => {
    const valid = Buffer.from(
      JSON.stringify({
        ...staticCheckpointFacts,
        limitations: ["literal � checkpoint"],
      }),
    );
    const replacementAt = valid.indexOf(Buffer.from("�"));
    expect(replacementAt).toBeGreaterThanOrEqual(0);
    const checkpoint = malformed
      ? Buffer.concat([
          valid.subarray(0, replacementAt),
          Buffer.from([0xff]),
          valid.subarray(replacementAt + Buffer.byteLength("�")),
        ])
      : valid;
    let runtimeRoot: string | undefined;
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) => {
        runtimeRoot = request.cwd;
        return spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready}
             const fs=require("node:fs");
             const {createHash}=require("node:crypto");
             const checkpoint=Buffer.from(${JSON.stringify(checkpoint.toString("base64"))},"base64");
             require("node:readline").createInterface({input:process.stdin}).on("line",line=>{
               const request=JSON.parse(line);
               if(request.file){
                 fs.writeFileSync(request.id+".static.json",checkpoint);
                 if(!${advertised}) process.exit(2);
                 process.stdout.write(JSON.stringify({kind:"static",id:request.id,bytes:checkpoint.length,sha256:createHash("sha256").update(checkpoint).digest("hex")})+"\\n");
               } else process.stdout.write(JSON.stringify({kind:"complete",id:request.id,descriptor:null})+"\\n");
             });`,
          ],
        });
      },
    );
    try {
      const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
      expect(result.ok).toBe(advertised && !malformed);
      const retained = result.ok ? result.value : result.error;
      if (malformed) {
        expect(retained.javascript).toBeNull();
        if (result.ok) throw new Error("Expected malformed checkpoint failure");
        if (advertised) {
          expect(result.error.error).toMatchObject({
            _tag: "AnalysisOutputError",
            cause: expect.any(TypeError),
          });
          expect(projectAnalysisError(result.error.error).code).toBe(
            "unreadable_output",
          );
          expect(result.error.error.message).not.toContain(
            "digest does not match",
          );
        }
      } else {
        expect(retained.javascript?.limitations).toEqual([
          "literal � checkpoint",
        ]);
      }
      if (!advertised) {
        if (result.ok) throw new Error("Expected worker crash failure");
        expect(result.error.error).toMatchObject({
          _tag: "ProviderAdapterError",
        });
      }
    } finally {
      await worker.close();
    }
    if (runtimeRoot === undefined)
      throw new Error(
        "Owned analyzer did not expose its runtime root to launcher",
      );
    await expect(access(runtimeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
