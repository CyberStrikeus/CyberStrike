import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import {
  projectRetainedAnalysis,
  requireAnalysisViewRetention,
} from "../application/analysisView/AnalysisViewService.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { OptionalProviderLoadFailure } from "../application/OptionalObservationProviders.js";

import type { BrowserObservationPort } from "../application/BrowserObservationPort.js";
import {
  analyzeWebBundle,
  captureWebScreenshot,
  compareWebCaptureEvidence,
  compareWebScreenshotEvidence,
  discoverWebMcpTools,
  inspectWebPage,
  listBrowserTargets,
  observeWebSession,
} from "../application/BrowserObservationService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runEvidenceToolOperation } from "./contractToolHandler.js";

interface BrowserToolRegistration {
  readonly logger: Logger;
  readonly loadFailure?: OptionalProviderLoadFailure | undefined;
  readonly browser: BrowserObservationPort | undefined;
  readonly evidenceById?: EvidenceLookup | undefined;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
}

/** Register browser tools with execution-time provider diagnostics. */
// oxlint-disable-next-line max-lines-per-function -- direct SDK calls retain each schema-handler type correlation.
export const registerBrowserTools = (
  server: EvidenceMcpServer,
  options: BrowserToolRegistration,
): void => {
  const registration = { ...options, server };
  const listContract = toolContract("list_browser_targets");
  const inspectContract = toolContract("inspect_web_page");
  const analyzeContract = toolContract("analyze_web_bundle");
  const sessionContract = toolContract("observe_web_session");
  const webMcpContract = toolContract("discover_webmcp_tools");
  const captureDiffContract = toolContract("compare_web_captures");
  const screenshotContract = toolContract("capture_web_screenshot");
  const screenshotDiffContract = toolContract("compare_web_screenshots");

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
          listBrowserTargets(options.browser, parsed, {
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
        options.loadFailure,
        { input, context },
        (parsed, { signal, progress }) =>
          inspectWebPage(options.browser, parsed, { signal, progress }),
      ),
  );
  server.registerTool(
    analyzeContract.name,
    toolRegistrationOptions(analyzeContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        analyzeContract,
        options.loadFailure,
        { input, context },
        async ({ detail, view, ...request }, { signal, progress }) => {
          const retention = {
            recordEvidence: options.recordEvidence,
            evidenceById: options.evidenceById,
          };
          if (detail === "summary") {
            const ready = requireAnalysisViewRetention(
              analyzeContract.name,
              retention,
            );
            if (!ready.ok) return ready;
          }
          const analyzed = await analyzeWebBundle(options.browser, request, {
            signal,
            progress,
          });
          return analyzed.ok && view !== undefined
            ? projectRetainedAnalysis(analyzed.value, retention, view)
            : analyzed;
        },
      ),
  );
  server.registerTool(
    sessionContract.name,
    toolRegistrationOptions(sessionContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        sessionContract,
        options.loadFailure,
        { input, context },
        (parsed, { signal, progress }) =>
          observeWebSession(options.browser, parsed, {
            signal,
            progress,
          }),
      ),
  );
  server.registerTool(
    webMcpContract.name,
    toolRegistrationOptions(webMcpContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        webMcpContract,
        options.loadFailure,
        { input, context },
        (parsed, { signal, progress }) =>
          discoverWebMcpTools(options.browser, parsed, {
            signal,
            progress,
          }),
      ),
  );
  server.registerTool(
    captureDiffContract.name,
    toolRegistrationOptions(captureDiffContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        captureDiffContract,
        options.loadFailure,
        { input, context },
        (parsed) => compareWebCaptureEvidence(options.browser, parsed),
      ),
  );
  server.registerTool(
    screenshotContract.name,
    toolRegistrationOptions(screenshotContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        screenshotContract,
        options.loadFailure,
        { input, context },
        (parsed, { signal, progress }) =>
          captureWebScreenshot(options.browser, parsed, {
            signal,
            progress,
          }),
      ),
  );
  server.registerTool(
    screenshotDiffContract.name,
    toolRegistrationOptions(screenshotDiffContract),
    (input, context) =>
      runEvidenceToolOperation(
        registration,
        screenshotDiffContract,
        options.loadFailure,
        { input, context },
        (parsed) => compareWebScreenshotEvidence(options.browser, parsed),
      ),
  );
};
