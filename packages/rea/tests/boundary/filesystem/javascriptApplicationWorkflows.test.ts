import { rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { compareApplicationVersionsRequestSchema } from "../../../src/contracts/javascript/applicationWorkflowInputContracts.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import {
  compareApplicationVersionsEvidence,
  traceApplicationFeatureEvidence,
} from "../../../src/application/javascript/JavaScriptApplicationWorkflowService.js";
import { reconcileJavaScriptRuntimeEvidence } from "../../../src/application/javascript/JavaScriptRuntimeReconciliationService.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import {
  applicationVersionComparisonResultSchema,
  type ApplicationVersionComparisonResult,
} from "../../../src/domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { javascriptRuntimeReconciliationResultSchema } from "../../../src/domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { electronPageInspectionSchema } from "../../../src/domain/javascript/electronObservation.js";
import { compareJavaScriptApplicationVersions } from "../../../src/domain/javascript/javascriptApplicationVersionComparison.js";
import { createJavaScriptSemanticGraph } from "../../../src/domain/javascript/javascriptSemanticGraph.js";
import {
  createJavaScriptApplicationNode,
  createJavaScriptApplicationGraph,
} from "../../../src/domain/javascript/javascriptApplicationGraph.js";
import { traceApplicationFeature } from "../../../src/domain/javascript/javascriptFeatureTrace.js";
import { applicationFeatureTraceResultSchema } from "../../../src/domain/javascript/javascriptFeatureTraceSchemas.js";
import {
  APPLICATION_GRAPH_DIGESTS,
  buildSyntheticJavaScriptApplicationGraph,
} from "../../../src/domain/javascript/javascriptApplicationGraph.fixture.js";
import { writeVersionedJavaScriptApplicationFixtures } from "../../fixtures/javascriptArtifactApplication.js";
import { JAVASCRIPT_APPLICATION_PROVIDER } from "../../../src/domain/investigationProviders.js";
import { projectManagedApplicationGraphEvidence } from "../../../src/application/managed/ManagedApplicationGraphService.js";
import { MANAGED_APPLICATION_GRAPH_EXAMPLE } from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE } from "../../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import { managedApplicationGraphResultSchema } from "../../../src/domain/managed/managedApplicationGraph.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("JavaScript application workflows", () => {
  it("preserves source-owned requested native members across trace directions", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const addon = graph.nodes.find(({ kind }) => kind === "native-addon");
    if (addon === undefined) throw new Error("Expected native fixture node");
    const traces = (["incoming", "outgoing", "both"] as const).map(
      (direction) =>
        traceApplicationFeature({
          sourceEvidenceId: `ev_${"a".repeat(64)}`,
          graph,
          nativeEvidence: [],
          seed: {
            kind: "node-id",
            value: addon.node_id,
            match: "exact",
            case_sensitive: true,
          },
          direction,
        }),
    );
    for (const trace of traces)
      expect(trace.native_handoffs).toMatchObject([
        {
          native_node_id: addon.node_id,
          requested_exports: ["openProject"],
          export_node_ids: [expect.any(String)],
        },
      ]);
    expect(traces[0]!.native_handoffs).toEqual(traces[1]!.native_handoffs);
    expect(traces[0]!.graph?.edges).not.toEqual(traces[1]!.graph?.edges);
  });

  it("traces a contextBridge API through IPC into linked native evidence", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const nativeEvidence = createEvidence(
      {
        path: "/tmp/synthetic.node",
        sha256: APPLICATION_GRAPH_DIGESTS.nativeAddon,
        format: "elf",
        architecture: "x86_64",
      },
      { id: "ghidra", name: "Ghidra", version: "fixture" },
      {
        operation: "analyze_function",
        parameters: { address: "openProject" },
        result: { name: "openProject", address: "0x1000" },
        limitations: ["Synthetic native provider observation."],
      },
    );

    const result = traceApplicationFeature({
      sourceEvidenceId: `ev_${"a".repeat(64)}`,
      graph,
      nativeEvidence: [nativeEvidence],
      seed: {
        kind: "api",
        value: "desktopApi",
        match: "exact",
        case_sensitive: false,
      },
      direction: "outgoing",
    });

    expect(() =>
      applicationFeatureTraceResultSchema.parse(result),
    ).not.toThrow();
    expect(result.summary).toMatchObject({
      matched_seeds: 1,
      native_handoffs: 1,
    });
    expect(result.native_handoffs).toContainEqual(
      expect.objectContaining({
        artifact_sha256: APPLICATION_GRAPH_DIGESTS.nativeAddon,
        status: "evidence-linked",
        evidence_ids: [nativeEvidence.evidence_id],
        requested_exports: expect.arrayContaining(["openProject"]),
      }),
    );
    expect(result.paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ end_kind: "native-export" }),
      ]),
    );
    expect(
      result.graph?.edges.some(
        ({ evidence }) =>
          evidence.authority === "static-relationship-inference" &&
          evidence.state === "inferred",
      ),
    ).toBe(true);
  });

  it("keeps no-match explicit and traces the full reachable graph", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const noMatch = traceApplicationFeature({
      sourceEvidenceId: `ev_${"a".repeat(64)}`,
      graph,
      nativeEvidence: [],
      seed: {
        kind: "route",
        value: "/missing",
        match: "exact",
        case_sensitive: false,
      },
      direction: "both",
    });
    expect(noMatch).toMatchObject({
      graph: null,
      coverage: { status: "no-match" },
      summary: { matched_seeds: 0 },
    });

    const complete = traceApplicationFeature({
      sourceEvidenceId: `ev_${"a".repeat(64)}`,
      graph,
      nativeEvidence: [],
      seed: {
        kind: "api",
        value: "desktopApi",
        match: "exact",
        case_sensitive: false,
      },
      direction: "outgoing",
    });
    expect(complete.coverage.status).toBe("complete-within-source");
    expect(complete.coverage.total_seed_matches).toBe(1);
    expect(complete.graph?.nodes.length).toBeGreaterThan(1);
    expect(complete.coverage).not.toHaveProperty("omitted_nodes");
  });
});

describe("JavaScript application comparison workflows", () => {
  it("accepts complete inline Evidence and native observation arrays", () => {
    const native = Array.from({ length: 65 }, (_, index) =>
      createEvidence(
        {
          path: `/tmp/native-${index}.node`,
          sha256: index.toString(16).padStart(64, "0"),
          format: "elf",
          architecture: "x86_64",
        },
        { id: "ghidra", name: "Ghidra", version: "fixture" },
        {
          operation: "analyze_function",
          parameters: { address: `0x${index.toString(16)}` },
          result: { address: `0x${index.toString(16)}` },
        },
      ),
    );
    const applicationEvidence = (side: string) =>
      createEvidence(
        undefined,
        { id: "fixture", name: "Fixture", version: "1" },
        {
          predicateType: "rea.javascript-application-analysis",
          operation: "analyze_javascript_application",
          parameters: { side },
          result: {},
        },
      );
    const input = {
      left: applicationEvidence("left"),
      right: applicationEvidence("right"),
      left_native_observations: native,
    };
    expect(
      compareApplicationVersionsRequestSchema.safeParse(input).success,
    ).toBe(true);
  });
});

describe("historical native comparison projections", () => {
  it("keeps historical native member omission distinct through authenticated comparison", async () => {
    const root = await createTestTempDirectory(
      "rea-historical-native-members-",
    );
    temporary.push(root);
    await writeFile(
      join(root, "main.js"),
      'const { open } = require("./addon.node"); open();',
    );
    await writeFile(join(root, "addon.node"), "inert fixture; never executed");
    const source = await analyzeFixture(root);
    const original = javascriptApplicationAnalysisResultSchema.parse(
      source.normalized_result,
    );
    const binding = original.graph.nodes.find(
      ({ kind }) => kind === "native-export",
    );
    if (binding === undefined || source.subject === null)
      throw new Error("Missing fixture binding");
    const historical = (name: string, explicitEmpty = false) => {
      const artifact = binding.observations[0]!.evidence.artifact;
      if (!artifact.available)
        throw new Error("Missing binding source artifact");
      const node = createJavaScriptApplicationNode({
        kind: binding.kind,
        identity: {
          strategy: "artifact-local-key",
          stability: "artifact-version",
          artifact_sha256: artifact.sha256,
          namespace: "historical-native-binding-fixture",
          key: `${name}-${String(explicitEmpty)}`,
        },
        observations: binding.observations.map((observation) => {
          const { requested_members: _requested, ...properties } =
            observation.properties;
          return {
            label: name,
            properties: {
              ...properties,
              ...(explicitEmpty
                ? { requested_members: [] }
                : { members: [name] }),
            },
            evidence: observation.evidence,
          };
        }),
      });
      const { graph_id: _graphId, ...graphContent } = original.graph;
      const graph = createJavaScriptApplicationGraph({
        ...graphContent,
        nodes: [...original.graph.nodes, node],
      });
      const { graph_id: _semanticId, ...semanticContent } =
        original.semantic_graph;
      const semantic_graph = createJavaScriptSemanticGraph({
        ...semanticContent,
        application_graph_id: graph.graph_id,
      });
      return createEvidence(
        {
          path: source.subject!.local_path,
          sha256: source.subject!.digest.sha256,
          format: source.subject!.format,
        },
        source.provider,
        {
          predicateType: source.predicate_type,
          operation: source.operation,
          parameters: source.parameters,
          authority: source.authority,
          confidence: source.confidence,
          result: { ...original, graph, semantic_graph },
        },
      );
    };
    const left = historical("open");
    const before = JSON.stringify(left);
    for (const right of [historical("close"), historical("open", true)]) {
      const compared = compareApplicationVersionsEvidence({ left, right });
      if (!compared.ok) throw compared.error;
      const bindings = compared.value.result.items.filter(
        ({ node_kind, match }) =>
          node_kind === "native-export" && match.status === "unmatched",
      );
      expect(bindings).toHaveLength(2);
      expect(compared.value.sources).toEqual([left, right]);
    }
    expect(JSON.stringify(left)).toBe(before);
  });
});

describe("complete comparison projections", () => {
  it("matches rechunked modules by exact source and minified modules by structural fingerprint", async () => {
    const root = await createTestTempDirectory("rea-application-versions-");
    temporary.push(root);
    const fixtures = await writeVersionedJavaScriptApplicationFixtures(root);
    const [left, right] = await Promise.all([
      analyzeFixture(fixtures.left),
      analyzeFixture(fixtures.right),
    ]);
    const compared = compareApplicationVersionsEvidence({ left, right });
    if (!compared.ok) throw compared.error;
    expect(compared.value.sources[0]).toBe(left);
    expect(compared.value.sources[1]).toBe(right);
    const result = compared.value.result;
    expectFullComparisonResultSchema(result);
    const modules = result.items.filter(
      ({ node_kind: kind }) => kind === "javascript-module",
    );

    expect(modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          match: expect.objectContaining({
            status: "matched",
            basis: "exact-module-source-digest",
            confidence: "exact",
          }),
        }),
        expect.objectContaining({
          status: "changed",
          match: expect.objectContaining({
            status: "matched",
            basis: "structural-fingerprint",
            confidence: "medium",
          }),
        }),
      ]),
    );
    expect(result.matching.ambiguous).toBeGreaterThanOrEqual(4);
    expect(modules.filter(({ match }) => match.status === "ambiguous")).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "unknown" })]),
    );
    expect(result.summary.added).toBeGreaterThan(0);
    expect(result.summary.removed).toBeGreaterThan(0);
    expect(result.coverage).not.toHaveProperty("omitted_graph_nodes");
    expect(result.coverage).not.toHaveProperty("omitted_graph_edges");
    expect(result.coverage).not.toHaveProperty("omitted_graph_observations");
    expect(result.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "changed_from",
          evidence: expect.objectContaining({
            authority: "cross-version-comparison",
            state: "inferred",
          }),
        }),
      ]),
    );
    expect(result.limitations.join(" ")).toMatch(
      /module ordinals|fuzzy pairing/u,
    );
    expectComparisonItemAlgebra(result);
  });

  it("pairs source-map originals without promoting the match to exact", async () => {
    const root = await createTestTempDirectory("rea-source-map-versions-");
    temporary.push(root);
    const fixtures = await writeVersionedJavaScriptApplicationFixtures(root);
    const [left, right] = await Promise.all([
      analyzeFixture(fixtures.left),
      analyzeFixture(fixtures.right),
    ]);
    const compared = compareApplicationVersionsEvidence({ left, right });
    if (!compared.ok) throw compared.error;
    const result = compared.value.result;
    expect(result.items).toContainEqual(
      expect.objectContaining({
        node_kind: "source-module",
        status: "changed",
        match: expect.objectContaining({
          basis: "source-map-identity",
          confidence: "high",
        }),
      }),
    );
  });

  it("keeps incomplete one-sided absence unknown and reports source omissions", () => {
    const complete = buildSyntheticJavaScriptApplicationGraph();
    const rootNode = complete.nodes.find(({ node_id: id }) =>
      complete.root_node_ids.includes(id),
    );
    if (rootNode === undefined) throw new Error("Synthetic graph root missing");
    const partial = createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: [rootNode.node_id],
      nodes: [rootNode],
      edges: [],
      coverage: {
        status: "partial",
        truncated: true,
        omitted_count: complete.nodes.length - 1,
        limits: [{ name: "fixture_nodes", value: 1, unit: "items" }],
      },
      limitations: ["Synthetic partial graph."],
    });
    const input = {
      left: {
        evidenceId: `ev_${"a".repeat(64)}`,
        rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.package,
        graph: complete,
      },
      right: {
        evidenceId: `ev_${"b".repeat(64)}`,
        rootArtifactSha256: APPLICATION_GRAPH_DIGESTS.package,
        graph: partial,
      },
      leftNativeEvidence: [],
      rightNativeEvidence: [],
    };

    const first = compareJavaScriptApplicationVersions(input);
    const second = compareJavaScriptApplicationVersions(input);
    expect(first.comparison_id).toBe(second.comparison_id);
    expect(first.coverage).toMatchObject({
      status: "truncated",
      right_graph_status: "partial",
      right_graph_omitted_count: complete.nodes.length - 1,
    });
    expect(first.summary.removed).toBe(0);
    expect(first.summary.unknown).toBeGreaterThan(0);
  });
});

describe("Application graph Evidence envelopes", () => {
  it.each(["runtime reconciliation", "managed application graph"] as const)(
    "rejects %s result links outside the authenticated Evidence envelope",
    (sourceKind) => {
      const sourceResult =
        sourceKind === "runtime reconciliation"
          ? reconcileJavaScriptRuntimeEvidence(
              JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
            )
          : projectManagedApplicationGraphEvidence(
              MANAGED_APPLICATION_GRAPH_EXAMPLE,
            );
      if (!sourceResult.ok) throw sourceResult.error;
      const source =
        "evidence" in sourceResult.value
          ? sourceResult.value.evidence
          : sourceResult.value;
      const result =
        sourceKind === "runtime reconciliation"
          ? javascriptRuntimeReconciliationResultSchema.parse(
              source.normalized_result,
            )
          : managedApplicationGraphResultSchema.parse(source.normalized_result);
      const extraLink = `ev_${"f".repeat(64)}`;
      const malformed = createEvidence(undefined, source.provider, {
        predicateType: source.predicate_type,
        operation: source.operation,
        parameters: source.parameters,
        result: {
          ...result,
          evidence_links: [...result.evidence_links, extraLink],
        },
        rawResult: source.raw_result,
        confidence: source.confidence,
        authority: source.authority,
        environment: source.environment,
        limitations: source.limitations,
        locations: source.locations,
        evidenceLinks: source.evidence_links,
      });
      const workflowInput = {
        application: source,
        seed: { kind: "route" as const, value: "/not-present" },
        direction: "both" as const,
      };

      expect(traceApplicationFeatureEvidence(workflowInput).ok).toBe(true);
      const rejected = traceApplicationFeatureEvidence({
        ...workflowInput,
        application: malformed,
      });

      expect(rejected).toMatchObject({
        ok: false,
        error: {
          issues: [
            {
              path: ["application", "normalized_result", "evidence_links"],
              reason: "invalid_value",
              message: `${sourceKind === "runtime reconciliation" ? "Runtime reconciliation result" : "Managed application graph result"} references Evidence ${extraLink} outside its envelope.`,
            },
          ],
        },
      });
    },
  );
});

describe("JavaScript application workflow error diagnostics", () => {
  it("identifies the inconsistent Evidence subject in graph workflows", async () => {
    const root = await createTestTempDirectory(
      "rea-application-workflow-diagnostics-",
    );
    temporary.push(root);
    const evidence = await analyzeFixture(root);
    const subject = evidence.subject;
    if (subject === null) throw new Error("Analysis Evidence subject missing");
    const inconsistentPath = "/different/application.js";
    const inconsistent = {
      ...evidence,
      subject: { ...subject, local_path: inconsistentPath },
    };

    const result = traceApplicationFeatureEvidence({
      application: inconsistent,
      seed: { kind: "route", value: "/" },
      direction: "both",
    });

    if (result.ok) throw new Error("Expected inconsistent Evidence to fail");
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    if (!(result.error instanceof AnalysisInputError)) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        reason: "invalid_value",
        path: ["application", "subject"],
        message: expect.stringContaining("subject must match"),
      }),
    );
  });

  it("preserves schema-authored Evidence validation messages", async () => {
    const root = await createTestTempDirectory(
      "rea-application-workflow-schema-diagnostics-",
    );
    temporary.push(root);
    const evidence = await analyzeFixture(root);
    const subject = evidence.subject;
    if (subject === null) throw new Error("Analysis Evidence subject missing");
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    const malformedResult = {
      ...result,
      semantic_graph: {
        ...result.semantic_graph,
        application_graph_id: `jag_${"f".repeat(64)}`,
      },
    };
    const malformedEvidence = createEvidence(
      {
        path: subject.local_path,
        sha256: subject.digest.sha256,
        format: subject.format,
      },
      JAVASCRIPT_APPLICATION_PROVIDER,
      {
        predicateType: evidence.predicate_type,
        operation: evidence.operation,
        parameters: evidence.parameters,
        result: malformedResult,
        confidence: evidence.confidence,
        authority: evidence.authority,
        limitations: evidence.limitations,
        locations: evidence.locations,
        evidenceLinks: evidence.evidence_links,
      },
    );

    const traced = traceApplicationFeatureEvidence({
      application: malformedEvidence,
      seed: { kind: "route", value: "/" },
      direction: "both",
    });
    const reconciled = reconcileJavaScriptRuntimeEvidence({
      static_layers: [{ role: "application", analysis: malformedEvidence }],
      runtime_observations: [evidence],
    });

    expect(traced.ok).toBe(false);
    expect(reconciled.ok).toBe(false);
    if (!traced.ok && traced.error instanceof AnalysisInputError)
      expect(traced.error.issues).toContainEqual(
        expect.objectContaining({
          message:
            "Semantic graph must commit the containing application graph",
        }),
      );
    if (!reconciled.ok && reconciled.error instanceof AnalysisInputError)
      expect(reconciled.error.issues).toContainEqual(
        expect.objectContaining({
          message:
            "Semantic graph must commit the containing application graph",
        }),
      );
  });

  it("returns supported-operation constraints from runtime reconciliation", async () => {
    const root = await createTestTempDirectory(
      "rea-runtime-workflow-diagnostics-",
    );
    temporary.push(root);
    const evidence = await analyzeFixture(root);

    const result = reconcileJavaScriptRuntimeEvidence({
      static_layers: [{ role: "application", analysis: evidence }],
      runtime_observations: [evidence],
    });

    if (result.ok) throw new Error("Expected non-runtime Evidence to fail");
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    if (!(result.error instanceof AnalysisInputError)) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        reason: "invalid_value",
        message:
          "Runtime reconciliation requires inspect_web_page, inspect_electron_page, observe_javascript_runtime, or capture_electron_scenario Evidence",
      }),
    );
  });
});

const RUNTIME_PATH_CASES = [
  {
    name: "case-sensitive POSIX input root",
    root: null,
    path: "/applications/Example.app/Contents/Resources/app/renderer.js",
    status: "unknown",
    basis: "none",
  },
  {
    name: "case-sensitive POSIX mapping root",
    root: "/runtime/App",
    path: "/runtime/app/renderer.js",
    status: "unknown",
    basis: "none",
  },
  {
    name: "matching POSIX mapping root",
    root: "/runtime/App",
    path: "/runtime/App/renderer.js",
    status: "matched",
    basis: "operator-file-mapping",
  },
  {
    name: "case-insensitive Windows mapping root",
    root: String.raw`C:\runtime\App`,
    path: String.raw`c:\runtime\app\renderer.js`,
    status: "matched",
    basis: "operator-file-mapping",
  },
] as const;

describe("JavaScript runtime reconciliation local paths", () => {
  it.each(RUNTIME_PATH_CASES)(
    "uses $name on every host",
    ({ root, path, status, basis }) => {
      const base = JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE;
      const original = base.runtime_observations[0]!;
      const inspection = electronPageInspectionSchema.parse(
        original.normalized_result,
      );
      // Keep target and script coordinates consistent so an unrelated target
      // cannot activate the static layer after its script mapping was rejected.
      const runtime = createEvidence(undefined, original.provider, {
        predicateType: original.predicate_type,
        operation: original.operation,
        parameters: { ...original.parameters, include_script_sources: false },
        result: {
          ...inspection,
          target: { ...inspection.target, file_path: path },
          scripts: {
            ...inspection.scripts,
            items: inspection.scripts.items.map((script) => ({
              ...script,
              file_path: path,
              source: { included: false, reason: "not-requested" },
            })),
          },
        },
        confidence: original.confidence,
        authority: original.authority,
      });
      const reconciled = reconcileJavaScriptRuntimeEvidence({
        static_layers: base.static_layers.map((layer) => ({
          ...layer,
          runtime_mappings: root === null ? [] : [{ kind: "file-root", root }],
        })),
        runtime_observations: [runtime],
      });
      if (!reconciled.ok) throw reconciled.error;
      const result = javascriptRuntimeReconciliationResultSchema.parse(
        reconciled.value.evidence.normalized_result,
      );
      expect(
        result.reconciliations.find(
          ({ entity_kind }) => entity_kind === "script",
        ),
      ).toMatchObject({ status, basis });
      expect(
        result.static_load_states.find(
          ({ kind }) => kind === "javascript-asset",
        ),
      ).toMatchObject(
        status === "matched"
          ? { status: "loaded", reason: "runtime-script-correspondence" }
          : { status: "unknown", reason: "layer-outside-runtime-scope" },
      );
      expect(result.static_layers[0]?.runtime_mappings).toEqual(
        root === null ? [] : [{ kind: "file-root", root, artifact_prefix: "" }],
      );
    },
  );

  it("resolves relative file mapping roots before deriving result Evidence", () => {
    const absoluteRoot = resolve(process.cwd(), "runtime-cache-fixture");
    const relativeRoot = relative(process.cwd(), absoluteRoot);
    const base = JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE;
    const [baseLayer] = base.static_layers;
    if (baseLayer === undefined) throw new Error("Static layer missing");
    const input = {
      ...base,
      static_layers: [
        {
          ...baseLayer,
          runtime_mappings: [
            { kind: "file-root" as const, root: relativeRoot },
          ],
        },
      ],
    };
    const relativeResult = reconcileJavaScriptRuntimeEvidence(input);
    const absoluteResult = reconcileJavaScriptRuntimeEvidence({
      ...input,
      static_layers: [
        {
          ...input.static_layers[0],
          runtime_mappings: [{ kind: "file-root", root: absoluteRoot }],
        },
      ],
    });

    expect(relativeResult.ok).toBe(true);
    expect(absoluteResult.ok).toBe(true);
    if (!relativeResult.ok || !absoluteResult.ok) return;
    expect(relativeResult.value.evidence.evidence_id).toBe(
      absoluteResult.value.evidence.evidence_id,
    );
    expect(relativeResult.value.evidence.normalized_result).toEqual(
      absoluteResult.value.evidence.normalized_result,
    );
    const result = javascriptRuntimeReconciliationResultSchema.parse(
      relativeResult.value.evidence.normalized_result,
    );
    expect(result.static_layers[0]?.runtime_mappings[0]).toMatchObject({
      kind: "file-root",
      root: absoluteRoot,
    });
  });

  it("preserves foreign absolute file roots without matching another path syntax", () => {
    const base = JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE;
    const [baseLayer] = base.static_layers;
    if (baseLayer === undefined) throw new Error("Static layer missing");
    const remoteWindowsRoot = String.raw`C:\runtime\cache`;
    const reconciled = reconcileJavaScriptRuntimeEvidence({
      ...base,
      static_layers: [
        {
          ...baseLayer,
          runtime_mappings: [{ kind: "file-root", root: remoteWindowsRoot }],
        },
      ],
    });

    if (!reconciled.ok) throw reconciled.error;
    const result = javascriptRuntimeReconciliationResultSchema.parse(
      reconciled.value.evidence.normalized_result,
    );
    expect(result.static_layers[0]?.runtime_mappings[0]).toMatchObject({
      kind: "file-root",
      root: remoteWindowsRoot,
    });
    expect(
      result.reconciliations.some(
        ({ basis }) => basis === "operator-file-mapping",
      ),
    ).toBe(false);
  });
});

const analyzeFixture = async (root: string) => {
  const result = await analyzeJavaScriptApplication({
    input_path: root,
  });
  if (!result.ok) throw result.error;
  return result.value;
};

const expectComparisonItemAlgebra = (
  result: ApplicationVersionComparisonResult,
): void => {
  const matched = result.items.find(({ match }) => match.status === "matched");
  expect(matched).toBeDefined();
  if (matched === undefined) return;
  expect(
    applicationVersionComparisonResultSchema.safeParse({
      ...result,
      items: [{ ...matched, right_node_id: null }],
    }).success,
  ).toBe(false);
  expect(
    applicationVersionComparisonResultSchema.safeParse({
      ...result,
      items: [
        {
          ...matched,
          match: {
            ...matched.match,
            basis: "none",
            confidence: "unknown",
          },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    applicationVersionComparisonResultSchema.safeParse({
      ...result,
      coverage: {
        ...result.coverage,
        status: "complete-within-inputs",
        left_graph_status: "partial",
      },
    }).success,
  ).toBe(false);
};

const expectFullComparisonResultSchema = (
  result: ApplicationVersionComparisonResult,
): void => {
  const candidateNodeIds = Array.from(
    { length: 1_001 },
    (_, index) => `jag_node_${index.toString(16).padStart(64, "0")}`,
  );
  const expanded = {
    ...result,
    evidence_links: Array.from(
      { length: 131 },
      (_, index) => `ev_${index.toString(16).padStart(64, "0")}`,
    ),
    items: result.items.map((item) =>
      item.match.status === "ambiguous"
        ? {
            ...item,
            match: {
              ...item.match,
              ...(item.match.candidate_left_node_ids.length === 0
                ? { candidate_right_node_ids: candidateNodeIds }
                : { candidate_left_node_ids: candidateNodeIds }),
            },
          }
        : item,
    ),
  };
  expect(
    applicationVersionComparisonResultSchema.safeParse(expanded).success,
  ).toBe(true);
};
