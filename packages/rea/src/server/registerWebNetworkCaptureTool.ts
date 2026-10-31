import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { retainedSummaryDelivery } from "./retainedSummaryDelivery.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { redactExplicitFailure } from "../domain/explicitSensitiveFailure.js";
import { captureSensitiveValues } from "../domain/webNetworkCapture.js";
import { err } from "../domain/result.js";
import type { WebNetworkCaptureService } from "../application/WebNetworkCaptureService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind historical inspection to its named contract and caller-owned Evidence writer. */
export const registerWebNetworkCaptureTool = (
  server: EvidenceMcpServer,
  service: WebNetworkCaptureService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = toolContract("inspect_web_network_capture");
  const delivery = retainedSummaryDelivery(contract.name, {
    recordEvidence,
    evidenceById,
  });
  const registration = applicationToolRegistrationOptions(contract);
  // Keep the exact advertised contract; the shared service validates raw input
  // before effects so caller-declared sensitivity also covers invalid arguments.
  // SDK pre-validation otherwise emits unprojected issue paths as plain text.
  const handler = createEvidenceToolHandler(
    server,
    async (rawInput, options) => {
      const parsed = contract.inputSchema.safeParse(rawInput);
      if (!parsed.success)
        return err(
          redactExplicitFailure(
            analysisInputErrorFromIssues(
              contract.name,
              parsed.error.issues,
              rawInput,
              { cause: parsed.error },
            ),
            captureSensitiveValues(rawInput),
          ),
        );
      const { detail, ...input } = parsed.data;
      const parameters = { detail };
      const ready = delivery.preflight(parameters);
      if (!ready.ok) return ready;
      const inspected = await service.inspect(input, options);
      return inspected.ok
        ? delivery.projectEvidence(parameters, inspected.value)
        : inspected;
    },
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(contract.name, registration, handler(contract));
};
