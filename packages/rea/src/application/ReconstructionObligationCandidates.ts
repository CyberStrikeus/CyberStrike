import { uniqueSorted, uniqueSortedBy } from "../domain/canonicalOrdering.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";

import type { Evidence } from "../domain/evidence.js";
import { describeValidationFailure } from "../domain/validationFailure.js";
import type {
  ReconstructionObligation,
  ReviewedReconstructionObligation,
} from "../domain/reconstructionObligationLedgerSchemas.js";
import { parseApplicationGraphEvidence } from "./javascript/JavaScriptApplicationEvidenceGraph.js";
import { parseProcessCaptureEvidence } from "./process/ProcessEvidence.js";
import { evidenceSupportsOriginalAuthority } from "./ReconstructionObligationAuthority.js";
import {
  applicationObligationPolicy,
  semanticObligationPolicy,
  type ReconstructionObligationCandidatePolicy,
} from "./ReconstructionObligationPolicies.js";
import type { ResolvedReconstructionObligationRequest } from "./ReconstructionObligationLedgerRequest.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

type CandidateFields = Omit<
  ReconstructionObligation,
  "binding" | "status" | "diagnostics"
>;

/** Internal generated or reviewed obligation before manifest closure evaluation. */
export interface ReconstructionObligationCandidate extends CandidateFields {
  readonly definitionCount: number;
  readonly disposition: "active" | "blocked" | "out-of-scope";
}

export interface ReconstructionObligationCandidateSet {
  readonly candidates: readonly ReconstructionObligationCandidate[];
  readonly limitations: readonly string[];
}

/** Derive conservative candidates from graph, process, and reviewed inputs. */
export const deriveReconstructionObligationCandidates = (
  request: Pick<
    ResolvedReconstructionObligationRequest,
    "sources" | "reviewedObligations"
  >,
): ReconstructionObligationCandidateSet => {
  const { bundle, records } = request.sources;
  const candidates = new Map<string, ReconstructionObligationCandidate>();
  const limitations = new Set<string>();
  for (const evidence of bundle.records) {
    deriveApplicationCandidates(evidence, records, candidates, limitations);
    deriveProcessCandidate(evidence, candidates, limitations);
  }
  for (const obligation of request.reviewedObligations)
    addCandidate(candidates, reviewedCandidate(obligation, records));
  return {
    candidates: [...candidates.values()].sort((left, right) =>
      compareUnicodeCodePoints(left.obligation_id, right.obligation_id),
    ),
    limitations: [...limitations].sort(),
  };
};

const deriveApplicationCandidates = (
  evidence: Evidence,
  records: ReadonlyMap<string, Evidence>,
  candidates: Map<string, ReconstructionObligationCandidate>,
  limitations: Set<string>,
): void => {
  if (
    ![
      "analyze_javascript_application",
      "reconcile_javascript_runtime",
      "project_managed_application_graph",
    ].includes(evidence.operation)
  )
    return;
  const parsed = parseApplicationGraphEvidence(evidence);
  if (!parsed.ok) {
    limitations.add(
      `Application Evidence ${evidence.evidence_id} could not generate candidates because it failed graph validation.`,
    );
    return;
  }
  const source = parsed.value;
  for (const node of source.graph.nodes) {
    const candidatePolicy = applicationObligationPolicy(node.kind);
    if (candidatePolicy === undefined) {
      if (node.kind === "unknown")
        limitations.add(
          `Application graph ${source.graph.graph_id} contains unresolved node ${node.node_id}; reconstruction obligations remain unknown.`,
        );
      continue;
    }
    const reference = node.observations.map((observation) =>
      graphReference(
        evidence,
        records,
        observation.evidence,
        `${source.graph.graph_id}/node/${node.node_id}/observation/${observation.observation_id}`,
      ),
    );
    addCandidate(
      candidates,
      generatedCandidate({
        key: `application:${node.node_id}:${candidatePolicy.family}`,
        title: node.observations[0]?.label?.trim() || `${node.kind} boundary`,
        policy: candidatePolicy,
        artifactSha256: source.rootArtifactSha256,
        applicationNodeId: node.node_id,
        semanticNodeId: null,
        location: `application-graph:${source.graph.graph_id}/nodes/${node.node_id}`,
        authorityReferences: reference,
      }),
    );
  }
  if (source.semanticGraph !== null) {
    const semanticGraph = source.semanticGraph;
    const unknownIdsByNode = new Map<string, string[]>();
    for (const unknown of semanticGraph.unknowns) {
      // Candidate targets are possibilities, not established node bindings.
      if (unknown.node_id !== null) {
        const ids = unknownIdsByNode.get(unknown.node_id) ?? [];
        ids.push(unknown.unknown_id);
        unknownIdsByNode.set(unknown.node_id, ids);
      }
      // Keep every frontier visible, including families without a policy.
      limitations.add(
        `Semantic graph ${semanticGraph.graph_id} contains unresolved ${unknown.family} unknown ${unknown.unknown_id}: ${unknown.detail}`,
      );
    }
    if (semanticGraph.coverage.status !== "complete")
      limitations.add(
        `Semantic graph ${semanticGraph.graph_id} coverage is ${semanticGraph.coverage.status}; omitted candidates remain unknown.`,
      );
    for (const limitation of semanticGraph.limitations)
      limitations.add(
        `Semantic graph ${semanticGraph.graph_id}: ${limitation}`,
      );
    const evidenceContexts = new Map(
      semanticGraph.evidence_contexts.map((context) => [
        context.context_id,
        context,
      ]),
    );
    for (const node of semanticGraph.nodes) {
      const candidatePolicy = semanticObligationPolicy(node.kind);
      if (candidatePolicy === undefined) continue;
      const evidenceContext = evidenceContexts.get(node.evidence.context_id);
      if (evidenceContext === undefined)
        throw new TypeError(
          "Semantic evidence reference names an absent context",
        );
      addCandidate(
        candidates,
        generatedCandidate({
          key: `semantic:${node.node_id}:${candidatePolicy.family}`,
          title: node.label?.trim() || `${node.kind} semantic boundary`,
          policy: candidatePolicy,
          artifactSha256: node.identity.artifact_sha256,
          applicationNodeId: node.application_node_ids[0] ?? null,
          semanticNodeId: node.node_id,
          residualUnknownIds: unknownIdsByNode.get(node.node_id) ?? [],
          location: `semantic-graph:${semanticGraph.graph_id}/nodes/${node.node_id}`,
          authorityReferences: [
            graphReference(
              evidence,
              records,
              evidenceContext,
              `${semanticGraph.graph_id}/node/${node.node_id}`,
            ),
          ],
        }),
      );
    }
  }
  if (source.graph.coverage.status !== "complete")
    limitations.add(
      `Application graph ${source.graph.graph_id} coverage is ${source.graph.coverage.status}; omitted candidates remain unknown.`,
    );
};

const deriveProcessCandidate = (
  input: Evidence,
  candidates: Map<string, ReconstructionObligationCandidate>,
  limitations: Set<string>,
): void => {
  const parsed = parseProcessCaptureEvidence(input);
  if (!parsed.ok) {
    switch (parsed.error.kind) {
      case "wrong-workflow":
        break;
      case "unsupported-provider":
        limitations.add(
          `Process Evidence ${input.evidence_id} has an unsupported provider; process lifecycle candidates remain unknown.`,
        );
        break;
      case "invalid-evidence":
      case "invalid-capture":
        limitations.add(
          `Process Evidence ${input.evidence_id} could not generate candidates: ${describeValidationFailure(parsed.error.cause)}`,
        );
    }
    return;
  }
  const { record: evidence, capture } = parsed.value;
  const observedCases: ReconstructionObligation["observed_cases"] = [
    {
      kind: capture.exit.code === 0 ? "positive" : "negative",
      evidence_id: evidence.evidence_id,
      location: "/normalized_result/exit",
    },
    {
      kind: "teardown",
      evidence_id: evidence.evidence_id,
      location: "/normalized_result/settlement",
    },
    ...(capture.exit.signal !== null || capture.exit.reason !== "exited"
      ? [
          {
            kind: "cancellation" as const,
            evidence_id: evidence.evidence_id,
            location: "/normalized_result/exit",
          },
        ]
      : []),
  ];
  if (capture.manifest.executable_sha256 === null) {
    limitations.add(
      `Process capture ${evidence.evidence_id} has no validated executable artifact identity; packaged-process lifecycle obligation was not bound to an artifact.`,
    );
    return;
  }
  addCandidate(candidates, {
    obligation_id: obligationId(
      `process:${capture.manifest.executable_sha256}:${capture.manifest.full_scenario_sha256}`,
    ),
    obligation_version: 1,
    title: "Captured packaged-process lifecycle",
    origin: "generated",
    application_layer: "process",
    family: "packaged-process-lifecycle",
    target: {
      artifact_sha256: capture.manifest.executable_sha256,
      application_node_id: null,
      semantic_node_id: null,
      location: `/evidence/${evidence.evidence_id}/normalized_result`,
    },
    authority_references: [
      {
        evidence_id: evidence.evidence_id,
        authority: evidence.authority,
        state: "observed",
        location: "/normalized_result",
      },
    ],
    source_state: "observed",
    observed_cases: observedCases,
    required: true,
    required_case_kinds: ["positive", "negative", "cancellation", "teardown"],
    required_original_authority: "process",
    required_fixture_authority: "packaged-process",
    required_verifier_authority: "packaged-process",
    requires_parser_type: false,
    dependency_obligation_ids: [],
    residual_unknown_ids: [],
    unavailable_authority: capture.residual_unknowns.map(
      ({ scope, reason }) => `${scope}: ${reason}`,
    ),
    required_next_evidence: capture.truncated
      ? ["Repeat the packaged-process capture without truncation."]
      : [],
    definitionCount: 1,
    disposition: "active",
  });
  if (capture.truncated)
    limitations.add(
      `Process Evidence ${evidence.evidence_id} is truncated; absence and upper bounds remain unknown.`,
    );
};

interface GeneratedCandidateInput {
  readonly key: string;
  readonly title: string;
  readonly policy: ReconstructionObligationCandidatePolicy;
  readonly artifactSha256: string;
  readonly applicationNodeId: string | null;
  readonly semanticNodeId: string | null;
  readonly location: string;
  readonly residualUnknownIds?: ReconstructionObligation["residual_unknown_ids"];
  readonly authorityReferences: ReconstructionObligation["authority_references"];
}

const generatedCandidate = ({
  key,
  title,
  policy: candidatePolicy,
  artifactSha256,
  applicationNodeId,
  semanticNodeId,
  location,
  authorityReferences,
  residualUnknownIds = [],
}: GeneratedCandidateInput): ReconstructionObligationCandidate => ({
  obligation_id: obligationId(key),
  obligation_version: 1,
  title,
  origin: "generated",
  application_layer: candidatePolicy.applicationLayer,
  family: candidatePolicy.family,
  target: {
    artifact_sha256: artifactSha256,
    application_node_id: applicationNodeId,
    semantic_node_id: semanticNodeId,
    location,
  },
  authority_references: authorityReferences,
  source_state: sourceState(authorityReferences),
  observed_cases: [],
  required: true,
  required_case_kinds: candidatePolicy.cases,
  required_original_authority: candidatePolicy.originalAuthority,
  required_fixture_authority: candidatePolicy.fixtureAuthority,
  required_verifier_authority: candidatePolicy.verifierAuthority,
  requires_parser_type: candidatePolicy.requiresParserType,
  dependency_obligation_ids: [],
  residual_unknown_ids: residualUnknownIds,
  unavailable_authority: [],
  required_next_evidence: [
    `Obtain ${candidatePolicy.originalAuthority} authority for this finite ${candidatePolicy.family} claim.`,
  ],
  definitionCount: 1,
  disposition: "active",
});

const reviewedCandidate = (
  obligation: ReviewedReconstructionObligation,
  records: ReadonlyMap<string, Evidence>,
): ReconstructionObligationCandidate => {
  const {
    review_evidence_ids: reviewEvidenceIds,
    disposition,
    ...definition
  } = obligation;
  return {
    ...definition,
    origin: "reviewed",
    authority_references: reviewEvidenceIds.map((evidenceId) => {
      const evidence = records.get(evidenceId);
      if (evidence === undefined)
        throw new Error(
          `Resolved reviewed obligation references absent Evidence: ${evidenceId}`,
        );
      return {
        evidence_id: evidenceId,
        authority: evidence.authority,
        state: reviewedEvidenceState(evidence),
        location: `/evidence/${evidenceId}`,
      };
    }),
    source_state: "reviewed",
    observed_cases: [],
    definitionCount: 1,
    disposition,
  };
};

const graphReference = (
  envelope: Evidence,
  records: ReadonlyMap<string, Evidence>,
  graphEvidence: {
    readonly authority: string;
    readonly state: string;
    readonly evidence_ids: readonly string[];
  },
  location: string,
): ReconstructionObligation["authority_references"][number] => {
  const linkedId =
    graphEvidence.evidence_ids.find((evidenceId) => records.has(evidenceId)) ??
    envelope.evidence_id;
  const linked = records.get(linkedId) ?? envelope;
  const runtimeAuthority = [
    "passive-cdp-runtime",
    "controlled-replay",
  ].includes(graphEvidence.authority);
  return {
    evidence_id: linked.evidence_id,
    authority: linked.authority,
    state:
      runtimeAuthority && graphEvidence.state === "observed"
        ? "observed"
        : graphEvidence.state === "unknown" ||
            graphEvidence.state === "unavailable"
          ? "unknown"
          : "candidate",
    location,
  };
};

const reviewedEvidenceState = (
  evidence: Evidence,
): ReconstructionObligation["authority_references"][number]["state"] => {
  if (evidenceSupportsOriginalAuthority(evidence, "process")) return "observed";
  if (
    evidence.authority === "external-service" &&
    evidence.confidence === "observed"
  )
    return "observed";
  if (evidence.authority === "shipped-artifact") return "candidate";
  return "reviewed";
};

const addCandidate = (
  candidates: Map<string, ReconstructionObligationCandidate>,
  candidate: ReconstructionObligationCandidate,
): void => {
  const current = candidates.get(candidate.obligation_id);
  if (current === undefined) {
    candidates.set(candidate.obligation_id, candidate);
    return;
  }
  candidates.set(candidate.obligation_id, {
    ...current,
    authority_references: uniqueSortedBy(
      [...current.authority_references, ...candidate.authority_references],
      (reference) =>
        `${reference.evidence_id}:${reference.state}:${reference.location}`,
    ),
    observed_cases: uniqueSortedBy(
      [...current.observed_cases, ...candidate.observed_cases],
      (item) => `${item.kind}:${item.evidence_id}:${item.location}`,
    ),
    source_state: sourceState([
      ...current.authority_references,
      ...candidate.authority_references,
    ]),
    residual_unknown_ids: uniqueSorted([
      ...current.residual_unknown_ids,
      ...candidate.residual_unknown_ids,
    ]),
    // Each observation keeps its own unresolved authority and next steps.
    unavailable_authority: uniqueSorted([
      ...current.unavailable_authority,
      ...candidate.unavailable_authority,
    ]),
    required_next_evidence: uniqueSorted([
      ...current.required_next_evidence,
      ...candidate.required_next_evidence,
    ]),
    // A generated ID digests its derivation key, so two generated candidates
    // with one ID are the same claim seen by several records. Only another
    // reviewed definition can introduce a competing definition.
    definitionCount:
      current.origin === "generated" && candidate.origin === "generated"
        ? current.definitionCount
        : current.definitionCount + candidate.definitionCount,
  });
};

const sourceState = (
  references: ReconstructionObligation["authority_references"],
): ReconstructionObligation["source_state"] => {
  if (references.some(({ state }) => state === "observed")) return "observed";
  if (references.some(({ state }) => state === "candidate")) return "candidate";
  if (references.some(({ state }) => state === "reviewed")) return "reviewed";
  return "unknown";
};

const obligationId = (key: string): string =>
  `obl_${digestCanonicalValue({ schema: "ReconstructionObligation", key }, "Reconstruction obligation key")}`;
