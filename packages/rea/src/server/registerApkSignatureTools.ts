import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { ApkSignatureService } from "../application/apkSignature/ApkSignatureService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { apkSignatureModule } from "../composition/apkSignature.js";
import type { Logger } from "pino";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the named APK-signature contract to shared validation and session Evidence. */
export const registerApkSignatureTools = (
  server: EvidenceMcpServer,
  service: Pick<ApkSignatureService, "inspect">,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = apkSignatureModule.contract;
  const handler = createEvidenceToolHandler(
    server,
    (input, options) =>
      service.inspect(input, options, { recordEvidence, evidenceById }),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    handler(contract),
  );
};
