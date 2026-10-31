import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  Il2cppMetadata,
  Il2cppMetadataProviderInput,
} from "../../domain/il2cpp/il2cppMetadata.js";
import type { Result } from "../../domain/result.js";

/** Replaceable offline metadata reader with no target-execution or decryption authority. */
export interface Il2cppMetadataPort {
  readonly identity: ProviderIdentity;
  close(): Promise<void>;
  inspect(
    input: Il2cppMetadataProviderInput,
    options?: ExecutionOptions,
  ): Promise<Result<Il2cppMetadata, AnalysisError>>;
}
