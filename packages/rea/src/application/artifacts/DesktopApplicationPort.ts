import type { ExecutionOptions } from "../AnalysisProvider.js";
import type {
  DesktopApplication,
  InspectDesktopApplicationInput,
} from "../../domain/desktopApplication.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/** Directory facts from bounded filesystem reads, without a native-analysis session. */
export interface DesktopApplicationPort {
  inspect(
    input: InspectDesktopApplicationInput,
    options?: ExecutionOptions,
  ): Promise<Result<DesktopApplication, AnalysisError>>;
  close(): Promise<void>;
}
