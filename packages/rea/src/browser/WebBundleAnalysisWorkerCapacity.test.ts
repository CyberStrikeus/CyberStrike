import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

const heapLimit = vi.hoisted(() => ({ override: null as number | null }));

vi.mock("node:v8", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:v8")>();
  return {
    ...actual,
    getHeapStatistics: () => {
      const statistics = actual.getHeapStatistics();
      return heapLimit.override === null
        ? statistics
        : { ...statistics, heap_size_limit: heapLimit.override };
    },
  };
});

import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { createWebTextArtifact } from "../domain/webContentArtifact.js";
import type { IncludedScript } from "../domain/webBundleAnalyzerState.js";
import { WebBundleAnalysisWorker } from "./WebBundleAnalysisWorker.js";

it("refuses before spawning or reading source when no host result capacity remains", async () => {
  const text = "fetch('/never-serialized');";
  const base = makeScript(text);
  let sourceReads = 0;
  let launches = 0;
  const artifact = { ...base.source.artifact };
  Object.defineProperty(artifact, "text", {
    configurable: true,
    get: () => {
      sourceReads += 1;
      return text;
    },
  });
  const script: IncludedScript = {
    ...base,
    source: { included: true, artifact },
  };
  const worker = new WebBundleAnalysisWorker(1024, async () => {
    launches += 1;
    throw new Error(
      "The worker must not launch when the host has no result capacity",
    );
  });
  heapLimit.override = 0;

  try {
    const result = await worker.analyze(script, 10_000);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected result-capacity refusal");
    const refusal = result.error.error;
    expect(refusal).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(refusal instanceof AnalysisResourceConstraintError))
      throw new Error("Expected a result-capacity refusal");
    expect(refusal.message).toContain("host result capacity 0 bytes");
    expect(refusal.message).toContain("still has 8388608 bytes");
    expect(refusal.message).not.toContain("has no further room");
    expect(refusal.remediationAction).toContain("NODE_OPTIONS");
    expect(result.error.continuation).toBe("result_capacity_exhausted");
    expect(result.error.completed).toBeNull();
    expect(sourceReads).toBe(0);
    expect(launches).toBe(0);
  } finally {
    heapLimit.override = null;
    await worker.close();
  }
});

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
