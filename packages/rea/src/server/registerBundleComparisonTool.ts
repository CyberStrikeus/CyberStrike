import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { readComparisonEvidenceBundles } from "../application/EvidenceBundleFiles.js";
import { toolContract } from "../contracts/toolContracts.js";
import { compareBundles } from "../domain/bundleComparison.js";
import { createEvidence } from "../domain/evidence.js";
import { runDerivedOperation } from "./runDerivedOperation.js";
import { recordEvidenceSources } from "../application/investigation/recordEvidenceSources.js";
import { BUNDLE_COMPARISON_PROVIDER } from "../domain/investigationProviders.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

/** Register canonical Evidence bundle comparison. */
export const registerBundleComparisonTool = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  contract: ReturnType<typeof toolContract<"compare_bundles">>,
  resources: ArtifactResourceScope,
): void => {
  const admission = withAdmittedAnalysis({ kind: "session", session });
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const loaded = await readComparisonEvidenceBundles(
            input.left_bundle_path,
            input.right_bundle_path,
            context.mcpReq.signal,
            resources,
            contract.name,
          );
          if (!loaded.ok)
            return server.delivery.toCallToolResult(loaded, contract);
          const { left, right } = loaded.value;
          const computed = await runDerivedOperation(
            context,
            contract.name,
            () => compareBundles(left, right, input.record_pairs),
          );
          if (!computed.ok)
            return server.delivery.toCallToolResult(computed, contract);
          const comparison = computed.value;
          const sourceRecords = [
            ...new Map(
              [...left.records, ...right.records].map((record) => [
                record.evidence_id,
                record,
              ]),
            ).values(),
          ];
          const recordedSources = recordEvidenceSources(
            (evidence) => session.recordEvidence(evidence),
            sourceRecords,
          );
          if (!recordedSources.ok)
            return server.delivery.toCallToolResult(recordedSources, contract);
          const evidence = createEvidence(
            undefined,
            BUNDLE_COMPARISON_PROVIDER,
            {
              predicateType: "rea.bundle-comparison",
              operation: contract.name,
              parameters: {
                left_bundle_sha256: comparison.left_bundle_sha256,
                right_bundle_sha256: comparison.right_bundle_sha256,
                record_pairs: input.record_pairs,
              },
              result: comparison,
              confidence: "derived",
              authority: "analyst-inference",
              limitations: comparison.limitations,
              evidenceLinks: sourceRecords.map(
                ({ evidence_id }) => evidence_id,
              ),
            },
          );
          const recorded = session.recordEvidence(evidence);
          return server.delivery.toEvidenceToolResult(
            evidence,
            contract,
            recorded,
          );
        },
      ),
  );
};
