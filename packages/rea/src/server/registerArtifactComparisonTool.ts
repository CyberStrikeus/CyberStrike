import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { ArtifactComparisonResult } from "../domain/artifactComparison.js";
import {
  compareArtifactEvidence,
  resolveArtifactComparisonSources,
} from "../application/artifacts/ArtifactComparisonEvidence.js";
import type { RecordUnknownInput } from "../domain/residualUnknown.js";
import { recordDerivedEvidence } from "./recordDerivedEvidence.js";
import { runDerivedOperation } from "./runDerivedOperation.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import { recordEvidenceSources } from "../application/investigation/recordEvidenceSources.js";

/** Register Evidence-backed deterministic artifact comparison. */
export const registerArtifactComparisonTool = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  contract: ReturnType<typeof toolContract<"compare_artifacts">>,
  resources: ArtifactResourceScope,
): void => {
  const admission = withAdmittedAnalysis({ kind: "session", session });
  const evidenceById = session.evidenceForAnalysis.bind(session);
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const sources = await resolveArtifactComparisonSources(
            input,
            evidenceById,
            { signal: context.mcpReq.signal, resources },
          );
          if (!sources.ok)
            return server.delivery.toCallToolResult(sources, contract);
          const computed = await runDerivedOperation(
            context,
            contract.name,
            () => {
              const compared = compareArtifactEvidence(sources.value);
              if (!compared.ok) throw compared.error;
              return compared.value;
            },
          );
          if (!computed.ok)
            return server.delivery.toCallToolResult(computed, contract);
          const { left, right } = sources.value;
          const { comparison, evidence } = computed.value;
          const recordedSources = recordEvidenceSources(
            (source) => session.recordEvidence(source),
            [left, right],
          );
          if (!recordedSources.ok)
            return server.delivery.toCallToolResult(recordedSources, contract);
          return server.delivery.toEvidenceToolResult(
            evidence,
            contract,
            recordDerivedEvidence(
              session,
              evidence,
              artifactUnknownInput(
                left,
                right,
                comparison,
                evidence.evidence_id,
              ),
            ),
          );
        },
      ),
  );
};

const artifactUnknownInput = (
  left: { readonly evidence_id: string },
  right: { readonly evidence_id: string },
  comparison: ArtifactComparisonResult,
  comparisonEvidenceId: string,
): RecordUnknownInput | undefined => {
  const { status } = comparison;
  if (status === "unchanged") return undefined;
  const sourceIds = [...new Set([left.evidence_id, right.evidence_id])];
  const contradictingIds = comparison.integrity_mismatch_evidence_ids ?? [];
  const contentContradictions =
    status === "changed" && left.evidence_id !== right.evidence_id
      ? [right.evidence_id]
      : [];
  const contradictions =
    contradictingIds.length > 0 ? contradictingIds : contentContradictions;
  return {
    question: `Artifact comparison is ${status} (comparison ${comparisonEvidenceId})`,
    severity:
      status === "unknown" || status === "truncated" ? "high" : "medium",
    domain: "artifact-comparison",
    supporting_evidence_ids: sourceIds.filter(
      (id) => !contradictions.includes(id),
    ),
    contradicting_evidence_ids: contradictions,
    required_authority: "shipped-artifact",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [
      {
        operation: "inspect_artifact",
        rationale: "Inspect both artifacts and compare their complete graphs.",
      },
    ],
    relationships: [],
  };
};
