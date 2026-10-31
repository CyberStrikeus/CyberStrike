import type {
  AnalysisExecution,
  ExecutionOptions,
  ProviderAvailability,
} from "../AnalysisProvider.js";
import type { AdbRequest } from "../../domain/adb/adbDeviceAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/**
 * ADB device inspection boundary over a caller-selected adb binary.
 * Implementation details belong to the provider adapter.
 */
export interface AdbDeviceAnalysisPort {
  /** Probe the selected adb binary without contacting devices. */
  inspectAvailability(signal?: AbortSignal): Promise<ProviderAvailability>;
  /** Terminally stop admission, drain work, and retry retained package rollback. */
  close(): Promise<void>;
  execute(
    request: AdbRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
