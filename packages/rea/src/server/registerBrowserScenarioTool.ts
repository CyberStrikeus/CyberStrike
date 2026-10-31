import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import {
  optionalProviderUnavailable,
  type OptionalProviderLoadFailure,
} from "../application/OptionalObservationProviders.js";
import { err } from "../domain/result.js";
import { browserScenarioSchema } from "../domain/browserScenario.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { BrowserScenarioCapturePort } from "../application/BrowserScenarioCapturePort.js";
import { captureBrowserScenario } from "../application/BrowserScenarioCaptureService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createRetainedSummaryToolHandler } from "./contractToolHandler.js";

interface BrowserScenarioToolRegistration {
  readonly logger: Logger;
  readonly loadFailure?: OptionalProviderLoadFailure | undefined;
  readonly provider: BrowserScenarioCapturePort | undefined;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly evidenceById?: EvidenceLookup | undefined;
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
}

/** Validate one scenario, then share complete/retained delivery with other analyses. */
export const registerBrowserScenarioTool = (
  server: EvidenceMcpServer,
  options: BrowserScenarioToolRegistration,
): void => {
  const contract = toolContract("capture_browser_scenario");
  const handler = createRetainedSummaryToolHandler(
    server,
    contract,
    async (input, execution) => {
      // The SDK admits the advertised structure. The canonical semantic parser
      // owns field-path diagnostics, shared with the CLI rather than flattened
      // into the SDK's pre-handler validation message.
      const scenario = browserScenarioSchema.safeParse(input);
      if (!scenario.success)
        return err(
          analysisInputErrorFromIssues(
            contract.name,
            scenario.error.issues,
            input,
            { cause: scenario.error },
          ),
        );
      return options.loadFailure === undefined
        ? captureBrowserScenario(options.provider, scenario.data, execution)
        : err(optionalProviderUnavailable(options.loadFailure, contract.name));
    },
    options.logger,
    {
      recordEvidence: options.recordEvidence,
      evidenceById: options.evidenceById,
    },
    options.withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    handler,
  );
};
