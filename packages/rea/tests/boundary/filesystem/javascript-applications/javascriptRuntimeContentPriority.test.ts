import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  readRuntimeReconciliationInput,
  reconcileJavaScriptRuntime,
} from "../../../../src/domain/javascript/javascriptRuntimeReconciliation.js";
import { reconcileRuntimeEntities } from "../../../../src/domain/javascript/javascriptRuntimeReconciliationMatching.js";
import { classifyStaticLoadStates } from "../../../../src/domain/javascript/javascriptRuntimeLoadState.js";
import { projectRuntimeCaptures } from "../../../../src/domain/javascript/javascriptRuntimeReconciliationRuntime.js";
import { reconcileJavaScriptRuntimeInputSchema } from "../../../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { collectStaticRuntimeCandidates } from "../../../../src/domain/javascript/javascriptRuntimeStaticCandidates.js";
import {
  SOURCE,
  analyzeFixture,
  applicationFixture,
  electronRuntimeEvidence,
} from "../../../fixtures/javascriptRuntimeReconciliation.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const CAPTURED = "export const observed = 'different';\n";

const readInput = (
  input: Parameters<typeof readRuntimeReconciliationInput>[0],
) => {
  const result = readRuntimeReconciliationInput(input);
  if (!result.ok) throw result.error;
  return result.value;
};

const collisionInput = async (
  alternatives: number,
  explicitMapping: boolean,
) => {
  const root = await applicationFixture();
  if (alternatives > 0) await writeFile(join(root, "other.js"), CAPTURED);
  const live = explicitMapping
    ? await createTestTempDirectory("rea-runtime-content-live-")
    : root;
  const extra = await createTestTempDirectory("rea-runtime-content-extra-");
  await writeFile(join(extra, "app.js"), CAPTURED);
  return readInput(
    reconcileJavaScriptRuntimeInputSchema.parse({
      static_layers: [
        {
          role: "application",
          analysis: await analyzeFixture(root),
          runtime_mappings: explicitMapping
            ? [{ kind: "file-root", root: live, artifact_prefix: "" }]
            : [],
        },
        ...(alternatives > 1
          ? [{ role: "assets", analysis: await analyzeFixture(extra) }]
          : []),
      ],
      runtime_observations: [
        electronRuntimeEvidence(live, CAPTURED, { includeWorker: false }),
      ],
    }),
  );
};

it.each([
  [0, false],
  [1, false],
  [2, false],
  [0, true],
  [1, true],
  [2, true],
] as const)(
  "preserves mapped disagreement with %i other content matches (explicit mapping: %s)",
  async (alternatives, explicitMapping) => {
    const parsed = await collisionInput(alternatives, explicitMapping);
    const result = reconcileJavaScriptRuntime(parsed);
    const script = result.reconciliations.find(
      ({ entity_kind }) => entity_kind === "script",
    );
    expect(script).toMatchObject({
      status: "unmatched",
      basis: explicitMapping ? "operator-file-mapping" : "artifact-path",
      confidence: "high",
      reason: "captured-content-disagrees-with-static-location",
      static_layer_id: null,
      static_node_id: null,
      candidate_static_count: 1,
    });
    const candidate = script?.candidate_static_nodes[0];
    const selected = result.graph.nodes.find(
      ({ node_id }) => node_id === candidate?.static_node_id,
    );
    expect(selected?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ path: "app.js" }),
        }),
      ]),
    );
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.relation === "observed_as" &&
          edge.target_node_id === script?.runtime_node_id,
      ),
    ).toBe(false);
  },
);

it("restricts content-and-location ambiguity to mapped candidates", async () => {
  const application = await applicationFixture();
  const cache = await applicationFixture();
  const other = await applicationFixture();
  const live = await createTestTempDirectory("rea-runtime-content-mapped-");
  const analysis = await analyzeFixture(application);
  const mapping = [{ kind: "file-root", root: live, artifact_prefix: "" }];
  const parsed = readInput(
    reconcileJavaScriptRuntimeInputSchema.parse({
      static_layers: [
        { role: "application", analysis, runtime_mappings: mapping },
        {
          role: "cache",
          analysis: await analyzeFixture(cache),
          runtime_mappings: mapping,
        },
        { role: "assets", analysis: await analyzeFixture(other) },
      ],
      runtime_observations: [
        electronRuntimeEvidence(live, SOURCE, { includeWorker: false }),
      ],
    }),
  );
  const result = reconcileJavaScriptRuntime(parsed);
  const script = result.reconciliations.find(
    ({ entity_kind }) => entity_kind === "script",
  );
  expect(script).toMatchObject({
    status: "ambiguous",
    reason: "ambiguous-static-candidates",
    candidate_static_count: 2,
  });
  const unmapped = result.static_layers.find(({ role }) => role === "assets");
  expect(
    script?.candidate_static_nodes.map(
      ({ static_layer_id }) => static_layer_id,
    ),
  ).not.toContain(unmapped?.layer_id);
});

it.each([false, true])(
  "retains digest-only matching without a mapped candidate (mapping: %s)",
  async (mapped) => {
    const root = await applicationFixture();
    await writeFile(join(root, "other.js"), CAPTURED);
    const live = await createTestTempDirectory(
      "rea-runtime-content-unlocated-",
    );
    const result = reconcileJavaScriptRuntime(
      readInput(
        reconcileJavaScriptRuntimeInputSchema.parse({
          static_layers: [
            {
              role: "application",
              analysis: await analyzeFixture(root),
              runtime_mappings: mapped
                ? [{ kind: "file-root", root: live, artifact_prefix: "" }]
                : [],
            },
          ],
          runtime_observations: [
            electronRuntimeEvidence(live, CAPTURED, {
              scriptFile: "absent.js",
              includeWorker: false,
            }),
          ],
        }),
      ),
    );
    expect(
      result.reconciliations.find(
        ({ entity_kind }) => entity_kind === "script",
      ),
    ).toMatchObject({
      status: "matched",
      basis: "content-sha256",
      confidence: "high",
      reason: "unique-content-match",
      candidate_static_count: 1,
    });
  },
);

it("keeps unavailable mapped digests unknown instead of borrowing unrelated matches", async () => {
  const parsed = await collisionInput(1, true);
  const candidates = collectStaticRuntimeCandidates(parsed.layers).map(
    (candidate) =>
      candidate.paths.includes("app.js") && candidate.category === "javascript"
        ? { ...candidate, digests: [] }
        : candidate,
  );
  // Model the matcher's supported missing-digest boundary; do not falsify Evidence.
  const runtime = projectRuntimeCaptures(parsed.captures);
  const result = reconcileRuntimeEntities({
    entities: runtime.entities,
    candidates,
    layers: parsed.layers,
  });
  expect(
    result.items.find(({ entity_kind }) => entity_kind === "script"),
  ).toMatchObject({
    status: "unknown",
    basis: "operator-file-mapping",
    confidence: "unknown",
    reason: "static-or-runtime-coverage-incomplete",
    candidate_static_count: 1,
  });
  const script = result.items.find(
    ({ entity_kind }) => entity_kind === "script",
  );
  const candidate = script?.candidate_static_nodes[0];
  const states = classifyStaticLoadStates(
    parsed.layers,
    parsed.captures,
    runtime.entities,
    result.items,
    {
      reconciliationComplete: true,
    },
  );
  expect(
    states.states.find(
      (state) =>
        state.static_layer_id === candidate?.static_layer_id &&
        state.static_node_id === candidate?.static_node_id,
    ),
  ).toMatchObject({
    status: "unknown",
    reason: "static-or-runtime-coverage-incomplete",
  });
});

const UNRELATED = "export const unrelated = 17;\n";

type LayerSetup = {
  readonly root: string;
  readonly mapping: "none" | "explicit";
};

/** Reconcile one captured script, located at absent.js under live, against layers. */
const reconcileCapturedScript = async (input: {
  readonly layers: readonly LayerSetup[];
  readonly live: string;
  readonly source: string;
  readonly includeWorker?: boolean;
}) => {
  const result = reconcileJavaScriptRuntime(
    readInput(
      reconcileJavaScriptRuntimeInputSchema.parse({
        static_layers: await Promise.all(
          input.layers.map(async ({ root, mapping }, index) => ({
            role: (["application", "cache", "assets"] as const)[index],
            analysis: await analyzeFixture(root),
            runtime_mappings:
              mapping === "explicit"
                ? [{ kind: "file-root", root: input.live, artifact_prefix: "" }]
                : [],
          })),
        ),
        runtime_observations: [
          electronRuntimeEvidence(input.live, input.source, {
            scriptFile: "absent.js",
            includeWorker: input.includeWorker ?? false,
          }),
        ],
      }),
    ),
  );
  const item = (kind: string) =>
    result.reconciliations.find(({ entity_kind }) => entity_kind === kind);
  return { result, script: item("script"), worker: item("worker") };
};

it("keeps an unmapped captured script without a content match unknown", async () => {
  const root = await applicationFixture();
  const live = await createTestTempDirectory("rea-runtime-unmapped-");
  const { result, script, worker } = await reconcileCapturedScript({
    layers: [{ root, mapping: "none" }],
    live,
    source: UNRELATED,
    includeWorker: true,
  });
  const unknown = {
    status: "unknown",
    basis: "none",
    confidence: "unknown",
    reason: "no-authorized-location-mapping",
    static_layer_id: null,
    static_node_id: null,
    candidate_static_count: 0,
  };
  expect(script).toMatchObject(unknown);
  // A source-free worker at an unmapped location shares the same rule.
  expect(worker).toMatchObject(unknown);
  expect(result.summary).toMatchObject({ matched: 0, unmatched: 0 });
  expect(
    result.graph.edges.some(({ relation }) => relation === "observed_as"),
  ).toBe(false);
});

it.each(["explicit", "implicit-root"] as const)(
  "reports a mapped captured script without a content match as unmatched (%s)",
  async (mapping) => {
    const root = await applicationFixture();
    const live =
      mapping === "explicit"
        ? await createTestTempDirectory("rea-runtime-mapped-absent-")
        : root;
    const { result, script } = await reconcileCapturedScript({
      layers: [{ root, mapping: mapping === "explicit" ? "explicit" : "none" }],
      live,
      source: UNRELATED,
    });
    expect(script).toMatchObject({
      status: "unmatched",
      basis: "none",
      confidence: "high",
      reason: "no-static-content-match",
      candidate_static_count: 0,
    });
    expect(result.summary.unmatched).toBe(1);
  },
);

it.each([
  ["only the second", ["none", "explicit"], "unmatched"],
  ["only the first", ["explicit", "none"], "unmatched"],
  ["neither", ["none", "none"], "unknown"],
] as const)(
  "classifies an unmatched captured script when %s of two layers maps it",
  async (_label, mappings, status) => {
    const live = await createTestTempDirectory("rea-runtime-layer-mapping-");
    const { script } = await reconcileCapturedScript({
      layers: await Promise.all(
        mappings.map(async (mapping) => ({
          root: await applicationFixture(),
          mapping,
        })),
      ),
      live,
      source: UNRELATED,
    });
    expect(script).toMatchObject({
      status,
      reason:
        status === "unknown"
          ? "no-authorized-location-mapping"
          : "no-static-content-match",
    });
  },
);

it.each([
  [1, "matched", "unique-content-match"],
  [2, "ambiguous", "ambiguous-static-candidates"],
] as const)(
  "keeps unmapped content-only correspondence with %i digest candidates",
  async (copies, status, reason) => {
    const live = await createTestTempDirectory("rea-runtime-unmapped-content-");
    const { result, script } = await reconcileCapturedScript({
      layers: await Promise.all(
        Array.from({ length: copies }, async () => {
          const root = await applicationFixture();
          await writeFile(join(root, "other.js"), CAPTURED);
          return { root, mapping: "none" as const };
        }),
      ),
      live,
      source: CAPTURED,
    });
    expect(script).toMatchObject({
      status,
      basis: copies === 1 ? "content-sha256" : "none",
      reason,
      candidate_static_count: copies,
    });
    expect(result.summary.unmatched).toBe(0);
  },
);

it.each([
  ["https://example.test/assets/absent.js", "unmatched"],
  ["https://other.test/assets/absent.js", "unknown"],
] as const)(
  "applies URL-prefix mapping presence to captured script %s",
  async (url, status) => {
    const root = await applicationFixture();
    const parsed = readInput(
      reconcileJavaScriptRuntimeInputSchema.parse({
        static_layers: [
          {
            role: "application",
            analysis: await analyzeFixture(root),
            runtime_mappings: [
              {
                kind: "url-prefix",
                prefix: "https://example.test/assets/",
                artifact_prefix: "",
              },
            ],
          },
        ],
        runtime_observations: [
          electronRuntimeEvidence(root, UNRELATED, { includeWorker: false }),
        ],
      }),
    );
    // Model a URL-located capture at the matcher boundary; browser and
    // Inspector projections supply URL locations to the same classifier.
    const entities = projectRuntimeCaptures(parsed.captures).entities.map(
      (entity) =>
        entity.kind === "script"
          ? { ...entity, location: { kind: "url" as const, value: url } }
          : entity,
    );
    const result = reconcileRuntimeEntities({
      entities,
      candidates: collectStaticRuntimeCandidates(parsed.layers),
      layers: parsed.layers,
    });
    expect(
      result.items.find(({ entity_kind }) => entity_kind === "script"),
    ).toMatchObject({
      status,
      confidence: status === "unknown" ? "unknown" : "high",
      reason:
        status === "unknown"
          ? "no-authorized-location-mapping"
          : "no-static-content-match",
    });
  },
);
