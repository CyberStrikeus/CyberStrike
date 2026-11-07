import type {
  AnalysisExecution,
  ExecutionOptions,
  ProviderAvailability,
} from "../AnalysisProvider.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { AndroidRequest } from "../../domain/android/androidAnalysis.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/** Provider-authored inline projection; complete raw observations stay in rawResult. */
export interface AndroidAnalysisExecution extends AnalysisExecution {
  readonly searchRawSummary?: Readonly<Record<string, JsonValue>>;
}

/** Static Android inspection boundary; implementation details belong to the provider. */
export interface AndroidAnalysisPort {
  /** Inspect the selected JAR and Java runtime without opening an APK. */
  inspectAvailability(signal?: AbortSignal): Promise<ProviderAvailability>;
  /** Cancel active work and join cleanup of any retained provider resources. */
  close(): Promise<void>;
  execute(
    target: BinaryTarget,
    request: AndroidRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AndroidAnalysisExecution, AnalysisError>>;
}
