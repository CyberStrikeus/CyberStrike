import { compareWasmInterfaces } from "../application/wasm/WasmInterfaceComparisonService.js";
import { COMPARE_WASM_INTERFACES_CONTRACT } from "../contracts/wasm/wasmComparisonContracts.js";
import { retainAnalysisResultSources } from "../application/investigation/recordEvidenceSources.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { WasmArtifactService } from "../application/wasm/WasmArtifactService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { wasmArtifactModule } from "../composition/wasm.js";
import type { Logger } from "pino";
import {
  createEvidenceToolHandler,
  createRetainedSummaryToolHandler,
} from "./contractToolHandler.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import {
  applicationToolRegistrationOptions,
  toolRegistrationOptions,
} from "./toolRegistrationOptions.js";

/** Bind the named WASM contract to shared validation and session Evidence recording. */
export const registerWasmTools = (
  server: EvidenceMcpServer,
  service: Pick<WasmArtifactService, "inspect">,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const comparison = COMPARE_WASM_INTERFACES_CONTRACT;
  const compareHandler = createEvidenceToolHandler(
    server,
    async (rawInput, options) => {
      const result = retainAnalysisResultSources(
        comparison.name,
        recordEvidence,
        await compareWasmInterfaces(rawInput, options, evidenceById),
        { sourceOwner: "caller" },
      );
      return result.ok ? { ok: true, value: result.value.evidence } : result;
    },
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    comparison.name,
    toolRegistrationOptions(comparison),
    compareHandler(comparison),
  );
  const contract = wasmArtifactModule.contract;
  const handler = createRetainedSummaryToolHandler(
    server,
    contract,
    (input, options) => service.inspect(input, options),
    logger,
    { recordEvidence, evidenceById },
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    handler,
  );
};
