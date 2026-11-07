import { expect, it } from "vitest";
import {
  AnalysisInputError,
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { PythonPyc } from "../../domain/python/pythonPyc.js";
import { ok } from "../../domain/result.js";
import { PythonPycService } from "./PythonPycService.js";

const identity = {
  id: "fixture-python-pyc",
  name: "Source-owned pyc reader seam",
  version: "1",
};

const report: PythonPyc = {
  artifact: {
    path: "/artifacts/sample.pyc",
    sha256: "a".repeat(64),
    bytes: 64,
  },
  header: {
    magic: 3531,
    python_version: "3.12",
    code_layout: "py311",
    flags: 0,
    hash_based: false,
    check_source: false,
    source_hash_hex: null,
    source_mtime: 1,
    source_size: 10,
  },
  code_objects: [
    {
      name: "<module>",
      qualname: "<module>",
      filename: "sample.py",
      firstlineno: 1,
      argcount: 0,
      posonlyargcount: 0,
      kwonlyargcount: 0,
      nlocals: null,
      stacksize: 1,
      flags: 0,
      names: [],
      varnames: null,
      freevars: null,
      cellvars: null,
      localsplusnames: [],
      localspluskinds_hex: "",
      bytecode: { bytes: 2, sha256: "b".repeat(64) },
      consts: [{ kind: "none" }],
      nested_code: [],
    },
  ],
  coverage: {
    status: "complete",
    objects: 4,
    code_objects: 1,
    marshal_bytes: 48,
    marshal_depth: 1,
  },
  limitations: [
    "Bytecode is retained as length and SHA-256 only; this workflow does not decompile, disassemble, or recover source.",
  ],
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new PythonPycService({
    close: async () => {},
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "sample.pyc" });
  const extra = await service.inspect({
    path: report.artifact.path,
    detail: "complete",
  });
  expect(relative.ok).toBe(false);
  expect(extra.ok).toBe(false);
  if (!relative.ok) expect(relative.error).toBeInstanceOf(AnalysisInputError);
  if (!extra.ok) expect(extra.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});

it("records the selected artifact and the header plus marshal ranges", async () => {
  const result = await new PythonPycService({
    close: async () => {},
    identity,
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    confidence: "observed",
    subject: { format: "file" },
    normalized_result: report,
  });
  expect(result.value.locations).toEqual([
    { kind: "artifact-path", path: report.artifact.path },
    { kind: "file-offset-range", start: 0, end: 16 },
    { kind: "file-offset-range", start: 16, end: report.artifact.bytes },
  ]);
});

it("retains completed pyc Evidence and the opaque caller reason on late cancellation", async () => {
  const controller = new AbortController();
  const reason = new AnalysisInputError("opaque caller metadata");
  const service = new PythonPycService({
    close: async () => {},
    identity,
    inspect: () => {
      controller.abort(reason);
      return Promise.resolve(ok(report));
    },
  });
  const result = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    operation: "inspect_python_pyc",
    normalized_result: report,
    subject: { local_path: report.artifact.path },
  });
});

it("retains a pre-admission cancellation reason without calling the pyc provider", async () => {
  const reason = new Error("caller stopped before pyc admission");
  let calls = 0;
  const service = new PythonPycService({
    close: async () => {},
    identity,
    inspect: async () => {
      calls++;
      return ok(report);
    },
  });
  const result = await service.inspect(
    { path: report.artifact.path },
    { signal: AbortSignal.abort(reason) },
  );
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toBeUndefined();
  expect(calls).toBe(0);
});

it("preserves malformed provider output instead of relabeling it as a late abort", async () => {
  const controller = new AbortController();
  const service = new PythonPycService({
    close: async () => {},
    identity,
    inspect: async () => {
      controller.abort(new Error("later caller stop"));
      return ok({
        ...report,
        artifact: { ...report.artifact, path: "/different.pyc" },
      });
    },
  });
  const result = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Expected output failure");
  expect(result.error).toBeInstanceOf(AnalysisOutputError);
  expect(result.error.partialObservation).toBeUndefined();
});
