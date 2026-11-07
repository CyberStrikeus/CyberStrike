import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectPeLoadConfigInput,
  PeLoadConfig,
} from "../../domain/native/peLoadConfig.js";
import type { Result } from "../../domain/result.js";

/** Stable read and PE TLS/load-config-table decoding, independent of a disassembler session. */
export interface PeLoadConfigPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectPeLoadConfigInput,
    options?: ExecutionOptions,
  ): Promise<Result<PeLoadConfig, AnalysisError>>;
}
