import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  ModelArtifact,
  ModelArtifactInput,
} from "../../domain/model/modelArtifact.js";
import type { Result } from "../../domain/result.js";

/** Read-only, local model declarations; no model runtime, target execution or downloads. */
export interface ModelArtifactPort {
  readonly identity: ProviderIdentity;
  inspect(
    input: ModelArtifactInput,
    options?: ExecutionOptions,
  ): Promise<Result<ModelArtifact, AnalysisError>>;
  close(): Promise<void>;
}
