import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { FlutterBuildAnalysisService } from "../application/flutter/FlutterBuildAnalysisService.js";
import { inspectDartAot } from "../application/flutter/DartAotInspection.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import type { Logger } from "pino";
import {
  createContractToolHandler,
  type ContractToolService,
} from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind Flutter handlers to their exact named contracts through admission. */
export const registerFlutterTools = (
  server: EvidenceMcpServer,
  service: FlutterBuildAnalysisService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const handler = createContractToolHandler(
    server,
    service,
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  const identify = toolContract("identify_flutter_build");
  server.registerTool(
    identify.name,
    toolRegistrationOptions(identify),
    handler(identify),
  );
  const aotService: ContractToolService<"inspect_dart_aot"> = {
    execute: (_operation, input, options) =>
      inspectDartAot(service, input, { recordEvidence, evidenceById }, options),
  };
  const aotHandler = createContractToolHandler(
    server,
    aotService,
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  const aot = toolContract("inspect_dart_aot");
  server.registerTool(aot.name, toolRegistrationOptions(aot), aotHandler(aot));
};
