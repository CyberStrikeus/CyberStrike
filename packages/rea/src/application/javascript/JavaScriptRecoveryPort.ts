import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { JavaScriptRecoveryInput } from "../../domain/javascript/javascriptRecovery.js";
import type { Result } from "../../domain/result.js";
import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";

/** Typed boundary for upstream source recovery without exposing its protocol. */
export interface JavaScriptRecoveryPort {
  close?(): Promise<void>;
  recover(
    input: JavaScriptRecoveryInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
