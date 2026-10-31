import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { AdbDeviceAnalysisService } from "../application/adb/AdbDeviceAnalysisService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createContractToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";

/** Bind ADB handlers to their exact named contracts through shared workflows. */
export const registerAdbTools = (
  server: EvidenceMcpServer,
  service: AdbDeviceAnalysisService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const handler = createContractToolHandler(
    server,
    service,
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  for (const contract of [
    toolContract("inspect_adb_client"),
    toolContract("list_adb_devices"),
    toolContract("inspect_adb_device"),
    toolContract("list_adb_packages"),
    toolContract("pull_adb_package"),
    toolContract("read_adb_logcat"),
    toolContract("inspect_adb_package"),
    toolContract("pull_adb_file"),
    toolContract("push_adb_file"),
    toolContract("capture_adb_screen"),
    toolContract("list_adb_processes"),
    toolContract("list_adb_directory"),
    toolContract("list_adb_features"),
    toolContract("list_adb_services"),
    toolContract("inspect_adb_display"),
    toolContract("inspect_adb_window"),
    toolContract("read_adb_setting"),
    toolContract("collect_adb_bugreport"),
    toolContract("resolve_adb_packages"),
    toolContract("install_adb_package"),
    toolContract("uninstall_adb_package"),
    toolContract("start_adb_app"),
    toolContract("start_adb_activity"),
    toolContract("stop_adb_app"),
  ] as const) {
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      handler(contract),
    );
  }
};
