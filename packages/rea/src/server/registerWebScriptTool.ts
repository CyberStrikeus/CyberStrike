import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";

import { exportWebScriptsValidated } from "../application/WebScriptExportService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { deliverEvidenceResult } from "./contractToolHandler.js";

/** Register local script export without requiring a live browser provider. */
export const registerWebScriptTool = (
  server: EvidenceMcpServer,
  options: {
    readonly logger: Logger;
    readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
    readonly artifactResources: ArtifactResourceScope;
    readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
  },
): void => {
  const contract = toolContract("export_web_scripts");
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              exportWebScriptsValidated(input, options.artifactResources, {
                signal: context.mcpReq.signal,
              }),
          );
          return deliverEvidenceResult(
            server,
            result,
            contract,
            options.recordEvidence,
          );
        },
      ),
  );
};
