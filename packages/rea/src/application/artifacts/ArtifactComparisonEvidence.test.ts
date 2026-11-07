import { expect, it } from "vitest";

import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../../contracts/artifactComparisonExample.js";
import {
  artifactInventorySummaryViewResultSchema,
  sealAnalysisView,
} from "../../domain/analysisView/analysisView.js";
import {
  createEvidence,
  parseEvidence,
  rebindEvidenceToTargetPath,
  type Evidence,
} from "../../domain/evidence.js";
import {
  EvidenceIntegrityError,
  EvidenceReferenceError,
} from "../../domain/evidenceErrors.js";
import { resolveArtifactComparisonEvidence } from "./ArtifactComparisonEvidence.js";
import { artifactInventoryResultSchema } from "../../domain/artifactGraph.js";
import {
  artifactGraphDigest,
  artifactManifestId,
} from "../../domain/artifactIdentity.js";

const artifactSummary = async () => {
  const parent = ARTIFACT_COMPARISON_EXAMPLE.left;
  const summary = await inspectAnalysisView(
    {
      source: { kind: "inline", evidence: parent },
      view: { kind: "summary" },
    },
    (evidenceId) => (evidenceId === parent.evidence_id ? parent : undefined),
  );
  if (!summary.ok) throw summary.error;
  return { parent, summary: summary.value };
};

const recreateSummary = (
  summary: Evidence,
  normalizedResult: Evidence["normalized_result"],
  parameters: Evidence["parameters"] = summary.parameters,
): Evidence => {
  if (summary.subject === null)
    throw new Error("artifact summary fixture must identify its subject");
  return createEvidence(
    {
      path: summary.subject.local_path,
      sha256: summary.subject.digest.sha256,
      format: summary.subject.format,
      ...(summary.subject.architecture === null
        ? {}
        : { architecture: summary.subject.architecture }),
    },
    summary.provider,
    {
      predicateType: summary.predicate_type,
      operation: summary.operation,
      parameters,
      result: normalizedResult,
      ...(summary.analysis_profile === null
        ? {}
        : { analysisProfile: summary.analysis_profile }),
      rawResult: summary.raw_result,
      confidence: summary.confidence,
      authority: summary.authority,
      environment: summary.environment,
      limitations: summary.limitations,
      ...(summary.relationship_coverage === null
        ? {}
        : { relationshipCoverage: summary.relationship_coverage }),
      locations: summary.locations,
      evidenceLinks: summary.evidence_links,
    },
  );
};

it("reports a missing retained parent instead of treating summary facts as inventory", async () => {
  const { summary } = await artifactSummary();
  const resolved = resolveArtifactComparisonEvidence(summary, undefined);
  expect(resolved.ok).toBe(false);
  if (!resolved.ok) {
    expect(resolved.error).toBeInstanceOf(EvidenceReferenceError);
    expect(resolved.error).toMatchObject({ reason: "missing" });
  }
});

it("uses retained Evidence resolution to reject a mismatched parent identity", async () => {
  const { summary } = await artifactSummary();
  const otherParent = ARTIFACT_COMPARISON_EXAMPLE.right;
  const resolved = resolveArtifactComparisonEvidence(
    summary,
    () => otherParent,
  );
  expect(resolved.ok).toBe(false);
  if (!resolved.ok) {
    expect(resolved.error).toBeInstanceOf(EvidenceReferenceError);
    expect(resolved.error).toMatchObject({ reason: "identity_mismatch" });
  }
});

it("rejects a summary that declares the wrong parent operation", async () => {
  const { parent, summary } = await artifactSummary();
  const summaryResult = artifactInventorySummaryViewResultSchema.parse(
    summary.normalized_result,
  );
  const normalizedResult = {
    ...summaryResult,
    parent_operation: "inspect_artifact",
  };
  const forged = recreateSummary(summary, normalizedResult);
  const resolved = resolveArtifactComparisonEvidence(forged, (evidenceId) =>
    evidenceId === parent.evidence_id ? parent : undefined,
  );
  expect(resolved.ok).toBe(false);
  if (!resolved.ok)
    expect(resolved.error).toBeInstanceOf(EvidenceIntegrityError);
});

it("rejects summary parameters that do not identify the projected parent", async () => {
  const { parent, summary } = await artifactSummary();
  const forged = recreateSummary(summary, summary.normalized_result, {
    ...summary.parameters,
    parent_evidence_id: `ev_${"f".repeat(64)}`,
  });
  const resolved = resolveArtifactComparisonEvidence(forged, (evidenceId) =>
    evidenceId === parent.evidence_id ? parent : undefined,
  );
  expect(resolved.ok).toBe(false);
  if (!resolved.ok)
    expect(resolved.error).toBeInstanceOf(EvidenceIntegrityError);
});

it("rejects summary facts that do not reproject from the complete parent", async () => {
  const { parent, summary } = await artifactSummary();
  const summaryResult = artifactInventorySummaryViewResultSchema.parse(
    summary.normalized_result,
  );
  const normalizedResult = {
    ...summaryResult,
    summary: {
      ...summaryResult.summary,
      available_counts: {
        ...summaryResult.summary.available_counts,
        nodes: summaryResult.summary.available_counts.nodes + 1,
      },
    },
  };
  const forged = recreateSummary(summary, normalizedResult);
  const resolved = resolveArtifactComparisonEvidence(forged, (evidenceId) =>
    evidenceId === parent.evidence_id ? parent : undefined,
  );
  expect(resolved.ok).toBe(false);
  if (!resolved.ok)
    expect(resolved.error).toBeInstanceOf(EvidenceIntegrityError);
});

it("accepts display-only subject changes excluded from Evidence identity", async () => {
  const { parent, summary } = await artifactSummary();
  if (summary.subject === null)
    throw new Error("artifact summary fixture must identify its subject");
  const displayOnly = parseEvidence({
    ...summary,
    subject: {
      ...summary.subject,
      name: "renamed.app",
      local_path: "/display-only/renamed.app",
    },
  });
  const resolved = resolveArtifactComparisonEvidence(
    displayOnly,
    (evidenceId) => (evidenceId === parent.evidence_id ? parent : undefined),
  );
  expect(resolved).toEqual({ ok: true, value: parent });
});

const traversalUnknown =
  "Producer traversal coverage is unknown; missing matches do not prove source absence.";
const hashesUnknown =
  "Content hashes are unknown for some recorded files; missing node IDs do not prove content absence.";

type SummaryEra = "pre-ce1f4b1bb" | "pre-b395190e4" | "current";

/** Recommit an inventory whose two independent unknowns exercise both migrations. */
const unknownInventory = () => {
  const original = ARTIFACT_COMPARISON_EXAMPLE.left;
  const inventory = artifactInventoryResultSchema.parse(
    original.normalized_result,
  );
  inventory.coverage.status = "unknown";
  inventory.occurrences[0]!.hash_status = "unavailable";
  const graphSha256 = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences: inventory.occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrity_contradictions,
  });
  inventory.manifest.graph_sha256 = graphSha256;
  inventory.manifest.manifest_id = artifactManifestId(
    inventory.manifest.root_artifact_id,
    graphSha256,
  );
  return createEvidence(
    {
      path: "historical-inventory",
      sha256: inventory.manifest.root_sha256,
      format: "file",
    },
    original.provider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
};

/**
 * Exact non-PCK/non-PyInstaller summary deltas checked against the projectors at
 * ce1f4b1bb^ and b395190e4^. The first omitted coverage and both caveats; the
 * second included coverage/traversal, but still omitted the hash caveat.
 */
const resealSummary = (
  result: ReturnType<typeof artifactInventorySummaryViewResultSchema.parse>,
) => {
  const { view_digest: _digest, ...unsigned } = result;
  return artifactInventorySummaryViewResultSchema.parse(
    sealAnalysisView(unsigned),
  );
};

const summaryAtEra = async (era: SummaryEra, aliasPath?: string) => {
  const parent = unknownInventory();
  const selectedParent =
    aliasPath === undefined
      ? parent
      : rebindEvidenceToTargetPath(parent, {
          path: aliasPath,
          sha256: parent.subject!.digest.sha256,
          format: parent.subject!.format,
        });
  const projected = await inspectAnalysisView({
    source: { kind: "inline", evidence: selectedParent },
    view: { kind: "summary" },
  });
  if (!projected.ok) throw projected.error;
  const current = artifactInventorySummaryViewResultSchema.parse(
    projected.value.normalized_result,
  );
  expect(current.summary.source_coverage).toEqual({
    scope: "root",
    status: "unknown",
  });
  expect(current.unknowns).toContain(traversalUnknown);
  expect(current.unknowns).toContain(hashesUnknown);
  const { source_coverage: _coverage, ...withoutCoverage } = current.summary;
  const result = {
    ...current,
    summary: era === "pre-ce1f4b1bb" ? withoutCoverage : current.summary,
    unknowns: current.unknowns.filter(
      (unknown) =>
        era === "current" ||
        (unknown !== hashesUnknown &&
          (era !== "pre-ce1f4b1bb" || unknown !== traversalUnknown)),
    ),
  };
  return {
    parent,
    summary: recreateSummary(projected.value, resealSummary(result)),
  };
};

it.each<SummaryEra>(["pre-ce1f4b1bb", "pre-b395190e4", "current"])(
  "authenticates the exact %s summary against its retained inventory",
  async (era) => {
    const { parent, summary } = await summaryAtEra(era);
    expect(resolveArtifactComparisonEvidence(summary, () => parent)).toEqual({
      ok: true,
      value: parent,
    });
  },
);

it.each<SummaryEra>(["pre-ce1f4b1bb", "pre-b395190e4", "current"])(
  "authenticates a %s summary projected from the caller alias against the original retained parent",
  async (era) => {
    const { parent, summary } = await summaryAtEra(era, "/selected/alias.bin");
    const result = artifactInventorySummaryViewResultSchema.parse(
      summary.normalized_result,
    );
    expect(result.artifact?.path).toBe("/selected/alias.bin");
    expect(parent.subject?.local_path).toBe("historical-inventory");
    expect(resolveArtifactComparisonEvidence(summary, () => parent)).toEqual({
      ok: true,
      value: parent,
    });
  },
);

it.each<SummaryEra>(["pre-ce1f4b1bb", "pre-b395190e4", "current"])(
  "authenticates a %s summary after its retained parent is rebound to an alias path",
  async (era) => {
    const { parent, summary } = await summaryAtEra(era);
    const rebound = rebindEvidenceToTargetPath(parent, {
      path: "/selected/alias.bin",
      sha256: parent.subject!.digest.sha256,
      format: parent.subject!.format,
    });
    expect(rebound.evidence_id).toBe(parent.evidence_id);
    expect(resolveArtifactComparisonEvidence(summary, () => rebound)).toEqual({
      ok: true,
      value: rebound,
    });
  },
);

it.each([
  "coverage-only",
  "traversal-only",
  "hash-only-without-traversal",
  "all-unknowns",
  "wrong-count",
  "wrong-parent-digest",
  "wrong-parameters",
] as const)(
  "rejects an unsupported historical summary: %s",
  async (variant) => {
    const { parent, summary } = await summaryAtEra("current");
    const result = artifactInventorySummaryViewResultSchema.parse(
      summary.normalized_result,
    );
    let parameters = summary.parameters;
    switch (variant) {
      case "coverage-only":
        delete result.summary.source_coverage;
        break;
      case "traversal-only":
        result.unknowns = result.unknowns.filter(
          (unknown) => unknown !== traversalUnknown,
        );
        break;
      case "hash-only-without-traversal":
        delete result.summary.source_coverage;
        result.unknowns = result.unknowns.filter(
          (unknown) => unknown !== traversalUnknown,
        );
        break;
      case "all-unknowns":
        result.unknowns = [];
        break;
      case "wrong-count":
        result.summary.available_counts.occurrences += 1;
        break;
      case "wrong-parent-digest":
        result.parent_digest = "f".repeat(64);
        break;
      case "wrong-parameters":
        parameters = {
          ...parameters,
          parent_evidence_id: `ev_${"f".repeat(64)}`,
        };
        break;
    }
    const forged = recreateSummary(summary, resealSummary(result), parameters);
    const resolved = resolveArtifactComparisonEvidence(forged, () => parent);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok)
      expect(resolved.error).toBeInstanceOf(EvidenceIntegrityError);
  },
);

it.each<SummaryEra>(["pre-ce1f4b1bb", "pre-b395190e4"])(
  "rejects a %s summary when lookup returns another inventory",
  async (era) => {
    const { summary } = await summaryAtEra(era);
    const resolved = resolveArtifactComparisonEvidence(
      summary,
      () => ARTIFACT_COMPARISON_EXAMPLE.right,
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok)
      expect(resolved.error).toMatchObject({ reason: "identity_mismatch" });
  },
);

it.each(["provider", "authority", "locations", "links"] as const)(
  "rejects a validly recommitted historical summary with altered %s",
  async (field) => {
    const { parent, summary } = await summaryAtEra("pre-ce1f4b1bb");
    const altered: Evidence = {
      ...summary,
      ...(field === "provider"
        ? { provider: { ...summary.provider, version: "altered" } }
        : field === "authority"
          ? { authority: "analyst-inference" as const }
          : field === "locations"
            ? {
                locations: [
                  { kind: "artifact-path" as const, path: "different.bin" },
                ],
              }
            : {
                evidence_links: [ARTIFACT_COMPARISON_EXAMPLE.right.evidence_id],
              }),
    };
    const forged = recreateSummary(altered, summary.normalized_result);
    expect(parseEvidence(forged).evidence_id).toBe(forged.evidence_id);
    expect(forged.evidence_id).not.toBe(summary.evidence_id);
    const resolved = resolveArtifactComparisonEvidence(forged, () => parent);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok)
      expect(resolved.error).toBeInstanceOf(EvidenceIntegrityError);
  },
);

it("authenticates a retained parent's content instead of trusting its original ID", async () => {
  const { parent, summary } = await summaryAtEra("pre-b395190e4");
  const tampered: Evidence = {
    ...parent,
    limitations: ["changed without recomputing the Evidence ID"],
  };
  expect(tampered.evidence_id).toBe(parent.evidence_id);
  const resolved = resolveArtifactComparisonEvidence(summary, () => tampered);
  expect(resolved.ok).toBe(false);
  if (!resolved.ok)
    expect(resolved.error).toBeInstanceOf(EvidenceIntegrityError);
});

it.each<SummaryEra>(["pre-ce1f4b1bb", "pre-b395190e4", "current"])(
  "preserves both immutable Evidence commitments when resolving %s",
  async (era) => {
    const { parent, summary } = await summaryAtEra(era, "/selected/alias.bin");
    const before = {
      parentId: parent.evidence_id,
      summaryId: summary.evidence_id,
      parentResult: JSON.stringify(parent.normalized_result),
      summaryResult: JSON.stringify(summary.normalized_result),
    };
    const resolved = resolveArtifactComparisonEvidence(summary, () => parent);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value.evidence_id).toBe(before.parentId);
    expect(parent.evidence_id).toBe(before.parentId);
    expect(summary.evidence_id).toBe(before.summaryId);
    expect(JSON.stringify(parent.normalized_result)).toBe(before.parentResult);
    expect(JSON.stringify(summary.normalized_result)).toBe(
      before.summaryResult,
    );
    expect(parseEvidence(parent).evidence_id).toBe(before.parentId);
    expect(parseEvidence(summary).evidence_id).toBe(before.summaryId);
  },
);
