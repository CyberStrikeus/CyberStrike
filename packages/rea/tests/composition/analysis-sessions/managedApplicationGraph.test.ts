import { describe, expect, it } from "vitest";

import { projectManagedApplicationGraphEvidence } from "../../../src/application/managed/ManagedApplicationGraphService.js";
import {
  managedApplicationGraphReferenceInputSchema,
  managedApplicationGraphResultSchema,
} from "../../../src/domain/managed/managedApplicationGraph.js";
import { MANAGED_APPLICATION_GRAPH_EXAMPLE } from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { traceApplicationFeatureEvidence } from "../../../src/application/javascript/JavaScriptApplicationWorkflowService.js";
import { MANAGED_STATIC_PROVIDER } from "../../../src/domain/investigationProviders.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { parseJavaScriptApplicationGraph } from "../../../src/domain/javascript/javascriptApplicationGraph.js";
import {
  managedMemberInspectionSchema,
  managedNativeBoundaryInspectionSchema,
} from "../../../src/domain/managed/managedArtifact.js";
import { inspectManagedArtifactBytes } from "../../../src/dotnet/ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "../../../src/dotnet/ManagedMemberInspector.js";
import { inspectManagedNativeBoundariesBytes } from "../../../src/dotnet/ManagedNativeBoundaryInspector.js";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "../../../src/dotnet/ManagedPe.fixture.js";

/** Tiny-format CIL method body. */
const tinyIl = (il: readonly number[]): Buffer =>
  Buffer.from([(il.length << 2) | 2, ...il]);

const memberGraph = (
  bytes: Buffer,
  options: Parameters<typeof inspectManagedMembersBytes>[2] = {},
) => {
  const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedCalls.exe");
  const members = inspectManagedMembersBytes(bytes, binary, options);
  const memberEvidence = createEvidence(binary, MANAGED_STATIC_PROVIDER, {
    operation: "inspect_managed_members",
    parameters: {},
    result: members,
    rawResult: null,
    limitations: members.limitations,
  });
  const projection = projectManagedApplicationGraphEvidence({
    managed_members: memberEvidence,
  });
  if (!projection.ok) throw new Error(JSON.stringify(projection.error));
  const result = managedApplicationGraphResultSchema.parse(
    parseEvidence(projection.value).normalized_result,
  );
  const graph = parseJavaScriptApplicationGraph(result.graph);
  return { members, memberEvidence, result, graph };
};

const createManagedInteropEvidence = () => {
  const bytes = buildManagedPeFixture({
    pinvoke: {
      moduleName: "user32.dll",
      importName: "MessageBoxW",
      mappingFlags: 0x0345,
    },
  });
  const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedInterop.exe");
  const managedArtifact = inspectManagedArtifactBytes(bytes, binary);
  const members = inspectManagedMembersBytes(bytes, binary);
  const boundaries = inspectManagedNativeBoundariesBytes(bytes, binary);

  return {
    artifactEvidence: createEvidence(binary, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_artifact",
      parameters: {},
      result: managedArtifact,
      rawResult: null,
      limitations: managedArtifact.limitations,
      locations: [{ kind: "artifact-path", path: binary.path }],
    }),
    memberEvidence: createEvidence(binary, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_members",
      parameters: {},
      result: members,
      rawResult: null,
      limitations: members.limitations,
      locations: [{ kind: "artifact-path", path: binary.path }],
    }),
    boundaryEvidence: createEvidence(binary, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_native_boundaries",
      parameters: {},
      result: boundaries,
      rawResult: null,
      limitations: boundaries.limitations,
      locations: [{ kind: "artifact-path", path: binary.path }],
    }),
  };
};

describe("managed application graph MethodDef scope", () => {
  it("preserves MethodDef page omissions from decoded member Evidence", () => {
    const bytes = buildManagedPeFixture({
      ilBody: tinyIl([0x2a]),
      methodRowCount: 3,
    });
    const full = memberGraph(bytes);
    expect(full.members.method_rows).toEqual({ offset: 0, count: 3, total: 3 });
    expect(full.result.coverage.status).toBe("complete-within-inputs");
    for (const options of [
      { methodLimit: 0 },
      { methodOffset: 1, methodLimit: 1 },
      { methodOffset: 3 },
    ]) {
      const page = memberGraph(bytes, options);
      expect(page.members.coverage.state).toBe("complete");
      expect(page.result.summary.methods).toBe(page.members.method_rows!.count);
      expect(page.result.coverage.status).toBe("partial");
      expect(page.result.limitations).toContain(
        `Managed member Evidence examined MethodDef rows at offset ${page.members.method_rows!.offset} with count ${page.members.method_rows!.count} of 3 total rows; methods outside that interval and their relations are omitted, not absent.`,
      );
    }
  });

  it("keeps unrecorded legacy MethodDef scope unknown", () => {
    const bytes = buildManagedPeFixture({ ilBody: tinyIl([0x2a]) });
    const binary = managedPeFixtureTarget(bytes);
    const members = inspectManagedMembersBytes(bytes, binary);
    const { method_rows: _methodRows, ...legacy } = members;
    const evidence = createEvidence(binary, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_members",
      parameters: {},
      result: legacy,
      rawResult: null,
      limitations: members.limitations,
    });
    const projection = projectManagedApplicationGraphEvidence({
      managed_members: evidence,
    });
    if (!projection.ok) throw new Error(JSON.stringify(projection.error));
    const result = managedApplicationGraphResultSchema.parse(
      parseEvidence(projection.value).normalized_result,
    );
    expect(result.coverage.status).toBe("partial");
    expect(result.summary.methods).toBe(1);
    expect(result.limitations).toContain(
      "Managed member Evidence did not record its MethodDef row scope; coverage of methods and their relations outside the supplied observations is unknown.",
    );
  });
});

describe("managed application graph projection", () => {
  it("projects managed metadata and native declarations into authenticated graph Evidence", () => {
    const { artifactEvidence, memberEvidence, boundaryEvidence } =
      createManagedInteropEvidence();

    const evidence = projectManagedApplicationGraphEvidence({
      managed_artifact: artifactEvidence,
      managed_members: memberEvidence,
      managed_native_boundaries: boundaryEvidence,
    });

    expect(
      evidence.ok,
      evidence.ok
        ? undefined
        : `${JSON.stringify(evidence.error)} cause=${String(evidence.error.cause)}`,
    ).toBe(true);
    if (!evidence.ok) throw new Error("projection failed");
    const parsed = parseEvidence(evidence.value);
    expect(parsed).toMatchObject({
      operation: "project_managed_application_graph",
      predicate_type: "rea.managed-application-graph",
      provider: { id: "rea-dotnet-workflows" },
      confidence: "inferred",
      authority: "analyst-inference",
      evidence_links: [
        artifactEvidence.evidence_id,
        memberEvidence.evidence_id,
        boundaryEvidence.evidence_id,
      ],
    });
    const result = managedApplicationGraphResultSchema.parse(
      parsed.normalized_result,
    );
    const graph = parseJavaScriptApplicationGraph(result.graph);
    expect(result.summary).toMatchObject({
      assemblies: 1,
      modules: 1,
      types: 1,
      methods: 1,
      fields: 1,
      pinvoke_imports: 1,
    });
    expect(graph.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "artifact",
        "managed-assembly",
        "managed-module",
        "managed-type",
        "managed-method",
        "managed-field",
        "managed-pinvoke-import",
      ]),
    );
    const allEvidenceIds = [
      artifactEvidence.evidence_id,
      memberEvidence.evidence_id,
      boundaryEvidence.evidence_id,
    ].sort();
    const observedEvidenceIds = (kind: string): readonly string[] => {
      const observation = graph.nodes.find((node) => node.kind === kind)
        ?.observations[0];
      if (observation === undefined)
        throw new Error(`Expected ${kind} observation`);
      return observation.evidence.evidence_ids;
    };
    expect(observedEvidenceIds("artifact")).toEqual(allEvidenceIds);
    expect(observedEvidenceIds("managed-assembly")).toEqual([
      artifactEvidence.evidence_id,
    ]);
    expect(observedEvidenceIds("managed-module")).toEqual([
      artifactEvidence.evidence_id,
    ]);
    for (const kind of ["managed-type", "managed-method", "managed-field"])
      expect(observedEvidenceIds(kind)).toEqual([memberEvidence.evidence_id]);
    expect(observedEvidenceIds("managed-pinvoke-import")).toEqual([
      boundaryEvidence.evidence_id,
    ]);
    const containmentEdges = graph.edges.filter(
      ({ relation }) => relation === "contains",
    );
    expect(containmentEdges.length).toBeGreaterThan(0);
    for (const edge of containmentEdges)
      expect(edge.evidence.evidence_ids).toEqual(allEvidenceIds);
    const method = graph.nodes.find(
      ({ kind, observations }) =>
        kind === "managed-method" &&
        observations[0]?.label === "Fixture.Program.Main",
    );
    expect(method).toBeDefined();
    const importEdge = graph.edges.find(
      ({ source_node_id, relation, target_node_id }) =>
        source_node_id === method?.node_id &&
        relation === "imports" &&
        graph.nodes.find(({ node_id: id }) => id === target_node_id)?.kind ===
          "managed-pinvoke-import",
    );
    expect(importEdge).toBeDefined();
    expect(importEdge?.evidence.evidence_ids).toEqual(
      [memberEvidence.evidence_id, boundaryEvidence.evidence_id].sort(),
    );
    expect(
      graph.nodes.flatMap(({ observations }) =>
        observations.map(({ evidence }) => evidence.authority),
      ),
    ).toContain("managed-static-analysis");

    const trace = traceApplicationFeatureEvidence({
      application: parsed,
      native_observations: [],
      seed: {
        kind: "string",
        value: "MessageBoxW",
        match: "exact",
        case_sensitive: true,
      },
      direction: "incoming",
    });
    expect(trace.ok, trace.ok ? undefined : JSON.stringify(trace.error)).toBe(
      true,
    );
    if (!trace.ok) throw new Error("trace failed");
    expect(trace.value.result).toMatchObject({
      source_evidence_id: parsed.evidence_id,
      summary: { matched_seeds: 1 },
    });
  });
});

describe("managed application graph request", () => {
  it("accepts any nonempty set of inline sources and rejects duplicates", () => {
    const evidence = MANAGED_APPLICATION_GRAPH_EXAMPLE.managed_members;
    expect(
      managedApplicationGraphReferenceInputSchema.safeParse({
        managed_members: evidence,
      }).success,
    ).toBe(true);
    expect(
      managedApplicationGraphReferenceInputSchema.safeParse({}).success,
    ).toBe(false);
    expect(
      managedApplicationGraphReferenceInputSchema.safeParse({
        managed_members: evidence,
        managed_native_boundaries: evidence,
      }).success,
    ).toBe(false);
  });
});

describe("managed application graph coverage", () => {
  it("rejects managed Evidence whose artifact digest differs from its subject", () => {
    const bytes = buildManagedPeFixture();
    const binary = managedPeFixtureTarget(bytes, "/fixture/Mismatch.dll");
    const members = inspectManagedMembersBytes(bytes, binary);
    const mismatched = createEvidence(binary, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_members",
      parameters: {},
      result: {
        ...members,
        artifact: { ...members.artifact, sha256: "b".repeat(64) },
        identity_scope: {
          ...members.identity_scope,
          requires_artifact_sha256: "b".repeat(64),
        },
      },
    });
    const rejected = projectManagedApplicationGraphEvidence({
      managed_members: mismatched,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("mismatched managed Evidence accepted");
    expect(JSON.stringify(rejected.error)).toContain(
      `Managed Evidence inspect_managed_members (${mismatched.evidence_id}) subject SHA-256 ${binary.sha256} does not match normalized artifact SHA-256 ${"b".repeat(64)}`,
    );
  });
});

describe("managed application graph identity facts", () => {
  it.each([
    ["managed_members", "memberEvidence"],
    ["managed_native_boundaries", "boundaryEvidence"],
  ] as const)(
    "binds a module from %s to its supplying Evidence",
    (inputKey, evidenceKey) => {
      const source = createManagedInteropEvidence()[evidenceKey];
      const projected = projectManagedApplicationGraphEvidence({
        [inputKey]: source,
      });
      if (!projected.ok) throw projected.error;
      const result = managedApplicationGraphResultSchema.parse(
        parseEvidence(projected.value).normalized_result,
      );
      const graph = parseJavaScriptApplicationGraph(result.graph);
      expect(result.summary).toMatchObject({ assemblies: 0, modules: 1 });
      expect(
        graph.nodes.find(({ kind }) => kind === "managed-module")
          ?.observations[0],
      ).toMatchObject({
        evidence: {
          extractor: { operation: source.operation },
          evidence_ids: [source.evidence_id],
        },
      });
      expect(result.evidence_links).toEqual([source.evidence_id]);
      expect(result.limitations).toContain(
        "Managed artifact Evidence was not supplied; assembly identity observations are absent.",
      );
    },
  );

  it("reports no assembly or module when the inspector observes no identity rows", () => {
    const bytes = buildManagedPeFixture({
      moduleRowCount: 0,
      assemblyRowCount: 0,
    });
    const binary = managedPeFixtureTarget(bytes, "/fixture/NoIdentityRows.exe");
    const inspection = inspectManagedArtifactBytes(bytes, binary);
    expect(inspection).toMatchObject({ module: null, assembly: null });
    const artifactEvidence = createEvidence(binary, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_artifact",
      parameters: {},
      result: inspection,
      rawResult: null,
      limitations: inspection.limitations,
      locations: [{ kind: "artifact-path", path: binary.path }],
    });

    const projected = projectManagedApplicationGraphEvidence({
      managed_artifact: artifactEvidence,
    });
    if (!projected.ok) throw projected.error;
    const result = managedApplicationGraphResultSchema.parse(
      parseEvidence(projected.value).normalized_result,
    );
    const graph = parseJavaScriptApplicationGraph(result.graph);
    expect(result.summary).toMatchObject({ assemblies: 0, modules: 0 });
    expect(
      graph.nodes.filter(
        ({ kind }) => kind === "managed-assembly" || kind === "managed-module",
      ),
    ).toEqual([]);
  });

  it("projects a module whose metadata name is empty without a label", () => {
    const bytes = buildManagedPeFixture({ ilBody: Buffer.from([0x06, 0x2a]) });
    const control = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes, "/fixture/EmptyModuleName.dll"),
    );
    if (control.module === null) throw new Error("Expected a Module row");
    // Point the Module row's Name at the string heap's empty entry.
    bytes.writeUInt16LE(0, control.module.row_offset + 2);
    const binary = managedPeFixtureTarget(
      bytes,
      "/fixture/EmptyModuleName.dll",
    );
    const members = inspectManagedMembersBytes(bytes, binary);
    expect(members.module?.name).toBe("");
    const projected = projectManagedApplicationGraphEvidence({
      managed_members: createEvidence(binary, MANAGED_STATIC_PROVIDER, {
        operation: "inspect_managed_members",
        parameters: {},
        result: members,
        rawResult: null,
        limitations: members.limitations,
        locations: [{ kind: "artifact-path", path: binary.path }],
      }),
    });
    if (!projected.ok) throw projected.error;
    const graph = parseJavaScriptApplicationGraph(
      managedApplicationGraphResultSchema.parse(
        parseEvidence(projected.value).normalized_result,
      ).graph,
    );
    expect(
      graph.nodes.find(({ kind }) => kind === "managed-module")
        ?.observations[0],
    ).toMatchObject({ label: null, properties: { name: "" } });
    expect(graph.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "managed-module",
        "managed-type",
        "managed-method",
        "managed-field",
      ]),
    );
  });
});

it("normalizes MVID casing for node identity while preserving observed values", () => {
  const { memberEvidence, boundaryEvidence } = createManagedInteropEvidence();
  const members = managedMemberInspectionSchema.parse(
    parseEvidence(memberEvidence).normalized_result,
  );
  if (members.module === null)
    throw new Error("Expected fixture module identity");
  const uppercaseMvid = members.module.mvid?.toUpperCase();
  if (uppercaseMvid === undefined || uppercaseMvid === null)
    throw new Error("Expected fixture module MVID");
  const uppercaseMembers = createEvidence(undefined, MANAGED_STATIC_PROVIDER, {
    operation: "inspect_managed_members",
    parameters: {},
    result: {
      ...members,
      module: {
        ...members.module,
        mvid: uppercaseMvid,
        enc_id: null,
        enc_base_id: null,
      },
      identity_scope: {
        ...members.identity_scope,
        requires_mvid: uppercaseMvid,
      },
    },
    rawResult: null,
    limitations: members.limitations,
  });
  const baseline = projectManagedApplicationGraphEvidence({
    managed_members: memberEvidence,
    managed_native_boundaries: boundaryEvidence,
  });
  const uppercase = projectManagedApplicationGraphEvidence({
    managed_members: uppercaseMembers,
    managed_native_boundaries: boundaryEvidence,
  });
  if (!baseline.ok) throw baseline.error;
  if (!uppercase.ok) throw uppercase.error;
  const baselineResult = managedApplicationGraphResultSchema.parse(
    parseEvidence(baseline.value).normalized_result,
  );
  const uppercaseResult = managedApplicationGraphResultSchema.parse(
    parseEvidence(uppercase.value).normalized_result,
  );
  const baselineModule = parseJavaScriptApplicationGraph(
    baselineResult.graph,
  ).nodes.find(({ kind }) => kind === "managed-module");
  const uppercaseGraph = parseJavaScriptApplicationGraph(uppercaseResult.graph);
  const uppercaseModule = uppercaseGraph.nodes.find(
    ({ kind }) => kind === "managed-module",
  );
  expect(uppercaseGraph.edges).toContainEqual(
    expect.objectContaining({
      relation: "imports",
      source_node_id: uppercaseGraph.nodes.find(
        ({ kind }) => kind === "managed-method",
      )?.node_id,
    }),
  );
  expect(uppercaseModule?.node_id).toBe(baselineModule?.node_id);
  expect(uppercaseModule?.observations[0]?.properties.mvid).toBe(uppercaseMvid);
});

describe("managed application graph module identity consistency", () => {
  it("rejects contradictory known module MVIDs across same-artifact inputs", () => {
    const { artifactEvidence, memberEvidence, boundaryEvidence } =
      createManagedInteropEvidence();
    const boundaries = managedNativeBoundaryInspectionSchema.parse(
      parseEvidence(boundaryEvidence).normalized_result,
    );
    const conflictingMvid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const conflictingBoundaries = createEvidence(
      undefined,
      MANAGED_STATIC_PROVIDER,
      {
        operation: "inspect_managed_native_boundaries",
        parameters: {},
        result: {
          ...boundaries,
          module:
            boundaries.module === null
              ? null
              : { ...boundaries.module, mvid: conflictingMvid },
          identity_scope: {
            ...boundaries.identity_scope,
            requires_mvid: conflictingMvid,
          },
        },
        rawResult: null,
        limitations: boundaries.limitations,
      },
    );

    const projected = projectManagedApplicationGraphEvidence({
      managed_artifact: artifactEvidence,
      managed_members: memberEvidence,
      managed_native_boundaries: conflictingBoundaries,
    });
    expect(projected.ok).toBe(false);
    if (projected.ok) throw new Error("conflicting MVIDs were accepted");
    expect(JSON.stringify(projected.error)).toContain(
      "conflicting known module MVIDs or token scopes",
    );
  });

  it("rejects contradictory known module declaration fields", () => {
    const { artifactEvidence, memberEvidence } = createManagedInteropEvidence();
    const members = managedMemberInspectionSchema.parse(
      parseEvidence(memberEvidence).normalized_result,
    );
    if (members.module === null)
      throw new Error("Expected fixture module identity");
    const conflictingMembers = createEvidence(
      undefined,
      MANAGED_STATIC_PROVIDER,
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: {
          ...members,
          module: {
            ...members.module,
            generation: members.module.generation + 1,
          },
        },
        rawResult: null,
        limitations: members.limitations,
      },
    );

    const projected = projectManagedApplicationGraphEvidence({
      managed_artifact: artifactEvidence,
      managed_members: conflictingMembers,
    });
    expect(projected.ok).toBe(false);
    if (projected.ok)
      throw new Error("conflicting module declaration was accepted");
    expect(JSON.stringify(projected.error)).toContain(
      "conflicting module generation values",
    );
  });
});

describe("managed application graph token scope", () => {
  it("checks declared token artifact and MVID scopes without a subject digest", () => {
    const { memberEvidence } = createManagedInteropEvidence();
    const members = managedMemberInspectionSchema.parse(
      parseEvidence(memberEvidence).normalized_result,
    );
    const wrongMvidValue = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const wrongMvidEvidence = createEvidence(
      undefined,
      MANAGED_STATIC_PROVIDER,
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: {
          ...members,
          identity_scope: {
            ...members.identity_scope,
            requires_mvid: wrongMvidValue,
          },
        },
        rawResult: null,
        limitations: members.limitations,
      },
    );
    const wrongArtifactEvidence = createEvidence(
      undefined,
      MANAGED_STATIC_PROVIDER,
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: {
          ...members,
          identity_scope: {
            ...members.identity_scope,
            requires_artifact_sha256: "b".repeat(64),
          },
        },
        rawResult: null,
        limitations: members.limitations,
      },
    );

    const wrongMvidResult = projectManagedApplicationGraphEvidence({
      managed_members: wrongMvidEvidence,
    });
    expect(wrongMvidResult.ok).toBe(false);
    if (wrongMvidResult.ok)
      throw new Error("mismatched token MVID was accepted");
    expect(JSON.stringify(wrongMvidResult.error)).toContain("token scope MVID");

    const wrongArtifact = projectManagedApplicationGraphEvidence({
      managed_members: wrongArtifactEvidence,
    });
    expect(wrongArtifact.ok).toBe(false);
    if (wrongArtifact.ok)
      throw new Error("mismatched token artifact digest was accepted");
    expect(JSON.stringify(wrongArtifact.error)).toContain(
      "token scope SHA-256",
    );
  });

  it.each([
    "module identity absent",
    "module MVID unknown",
    "token scope MVID unknown",
  ] as const)("rejects inconsistent identity when %s", (variant) => {
    const { memberEvidence, boundaryEvidence } = createManagedInteropEvidence();
    const members = managedMemberInspectionSchema.parse(
      parseEvidence(memberEvidence).normalized_result,
    );
    if (members.module === null || members.module.mvid === null)
      throw new Error("Expected fixture module identity and MVID");
    const module =
      variant === "module identity absent"
        ? null
        : variant === "module MVID unknown"
          ? { ...members.module, mvid: null }
          : members.module;
    const identity_scope =
      variant === "token scope MVID unknown"
        ? { ...members.identity_scope, requires_mvid: null }
        : members.identity_scope;
    const inconsistentMembers = createEvidence(
      undefined,
      MANAGED_STATIC_PROVIDER,
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: { ...members, module, identity_scope },
        rawResult: null,
        limitations: members.limitations,
      },
    );

    const projected = projectManagedApplicationGraphEvidence({
      managed_members: inconsistentMembers,
      managed_native_boundaries: boundaryEvidence,
    });

    expect(projected.ok).toBe(false);
    if (projected.ok)
      throw new Error("An inconsistent token scope was accepted");
    expect(JSON.stringify(projected.error)).toContain("token scope MVID");
  });
});

describe("unknown managed application graph token scope", () => {
  it("keeps absent MVID scope unknown and marks cross-source token joins partial", () => {
    const { memberEvidence, boundaryEvidence } = createManagedInteropEvidence();
    const members = managedMemberInspectionSchema.parse(
      parseEvidence(memberEvidence).normalized_result,
    );
    const boundaries = managedNativeBoundaryInspectionSchema.parse(
      parseEvidence(boundaryEvidence).normalized_result,
    );
    const unknownMembers = createEvidence(undefined, MANAGED_STATIC_PROVIDER, {
      operation: "inspect_managed_members",
      parameters: {},
      result: {
        ...members,
        module:
          members.module === null
            ? null
            : {
                ...members.module,
                mvid: null,
                enc_id: null,
                enc_base_id: null,
              },
        identity_scope: { ...members.identity_scope, requires_mvid: null },
      },
      rawResult: null,
      limitations: members.limitations,
    });

    const projected = projectManagedApplicationGraphEvidence({
      managed_members: unknownMembers,
      managed_native_boundaries: boundaryEvidence,
    });
    if (!projected.ok) throw projected.error;
    const result = managedApplicationGraphResultSchema.parse(
      parseEvidence(projected.value).normalized_result,
    );
    const graph = parseJavaScriptApplicationGraph(result.graph);
    expect(result.summary.modules).toBe(1);
    expect(result.coverage.status).toBe("partial");
    expect(result.limitations).toContain(
      "Managed boundary tokens were not linked to member nodes because matching module MVID scope was not established.",
    );
    const moduleObservation = graph.nodes.find(
      ({ kind }) => kind === "managed-module",
    )?.observations[0];
    expect(moduleObservation?.properties.mvid).toBe(boundaries.module?.mvid);
    expect(moduleObservation?.evidence.extractor.operation).toBe(
      "inspect_managed_native_boundaries",
    );
    const method = graph.nodes.find(
      ({ kind, observations }) =>
        kind === "managed-method" &&
        observations[0]?.label === "Fixture.Program.Main",
    );
    expect(method).toBeDefined();
    const importEdge = graph.edges.find(
      ({ relation, target_node_id }) =>
        relation === "imports" &&
        graph.nodes.find(({ node_id }) => node_id === target_node_id)?.kind ===
          "managed-pinvoke-import",
    );
    expect(importEdge).toBeDefined();
    expect(
      graph.nodes.find(({ node_id }) => node_id === importEdge?.source_node_id)
        ?.kind,
    ).toBe("artifact");
  });
});

describe("managed application graph coverage", () => {
  it("preserves partial parser coverage in graph and per-fact coverage", () => {
    const bytes = buildManagedPeFixture();
    const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedInterop.exe");
    const members = inspectManagedMembersBytes(bytes, binary);
    const parserPartialMembers = {
      ...members,
      coverage: {
        state: "partial" as const,
        issues: [
          {
            code: "invalid-blob" as const,
            scope: "metadata.#Blob",
            offset: 0x0a00,
            detail: "Blob content leaves #Blob",
          },
        ],
      },
    };
    const parserPartialEvidence = createEvidence(
      binary,
      MANAGED_STATIC_PROVIDER,
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: parserPartialMembers,
        rawResult: null,
        limitations: parserPartialMembers.limitations,
      },
    );
    const parserPartialProjection = projectManagedApplicationGraphEvidence({
      managed_members: parserPartialEvidence,
    });

    if (!parserPartialProjection.ok)
      throw new Error("partial projection failed");
    const parserPartialResult = managedApplicationGraphResultSchema.parse(
      parseEvidence(parserPartialProjection.value).normalized_result,
    );
    expect(parserPartialResult.coverage).toMatchObject({
      status: "partial",
    });
    expect(parserPartialResult.graph.coverage).toEqual({
      status: "partial",
      truncated: false,
      omitted_count: null,
      limits: [],
    });
  });
});

describe("managed application graph type selection", () => {
  const project = (
    result: Parameters<typeof createEvidence>[2]["result"],
    bytes = buildManagedPeFixture(),
  ) => {
    const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedInterop.exe");
    const projection = projectManagedApplicationGraphEvidence({
      managed_members: createEvidence(binary, MANAGED_STATIC_PROVIDER, {
        operation: "inspect_managed_members",
        parameters: {},
        result,
        rawResult: null,
        limitations: [],
      }),
    });
    if (!projection.ok) throw new Error("projection failed");
    return managedApplicationGraphResultSchema.parse(
      parseEvidence(projection.value).normalized_result,
    );
  };

  it("marks a graph from selected member inspection partial", () => {
    const bytes = buildManagedPeFixture();
    const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedInterop.exe");
    const selected = inspectManagedMembersBytes(bytes, binary, {
      typeNames: ["Fixture.Program"],
    });

    expect(selected.coverage.state).toBe("complete");
    const result = project(selected);
    expect(result.coverage).toMatchObject({ status: "partial" });
    expect(result.limitations).toContain(
      "Managed member Evidence selected only these declaring types: Fixture.Program; type, method, and field nodes of other types are omitted, not absent.",
    );
    expect(result.limitations).not.toContain(
      "At least one supplied managed Evidence record has partial coverage.",
    );
  });

  it("accepts member Evidence recorded before type selection existed", () => {
    // Only in-module relations, so nothing else makes the graph partial.
    const bytes = buildManagedPeFixture({
      ilBody: tinyIl([0x02, 0x7b, 0x01, 0, 0, 0x04, 0x26, 0x2a]),
    });
    const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedInterop.exe");
    const { selection: _selection, ...legacy } = inspectManagedMembersBytes(
      bytes,
      binary,
    );

    expect(managedMemberInspectionSchema.parse(legacy).selection).toBeNull();
    expect(project(legacy, bytes).coverage).toMatchObject({
      status: "complete-within-inputs",
    });
  });
});

describe("managed call and field-access relations", () => {
  // Both fixture methods share this body: 0x06000001 and 0x06000002.
  const relationsFixture = () =>
    buildManagedPeFixture({
      methodRowCount: 2,
      ilBody: tinyIl([
        ...[0x28, 0x02, 0, 0, 0x06], // call 0x06000002
        ...[0x6f, 0x02, 0, 0, 0x06], // callvirt 0x06000002
        ...[0x28, 0x01, 0, 0, 0x06], // call 0x06000001
        ...[0xfe, 0x06, 0x02, 0, 0, 0x06], // ldftn 0x06000002
        ...[0x28, 0x01, 0, 0, 0x0a], // call MemberRef 0x0a000001
        0x02,
        ...[0x7b, 0x01, 0, 0, 0x04], // ldfld 0x04000001
        0x02,
        0x02,
        ...[0x7d, 0x01, 0, 0, 0x04], // stfld 0x04000001
        0x02,
        ...[0x7c, 0x01, 0, 0, 0x04], // ldflda 0x04000001
        0x26,
        0x2a,
      ]),
    });

  it("links in-module calls and field accesses once per source and target", () => {
    const { members, memberEvidence, result, graph } =
      memberGraph(relationsFixture());
    expect(members.call_edges).toHaveLength(10);
    expect(members.field_accesses).toHaveLength(6);
    const memberTokens = new Map(
      graph.nodes.map((node) => [
        node.node_id,
        node.observations[0]?.properties.token,
      ]),
    );
    const relation = (name: string) =>
      graph.edges
        .filter((edge) => edge.relation === name)
        .map((edge) => ({
          source: memberTokens.get(edge.source_node_id),
          target: memberTokens.get(edge.target_node_id),
          properties: edge.properties,
          evidence_ids: edge.evidence.evidence_ids,
        }));
    // These distinct metadata methods intentionally have the same display name.
    expect(
      members.methods.map(
        ({ declaring_type, name }) => `${declaring_type}.${name}`,
      ),
    ).toEqual(["Fixture.Program.Main", "Fixture.Program.Main"]);
    const [first, second] = members.methods.map(({ token }) => token);
    expect(first).not.toBe(second);
    const field = members.fields[0]?.token;
    const evidence_ids = [memberEvidence.evidence_id];

    const calls = relation("calls");
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          source: first,
          target: second,
          properties: {
            kind: "managed-call",
            site_count: 2,
            opcodes: { call: 1, callvirt: 1 },
          },
          evidence_ids,
        },
        {
          source: second,
          target: first,
          properties: {
            kind: "managed-call",
            site_count: 1,
            opcodes: { call: 1 },
          },
          evidence_ids,
        },
      ]),
    );
    const accesses = relation("accesses");
    expect(accesses).toHaveLength(2);
    for (const source of [first, second])
      expect(accesses).toContainEqual({
        source,
        target: field,
        properties: {
          kind: "managed-field-access",
          access: ["address", "read", "write"],
          site_count: 3,
          opcodes: { ldfld: 1, ldflda: 1, stfld: 1 },
        },
        evidence_ids,
      });
    expect(result.summary).toMatchObject({ calls: 2, field_accesses: 2 });
    // Two MemberRef calls, two ldftn loads and three self-calls stay counted.
    expect(result.coverage).toEqual({ status: "partial" });
    expect(result.graph.coverage).toEqual({
      status: "partial",
      truncated: false,
      omitted_count: 7,
      limits: [],
    });
    expect(result.limitations).toContain(
      "Calls edges link only method nodes in the inspected module; these call sites are omitted: 2 member-reference, 2 function-pointer (ldftn/ldvirtftn), 3 recursive self-call.",
    );
  });

  it("reads graph Evidence projected before relation counters existed", () => {
    const { result } = memberGraph(relationsFixture());
    const {
      calls: _calls,
      field_accesses: _fieldAccesses,
      ...summary
    } = result.summary;

    expect(
      managedApplicationGraphResultSchema.parse({ ...result, summary }).summary,
    ).toMatchObject({ calls: null, field_accesses: null });
  });

  it("counts relations whose endpoints a type selection omitted", () => {
    const bytes = relationsFixture();
    const binary = managedPeFixtureTarget(bytes, "/fixture/ManagedCalls.exe");
    const members = inspectManagedMembersBytes(bytes, binary);
    const projection = projectManagedApplicationGraphEvidence({
      managed_members: createEvidence(binary, MANAGED_STATIC_PROVIDER, {
        operation: "inspect_managed_members",
        parameters: {},
        // Drop the second method, as a narrower selection would.
        result: { ...members, methods: members.methods.slice(0, 1) },
        rawResult: null,
        limitations: [],
      }),
    });
    if (!projection.ok) throw new Error(JSON.stringify(projection.error));
    const result = managedApplicationGraphResultSchema.parse(
      parseEvidence(projection.value).normalized_result,
    );

    expect(result.summary).toMatchObject({ calls: 0, field_accesses: 1 });
    expect(
      result.limitations.find((text) => text.startsWith("Calls edges")),
    ).toContain("missing-node");
    expect(
      result.limitations.find((text) => text.startsWith("Accesses edges")),
    ).toContain("3 missing-node");
  });
});
