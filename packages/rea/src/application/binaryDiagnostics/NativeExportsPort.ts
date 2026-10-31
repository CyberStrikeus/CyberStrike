import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectNativeExportsInput,
  NativeExports,
} from "../../domain/native/nativeExports.js";
import type { Result } from "../../domain/result.js";

/** Stable read and export-table decoding, independent of an active engine session. */
export interface NativeExportsPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectNativeExportsInput,
    options?: ExecutionOptions,
  ): Promise<Result<NativeExports, AnalysisError>>;
}
