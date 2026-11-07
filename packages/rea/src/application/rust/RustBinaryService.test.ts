import { expect, it } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { parseEvidence, type Evidence } from "../../domain/evidence.js";
import type { RustBinary } from "../../domain/rust/rustBinary.js";
import { ok } from "../../domain/result.js";
import { RustBinaryService } from "./RustBinaryService.js";

const identity = {
  id: "fixture-rust",
  name: "Source-owned Rust reader seam",
  version: "1",
};
const report: RustBinary = {
  artifact: { path: "/artifacts/program", sha256: "a".repeat(64), bytes: 128 },
  format: "elf",
  architecture: "amd64",
  bits: 64,
  byte_order: "little",
  auditable_metadata: {
    section_name: ".dep-v0",
    file_offset: 16,
    section_bytes: 8,
    compressed_bytes: 8,
    uncompressed_bytes: 20,
    format_version: 1,
    packages: [
      {
        name: "sample",
        version: "0.1.0",
        source: "local",
        kind: null,
        dependencies: [],
        features: null,
        root: true,
      },
    ],
    root_package_index: 0,
    dependency_edges: [],
    cyclic_dependency_indices: [],
  },
  rustc_commit: null,
  limitations: [
    "No /rustc/<40-hex>/ path was found in read-only data, so a rustc commit hash is unknown.",
  ],
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "program" });
  const extra = await service.inspect({
    path: report.artifact.path,
    unrecognized: true,
  });
  expect(relative.ok).toBe(false);
  expect(extra.ok).toBe(false);
  if (!relative.ok) expect(relative.error).toBeInstanceOf(AnalysisInputError);
  if (!extra.ok) expect(extra.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});

it("records the selected artifact and the dependency section range", async () => {
  const result = await new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    confidence: "observed",
    subject: { format: "elf", architecture: "x86_64" },
    normalized_result: report,
    locations: [
      { kind: "artifact-path", path: report.artifact.path },
      { kind: "file-offset-range", start: 16, end: 24 },
    ],
  });
  const mismatched: RustBinary = {
    ...report,
    artifact: { ...report.artifact, path: "/artifacts/other" },
  };
  const invalid = await new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => Promise.resolve(ok(mismatched)),
  }).inspect({ path: report.artifact.path });
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.error).toBeInstanceOf(AnalysisOutputError);
});

it("rejects a cycle claim the package dependencies do not contain", async () => {
  if (report.auditable_metadata === null) throw new Error("expected metadata");
  const invalidReport: RustBinary = {
    ...report,
    auditable_metadata: {
      ...report.auditable_metadata,
      cyclic_dependency_indices: [0],
    },
  };
  const result = await new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => Promise.resolve(ok(invalidReport)),
  }).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
});

it("retains completed Rust Evidence on late cancellation and keeps output failure precedence", async () => {
  const controller = new AbortController();
  const reason = { request: "late Rust cancellation" };
  const service = new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => {
      controller.abort(reason);
      return Promise.resolve(ok(report));
    },
  });
  const cancelled = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  expect(cancelled).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: { normalized_result: report },
    },
  });

  const invalidController = new AbortController();
  const mismatched: RustBinary = {
    ...report,
    artifact: { ...report.artifact, path: "/artifacts/other" },
  };
  const invalid = await new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => {
      invalidController.abort();
      return Promise.resolve(ok(mismatched));
    },
  }).inspect(
    { path: report.artifact.path },
    { signal: invalidController.signal },
  );
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
  expect(cancelled.ok).toBe(false);
  if (!cancelled.ok) {
    expect(cancelled.error).toBeInstanceOf(AnalysisCancelledError);
    expect(cancelled.error.cause).toBe(reason);
    expect(parseEvidence(cancelled.error.partialObservation)).toMatchObject({
      operation: "inspect_rust_binary",
      normalized_result: report,
    });
  }
});

it.each([
  { from_index: 1, to_index: 0 },
  { from_index: 0, to_index: 1 },
])("rejects provider edges referencing missing packages: %j", async (edge) => {
  if (report.auditable_metadata === null) throw new Error("expected metadata");
  const invalidReport: RustBinary = {
    ...report,
    auditable_metadata: {
      ...report.auditable_metadata,
      dependency_edges: [edge],
    },
  };
  const result = await new RustBinaryService({
    close: async () => {},
    identity,
    inspect: () => Promise.resolve(ok(invalidReport)),
  }).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
});

it.each([
  null,
  "caller cancellation",
  { request: "opaque caller value" },
  new Error("caller failure"),
  new AnalysisOutputError("caller_operation", "caller-owned cleanup", {
    cleanup: {
      reason: "unresolved caller resource",
      resources: ["caller resource"],
    },
  }),
])(
  "preserves an opaque admission cancellation reason without invoking the reader: %j",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    let calls = 0;
    const service = new RustBinaryService({
      close: async () => {},
      identity,
      inspect: async () => {
        calls += 1;
        throw new Error("cancelled admission must not invoke the reader");
      },
    });
    const result = await service.inspect(null, { signal: controller.signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected cancelled admission");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.partialObservation).toBeUndefined();
    expect(calls).toBe(0);
    if (reason instanceof AnalysisOutputError)
      expect(reason.cleanupIncomplete).toBe(true);
  },
);

it("requires retention and rejects contradictory detail before invoking the reader", async () => {
  let calls = 0;
  const service = new RustBinaryService({
    close: async () => {},
    identity,
    inspect: async () => {
      calls++;
      return ok(report);
    },
  });
  const missing = await service.inspect({
    path: report.artifact.path,
    detail: "summary",
  });
  expect(missing.ok).toBe(false);
  const conflict = await service.inspect({
    path: report.artifact.path,
    detail: "complete",
    view: { collection: "packages" },
  });
  if (conflict.ok) throw new Error("Contradictory delivery was accepted");
  expect(conflict.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});

it("retains the unchanged parent and keeps delivery selectors out of provider inputs", async () => {
  const inputs: unknown[] = [];
  const service = new RustBinaryService({
    close: async () => {},
    identity,
    inspect: async (input) => {
      inputs.push(input);
      return ok(report);
    },
  });
  const first = await service.inspect({ path: report.artifact.path });
  const explicit = await service.inspect({
    path: report.artifact.path,
    detail: "complete",
  });
  if (!first.ok || !explicit.ok) throw new Error("Complete delivery failed");
  expect(explicit.value).toEqual(first.value);
  const records = new Map<string, Evidence>();
  const selected = await service.inspect(
    {
      path: report.artifact.path,
      view: { collection: "packages", names: ["sample"], fields: ["name"] },
    },
    undefined,
    {
      recordEvidence: (evidence) => {
        records.set(evidence.evidence_id, evidence);
        return ok("added" as const);
      },
      evidenceById: (id) => records.get(id),
    },
  );
  if (!selected.ok) throw selected.error;
  expect(selected.value.normalized_result).toMatchObject({
    kind: "rust",
    parent_evidence_id: first.value.evidence_id,
    page: { collection: "packages", rows: [{ index: 0, name: "sample" }] },
  });
  expect(records.get(first.value.evidence_id)).toEqual(first.value);
  expect(inputs).toEqual(
    Array.from({ length: 3 }, () => ({ path: report.artifact.path })),
  );
});
