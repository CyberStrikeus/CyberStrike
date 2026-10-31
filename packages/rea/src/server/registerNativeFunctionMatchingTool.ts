import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import { matchNativeFunctions } from "../application/native/NativeFunctionMatchingService.js";
import { summarizeRetainedAnalysis } from "../application/analysisView/AnalysisViewService.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { recordEvidenceSources } from "../application/investigation/recordEvidenceSources.js";
import { ok } from "../domain/result.js";
import type { Logger } from "pino";
import { runtimeNativeMatchingAllowance } from "../config/runtimeAnalysisSettings.js";

/** Bind one named contract to the same retained-Evidence workflow used by CLI. */
export const registerNativeFunctionMatchingTool = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const contract = toolContract("match_native_functions");
  // Reads each accepted operation's settings snapshot over the launch value.
  const resolveAllowance = runtimeNativeMatchingAllowance(
    environment,
    server.analysisSettings?.read,
  );
  const evidenceById = session.evidenceForAnalysis.bind(session);
  const recordEvidence: BinarySessionPort["recordEvidence"] = (evidence) =>
    session.recordEvidence(evidence);
  const handler = createEvidenceToolHandler(
    server,
    async (input, options) => {
      const allowance = resolveAllowance();
      if (!allowance.ok) return allowance;
      const result = await matchNativeFunctions(
        input,
        { ...options, representationAllowance: allowance.value },
        evidenceById,
      );
      if (!result.ok) return result;
      const recorded = recordEvidenceSources(
        recordEvidence,
        result.value.sources,
      );
      if (!recorded.ok) return recorded;
      return result.value.detail === "summary"
        ? summarizeRetainedAnalysis(result.value.evidence, {
            evidenceById,
            recordEvidence,
          })
        : ok(result.value.evidence);
    },
    logger,
    recordEvidence,
    withAdmittedAnalysis({ kind: "session", session }),
  );
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    handler(contract),
  );
};
