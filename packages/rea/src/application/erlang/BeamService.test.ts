import { expect, it } from "vitest";
import { BeamService } from "./BeamService.js";
import { ERLANG_BEAM_PROVIDER_IDENTITY } from "../../erlang/BeamProvider.js";
import type { ErlangBeam } from "../../domain/erlang/beam.js";
import { ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";

const identity = ERLANG_BEAM_PROVIDER_IDENTITY;
const report: ErlangBeam = {
  artifact: {
    path: "/artifacts/app.beam",
    sha256: "a".repeat(64),
    bytes: 64,
  },
  form: { location: { offset: 0, bytes: 12 }, size: 4 },
  chunks: [],
  atoms: null,
  atom_encoding: null,
  exports: null,
  imports: null,
  lambdas: null,
  code: null,
  module: null,
  coverage: { status: "complete", examined_chunks: 0, atoms: 0 },
  limitations: ["No atom table was present."],
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new BeamService({
    close: async () => {},
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "app.beam" });
  const extra = await service.inspect({
    path: report.artifact.path,
    extra: true,
  });
  const nul = await service.inspect({ path: "/artifacts/app\0.beam" });
  expect(relative.ok).toBe(false);
  expect(extra.ok).toBe(false);
  expect(nul.ok).toBe(false);
  if (!relative.ok)
    expect(relative.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [{ path: ["path"] }],
    });
  if (!extra.ok) expect(extra.error).toBeInstanceOf(AnalysisInputError);
  if (!nul.ok)
    expect(nul.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [{ path: ["path"] }],
    });
  expect(calls).toBe(0);
});

it("discards an observation if the caller cancels while the provider completes", async () => {
  const controller = new AbortController();
  const reason = { source: "caller-request", operation: "cancel" };
  const service = new BeamService({
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
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
  }
});
