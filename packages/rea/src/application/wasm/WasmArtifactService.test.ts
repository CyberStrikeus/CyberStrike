import { rebindEvidenceToTargetPath } from "../../domain/evidence.js";
import { EvidenceLedger } from "../investigation/EvidenceLedger.js";
import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import { compareWasmInterfaces } from "./WasmInterfaceComparisonService.js";
import { AnalysisSettings } from "../AnalysisSettings.js";
import { expect, it } from "vitest";
import { WasmArtifactService } from "./WasmArtifactService.js";
import {
  wasmArtifactFixture,
  wasmArtifactExecution,
} from "../../../tests/fixtures/wasm/artifact.js";
import { ok } from "../../domain/result.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
it.each([
  { path: "relative" },
  { path: "/module", glue_paths: ["relative"] },
  { path: "/module", candidate_paths: ["relative"] },
  { path: "/module", fetch: true },
  ...[0, -1, 1.5, 2_147_483_648, "1000", null].map((command_timeout_ms) => ({
    path: "/module",
    command_timeout_ms,
  })),
])("rejects invalid selection before effects: %j", async (input) => {
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: () => {
      throw new Error("Must not execute");
    },
  });
  expect(await service.inspect(input)).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
});

it("preserves the selected command budget in provider input and Evidence", async () => {
  const value = wasmArtifactFixture();
  value.tool_profile.timeout_ms = 42_000;
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: async (input) => {
      expect(input).toMatchObject({ command_timeout_ms: 42_000 });
      return ok(wasmArtifactExecution(value));
    },
  });
  const result = await service.inspect({
    path: value.artifact.path,
    command_timeout_ms: 42_000,
  });
  if (!result.ok) throw result.error;
  expect(result.value.parameters).toMatchObject({ command_timeout_ms: 42_000 });
  expect(result.value.normalized_result).toEqual(value);
});

it("rejects a provider report that silently changes the selected command budget", async () => {
  const value = wasmArtifactFixture();
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: async () => ok(wasmArtifactExecution(value)),
  });
  expect(
    await service.inspect({
      path: value.artifact.path,
      command_timeout_ms: 42_000,
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
});
it.each(["path", "subject-path", "digest", "wat", "candidates", "glue"])(
  "rejects mismatched upstream observation: %s",
  async (problem) => {
    const value = wasmArtifactFixture();
    if (problem === "path") value.artifact.path = "/different";
    if (problem === "wat") value.wat.sha256 = "b".repeat(64);
    if (problem === "candidates") value.candidates = [];
    const execution = wasmArtifactExecution(value);
    const service = new WasmArtifactService({
      close: () => Promise.resolve(),
      inspect: () =>
        Promise.resolve(
          ok({
            ...execution,
            subject: {
              path:
                problem === "subject-path"
                  ? "/different"
                  : "/artifacts/module.wasm",
              format: "file",
              sha256:
                problem === "digest" ? "b".repeat(64) : value.artifact.sha256,
            },
          }),
        ),
    });
    expect(
      await service.inspect({
        path: "/artifacts/module.wasm",
        ...(problem === "glue" ? { glue_paths: ["/glue.js"] } : {}),
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  },
);
it("cancels before provider work and delivers observed Evidence on success", async () => {
  const value = wasmArtifactFixture();
  let calls = 0;
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: () => {
      calls++;
      return Promise.resolve(ok(wasmArtifactExecution(value)));
    },
  });
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "wasm-stop" });
  controller.abort(reason);
  const cancelled = await service.inspect(
    { path: value.artifact.path },
    { signal: controller.signal },
  );
  expect(cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(cancelled.ok ? undefined : cancelled.error.cause).toBe(reason);
  expect(calls).toBe(0);
  expect(await service.inspect({ path: value.artifact.path })).toMatchObject({
    ok: true,
    value: { confidence: "observed", normalized_result: value },
  });
});

it.each([false, true])(
  "retains provider provenance after completion (late cancellation: %s)",
  async (cancel) => {
    const value = wasmArtifactFixture();
    const execution = wasmArtifactExecution(value);
    const profile = createAnalysisProfile(
      { ...execution.provider, version: "1" },
      {
        features: "selected",
      },
    );
    const coverage = {
      status: "unknown",
      reason: "No call graph examined",
    } as const;
    const controller = new AbortController();
    const service = new WasmArtifactService({
      close: () => Promise.resolve(),
      inspect: async () => {
        if (cancel) controller.abort();
        return ok({
          ...execution,
          rawResult: { stdout: "retained command output" },
          analysisProfile: profile,
          relationshipCoverage: coverage,
        });
      },
    });

    const result = await service.inspect(
      { path: value.artifact.path },
      { signal: controller.signal },
    );
    if (cancel)
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
    else expect(result.ok).toBe(true);
    const evidence = result.ok ? result.value : result.error.partialObservation;
    expect(evidence).toMatchObject({
      normalized_result: value,
      raw_result: { stdout: "retained command output" },
      analysis_profile: profile,
      relationship_coverage: coverage,
    });
  },
);

it("preserves malformed-output failure when cancellation arrives with it", async () => {
  const value = wasmArtifactFixture();
  const controller = new AbortController();
  const malformed = { ...wasmArtifactExecution(value), result: {} };
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: async () => {
      controller.abort();
      return ok(malformed);
    },
  });

  expect(
    await service.inspect(
      { path: value.artifact.path },
      { signal: controller.signal },
    ),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});

it("gives cancellation precedence over malformed raw input", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: () => {
      calls++;
      return Promise.resolve(ok(wasmArtifactExecution()));
    },
  });
  const malformed = { path: "relative.wasm" };
  expect(
    await service.inspect(malformed, { signal: controller.signal }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
  expect(await service.inspect(malformed)).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  expect(calls).toBe(0);
});

it("uses runtime defaults only for omitted budgets, preserving explicit input and reset", async () => {
  const settings = new AnalysisSettings({});
  const accepted: number[] = [];
  const authored: (number | undefined)[] = [];
  const service = new WasmArtifactService(
    {
      close: async () => {},
      inspect: async (input, options) => {
        const value = wasmArtifactFixture();
        value.tool_profile.timeout_ms = options!.commandTimeoutMs!;
        accepted.push(options!.commandTimeoutMs!);
        authored.push(input.command_timeout_ms);
        return ok(wasmArtifactExecution(value));
      },
    },
    settings.read,
  );
  expect(
    settings.update({
      changes: [
        { setting: "wasm.command_timeout_ms", action: "set", value: 123000 },
      ],
    }).ok,
  ).toBe(true);
  const path = wasmArtifactFixture().artifact.path;
  expect((await settings.run(() => service.inspect({ path }))).ok).toBe(true);
  expect(
    (
      await settings.run(() =>
        service.inspect({ path, command_timeout_ms: 42000 }),
      )
    ).ok,
  ).toBe(true);
  settings.update({
    changes: [{ setting: "wasm.command_timeout_ms", action: "reset" }],
  });
  expect((await settings.run(() => service.inspect({ path }))).ok).toBe(true);
  expect(accepted).toEqual([123000, 42000, 30000]);
  expect(authored).toEqual([undefined, 42000, undefined]);
});

it("replays imported rebound WASM Evidence in views and comparisons", async () => {
  const report = wasmArtifactFixture();
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect: async () => ok(wasmArtifactExecution(report)),
  });
  const completed = await service.inspect({ path: report.artifact.path });
  if (!completed.ok) throw completed.error;
  const rebound = rebindEvidenceToTargetPath(completed.value, {
    path: "/alias/module.wasm",
    sha256: report.artifact.sha256,
    format: "file",
  });
  const exporting = new EvidenceLedger();
  expect(exporting.record(rebound).ok).toBe(true);
  const imported = new EvidenceLedger();
  expect(imported.import(exporting.export()).ok).toBe(true);
  const lookup = (id: string) => imported.forAnalysis(id);
  const replay = await inspectAnalysisView(
    {
      source: { kind: "retained-evidence", evidence_id: rebound.evidence_id },
      view: { kind: "summary" },
    },
    lookup,
  );
  if (!replay.ok) throw replay.error;
  expect(replay.value.subject?.local_path).toBe("/alias/module.wasm");
  expect(replay.value.normalized_result).toMatchObject({
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
  });
  expect(
    (
      await compareWasmInterfaces(
        {
          left: { kind: "retained-evidence", evidence_id: rebound.evidence_id },
          right: {
            kind: "retained-evidence",
            evidence_id: rebound.evidence_id,
          },
          scope: "both",
        },
        {},
        lookup,
      )
    ).ok,
  ).toBe(true);
});
