import {
  ArtifactInventoryCarrierError,
  parseArtifactInventoryEvidence,
} from "./artifactInventoryEvidence.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import { comparisonSourceEvidenceSides } from "./comparisonSourceEvidence.js";
import { readComparisonResult } from "./comparisonEvidenceResult.js";
import type { Evidence } from "./evidence.js";
import { hasComparisonEvidenceIdentity } from "./comparisonEvidenceIdentity.js";
import { readEvidenceBundle } from "./evidenceBundle.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { analysisInputErrorFromIssues } from "./inputIssueProjection.js";
import { readEvidencePayload } from "./evidenceValidation.js";
import { functionDossierSchema } from "./native/functionDossier.js";
import { assessFunctionCallCoverage } from "./functionCallCoverage.js";
import { processCaptureSchema } from "./process/processCapture.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import {
  reconstructionClaimResultSchema,
  reconstructionSpecificationSchema,
  reconstructionVerificationResultSchema,
  type ReconstructionClaim as Claim,
  type ReconstructionClaimResult as ClaimResult,
  type ReconstructionObservedStatus as ObservedStatus,
  type ReconstructionVerificationResult,
} from "./reconstructionVerificationSchemas.js";
import {
  reconstructionClaimUnknowns,
  reconstructionProbes,
  reconstructionUnknownHeads,
} from "./reconstructionUnknowns.js";
import type { ResidualUnknown } from "./residualUnknown.js";

const comparisonOperationsByClaimKind = {
  behavioral: "compare_process_captures",
  "structural-function": "compare_functions",
  "structural-artifact": "compare_artifacts",
} as const;

interface FunctionSourceFacts {
  readonly evidence_id: string;
  readonly callCoverageBlockers: readonly string[];
  readonly callCoverageDiagnostics: readonly string[];
}

/** Verify only explicitly declared claims; no global equivalence is inferred. */
export const verifyReconstruction = (
  specificationInput: unknown,
  bundleInput: unknown,
): ReconstructionVerificationResult => {
  const parsedSpecification =
    reconstructionSpecificationSchema.safeParse(specificationInput);
  if (!parsedSpecification.success)
    throw analysisInputErrorFromIssues(
      "verify_reconstruction",
      parsedSpecification.error.issues,
      specificationInput,
      { cause: parsedSpecification.error },
    );
  const specification = parsedSpecification.data;
  const bundleResult = readEvidenceBundle(bundleInput, {
    operation: "verify_reconstruction",
    path: ["evidence_bundle"],
  });
  if (!bundleResult.ok) throw bundleResult.error;
  const bundle = bundleResult.value;
  const records = new Map(
    bundle.records.map((item) => [item.evidence_id, item]),
  );
  const heads = reconstructionUnknownHeads(bundle.unknowns);
  const results = specification.claims
    .map((claim, index) => evaluateClaim(claim, index, records, heads))
    .sort((left, right) =>
      compareUnicodeCodePoints(left.claim_id, right.claim_id),
    );
  const failed = count(results, "fail");
  const unresolved = count(results, "unknown");
  const probes = reconstructionProbes(results, heads);
  const evidenceLinks = uniqueSorted(
    results.flatMap(({ evidence_links: links }) => links),
  );
  const output = {
    status: failed > 0 ? "fail" : unresolved > 0 ? "unknown" : "pass",
    specification_sha256: digestCanonicalValue(
      {
        ...specification,
        claims: [...specification.claims].sort((left, right) =>
          compareUnicodeCodePoints(left.claim_id, right.claim_id),
        ),
      },
      "Reconstruction specification",
    ),
    summary: {
      total: results.length,
      passed: count(results, "pass"),
      failed,
      unknown: unresolved,
      behavioral: results.filter(({ kind }) => kind === "behavioral").length,
      structural: results.filter(({ kind }) => kind !== "behavioral").length,
    },
    claims: {
      items: results,
    },
    recommended_probes: probes,
    evidence_links: evidenceLinks,
    limitations: [
      "Pass means every declared claim passed; it does not establish global implementation equivalence.",
    ],
  };
  return reconstructionVerificationResultSchema.parse(output);
};

const evaluateClaim = (
  claim: Claim,
  claimIndex: number,
  records: ReadonlyMap<string, Evidence>,
  heads: ReadonlyMap<string, ResidualUnknown>,
): ClaimResult => {
  const comparison = records.get(claim.comparison_evidence_id);
  if (comparison === undefined)
    throw missingSourceInputError(
      claimIndex,
      `Missing comparison Evidence ${claim.comparison_evidence_id}`,
    );
  validateComparisonIdentity(claim, comparison, claimIndex);
  const sides = comparisonSourceEvidenceSides(comparison);
  const allSourceIds = uniqueSorted([...sides.left, ...sides.right]);
  if (!sameSet(comparison.evidence_links, allSourceIds))
    throw new EvidenceIntegrityError(
      "Comparison Evidence closure disagrees with its parameters",
      {
        userMessage:
          "Comparison Evidence closure disagrees with its parameters",
      },
    );
  const sources = allSourceIds.map((id) => {
    const source = records.get(id);
    if (source === undefined)
      throw missingSourceInputError(
        claimIndex,
        `Missing source Evidence ${id}`,
      );
    return source;
  });
  const functionSourceFacts = readValidatedSourceFacts(claim, sources);
  const observation = comparisonObservation(claim, comparison);
  const observed = observation.status;
  const callCoverage = sourceCallCoverage(
    claim,
    functionSourceFacts,
    observation.hasIndependentFunctionChange === true,
  );
  const blockers = [
    ...authorityLimitations(claim, sources, sides),
    ...callCoverage.blockers,
  ];
  const relevantUnknowns = reconstructionClaimUnknowns(
    heads,
    comparison.evidence_id,
    allSourceIds,
    observation.selectedDimensions ?? [claim.dimension],
  );
  const status = classify(observed, blockers, relevantUnknowns);
  return reconstructionClaimResultSchema.parse({
    claim_id: claim.claim_id,
    kind: claim.kind,
    dimension: claim.dimension,
    status,
    observed_status: observed,
    comparison_evidence_id: comparison.evidence_id,
    left_evidence_ids: sides.left,
    right_evidence_ids: sides.right,
    evidence_links: uniqueSorted([comparison.evidence_id, ...allSourceIds]),
    unknown_ids: relevantUnknowns.map(({ unknown_id: id }) => id),
    limitations: uniqueSorted([
      ...comparison.limitations,
      ...observation.limitations,
      ...blockers,
      ...callCoverage.diagnostics,
      ...relevantUnknowns.map(
        ({ question }) => `Residual unknown: ${question}`,
      ),
    ]),
  });
};

const readValidatedSourceFacts = (
  claim: Claim,
  sources: readonly Evidence[],
): readonly FunctionSourceFacts[] => {
  const isExpectedType = (source: Evidence): boolean => {
    if (claim.kind === "behavioral")
      return (
        source.operation === "capture_process_scenario" &&
        source.predicate_type === "rea.process-capture"
      );
    if (claim.kind === "structural-function")
      return (
        source.operation === "analyze_function" &&
        source.predicate_type === "rea.analysis"
      );
    return (
      (source.operation === "inventory_artifact" ||
        source.operation === "inspect_artifact") &&
      source.predicate_type === "rea.analysis"
    );
  };
  if (sources.some((source) => !isExpectedType(source)))
    throw new EvidenceIntegrityError(
      "Comparison source Evidence has an unexpected observation type",
      {
        userMessage:
          "Comparison source Evidence has an unexpected observation type",
      },
    );
  const functionSources: FunctionSourceFacts[] = [];
  for (const source of sources) {
    if (claim.kind === "behavioral") {
      const capture = readEvidencePayload(
        processCaptureSchema,
        source.normalized_result,
      );
      if (!capture.ok) throw capture.error;
    } else if (claim.kind === "structural-function") {
      const parsedDossier = readEvidencePayload(
        functionDossierSchema,
        source.normalized_result,
      );
      if (!parsedDossier.ok) throw parsedDossier.error;
      const dossier = parsedDossier.value;
      const callCoverage = assessFunctionCallCoverage(
        source.relationship_coverage,
        dossier,
      );
      functionSources.push({
        evidence_id: source.evidence_id,
        callCoverageBlockers: callCoverage.blockers,
        callCoverageDiagnostics: callCoverage.diagnostics,
      });
    } else {
      try {
        parseArtifactInventoryEvidence(source);
      } catch (cause: unknown) {
        if (cause instanceof EvidenceIntegrityError) throw cause;
        if (cause instanceof ArtifactInventoryCarrierError)
          throw new EvidenceIntegrityError(cause.message, {
            cause,
            userMessage: cause.message,
          });
        throw cause;
      }
    }
  }
  return functionSources;
};

const validateComparisonIdentity = (
  claim: Claim,
  evidence: Evidence,
  claimIndex: number,
): void => {
  const expectedOperation = comparisonOperationsByClaimKind[claim.kind];
  if (evidence.operation !== expectedOperation)
    throw missingSourceInputError(
      claimIndex,
      `Claim ${claim.claim_id} requires ${expectedOperation} Evidence; selected ${evidence.operation}`,
    );
  if (!hasComparisonEvidenceIdentity(evidence)) {
    const message = "Comparison Evidence identity or authority disagrees";
    throw new EvidenceIntegrityError(message, { userMessage: message });
  }
};

const comparisonObservation = (
  claim: Claim,
  evidence: Evidence,
): {
  readonly status: ObservedStatus;
  readonly limitations: readonly string[];
  readonly hasIndependentFunctionChange?: boolean;
  readonly selectedDimensions?: readonly string[];
} => {
  if (claim.kind === "behavioral") {
    const parsed = readComparisonResult(evidence, "compare_process_captures");
    if (!parsed.ok) throw parsed.error;
    const result = parsed.value.result;
    if (claim.dimension !== "overall")
      return { status: result[claim.dimension], limitations: [] };
    if (
      result.status === "unchanged" &&
      result.first_divergence.status === "unknown"
    )
      return {
        status: "unknown",
        limitations: [result.first_divergence.reason],
      };
    return {
      status: result.status,
      limitations: [],
    };
  }
  if (claim.kind === "structural-function") {
    const parsed = readComparisonResult(evidence, "compare_functions");
    if (!parsed.ok) throw parsed.error;
    const result = parsed.value.result;
    if (claim.dimension === "overall")
      return {
        status: result.status,
        selectedDimensions: [
          "overall",
          ...result.dimensions.map(({ dimension }) => dimension),
        ],
        limitations: result.dimensions.flatMap(
          ({ limitations }) => limitations,
        ),
        // Historical overall changes can be caused only by incomplete call
        // sets. Ignore that aggregate change when independently checking the
        // source call-coverage limitations.
        hasIndependentFunctionChange:
          result.function_match.status === "mismatched" ||
          (result.function_match.status === "matched" &&
            result.dimensions.some(
              (dimension) =>
                dimension.dimension !== "calls" &&
                dimension.status === "changed",
            )),
      };
    const dimension = result.dimensions.find(
      (item) => item.dimension === claim.dimension,
    );
    if (dimension === undefined) {
      const message = "Function comparison dimension missing";
      throw new EvidenceIntegrityError(message, { userMessage: message });
    }
    return { status: dimension.status, limitations: dimension.limitations };
  }
  const parsed = readComparisonResult(evidence, "compare_artifacts");
  if (!parsed.ok) throw parsed.error;
  const result = parsed.value.result;
  return { status: result.status, limitations: [] };
};

const missingSourceInputError = (claimIndex: number, message: string) =>
  new AnalysisInputError("verify_reconstruction", { userMessage: message }, [
    {
      path: ["claims", claimIndex, "comparison_evidence_id"],
      reason: "invalid_value",
      message,
    },
  ]);

const authorityLimitations = (
  claim: Claim,
  sources: readonly Evidence[],
  sides: {
    readonly left: readonly string[];
    readonly right: readonly string[];
  },
): string[] => {
  const requiredAuthority =
    claim.kind === "behavioral" ? "controlled-replay" : "shipped-artifact";
  const limitations: string[] = [];
  if (sides.left.some((id) => sides.right.includes(id)))
    limitations.push(
      "A source observation appears on both comparison sides; independent original and reconstruction observations are unavailable.",
    );
  if (
    sources.some(
      (source) =>
        source.authority !== requiredAuthority ||
        (claim.kind === "structural-function"
          ? source.confidence === "inferred"
          : source.confidence !== "observed"),
    )
  )
    limitations.push(
      `Source Evidence lacks qualifying ${requiredAuthority} authority.`,
    );
  if (
    claim.kind !== "behavioral" &&
    sources.some(({ subject }) => subject === null)
  )
    limitations.push("Structural source artifact identity is unavailable.");
  if (claim.kind === "behavioral") {
    const referenceEnvironment = sources[0]?.environment;
    if (
      referenceEnvironment === null ||
      referenceEnvironment === undefined ||
      sources.some(
        ({ environment }) =>
          environment === null ||
          JSON.stringify(environment) !== JSON.stringify(referenceEnvironment),
      )
    )
      limitations.push(
        "Controlled replay environments are unavailable or incompatible.",
      );
  }
  return limitations;
};

const sourceCallCoverage = (
  claim: Claim,
  functionSources: readonly FunctionSourceFacts[],
  hasIndependentFunctionChange: boolean,
): { blockers: string[]; diagnostics: string[] } => {
  if (
    claim.kind !== "structural-function" ||
    (claim.dimension !== "calls" &&
      !(claim.dimension === "overall" && !hasIndependentFunctionChange))
  )
    return { blockers: [], diagnostics: [] };
  return {
    blockers: functionSources.flatMap(({ evidence_id, callCoverageBlockers }) =>
      callCoverageBlockers.map((reason) => `Source ${evidence_id}: ${reason}`),
    ),
    diagnostics: functionSources.flatMap(
      ({ evidence_id, callCoverageDiagnostics }) =>
        callCoverageDiagnostics.map(
          (reason) => `Source ${evidence_id}: ${reason}`,
        ),
    ),
  };
};

const classify = (
  observed: ObservedStatus,
  limitations: readonly string[],
  unknowns: readonly ResidualUnknown[],
): ClaimResult["status"] => {
  if (limitations.length > 0) return "unknown";
  if (["changed", "added", "removed", "contradiction"].includes(observed))
    return "fail";
  if (observed === "unknown" || observed === "truncated" || unknowns.length > 0)
    return "unknown";
  return "pass";
};

const count = (
  items: readonly ClaimResult[],
  status: ClaimResult["status"],
): number => items.filter((item) => item.status === status).length;
const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  uniqueSorted(left).length === uniqueSorted(right).length &&
  uniqueSorted(left).every((id, index) => id === uniqueSorted(right)[index]);
