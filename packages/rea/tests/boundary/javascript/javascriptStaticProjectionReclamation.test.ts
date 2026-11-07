import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

const heap = vi.hoisted(() => ({
  remainingBytes: 200 * 1024 * 1024,
  readings: [] as number[],
}));
vi.mock("node:v8", async (load) => {
  const actual = await load<typeof import("node:v8")>();
  return {
    ...actual,
    getHeapStatistics: () => {
      const current = actual.getHeapStatistics();
      return {
        ...current,
        heap_size_limit:
          current.used_heap_size +
          (heap.readings.shift() ?? heap.remainingBytes),
      };
    },
  };
});

// Bound the parent-side maximum checkpoint reservation for this controlled
// test. The child still emits actual, digest-verified complete checkpoints.
vi.mock(
  "../../../src/domain/javascript/javascriptAnalysisResourceControls.js",
  async (load) => {
    const actual =
      await load<
        typeof import("../../../src/domain/javascript/javascriptAnalysisResourceControls.js")
      >();
    return { ...actual, JAVASCRIPT_STATIC_FACT_BYTES: 256 * 1024 };
  },
);

import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import { AnalysisResourceConstraintError } from "../../../src/domain/analysisErrorCore.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
const file = (path: string, count: number): JavaScriptArtifactFile => {
  const text = Array.from(
    { length: count },
    (_, i) => `localStorage.setItem('k${i}', 'v');`,
  ).join("\n");
  return {
    path,
    container_sha256: "a".repeat(64),
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    inventory_artifact_id: path,
    kind: "javascript",
    unpacked: false,
    text: { included: true, value: text },
  };
};
it("uses one live heap observation for revocation and static admission", async () => {
  const run = async (changeHeapAt?: number) => {
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 512, timeoutMs: 30_000 },
      undefined,
      8,
    );
    const results = [];
    try {
      for (let i = 0; i < 8; i++) {
        const index = i;
        results.push(
          await worker.analyze(
            file(`${i}.js`, i === 0 ? 50 : 500),
            { nodes: 1, unknowns: 1 },
            undefined,
            async (phase) => {
              if (phase === "static" && index === changeHeapAt)
                heap.readings = [200, 200, 192, 192].map(
                  (mib) => mib * 1024 * 1024,
                );
            },
          ),
        );
        heap.readings = [];
      }
      return results;
    } finally {
      heap.readings = [];
      await worker.close();
    }
  };
  const control = await run();
  const at = control.findIndex((result) =>
    (result.ok ? result.value : result.error).revokedStaticProjections?.some(
      ({ sourceIndex }) => sourceIndex === 0,
    ),
  );
  expect(at).toBeGreaterThan(0);
  const changed = await run(at);
  const observed = changed[at];
  if (observed === undefined) throw new Error("Missing changed observation");
  const detail = observed.ok ? observed.value : observed.error;
  expect(
    detail.revokedStaticProjections?.map(({ sourceIndex }) => sourceIndex),
  ).toContain(0);
  if (
    !observed.ok &&
    observed.error.error instanceof AnalysisResourceConstraintError
  )
    expect(
      observed.error.error.reportedLimits?.parent_result_budget_exhausted,
    ).not.toBe(true);
});

it("reclaims prior unmaterialized projections only when a complete static checkpoint would otherwise exhaust the result budget", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 512, timeoutMs: 30_000 },
    undefined,
    8,
  );
  const results = [];
  try {
    for (let i = 0; i < 8; i++)
      results.push(
        await worker.analyze(file(`${i}.js`, i === 0 ? 50 : 500), {
          nodes: 1,
          unknowns: 1,
        }),
      );
    const details = results.map((r) => (r.ok ? r.value : r.error));
    expect(
      details.every((d) => d.javascript?.parse_status === "complete"),
    ).toBe(true);
    expect(
      details.some(
        (d) =>
          "error" in d &&
          d.error instanceof AnalysisResourceConstraintError &&
          d.error.reportedLimits?.parent_result_budget_exhausted === true,
      ),
    ).toBe(false);
    expect(
      details
        .flatMap((d) => d.revokedStaticProjections ?? [])
        .map((d) => d.sourceIndex),
    ).toContain(0);
  } finally {
    await worker.close();
  }
});

it("keeps earlier projections when reclaiming them cannot admit the checkpoint", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 512, timeoutMs: 30_000 },
    undefined,
    5,
  );
  try {
    const results = [];
    for (let i = 0; i < 5; i++)
      results.push(
        await worker.analyze(file(`${i}.js`, i === 0 ? 10 : 1000), {
          nodes: 1,
          unknowns: 1,
        }),
      );
    const details = results.map((result) =>
      result.ok ? result.value : result.error,
    );
    expect(results[0]?.ok).toBe(true);
    expect(details[0]?.applicationProjectionFailure).toBeUndefined();
    expect(
      details.flatMap((detail) => detail.revokedStaticProjections ?? []),
    ).toEqual([]);
    expect(results.at(-1)?.ok).toBe(false);
    const last = results.at(-1);
    if (last === undefined || last.ok)
      throw new Error("Expected capacity refusal");
    expect(last.error.error).toMatchObject({
      reportedLimits: { parent_result_budget_exhausted: true },
    });
  } finally {
    await worker.close();
  }
});

it("resets projection reservations and source indices when an idle worker is reused", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 512, timeoutMs: 30_000 },
    undefined,
    1,
  );
  try {
    const first = await worker.analyze(file("previous.js", 10), {
      nodes: 1,
      unknowns: 1,
    });
    expect(first.ok).toBe(true);
    expect(worker.prepareForAnotherAnalysis(8)).toBe(true);
    const results = [];
    for (let i = 0; i < 7; i++)
      results.push(
        await worker.analyze(file(`new-${i}.js`, i === 0 ? 50 : 500), {
          nodes: 1,
          unknowns: 1,
        }),
      );
    const revocations = results.flatMap(
      (r) => (r.ok ? r.value : r.error).revokedStaticProjections ?? [],
    );
    expect(revocations.map((entry) => entry.sourceIndex)).toEqual([0]);
    expect(revocations[0]?.error.message).toContain("new-0.js");
    expect(revocations[0]?.error.message).not.toContain("previous.js");
  } finally {
    await worker.close();
  }
});

it("does not discard earlier projections when live heap, not reservations, blocks admission", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 512, timeoutMs: 30_000 },
    undefined,
    2,
  );
  try {
    const first = await worker.analyze(file("first.js", 10), {
      nodes: 1,
      unknowns: 1,
    });
    expect(first.ok).toBe(true);
    const second = await worker.analyze(
      file("second.js", 1000),
      { nodes: 1, unknowns: 1 },
      undefined,
      async (phase) => {
        if (phase === "static") heap.remainingBytes = 192 * 1024 * 1024;
      },
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("Expected live heap refusal");
    expect(second.error.error).toMatchObject({
      reportedLimits: { parent_result_budget_exhausted: true },
    });
    expect(second.error.revokedStaticProjections).toBeUndefined();
  } finally {
    heap.remainingBytes = 200 * 1024 * 1024;
    await worker.close();
  }
});
