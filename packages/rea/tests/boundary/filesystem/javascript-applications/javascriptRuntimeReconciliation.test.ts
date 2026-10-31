import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { createElectronActiveEvidence } from "../../../../src/application/javascript/ElectronActiveEvidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { reconcileJavaScriptRuntimeEvidence } from "../../../../src/application/javascript/JavaScriptRuntimeReconciliationService.js";
import { createEvidence } from "../../../../src/domain/evidence.js";
import { mappedRuntimePaths } from "../../../../src/domain/javascript/javascriptRuntimeStaticCandidates.js";
import { projectRuntimeCaptures } from "../../../../src/domain/javascript/javascriptRuntimeReconciliationRuntime.js";
import { parseRuntimeCaptures } from "../../../../src/domain/javascript/javascriptRuntimeReconciliationCaptureParsing.js";
import { electronPageInspectionSchema } from "../../../../src/domain/javascript/electronObservation.js";
import {
  readRuntimeReconciliationInput,
  reconcileJavaScriptRuntime,
} from "../../../../src/domain/javascript/javascriptRuntimeReconciliation.js";
import {
  reconcileJavaScriptRuntimeInputSchema,
  javascriptRuntimeReconciliationResultSchema,
} from "../../../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import {
  electronActiveObservationInputSchema,
  type ElectronActiveObservationInput,
} from "../../../../src/domain/javascript/electronActiveObservation.js";
import { createElectronActiveObservationFixtureResult } from "../../../../src/domain/javascript/electronActiveObservation.fixture.js";

import {
  SOURCE,
  applicationFixture,
  analyzeFixture,
  electronRuntimeEvidence,
} from "../../../fixtures/javascriptRuntimeReconciliation.js";

const readInput = (input: unknown) => {
  const result = readRuntimeReconciliationInput(
    reconcileJavaScriptRuntimeInputSchema.parse(input),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const reconcileInput = (input: unknown) =>
  reconcileJavaScriptRuntime(readInput(input));

it.each([
  {
    parameter: "include_script_sources",
    value: false,
    message:
      "Runtime Evidence contains source without source-capture selection",
  },
  {
    parameter: "target_id",
    value: " target-main ",
    message: "Runtime Evidence target disagrees with its captured result",
  },
])(
  "preserves $parameter input paths for runtime Evidence",
  async ({ parameter, value, message }) => {
    const root = await applicationFixture();
    const application = await analyzeFixture(root);
    const runtime = electronRuntimeEvidence(root, SOURCE);
    const invalidRuntime = createEvidence(undefined, runtime.provider, {
      predicateType: runtime.predicate_type,
      operation: runtime.operation,
      parameters: { ...runtime.parameters, [parameter]: value },
      result: runtime.normalized_result,
      confidence: runtime.confidence,
      authority: runtime.authority,
    });

    const result = reconcileJavaScriptRuntimeEvidence({
      static_layers: [{ role: "application", analysis: application }],
      runtime_observations: [invalidRuntime],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [
          {
            path: ["runtime_observations", 0, "parameters", parameter],
            reason: "invalid_value",
            message,
          },
        ],
      },
    });
  },
);

it("reconciles runtime scripts inside dot-prefixed child directories", async () => {
  const root = await applicationFixture();
  await mkdir(join(root, "..cache"));
  await writeFile(join(root, "..cache", "app.js"), SOURCE);
  const result = reconcileInput({
    static_layers: [
      { role: "application", analysis: await analyzeFixture(root) },
    ],
    runtime_observations: [
      electronRuntimeEvidence(root, SOURCE, {
        scriptFile: "..cache/app.js",
        includeWorker: false,
      }),
    ],
  });
  expect(result.reconciliations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entity_kind: "script",
        status: "matched",
        basis: "content-and-location",
      }),
    ]),
  );
});

it("matches renderer, frame, script bytes, and worker without claiming execution", async () => {
  const fixture = await applicationFixture();
  const staticEvidence = await analyzeFixture(fixture);
  const runtimeEvidence = electronRuntimeEvidence(fixture, SOURCE);

  const result = reconcileInput({
    static_layers: [{ role: "application", analysis: staticEvidence }],
    runtime_observations: [runtimeEvidence],
  });

  expect(() =>
    javascriptRuntimeReconciliationResultSchema.parse(result),
  ).not.toThrow();
  expect(result.source_map_authority).toMatchObject({
    used_for_primary_matching: false,
    static_layer_count: 1,
    runtime_script_declarations: 0,
  });
  expect(result.summary).toMatchObject({
    runtime_targets: 1,
    runtime_frames: 1,
    runtime_scripts: 1,
    runtime_workers: 1,
    matched: 2,
    ambiguous: 2,
    unmatched: 0,
  });
  expect(result.reconciliations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entity_kind: "script",
        status: "matched",
        basis: "content-and-location",
      }),
      expect.objectContaining({
        entity_kind: "worker",
        status: "matched",
        basis: "artifact-path",
      }),
      expect.objectContaining({
        entity_kind: "target",
        status: "ambiguous",
        reason: "ambiguous-static-candidates",
      }),
    ]),
  );
  const matched = result.reconciliations.find(
    ({ status }) => status === "matched",
  );
  if (matched === undefined)
    throw new TypeError("Expected one matched runtime reconciliation");
  expect(
    javascriptRuntimeReconciliationResultSchema.safeParse({
      ...result,
      reconciliations: [{ ...matched, static_node_id: null }],
    }).success,
  ).toBe(false);
  expect(result.static_load_states).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "javascript-asset",
        status: "loaded",
      }),
    ]),
  );
  expect(result.limitations.join(" ")).toMatch(
    /not reported as executed|not code reachability/u,
  );
  const observedAsEdges = result.graph.edges.filter(
    ({ relation }) => relation === "observed_as",
  );
  expect(observedAsEdges).toHaveLength(2);
  for (const [entityKind, basis] of [
    ["script", "content-and-location"],
    ["worker", "artifact-path"],
  ] as const) {
    const reconciliation = result.reconciliations.find(
      ({ entity_kind }) => entity_kind === entityKind,
    );
    if (reconciliation === undefined || reconciliation.status !== "matched")
      throw new TypeError(`Expected matched ${entityKind} reconciliation`);
    expect(observedAsEdges).toContainEqual(
      expect.objectContaining({
        source_node_id: reconciliation.static_node_id,
        target_node_id: reconciliation.runtime_node_id,
        relation: "observed_as",
        properties: expect.objectContaining({
          reconciliation_id: reconciliation.reconciliation_id,
          static_layer_id: reconciliation.static_layer_id,
          basis,
        }),
        evidence: expect.objectContaining({
          authority: "cross-layer-reconciliation",
          state: "inferred",
        }),
      }),
    );
  }
  const worker = result.reconciliations.find(
    ({ entity_kind: kind }) => kind === "worker",
  );
  const frame = result.reconciliations.find(
    ({ entity_kind: kind }) => kind === "frame",
  );
  expect(result.graph.edges).toContainEqual(
    expect.objectContaining({
      source_node_id: frame?.runtime_node_id,
      target_node_id: worker?.runtime_node_id,
      relation: "contains",
    }),
  );
});

it("keeps static load states unknown when one scoped capture omits scripts", async () => {
  const fixture = await applicationFixture();
  const staticEvidence = await analyzeFixture(fixture);
  const result = reconcileInput({
    static_layers: [{ role: "application", analysis: staticEvidence }],
    runtime_observations: [
      electronRuntimeEvidence(fixture, SOURCE, {
        includeWorker: false,
        targetId: "target-complete",
      }),
      electronRuntimeEvidence(fixture, SOURCE, {
        includeWorker: false,
        scriptsUnavailable: true,
        targetId: "target-incomplete",
      }),
    ],
  });

  expect(
    result.runtime_captures.map(
      ({ scripts_complete_within_scope }) => scripts_complete_within_scope,
    ),
  ).toEqual(expect.arrayContaining([false, true]));
  expect(result.summary.static_not_observed).toBe(0);
  expect(result.static_load_states).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "unknown",
        reason: "static-or-runtime-coverage-incomplete",
      }),
    ]),
  );
});

it("does not infer absence from an incomplete capture with no mapped entities", async () => {
  const fixture = await applicationFixture();
  const outside = await applicationFixture();
  const analysis = await analyzeFixture(fixture);
  const complete = electronRuntimeEvidence(fixture, SOURCE, {
    includeWorker: false,
    targetId: "complete",
  });
  const outsideCapture = (scriptsUnavailable: boolean) =>
    electronRuntimeEvidence(outside, "export const unrelated = 1;", {
      includeWorker: false,
      scriptsUnavailable,
      targetId: "outside",
    });
  const reconcile = (
    runtime_observations: ReturnType<typeof electronRuntimeEvidence>[],
  ) =>
    reconcileInput({
      static_layers: [{ role: "application", analysis }],
      runtime_observations,
    });

  const control = reconcile([complete, outsideCapture(false)]);
  expect(control.summary.static_not_observed).toBeGreaterThan(0);
  const incomplete = outsideCapture(true);
  for (const captures of [
    [complete, incomplete],
    [incomplete, complete],
  ]) {
    const result = reconcile(captures);
    expect(result.summary.static_not_observed).toBe(0);
    expect(result.static_load_states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "loaded" }),
        expect.objectContaining({
          status: "unknown",
          reason: "static-or-runtime-coverage-incomplete",
        }),
      ]),
    );
  }
});

it("preserves positive script matches without inventing worker absence when workers are unavailable", async () => {
  const fixture = await applicationFixture();
  const staticEvidence = await analyzeFixture(fixture);
  const reconcile = (workersUnavailable: boolean) =>
    reconcileInput({
      static_layers: [{ role: "application", analysis: staticEvidence }],
      runtime_observations: [
        electronRuntimeEvidence(fixture, SOURCE, {
          includeWorker: false,
          workersUnavailable,
        }),
      ],
    });
  const complete = reconcile(false);
  const incomplete = reconcile(true);
  expect(complete.summary.static_not_observed).toBeGreaterThan(0);
  expect(incomplete.summary.static_not_observed).toBe(0);
  expect(incomplete.runtime_captures[0]?.scripts_complete_within_scope).toBe(
    true,
  );
  expect(incomplete.static_load_states).toContainEqual(
    expect.objectContaining({
      status: "loaded",
      reason: "runtime-script-correspondence",
    }),
  );
  expect(incomplete.static_load_states).toContainEqual(
    expect.objectContaining({
      status: "unknown",
      reason: "static-or-runtime-coverage-incomplete",
    }),
  );
});

it("preserves unknown Electron frame provenance without linking it to an authorized frame", async () => {
  const root = await applicationFixture();
  const recorded = electronRuntimeEvidence(root, SOURCE);
  const inspection = electronPageInspectionSchema.parse(
    recorded.normalized_result,
  );
  const evidence = createEvidence(undefined, recorded.provider, {
    predicateType: recorded.predicate_type,
    operation: recorded.operation,
    parameters: recorded.parameters,
    confidence: recorded.confidence,
    authority: recorded.authority,
    result: {
      ...inspection,
      completeness: {
        ...inspection.completeness,
        status: "attach_limited",
        conditions: ["attach_limited"],
        attach_limited_sections: ["scripts"],
      },
      scripts: {
        ...inspection.scripts,
        items: inspection.scripts.items.map((script) => ({
          ...script,
          frame_scope: "unknown",
          has_source_url: true,
          reported_url: "file:///reported-label.js",
          frame_claims: {
            script_event_frame_id: "declared-frame",
            execution_context_frame_id: "context-frame",
          },
        })),
      },
    },
  });
  const captures = parseRuntimeCaptures([evidence]);
  expect(captures[0]?.scriptsCompleteWithinScope).toBe(false);
  const projected = projectRuntimeCaptures(captures);
  const script = projected.entities.find(({ kind }) => kind === "script");
  const target = projected.entities.find(({ kind }) => kind === "target");
  if (script === undefined || target === undefined)
    throw new Error("Expected the observed script and selected target");
  expect(script.frameKey).toBeNull();
  expect(script.node.observations).toEqual([
    expect.objectContaining({
      properties: expect.objectContaining({
        frame_scope: "unknown",
        reported_frame_id: inspection.scripts.items[0]?.frame_id,
        has_source_url: true,
        reported_url: "file:///reported-label.js",
        frame_claims: {
          script_event_frame_id: "declared-frame",
          execution_context_frame_id: "context-frame",
        },
      }),
    }),
  ]);
  expect(projected.edges).toContainEqual(
    expect.objectContaining({
      source_node_id: target.node.node_id,
      target_node_id: script.node.node_id,
      relation: "loads",
    }),
  );
  const frameIds = new Set(
    projected.entities
      .filter(({ kind }) => kind === "frame")
      .map(({ node }) => node.node_id),
  );
  expect(frameIds.size).toBeGreaterThan(0);
  expect(
    projected.edges.some(
      (edge) =>
        frameIds.has(edge.source_node_id) &&
        edge.target_node_id === script.node.node_id,
    ),
  ).toBe(false);
});

it.each(["historical", "selected-paths"] as const)(
  "reconciles %s active Electron as a partial target-only runtime capture",
  async (representation) => {
    const fixture = await applicationFixture();
    const staticEvidence = await analyzeFixture(fixture);
    const applicationPath = join(fixture, "main.js");
    const input = {
      ...electronActiveObservationInputSchema.parse({
        executable_path: process.execPath,
        application_path: applicationPath,
        application_root: fixture,
        actions: [],
      }),
      application_root: fixture,
    };
    const capture =
      createElectronActiveObservationFixtureResult(applicationPath);
    let selectedInput: ElectronActiveObservationInput = input;
    let resolvedInput: typeof input | undefined;
    if (representation === "selected-paths") {
      const alias = join(fixture, "selected-main.js");
      await symlink(applicationPath, alias);
      selectedInput = electronActiveObservationInputSchema.parse({
        executable_path: process.execPath,
        application_path: alias,
      });
      resolvedInput = {
        ...input,
        executable_path: await realpath(process.execPath),
      };
      capture.application.executable_path = resolvedInput.executable_path;
    }
    const runtimeEvidence = createElectronActiveEvidence(
      selectedInput,
      capture,
      {
        id: "rea-playwright-electron-active",
        name: "REA Playwright active Electron observation provider",
        version: "1",
      },
      resolvedInput,
    );

    const result = reconcileInput({
      static_layers: [{ role: "application", analysis: staticEvidence }],
      runtime_observations: [runtimeEvidence],
    });

    expect(result.runtime_captures).toMatchObject([
      {
        kind: "electron-active",
        scripts: 0,
        frames: 0,
        workers: 0,
        scripts_complete_within_scope: false,
      },
    ]);
    expect(result.coverage.status).toBe("partial");
    expect(result.limitations.join(" ")).toMatch(
      /incomplete|not reported as executed/u,
    );
  },
);

it("commits complete Electron actions independently from selected arguments", async () => {
  const fixture = await applicationFixture();
  const applicationPath = join(fixture, "main.js");
  const makeInput = (secret: string, selector: string) => ({
    ...electronActiveObservationInputSchema.parse({
      executable_path: process.execPath,
      application_path: applicationPath,
      application_root: fixture,
      args: ["--token", secret],
      actions: [
        { step_id: "click", kind: "click", selector },
        { step_id: "settle", kind: "wait", duration_ms: 37 },
        {
          step_id: "open",
          kind: "deep-link",
          delivery: "second-instance",
          url: "rea-fixture://open/item?token=selected",
        },
      ],
    }),
    application_root: fixture,
  });
  const provider = {
    id: "rea-playwright-electron-active",
    name: "REA Playwright active Electron observation provider",
    version: "1",
  };
  const first = createElectronActiveEvidence(
    makeInput("first-secret", "#first-secret"),
    createElectronActiveObservationFixtureResult(applicationPath),
    provider,
  );
  const second = createElectronActiveEvidence(
    makeInput("first-secret", "#second-secret"),
    createElectronActiveObservationFixtureResult(applicationPath),
    provider,
  );

  expect(first.parameters.scenario_sha256).not.toBe(
    second.parameters.scenario_sha256,
  );
  expect(JSON.stringify(first)).toContain("first-secret");
  expect(first.parameters.actions).toEqual([
    {
      step_id: "click",
      kind: "click",
      selector: "#first-secret",
      window_index: 0,
    },
    { step_id: "settle", kind: "wait", duration_ms: 37 },
    {
      step_id: "open",
      kind: "deep-link",
      delivery: "second-instance",
      url: "rea-fixture://open/item?token=selected",
    },
  ]);
  expect(first.parameters.args).toEqual(["--token", "first-secret"]);
});

it("imports an operator-provided cache layer through an explicit file mapping", async () => {
  const application = await applicationFixture();
  const cache = await createTestTempDirectory("rea-runtime-cache-static-");
  const runtimeCache = await createTestTempDirectory("rea-runtime-cache-live-");
  const cacheSource = SOURCE;
  await mkdir(join(cache, "mapped"));
  await Promise.all([
    writeFile(join(cache, "mapped", "chunk.js"), cacheSource),
    writeFile(join(cache, "outside.js"), "export const outside = true;\n"),
    writeFile(join(runtimeCache, "chunk.js"), cacheSource),
    writeFile(join(runtimeCache, "index.html"), "<script></script>"),
  ]);
  const applicationEvidence = await analyzeFixture(application);
  const cacheEvidence = await analyzeFixture(cache);
  const runtimeEvidence = electronRuntimeEvidence(runtimeCache, cacheSource, {
    scriptFile: "chunk.js",
    includeWorker: false,
  });

  const result = reconcileInput({
    static_layers: [
      { role: "application", analysis: applicationEvidence },
      {
        role: "cache",
        analysis: cacheEvidence,
        runtime_mappings: [
          {
            kind: "file-root",
            root: runtimeCache,
            artifact_prefix: "mapped",
          },
        ],
      },
    ],
    runtime_observations: [runtimeEvidence],
  });
  const script = result.reconciliations.find(
    ({ entity_kind: kind }) => kind === "script",
  );
  const cacheLayer = result.static_layers.find(({ role }) => role === "cache");

  expect(script).toMatchObject({
    status: "matched",
    basis: "content-and-location",
    static_layer_id: cacheLayer?.layer_id,
  });
  const outside = result.graph.nodes.find(
    (node) =>
      node.kind === "javascript-asset" &&
      node.observations.some(
        ({ properties }) => properties.path === "outside.js",
      ),
  );
  expect(
    result.static_load_states.find(
      ({ static_node_id: nodeId }) => nodeId === outside?.node_id,
    ),
  ).toMatchObject({
    status: "unknown",
    reason: "layer-outside-runtime-scope",
  });
  const sharedFile = result.graph.nodes.find(
    ({ observations }) =>
      observations.some(({ properties }) => properties.path === "app.js") &&
      observations.some(
        ({ properties }) => properties.path === "mapped/chunk.js",
      ),
  );
  expect(
    sharedFile?.observations.map(({ properties }) => properties.path),
  ).toEqual(expect.arrayContaining(["app.js", "mapped/chunk.js"]));
});

const sourceFreeRuntime = (runtimeRoot: string, scriptFile: string) => {
  const runtime = electronRuntimeEvidence(runtimeRoot, "", {
    scriptFile,
    sourceIncluded: false,
    includeWorker: false,
  });
  const observation = electronPageInspectionSchema.parse(
    runtime.normalized_result,
  );
  for (const script of observation.scripts.items)
    script.source = { included: false, reason: "not-requested" };
  return createEvidence(undefined, runtime.provider, {
    operation: runtime.operation,
    predicateType: runtime.predicate_type,
    parameters: runtime.parameters,
    result: observation,
    confidence: runtime.confidence,
    authority: runtime.authority,
  });
};

const reconcileScriptLocation = (
  application: Awaited<ReturnType<typeof analyzeFixture>>,
  root: string,
  scriptFile: string,
  runtimeRoot = root,
) => {
  return reconcileInput({
    static_layers: [
      {
        role: "application",
        analysis: application,
        runtime_mappings:
          runtimeRoot === root
            ? []
            : [{ kind: "file-root", root: runtimeRoot, artifact_prefix: "" }],
      },
    ],
    runtime_observations: [sourceFreeRuntime(runtimeRoot, scriptFile)],
  }).reconciliations.find(({ entity_kind }) => entity_kind === "script");
};

it("matches a source-free bundled script to its containing asset without suppressing independent layers", async () => {
  const root = await createTestTempDirectory("rea-runtime-bundler-location-");
  const source =
    '(globalThis["webpackChunkfixture"] = globalThis["webpackChunkfixture"] || []).push([["main"],{1:(module)=>{module.exports=1;}},(__webpack_require__)=>{__webpack_require__(1);}]);\n';
  await writeFile(join(root, "runtime.js"), source);
  const application = await analyzeFixture(root);
  const secondRoot = await createTestTempDirectory(
    "rea-runtime-bundler-other-",
  );
  await writeFile(join(secondRoot, "runtime.js"), source);
  const secondApplication = await analyzeFixture(secondRoot);
  const reconcile = (sourceIncluded: boolean, twice = false) =>
    reconcileInput({
      static_layers: [
        { role: "application", analysis: application },
        ...(twice
          ? [
              {
                role: "cache",
                analysis: secondApplication,
                runtime_mappings: [
                  { kind: "file-root", root, artifact_prefix: "" },
                ],
              },
            ]
          : []),
      ],
      runtime_observations: [
        sourceIncluded
          ? electronRuntimeEvidence(root, source, {
              scriptFile: "runtime.js",
              includeWorker: false,
            })
          : sourceFreeRuntime(root, "runtime.js"),
      ],
    });
  const withoutSource = reconcile(false);
  const script = withoutSource.reconciliations.find(
    ({ entity_kind }) => entity_kind === "script",
  );
  expect(script).toMatchObject({
    status: "matched",
    basis: "artifact-path",
    confidence: "medium",
    candidate_static_count: 1,
  });
  expect(
    withoutSource.graph.nodes.find(
      ({ node_id }) => node_id === script?.static_node_id,
    )?.kind,
  ).toBe("javascript-asset");
  expect(withoutSource.static_load_states).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: "loaded" }),
      expect.objectContaining({ status: "resident-in-loaded-asset" }),
    ]),
  );
  expect(
    reconcile(true).reconciliations.find(
      ({ entity_kind }) => entity_kind === "script",
    ),
  ).toMatchObject({
    status: "matched",
    basis: "content-and-location",
  });
  const moduleCapture = reconcileInput({
    static_layers: [{ role: "application", analysis: application }],
    runtime_observations: [
      electronRuntimeEvidence(root, "(module)=>{module.exports=1;}", {
        scriptFile: "runtime.js",
        includeWorker: false,
      }),
    ],
  });
  const moduleMatch = moduleCapture.reconciliations.find(
    ({ entity_kind }) => entity_kind === "script",
  );
  expect(moduleMatch).toMatchObject({
    status: "matched",
    basis: "content-and-location",
  });
  expect(
    moduleCapture.graph.nodes.find(
      ({ node_id }) => node_id === moduleMatch?.static_node_id,
    )?.kind,
  ).toBe("javascript-module");
  expect(
    reconcile(false, true).reconciliations.find(
      ({ entity_kind }) => entity_kind === "script",
    ),
  ).toMatchObject({
    status: "ambiguous",
    reason: "ambiguous-static-candidates",
  });
});

it.skipIf(process.platform === "win32")(
  "keeps distinct POSIX backslash and slash script locations separate",
  async () => {
    const root = await createTestTempDirectory("rea-backslash-runtime-");
    const literal = "literal\\name.js";
    await writeFile(join(root, literal), "export const marker = 'literal';\n");
    const application = await analyzeFixture(root);
    expect(
      reconcileScriptLocation(application, root, "literal/name.js"),
    ).toMatchObject({ status: "unmatched" });
    expect(reconcileScriptLocation(application, root, literal)).toMatchObject({
      status: "matched",
      basis: "artifact-path",
    });
  },
);

it.skipIf(process.platform === "win32")(
  "does not make POSIX literal and slash paths ambiguous, including Windows runtime mappings",
  async () => {
    const root = await createTestTempDirectory("rea-backslash-runtime-pair-");
    const literal = "literal\\name.js";
    await mkdir(join(root, "literal"));
    await writeFile(join(root, literal), "export const marker = 'literal';\n");
    await writeFile(
      join(root, "literal", "name.js"),
      "export const marker = 'slash';\n",
    );
    const application = await analyzeFixture(root);
    const slash = reconcileScriptLocation(application, root, "literal/name.js");
    const backslash = reconcileScriptLocation(application, root, literal);
    expect(slash).toMatchObject({ status: "matched", basis: "artifact-path" });
    expect(backslash).toMatchObject({
      status: "matched",
      basis: "artifact-path",
    });
    expect(slash?.static_node_id).not.toBe(backslash?.static_node_id);
    // These recorded Windows paths exercise matching only, not native Windows IO.
    expect(
      reconcileScriptLocation(
        application,
        root,
        "literal\\name.js",
        "C:\\runtime",
      ),
    ).toMatchObject({
      status: "matched",
      static_node_id: slash?.static_node_id,
    });
  },
);

it.skipIf(process.platform === "win32")(
  "preserves URL-prefix path semantics separately from logical artifact names",
  async () => {
    const root = await createTestTempDirectory("rea-backslash-runtime-url-");
    await writeFile(
      join(root, "literal\\name.js"),
      "export const marker = 42;\n",
    );
    const analysis = await analyzeFixture(root);
    const parsed = readInput(
      reconcileJavaScriptRuntimeInputSchema.parse({
        static_layers: [
          {
            analysis,
            role: "application",
            runtime_mappings: [
              {
                kind: "url-prefix",
                prefix: "https://example.test/assets/",
                artifact_prefix: "",
              },
            ],
          },
        ],
        runtime_observations: [sourceFreeRuntime(root, "literal\\name.js")],
      }),
    );
    const layer = parsed.layers[0];
    const entity = projectRuntimeCaptures(parsed.captures).entities.find(
      ({ kind }) => kind === "script",
    );
    if (layer === undefined || entity === undefined)
      throw new Error("Expected parsed static layer and runtime script");
    const mapped = (value: string) =>
      mappedRuntimePaths(layer, {
        ...entity,
        location: { kind: "url", value },
      }).map(({ path }) => path);
    expect(mapped("https://example.test/assets/literal%5Cname.js")).toEqual([
      "literal\\name.js",
    ]);
    expect(mapped("https://example.test/assets/literal/name.js")).toEqual([
      "literal/name.js",
    ]);
    expect(mapped("https://example.test/assets/literal\\name.js")).toEqual([
      "literal/name.js",
    ]);
    expect(mapped("https://other.test/assets/literal/name.js")).toEqual([]);
    expect(mapped("https://example.test/assets/%2e%2e/outside.js")).toEqual([]);
  },
);

const rendererCapture = (runtimeRoot: string, filePath: string) => {
  const runtime = sourceFreeRuntime(runtimeRoot, "main.cjs");
  const observation = electronPageInspectionSchema.parse(
    runtime.normalized_result,
  );
  observation.target.file_path = filePath;
  for (const frame of observation.frames) frame.file_path = filePath;
  return createEvidence(undefined, runtime.provider, {
    operation: runtime.operation,
    predicateType: runtime.predicate_type,
    parameters: runtime.parameters,
    result: observation,
    confidence: runtime.confidence,
    authority: runtime.authority,
  });
};

it.skipIf(process.platform === "win32")(
  "interprets raw loadFile declarations using the captured native path format",
  async () => {
    const root = await createTestTempDirectory(
      "rea-native-loadfile-declaration-",
    );
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "index.html"), "slash file");
    await writeFile(join(root, "dist\\index.html"), "literal file");
    await writeFile(
      join(root, "main.cjs"),
      `const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile(${JSON.stringify("dist\\index.html")});`,
    );
    const analysis = await analyzeFixture(root);
    const reconcileTarget = (runtimeRoot: string, path: string) =>
      reconcileInput({
        static_layers: [
          {
            analysis,
            role: "application",
            runtime_mappings: [
              { kind: "file-root", root: runtimeRoot, artifact_prefix: "" },
            ],
          },
        ],
        runtime_observations: [rendererCapture(runtimeRoot, path)],
      }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
    // These Windows paths are recorded data, not native Windows execution.
    expect(
      reconcileTarget("C:\\runtime", "C:\\runtime\\dist\\index.html"),
    ).toMatchObject({ status: "matched" });
    expect(reconcileTarget(root, join(root, "dist\\index.html"))).toMatchObject(
      { status: "matched" },
    );
    expect(
      reconcileTarget(root, join(root, "dist", "index.html")),
    ).toMatchObject({ status: "unmatched" });
  },
);

it.skipIf(process.platform === "win32").each(["literal\\dir", "literal%5Cdir"])(
  "maps a runtime root to the exact logical artifact prefix %j",
  async (prefix) => {
    const root = await createTestTempDirectory("rea-literal-artifact-prefix-");
    await mkdir(join(root, prefix));
    await writeFile(
      join(root, prefix, "app.js"),
      "export const marker = 42;\n",
    );
    const analysis = await analyzeFixture(root);
    const result = reconcileInput({
      static_layers: [
        {
          analysis,
          role: "application",
          runtime_mappings: [
            { kind: "file-root", root: "/deployed", artifact_prefix: prefix },
          ],
        },
      ],
      runtime_observations: [sourceFreeRuntime("/deployed", "app.js")],
    });
    expect(
      result.reconciliations.find(
        ({ entity_kind }) => entity_kind === "script",
      ),
    ).toMatchObject({ status: "matched", basis: "operator-file-mapping" });
  },
);

it.skipIf(process.platform === "win32")(
  "uses resolved artifact paths instead of a raw declaration alias",
  async () => {
    const root = await createTestTempDirectory("rea-resolved-loadfile-alias-");
    const directory = "literal\\dir";
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, "index.html"), "owned target");
    await writeFile(join(root, "index.html"), "different target");
    await writeFile(
      join(root, directory, "package.json"),
      JSON.stringify({
        name: "literal-renderer",
        version: "1.0.0",
        renderer: "./index.html",
      }),
    );
    const analysis = await analyzeFixture(root);
    const reconcileTarget = (path: string) =>
      reconcileInput({
        static_layers: [{ analysis, role: "application" }],
        runtime_observations: [rendererCapture(root, path)],
      }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
    expect(reconcileTarget(join(root, directory, "index.html"))).toMatchObject({
      status: "matched",
    });
    expect(reconcileTarget(join(root, "index.html"))).toMatchObject({
      status: "unmatched",
    });
  },
);

it("rejects unsafe logical artifact prefixes without decoding literal names", async () => {
  const root = await createTestTempDirectory("rea-prefix-admission-");
  await writeFile(join(root, "app.js"), "export const marker = 42;\n");
  const analysis = await analyzeFixture(root);
  const accepts = (artifact_prefix: string) =>
    reconcileJavaScriptRuntimeInputSchema.safeParse({
      static_layers: [
        {
          analysis,
          role: "application",
          runtime_mappings: [
            { kind: "file-root", root: "/deployed", artifact_prefix },
          ],
        },
      ],
      runtime_observations: [sourceFreeRuntime("/deployed", "app.js")],
    }).success;
  for (const prefix of [
    "\0",
    "/absolute",
    ".",
    "..",
    "a/../b",
    "a//b",
    "a/",
    "./a",
  ])
    expect(accepts(prefix), prefix).toBe(false);
  for (const prefix of ["", "literal\\dir", "literal%5Cdir", "literal%2Fdir"])
    expect(accepts(prefix), prefix).toBe(true);
});

it.skipIf(process.platform === "win32")(
  "keeps a leading backslash declaration literal only for POSIX captures",
  async () => {
    const root = await createTestTempDirectory("rea-leading-loadfile-");
    await writeFile(join(root, "\\index.html"), "literal target");
    await writeFile(
      join(root, "main.cjs"),
      `const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile(${JSON.stringify("\\index.html")});`,
    );
    const analysis = await analyzeFixture(root);
    const reconcileTarget = (runtimeRoot: string, path: string) =>
      reconcileInput({
        static_layers: [
          {
            analysis,
            role: "application",
            runtime_mappings: [
              { kind: "file-root", root: runtimeRoot, artifact_prefix: "" },
            ],
          },
        ],
        runtime_observations: [rendererCapture(runtimeRoot, path)],
      }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
    expect(reconcileTarget(root, join(root, "\\index.html"))).toMatchObject({
      status: "matched",
    });
    expect(
      reconcileTarget("C:\\runtime", "C:\\runtime\\index.html"),
    ).toMatchObject({ status: "unmatched" });
  },
);

it.each([false, true])(
  "merges equivalent owned page declarations when target presence is %s",
  async (present) => {
    const root = await createTestTempDirectory("rea-generated-page-runtime-");
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(
      join(root, "app", "package.json"),
      JSON.stringify({ main: "main.cjs" }),
    );
    await writeFile(
      join(root, "app", "main.cjs"),
      'const {BrowserWindow} = require("electron"); const w = new BrowserWindow(); w.loadFile("generated.html"); const other = new BrowserWindow(); other.loadFile("./generated.html");',
    );
    if (present)
      await writeFile(join(root, "app", "generated.html"), "generated page");
    const analysis = await analyzeFixture(root);
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      analysis.normalized_result,
    );
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    expect(
      roles[0]?.observations
        .map(({ properties }) => properties.declared_path)
        .sort(),
    ).toEqual(["./generated.html", "generated.html"]);
    const reconcileTarget = (path: string) =>
      reconcileInput({
        static_layers: [{ analysis, role: "application" }],
        runtime_observations: [rendererCapture(root, path)],
      }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
    expect(reconcileTarget(join(root, "app", "generated.html"))).toMatchObject({
      status: "matched",
      candidate_static_count: 1,
    });
    expect(reconcileTarget(join(root, "generated.html"))).toMatchObject({
      status: "unmatched",
    });
  },
);

it("matches a resolved nested application path without an operator mapping", async () => {
  const root = await createTestTempDirectory("rea-owned-loadfile-runtime-");
  await mkdir(join(root, "app", "dist"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "app", "package.json"),
    JSON.stringify({ main: "main.cjs" }),
  );
  await writeFile(
    join(root, "app", "main.cjs"),
    "const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile('dist/index.html');",
  );
  await writeFile(
    join(root, "app", "dist", "index.html"),
    "application target",
  );
  await writeFile(join(root, "dist", "index.html"), "root decoy");
  const analysis = await analyzeFixture(root);
  const reconcileTarget = (path: string) =>
    reconcileInput({
      static_layers: [{ analysis, role: "application" }],
      runtime_observations: [rendererCapture(root, path)],
    }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
  expect(
    reconcileTarget(join(root, "app", "dist", "index.html")),
  ).toMatchObject({ status: "matched" });
  expect(reconcileTarget(join(root, "dist", "index.html"))).toMatchObject({
    status: "unmatched",
  });
});

it("keeps a raw nested loadFile target application-relative when the producer also resolves a nested decoy", async () => {
  const root = await createTestTempDirectory("rea-raw-loadfile-ownership-");
  await mkdir(join(root, "dist"));
  await mkdir(join(root, "sub", "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.html"), "application target");
  await writeFile(join(root, "sub", "dist", "index.html"), "nested decoy");
  await writeFile(
    join(root, "sub", "main.cjs"),
    "const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile('dist/index.html');",
  );
  const analysis = await analyzeFixture(root);
  const reconcileTarget = (path: string) =>
    reconcileInput({
      static_layers: [{ analysis, role: "application" }],
      runtime_observations: [rendererCapture(root, path)],
    }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
  expect(reconcileTarget(join(root, "dist", "index.html"))).toMatchObject({
    status: "matched",
  });
  expect(
    reconcileTarget(join(root, "sub", "dist", "index.html")),
  ).toMatchObject({ status: "unmatched" });
});

it
  .skipIf(process.platform === "win32")
  .each(["app", "literal\\app", "café", "cafe\u0301"])(
  "maps raw renderer declarations through the logical application prefix %j",
  async (prefix) => {
    const root = await createTestTempDirectory("rea-prefixed-native-renderer-");
    await mkdir(join(root, prefix, "dist"), { recursive: true });
    await writeFile(
      join(root, prefix, "dist", "index.html"),
      "application target",
    );
    await writeFile(
      join(root, prefix, "main.cjs"),
      "const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile('dist/index.html');",
    );
    const analysis = await analyzeFixture(root);
    const reconcileTarget = (runtimeRoot: string, path: string) =>
      reconcileInput({
        static_layers: [
          {
            analysis,
            role: "application",
            runtime_mappings: [
              { kind: "file-root", root: runtimeRoot, artifact_prefix: prefix },
            ],
          },
        ],
        runtime_observations: [rendererCapture(runtimeRoot, path)],
      }).reconciliations.find(({ entity_kind }) => entity_kind === "target");
    expect(
      reconcileTarget("/deployed", "/deployed/dist/index.html"),
    ).toMatchObject({ status: "matched", basis: "operator-file-mapping" });
    expect(
      reconcileTarget("C:\\deployed", "C:\\deployed\\dist\\index.html"),
    ).toMatchObject({ status: "matched", basis: "operator-file-mapping" });
    expect(reconcileTarget("/deployed", "/deployed/index.html")).toMatchObject({
      status: "unmatched",
    });
  },
);

it("confines raw renderer declarations to the operator-selected artifact prefix", async () => {
  const root = await createTestTempDirectory("rea-native-prefix-isolation-");
  for (const app of ["appA", "appB"]) {
    await mkdir(join(root, app, "dist"), { recursive: true });
    await writeFile(join(root, app, "dist", "index.html"), app);
    await writeFile(
      join(root, app, "main.cjs"),
      "const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile('dist/index.html');",
    );
  }
  const analysis = await analyzeFixture(root);
  const result = reconcileInput({
    static_layers: [
      {
        analysis,
        role: "application",
        runtime_mappings: [
          { kind: "file-root", root: "/deployed", artifact_prefix: "appA" },
        ],
      },
    ],
    runtime_observations: [
      rendererCapture("/deployed", "/deployed/dist/index.html"),
    ],
  });
  const target = result.reconciliations.find(
    ({ entity_kind }) => entity_kind === "target",
  );
  expect(target).toMatchObject({
    status: "matched",
    candidate_static_count: 1,
  });
  const node = result.graph.nodes.find(
    ({ node_id }) => node_id === target?.static_node_id,
  );
  expect(
    node?.observations.flatMap(({ evidence }) =>
      evidence.location.available &&
      evidence.location.value.kind === "source-range"
        ? [evidence.location.value.source]
        : [],
    ),
  ).toEqual(["appA/main.cjs"]);
});

it("retains uncertainty for overlapping file mappings with distinct application interpretations", async () => {
  const root = await createTestTempDirectory("rea-overlapping-native-prefix-");
  await mkdir(join(root, "app", "dist"), { recursive: true });
  await writeFile(join(root, "app", "dist", "index.html"), "shared target");
  for (const [path, declaration] of [
    ["app/main.cjs", "dist/index.html"],
    ["app/dist/main.cjs", "index.html"],
  ])
    await writeFile(
      join(root, path!),
      `const { BrowserWindow } = require('electron'); const win = new BrowserWindow(); win.loadFile(${JSON.stringify(declaration)});`,
    );
  const analysis = await analyzeFixture(root);
  const result = reconcileInput({
    static_layers: [
      {
        analysis,
        role: "application",
        runtime_mappings: [
          { kind: "file-root", root: "/deployed", artifact_prefix: "app" },
          {
            kind: "file-root",
            root: "/deployed/dist",
            artifact_prefix: "app/dist",
          },
        ],
      },
    ],
    runtime_observations: [
      rendererCapture("/deployed", "/deployed/dist/index.html"),
    ],
  });
  expect(
    result.reconciliations.find(({ entity_kind }) => entity_kind === "target"),
  ).toMatchObject({
    status: "ambiguous",
    confidence: "unknown",
    candidate_static_count: 2,
  });
});
