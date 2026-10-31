import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectRecordedCrashInput,
  RecordedCrash,
} from "../../domain/native/recordedCrash.js";
import type { Result } from "../../domain/result.js";

/** Replaceable decoder of supplied recordings; historical PID is never live authority. */
export interface RecordedCrashPort {
  readonly identity: ProviderIdentity;
  inspectAndClose(
    input: InspectRecordedCrashInput,
    options?: ExecutionOptions,
  ): Promise<Result<RecordedCrash, AnalysisError>>;
  close?(): Promise<void>;
  inspect(
    input: InspectRecordedCrashInput,
    options?: ExecutionOptions,
  ): Promise<Result<RecordedCrash, AnalysisError>>;
}
