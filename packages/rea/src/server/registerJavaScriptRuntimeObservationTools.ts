import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { OptionalProviderLoadFailure } from "../application/OptionalObservationProviders.js";

import type { JavaScriptRuntimeObservationPort } from "../application/javascript/JavaScriptRuntimeObservationPort.js";
import {
  listJavaScriptRuntimeTargets,
  observeJavaScriptRuntime,
} from "../application/javascript/JavaScriptRuntimeObservationService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runEvidenceToolOperation } from "./contractToolHandler.js";

interface RuntimeToolRegistration {
  readonly logger: Logger;
  readonly loadFailure?: OptionalProviderLoadFailure | undefined;
  readonly runtime: JavaScriptRuntimeObservationPort | undefined;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
}

/** Register passive Inspector tools even when policy keeps them unavailable. */
export const registerJavaScriptRuntimeObservationTools = (
  server: EvidenceMcpServer,
  options: RuntimeToolRegistration,
): void => {
  const registration = { ...options, server };
  const listContract = toolContract("list_javascript_runtime_targets");
  const observeContract = toolContract("observe_javascript_runtime");
  server.registerTool(
    listContract.name,
    toolRegistrationOptions(listContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        listContract,
        options.loadFailure,
        { input, context },
        (parsed, { signal }) =>
          listJavaScriptRuntimeTargets(options.runtime, parsed, { signal }),
      ),
  );
  server.registerTool(
    observeContract.name,
    toolRegistrationOptions(observeContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        observeContract,
        options.loadFailure,
        { input, context },
        (parsed, { signal }) =>
          observeJavaScriptRuntime(options.runtime, parsed, { signal }),
      ),
  );
};
