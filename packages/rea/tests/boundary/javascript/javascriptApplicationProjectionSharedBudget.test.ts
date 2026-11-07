import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, expect, it, vi } from "vitest";

const MIB = 1024 * 1024;
const TRANSFER_RESERVE = 24 * 8 * MIB;
const parentHeap = vi.hoisted(() => ({ remainingBytes: 0 }));

// Give the parent an exact result budget: (remaining heap - transfer
// reserve) / 2. The analyzer is a real separately owned process that replays
// one recorded static checkpoint per source.
vi.mock("node:v8", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:v8")>();
  return {
    ...actual,
    getHeapStatistics: () => {
      const observed = actual.getHeapStatistics();
      return {
        ...observed,
        heap_size_limit: observed.used_heap_size + parentHeap.remainingBytes,
      };
    },
  };
});

import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { estimateJavaScriptStaticApplicationProjection } from "../../../src/domain/javascript/javascriptApplicationProjectionResources.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { analyzeJavaScriptStaticSource } from "../../../src/domain/javascript/javascriptStaticAnalysis.js";
import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import { javaScriptWorkerStaticAnalysisSchema } from "../../../src/javascript/analysis/JavaScriptAnalysisWorkerSchemas.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

afterAll(() => {
  vi.doUnmock("node:v8");
  vi.resetModules();
});

// Matches STATIC_CHECKPOINT_RETENTION_EXPANSION and the per-source checkpoint
// reserve (8 MiB checkpoint ceiling at that expansion) in the worker.
const STATIC_EXPANSION = 6;
const CHECKPOINT_RESERVE = 8 * MIB * STATIC_EXPANSION;

const text = Array.from(
  { length: 12 },
  (_, index) =>
    `export function f${String(index)}(a){` +
    `localStorage.setItem("pref.${String(index % 3)}",String(a));` +
    `return fetch("/rpc/p${String(index % 4)}",{method:"POST",body:a});}`,
).join("\n");

const sourceFile = (path: string): JavaScriptArtifactFile => ({
  path,
  sha256: createHash("sha256").update(text).digest("hex"),
  container_sha256: "1".repeat(64),
  bytes: Buffer.byteLength(text),
  inventory_artifact_id: `fixture-${path}`,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: text },
});

const ready =
  'process.stdout.write(JSON.stringify({kind:"ready",heap_limit_bytes:require("node:v8").getHeapStatistics().heap_size_limit})+"\\n");';

// Replay a recorded checkpoint per source path (the default otherwise) and
// complete without a semantic transfer, so only static and
// application-projection charges reach the shared budget.
const replayingAnalyzer =
  (checkpointPath: string, byPath: Readonly<Record<string, string>> = {}) =>
  async (request: Parameters<typeof spawnOwnedProviderProcess>[0]) =>
    spawnOwnedProviderProcess({
      ...request,
      arguments: [
        "-e",
        `${ready} const fs=require("node:fs"); const {createHash}=require("node:crypto"); const byPath=${JSON.stringify(byPath)}; require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); if(request.file) {const checkpoint=fs.readFileSync(byPath[request.file.path] ?? ${JSON.stringify(checkpointPath)}); fs.writeFileSync(request.id+".static.json",checkpoint); process.stdout.write(JSON.stringify({kind:"static",id:request.id,bytes:checkpoint.length,sha256:createHash("sha256").update(checkpoint).digest("hex")})+"\\n");} else process.stdout.write(JSON.stringify({kind:"complete",id:request.id,descriptor:null})+"\\n"); });`,
      ],
    });

it("admits application relationships up to the shared parent budget and keeps static facts beyond it", async () => {
  const facts = javaScriptWorkerStaticAnalysisSchema.parse(
    analyzeJavaScriptStaticSource(text),
  );
  const checkpoint = JSON.stringify(facts);
  const checkpointBytes = Buffer.byteLength(checkpoint);
  const paths = ["a.mjs", "b.mjs", "c.mjs", "d.mjs", "e.mjs"];
  const staticCharge = checkpointBytes * STATIC_EXPANSION;
  const projection = estimateJavaScriptStaticApplicationProjection(
    facts,
    checkpointBytes,
    "a.mjs",
  );
  // Sources 1-3 fit exactly; source 4 misses by half a source, while its
  // static facts still fit. The last source has no checkpoint reserve left
  // to hold back, so it fits again.
  const budget =
    CHECKPOINT_RESERVE +
    3 * (staticCharge + projection) +
    Math.floor((staticCharge + projection) / 2);
  parentHeap.remainingBytes = TRANSFER_RESERVE + 2 * budget;
  const root = await createTestTempDirectory("rea-shared-projection-budget-");
  const checkpointPath = join(root, "checkpoint.json");
  await writeFile(checkpointPath, checkpoint);
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    replayingAnalyzer(checkpointPath),
    paths.length,
  );
  try {
    const outcomes = [];
    for (const path of paths) {
      const result = await worker.analyze(sourceFile(path), {
        nodes: 100,
        unknowns: 100,
      });
      if (!result.ok) throw result.error.error;
      outcomes.push(result.value);
    }

    expect(projection).toBeGreaterThan(staticCharge);
    expect(outcomes.map(({ javascript }) => javascript.storage.length)).toEqual(
      paths.map(() => facts.storage.length),
    );
    expect(
      outcomes.map(
        ({ applicationProjectionFailure }) =>
          applicationProjectionFailure !== undefined,
      ),
    ).toEqual([false, false, false, true, false]);
    expect(outcomes[3]?.applicationProjectionFailure).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reason: expect.stringContaining(
        "Expanded application relationships for d.mjs exceed the parent's result budget",
      ),
      reportedLimits: {
        parent_result_budget_bytes: budget,
        application_projection_required_bytes: projection,
      },
    });
  } finally {
    await worker.close();
  }
});

it("charges nothing for a large rejected checkpoint before a valid source", async () => {
  const facts = javaScriptWorkerStaticAnalysisSchema.parse(
    analyzeJavaScriptStaticSource(text),
  );
  const checkpoint = JSON.stringify(facts);
  const checkpointBytes = Buffer.byteLength(checkpoint);
  // A 3 MiB checkpoint cut off inside a string: within the checkpoint ceiling
  // and the parent's decode headroom, but not JSON.
  const malformed = `${checkpoint.slice(0, -1)},"padding":"${"x".repeat(3 * MIB)}`;
  const malformedCharge = Buffer.byteLength(malformed) * STATIC_EXPANSION;
  const staticCharge = checkpointBytes * STATIC_EXPANSION;
  const projection = estimateJavaScriptStaticApplicationProjection(
    facts,
    checkpointBytes,
    "b.mjs",
  );
  // The valid last source fits with half of the rejected checkpoint's static
  // charge to spare, so any charge kept for rejected bytes refuses it.
  const budget = staticCharge + projection + Math.floor(malformedCharge / 2);
  expect(malformedCharge).toBeGreaterThan(2 * (staticCharge + projection));
  parentHeap.remainingBytes = TRANSFER_RESERVE + 2 * budget;
  const root = await createTestTempDirectory("rea-shared-budget-rejected-");
  const checkpointPath = join(root, "checkpoint.json");
  const malformedPath = join(root, "malformed.json");
  await writeFile(checkpointPath, checkpoint);
  await writeFile(malformedPath, malformed);
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    replayingAnalyzer(checkpointPath, { "a.mjs": malformedPath }),
    2,
  );
  try {
    const rejected = await worker.analyze(sourceFile("a.mjs"), {
      nodes: 100,
      unknowns: 100,
    });
    if (rejected.ok)
      throw new Error("Expected the malformed checkpoint to fail");
    expect(rejected.error.javascript).toBeNull();
    expect(rejected.error.error).toMatchObject({
      _tag: "AnalysisOutputError",
    });
    expect(projectAnalysisError(rejected.error.error).code).toBe(
      "unreadable_output",
    );

    const valid = await worker.analyze(sourceFile("b.mjs"), {
      nodes: 100,
      unknowns: 100,
    });
    if (!valid.ok) throw valid.error.error;
    expect(valid.value.javascript.storage).toEqual(facts.storage);
    expect(valid.value.applicationProjectionFailure).toBeUndefined();
  } finally {
    await worker.close();
  }
});
