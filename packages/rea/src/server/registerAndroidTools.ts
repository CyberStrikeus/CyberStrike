import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { AndroidAnalysisService } from "../application/android/AndroidAnalysisService.js";
import { inspectAndroidPackage } from "../application/android/AndroidPackageInspection.js";
import { inspectAndroidSymbol } from "../application/android/AndroidSymbolInspection.js";
import { inspectAndroidJniBindings } from "../application/android/AndroidJniInspection.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import {
  createContractToolHandler,
  type ContractToolService,
} from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";

/** Bind Android handlers to their exact named contracts through shared workflows. */
export const registerAndroidTools = (
  server: EvidenceMcpServer,
  service: AndroidAnalysisService,
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
  const packageContract = toolContract("inspect_android_package");
  const packageService: ContractToolService<"inspect_android_package"> = {
    execute: (_operation, input, options) =>
      inspectAndroidPackage(
        service,
        input,
        { recordEvidence, evidenceById },
        options,
      ),
  };
  const packageHandler = createContractToolHandler(
    server,
    packageService,
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    packageContract.name,
    toolRegistrationOptions(packageContract),
    packageHandler(packageContract),
  );
  const searchContract = toolContract("search_android_classes");
  const jniContract = toolContract("inspect_android_jni_bindings");
  const jniService: ContractToolService<"inspect_android_jni_bindings"> = {
    execute: (_operation, input, options) =>
      inspectAndroidJniBindings(
        service,
        input,
        { recordEvidence, evidenceById },
        options,
      ),
  };
  server.registerTool(
    jniContract.name,
    toolRegistrationOptions(jniContract),
    createContractToolHandler(
      server,
      jniService,
      logger,
      recordEvidence,
      withAdmittedAnalysis,
    )(jniContract),
  );
  server.registerTool(
    searchContract.name,
    toolRegistrationOptions(searchContract),
    handler(searchContract),
  );
  const classContract = toolContract("inspect_android_class");
  const classService: ContractToolService<"inspect_android_class"> = {
    execute: (operation, input, options) =>
      inspectAndroidSymbol(
        service,
        operation,
        input,
        { recordEvidence, evidenceById },
        options,
      ),
  };
  server.registerTool(
    classContract.name,
    toolRegistrationOptions(classContract),
    createContractToolHandler(
      server,
      classService,
      logger,
      recordEvidence,
      withAdmittedAnalysis,
    )(classContract),
  );
  const methodContract = toolContract("inspect_android_method");
  const methodService: ContractToolService<"inspect_android_method"> = {
    execute: (operation, input, options) =>
      inspectAndroidSymbol(
        service,
        operation,
        input,
        { recordEvidence, evidenceById },
        options,
      ),
  };
  server.registerTool(
    methodContract.name,
    toolRegistrationOptions(methodContract),
    createContractToolHandler(
      server,
      methodService,
      logger,
      recordEvidence,
      withAdmittedAnalysis,
    )(methodContract),
  );
  const referencesContract = toolContract("trace_android_references");
  server.registerTool(
    referencesContract.name,
    toolRegistrationOptions(referencesContract),
    handler(referencesContract),
  );
};
