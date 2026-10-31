import { createHash } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";

const heapObservation = vi.hoisted(() => ({
  reclaimedBytes: 0,
  remainingBytes: 320 * 1024 * 1024,
}));

// Give the parent a stable 64 MiB result envelope after its transfer reserve.
// The child analyzer remains a real separately owned Node process with its
// normal heap and real transfer files/descriptors.
vi.mock("node:v8", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:v8")>();
  return {
    ...actual,
    getHeapStatistics: () => {
      const snapshot = actual.getHeapStatistics();
      // A separate later memoryUsage() read can observe a collection. Keep the
      // limit and usage in this earlier snapshot consistent with each other.
      const used = snapshot.used_heap_size + heapObservation.reclaimedBytes;
      return {
        ...snapshot,
        used_heap_size: used,
        heap_size_limit: used + heapObservation.remainingBytes,
      };
    },
  };
});

import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import { AnalysisResourceConstraintError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";

afterAll(() => {
  vi.doUnmock("node:v8");
  vi.resetModules();
});

async function verifyParentAdmission(reclaimedBytes: number) {
  heapObservation.remainingBytes = 320 * 1024 * 1024;
  heapObservation.reclaimedBytes = reclaimedBytes;
  const methodsCount = 600;
  const text = Array.from(
    { length: methodsCount },
    (_, index) =>
      `export function method_${String(index)}(input) { const value = input + ${String(index)}; const pair = { value }; return pair.value; }`,
  ).join("\n");
  const file: JavaScriptArtifactFile = {
    path: "a-large.mjs",
    sha256: createHash("sha256").update(text).digest("hex"),
    container_sha256: "1".repeat(64),
    bytes: Buffer.byteLength(text),
    inventory_artifact_id: "parent-admission-fixture",
    kind: "javascript",
    unpacked: false,
    text: { included: true, value: text },
  };
  const worker = new JavaScriptAnalysisWorker({
    heapMb: 1024,
    timeoutMs: 30_000,
  });
  try {
    const result = await worker.analyze(file, {
      nodes: 20_000,
      unknowns: 20_000,
    });
    if (result.ok)
      throw new Error(
        "Expected the parent to decline the large semantic graph",
      );
    const { error, javascript, module, projection } = result.error;
    expect(javascript?.parse_status).toBe("complete");
    expect(module?.callables).toHaveLength(methodsCount);
    expect(projection).toBeNull();
    expect(error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "memory",
      reason:
        "Semantic graph for a-large.mjs exceeds the parent's remaining result budget; static and module facts were retained",
    });
    if (!(error instanceof AnalysisResourceConstraintError))
      throw new Error("Expected a typed resource constraint");
    expect(error.reportedLimits).toMatchObject(
      process.versions.bun === undefined
        ? { worker_old_space_mb: 1024 }
        : { worker_heap_limit_bytes: null },
    );
    const limits = error.reportedLimits;
    if (limits === null)
      throw new Error("Parent admission omitted its measured limits");
    expect(limits.parent_result_budget_bytes).toBe(64 * 1024 * 1024);
    const moduleEstimate = limits.module_retention_estimate_bytes;
    const graphEstimate = limits.graph_retention_estimate_bytes;
    const available = limits.parent_available_result_budget_bytes;
    expect(typeof moduleEstimate).toBe("number");
    expect(typeof graphEstimate).toBe("number");
    expect(typeof available).toBe("number");
    if (
      typeof moduleEstimate !== "number" ||
      typeof graphEstimate !== "number" ||
      typeof available !== "number"
    )
      throw new Error(
        "Parent admission omitted its measured transfer estimates",
      );
    expect(moduleEstimate).toBeLessThanOrEqual(available);
    expect(moduleEstimate + graphEstimate).toBeGreaterThan(available);
  } finally {
    await worker.close();
  }
}

it.each([0, 1024 * 1024])(
  "retains module facts and declines only the graph with %i bytes reclaimed between heap observations",
  verifyParentAdmission,
);

it("keeps parent-budget recovery when capacity is exhausted after a static checkpoint", async () => {
  heapObservation.remainingBytes = 320 * 1024 * 1024;
  const text = "export const observed = 7;";
  const file: JavaScriptArtifactFile = {
    path: "checkpoint.mjs",
    sha256: createHash("sha256").update(text).digest("hex"),
    container_sha256: "1".repeat(64),
    bytes: Buffer.byteLength(text),
    inventory_artifact_id: "parent-checkpoint-fixture",
    kind: "javascript",
    unpacked: false,
    text: { included: true, value: text },
  };
  const worker = new JavaScriptAnalysisWorker({
    heapMb: 128,
    timeoutMs: 30_000,
  });
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      undefined,
      async (phase) => {
        // A smaller live parent envelope after the request was admitted still
        // permits decoding this tiny checkpoint, but leaves no result capacity.
        if (phase === "static")
          heapObservation.remainingBytes = 128 * 1024 * 1024;
      },
    );
    if (result.ok)
      throw new Error("Expected a parent checkpoint capacity failure");
    expect(result.error.javascript?.parse_status).toBe("complete");
    expect(result.error.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: { parent_result_budget_exhausted: true },
    });
    expect(
      projectAnalysisError(result.error.error).remediation.action,
    ).toContain("This limit belongs to the parent result budget");
    expect(
      projectAnalysisError(result.error.error).remediation.action,
    ).toContain("Increasing max_heap_mb does not raise it");
  } finally {
    heapObservation.remainingBytes = 320 * 1024 * 1024;
    await worker.close();
  }
});
