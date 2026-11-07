import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import {
  projectRetainedAnalysis,
  requireAnalysisViewRetention,
} from "../application/analysisView/AnalysisViewService.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { OptionalProviderLoadFailure } from "../application/OptionalObservationProviders.js";

import type { ElectronActiveObservationPort } from "../application/javascript/ElectronActiveObservationPort.js";
import { captureElectronScenario } from "../application/javascript/ElectronActiveObservationService.js";
import type { ElectronObservationPort } from "../application/javascript/ElectronObservationPort.js";
import {
  inspectElectronPage,
  listElectronTargets,
} from "../application/javascript/ElectronObservationService.js";
import { analyzeJavaScriptApplicationValidated } from "../application/javascript/JavaScriptApplicationService.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { reconcileJavaScriptRuntimeEvidence } from "../application/javascript/JavaScriptRuntimeReconciliationService.js";
import { recordEvidenceSources } from "../application/investigation/recordEvidenceSources.js";
import type { ElectronFuseService } from "../application/electron/ElectronFuseService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import {
  applicationToolRegistrationOptions,
  toolRegistrationOptions,
} from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import {
  createEvidenceToolHandler,
  runEvidenceToolOperation,
} from "./contractToolHandler.js";

interface ElectronToolRegistration {
  readonly artifactResources: ArtifactResourceScope;
  /** The server's selected environment; JavaScript analysis reads its admission settings. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  readonly observationLoadFailure?: OptionalProviderLoadFailure | undefined;
  readonly activeLoadFailure?: OptionalProviderLoadFailure | undefined;
  readonly electron: ElectronObservationPort | undefined;
  readonly electronActive: ElectronActiveObservationPort | undefined;
  readonly electronFuses: ElectronFuseService;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly evidenceById: EvidenceLookup | undefined;
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
}

/** Register Electron tools even when a provider is absent. */
// oxlint-disable-next-line max-lines-per-function -- direct SDK calls retain each schema-handler type correlation.
export const registerElectronTools = (
  server: EvidenceMcpServer,
  options: ElectronToolRegistration,
): void => {
  const registration = { ...options, server };
  registerElectronFuseTool(server, options);
  const listContract = toolContract("list_electron_targets");
  const inspectContract = toolContract("inspect_electron_page");
  const analyzeContract = toolContract("analyze_javascript_application");
  const reconcileContract = toolContract("reconcile_javascript_runtime");
  const activeContract = toolContract("capture_electron_scenario");

  server.registerTool(
    listContract.name,
    toolRegistrationOptions(listContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        listContract,
        options.observationLoadFailure,
        { input, context },
        (parsed, { signal }) =>
          listElectronTargets(options.electron, parsed, {
            signal,
          }),
      ),
  );
  server.registerTool(
    inspectContract.name,
    toolRegistrationOptions(inspectContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        inspectContract,
        options.observationLoadFailure,
        { input, context },
        (parsed, { signal, progress }) =>
          inspectElectronPage(options.electron, parsed, {
            signal,
            progress,
          }),
      ),
  );
  server.registerTool(
    analyzeContract.name,
    toolRegistrationOptions(analyzeContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        analyzeContract,
        undefined,
        { input, context },
        async ({ detail, view, ...request }, { signal, progress }) => {
          if (detail === "summary") {
            const ready = requireAnalysisViewRetention(
              analyzeContract.name,
              options,
            );
            if (!ready.ok) return ready;
          }
          const analyzed = await analyzeJavaScriptApplicationValidated(
            request,
            options.artifactResources,
            {
              signal,
              progress,
              environment: options.environment,
              ...(server.analysisSettings === undefined
                ? {}
                : { settings: server.analysisSettings.read }),
            },
          );
          return detail === "summary" && analyzed.ok
            ? projectRetainedAnalysis(
                analyzed.value,
                options,
                view ?? { kind: "summary" },
              )
            : analyzed;
        },
      ),
  );
  server.registerTool(
    reconcileContract.name,
    toolRegistrationOptions(reconcileContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        reconcileContract,
        undefined,
        { input, context },
        async (parsed, { signal }) => {
          const result = reconcileJavaScriptRuntimeEvidence(
            parsed,
            options.evidenceById,
            { signal },
          );
          if (!result.ok) return result;
          const recorded = recordEvidenceSources(
            options.recordEvidence,
            result.value.sources,
          );
          return recorded.ok
            ? { ok: true, value: result.value.evidence }
            : recorded;
        },
      ),
  );
  server.registerTool(
    activeContract.name,
    toolRegistrationOptions(activeContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        activeContract,
        options.activeLoadFailure,
        { input, context },
        (parsed, { signal, progress }) =>
          captureElectronScenario(options.electronActive, parsed, {
            signal,
            progress,
          }),
      ),
  );
};

const registerElectronFuseTool = (
  server: EvidenceMcpServer,
  options: ElectronToolRegistration,
): void => {
  const contract = toolContract("inspect_electron_fuses");
  const handler = createEvidenceToolHandler(
    server,
    (input, execution) => options.electronFuses.inspect(input, execution),
    options.logger,
    options.recordEvidence,
    options.withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    handler(contract),
  );
};
