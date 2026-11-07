import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  GpuCodeObjects,
  GpuCodeObjectsInput,
} from "../../domain/gpu/gpuCodeObjects.js";
import type { Result } from "../../domain/result.js";

/** Read-only, local GPU declarations; no GPU runtime, target execution or downloads. */
export interface GpuCodeObjectsPort {
  readonly identity: ProviderIdentity;
  inspect(
    input: GpuCodeObjectsInput,
    options?: ExecutionOptions,
  ): Promise<Result<GpuCodeObjects, AnalysisError>>;
  close(): Promise<void>;
}
