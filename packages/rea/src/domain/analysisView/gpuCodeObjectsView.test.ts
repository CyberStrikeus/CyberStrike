import { expect, it } from "vitest";
import { createEvidence } from "../evidence.js";
import { freezeOwnedJsonTreeSnapshot } from "../immutableJson.js";
import { gpuCodeObjectsSchema } from "../gpu/gpuCodeObjects.js";
import type { AnalysisViewParent } from "./analysisView.js";
import {
  gpuCodeObjectsItemsSchema,
  projectGpuCodeObjectsView,
} from "./gpuCodeObjectsView.js";

const report = () =>
  gpuCodeObjectsSchema.parse({
    artifact: {
      path: "/gpu",
      file_size: 0,
      sha256: "a".repeat(64),
      bytes_read: 0,
    },
    format: "elf",
    analysis: "inventory",
    objects: [],
    kernels: [],
    ptx_artifacts: [],
    coverage: {
      discovery_scope: "supported-section-names-and-standalone-formats",
      discovery: "partial",
      payloads: "not-requested",
      examined_sections: 0,
      unknown_section_names: 0,
    },
    limitations: ["No sections examined."],
  });

const parent = (normalizedResult: unknown): AnalysisViewParent => ({
  evidenceId: `ev_${"b".repeat(64)}`,
  operation: "inspect_gpu_code_objects",
  normalizedResult,
  sealedResult: true,
  limitations: [],
});

it("checks each subject despite reusable GPU summary indexes", () => {
  const source = freezeOwnedJsonTreeSnapshot(report());
  const input = parent(source);
  expect(projectGpuCodeObjectsView(input, { kind: "summary" }).ok).toBe(true);
  const subject = createEvidence(
    { path: "/other", sha256: "b".repeat(64), format: "file" },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: input.operation,
      parameters: {},
      result: source,
      confidence: "observed",
    },
  ).subject;
  expect(
    projectGpuCodeObjectsView({ ...input, subject }, { kind: "summary" }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
});

it("revalidates mutable GPU facts and preserves incomplete source coverage", () => {
  const source = report();
  Object.freeze(source);
  const input = parent(source);
  const first = projectGpuCodeObjectsView(input, { kind: "summary" });
  expect(first).toMatchObject({
    ok: true,
    value: {
      summary: {
        coverage: { discovery: "partial", payloads: "not-requested" },
      },
    },
  });
  Object.assign(source.artifact, { sha256: "invalid" });
  expect(projectGpuCodeObjectsView(input, { kind: "summary" })).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
});

it("preserves omitted AMD metadata columns instead of inventing null metadata", () => {
  const items = [
    {
      id: "object",
      kind: "amdgpu",
      target: "gfx900",
      payload_target: "gfx900",
      target_consistency: "single-source",
      inspection: "complete",
      location: {
        container_id: null,
        offset: 0,
        size: 64,
        section_index: null,
        section_name: null,
      },
      metadata_location: {
        container_id: null,
        offset: 0,
        size: 64,
        section_index: null,
        section_name: null,
      },
    },
  ];
  expect(gpuCodeObjectsItemsSchema.parse(items)).toEqual(items);
});
