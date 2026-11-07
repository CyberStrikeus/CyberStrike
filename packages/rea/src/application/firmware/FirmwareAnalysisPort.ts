import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import type { FirmwareRequest } from "../../domain/firmware/firmwareAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/** File-oriented firmware engines; executable admission remains a separate operation. */
export interface FirmwareAnalysisPort {
  close?(): Promise<void>;
  execute(
    request: FirmwareRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
