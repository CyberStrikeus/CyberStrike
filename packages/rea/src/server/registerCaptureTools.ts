import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { PacketCaptureService } from "../application/captures/PacketCaptureService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import {
  applicationToolRegistrationOptions,
  toolRegistrationOptions,
} from "./toolRegistrationOptions.js";

/** Bind the named capture contract through shared admission and retained Evidence delivery. */
export const registerCaptureTools = (
  server: EvidenceMcpServer,
  service: PacketCaptureService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const contract = toolContract("inspect_packet_capture");
  const handler = createEvidenceToolHandler(
    server,
    (input, options) => service.inspect(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    handler(contract),
  );
  const discovery = toolContract("inspect_packet_fields");
  const discover = createEvidenceToolHandler(
    server,
    (input, options) => service.inspectFields(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    discovery.name,
    toolRegistrationOptions(discovery),
    discover(discovery),
  );
};
