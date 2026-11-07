import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  readRuntimeReconciliationInput,
  reconcileJavaScriptRuntime,
} from "../../../src/domain/javascript/javascriptRuntimeReconciliation.js";
import { reconcileJavaScriptRuntimeInputSchema } from "../../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";

import {
  SOURCE,
  applicationFixture,
  analyzeFixture,
  electronRuntimeEvidence,
} from "../../fixtures/javascriptRuntimeReconciliation.js";

const reconcileInput = (input: unknown) => {
  const result = readRuntimeReconciliationInput(
    reconcileJavaScriptRuntimeInputSchema.parse(input),
  );
  if (!result.ok) throw result.error;
  return reconcileJavaScriptRuntime(result.value);
};

const execute = promisify(execFile);

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

it("keeps byte-identical cross-layer candidates explicitly ambiguous", async () => {
  const application = await applicationFixture();
  const assets = await createTestTempDirectory("rea-runtime-assets-static-");
  const runtime = await createTestTempDirectory("rea-runtime-assets-live-");
  temporary.push(application, assets, runtime);
  await Promise.all([
    writeFile(join(assets, "app.js"), SOURCE),
    writeFile(join(runtime, "app.js"), SOURCE),
    writeFile(join(runtime, "index.html"), "<script></script>"),
  ]);
  const result = reconcileInput({
    static_layers: [
      {
        role: "application",
        analysis: await analyzeFixture(application),
      },
      { role: "assets", analysis: await analyzeFixture(assets) },
    ],
    runtime_observations: [
      electronRuntimeEvidence(runtime, SOURCE, { includeWorker: false }),
    ],
  });
  const script = result.reconciliations.find(
    ({ entity_kind: kind }) => kind === "script",
  );

  expect(script).toMatchObject({
    status: "ambiguous",
    reason: "ambiguous-static-candidates",
    candidate_static_count: 2,
  });
  expect(script?.candidate_static_nodes).toHaveLength(2);
  expect(
    new Set(
      script?.candidate_static_nodes.map(
        ({ static_layer_id: layerId }) => layerId,
      ),
    ).size,
  ).toBe(2);
});

it("retains all runtime entities and static load states without projection caps", async () => {
  const fixture = await applicationFixture();
  temporary.push(fixture);
  const staticEvidence = await analyzeFixture(fixture);
  const runtimeObservations = [
    electronRuntimeEvidence(fixture, SOURCE, {
      includeWorker: false,
      targetId: "target-one",
    }),
    electronRuntimeEvidence(fixture, SOURCE, {
      includeWorker: false,
      targetId: "target-two",
    }),
  ];

  const result = reconcileInput({
    static_layers: [{ role: "application", analysis: staticEvidence }],
    runtime_observations: runtimeObservations,
  });

  expect(result.runtime_captures).toHaveLength(2);
  expect(
    new Set(result.runtime_captures.map(({ target_node_id: id }) => id)).size,
  ).toBe(2);
  expect(result.summary).toMatchObject({
    runtime_targets: 2,
    runtime_frames: 2,
    runtime_scripts: 2,
    runtime_workers: 0,
    static_not_observed: 2,
  });
  expect(result.coverage).toMatchObject({
    omitted_runtime_entities: 0,
    omitted_reconciliation_items: 0,
    omitted_static_load_states: 0,
  });
  expect(result.static_load_states).toHaveLength(
    result.summary.static_loaded +
      result.summary.static_resident +
      result.summary.static_not_observed +
      result.summary.static_unknown,
  );
});

it("rejects runtime source bytes whose Evidence omits source-capture approval", async () => {
  const fixture = await applicationFixture();
  temporary.push(fixture);
  const staticEvidence = await analyzeFixture(fixture);
  const contradictoryRuntime = electronRuntimeEvidence(fixture, SOURCE, {
    includeWorker: false,
    sourceIncluded: false,
  });

  const result = readRuntimeReconciliationInput(
    reconcileJavaScriptRuntimeInputSchema.parse({
      static_layers: [{ role: "application", analysis: staticEvidence }],
      runtime_observations: [contradictoryRuntime],
    }),
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      operation: "reconcile_javascript_runtime",
      issues: [
        {
          path: [
            "runtime_observations",
            0,
            "parameters",
            "include_script_sources",
          ],
          reason: "invalid_value",
          message:
            "Runtime Evidence contains source without source-capture selection",
        },
      ],
    },
  });
});

it("keeps graph omission counts unknown when a runtime section is unavailable", async () => {
  const fixture = await applicationFixture();
  temporary.push(fixture);
  const result = reconcileInput({
    static_layers: [
      { role: "application", analysis: await analyzeFixture(fixture) },
    ],
    runtime_observations: [
      electronRuntimeEvidence(fixture, SOURCE, {
        includeWorker: false,
        workersUnavailable: true,
      }),
    ],
  });

  expect(result.coverage).toMatchObject({
    status: "partial",
    truncated: false,
  });
  expect(result.graph.coverage).toMatchObject({
    status: "partial",
    truncated: false,
    omitted_count: null,
  });
});

it("runs the local verifier from operator-provided paths without emitting source", async () => {
  const fixture = await applicationFixture();
  const evidenceRoot = await createTestTempDirectory("rea-runtime-evidence-");
  const evidencePath = join(evidenceRoot, "runtime-evidence.json");
  temporary.push(fixture, evidenceRoot);
  await writeFile(
    evidencePath,
    JSON.stringify(electronRuntimeEvidence(fixture, SOURCE)),
  );

  const { stdout } = await execute(
    process.execPath,
    [
      "scripts/verify/javascript/runtime-observation.mjs",
      "--application",
      fixture,
      "--runtime-evidence",
      evidencePath,
    ],
    { cwd: process.cwd(), maxBuffer: 16 * 1_024 * 1_024 },
  );
  const output: unknown = JSON.parse(stdout);

  expect(output).toMatchObject({
    verified: true,
    summary: { runtime_scripts: 1 },
  });
  expect(stdout).not.toContain(SOURCE.trim());
}, 10_000);
