import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectPeResourcesInput,
  PeResources,
} from "../../domain/native/peResources.js";
import type { Result } from "../../domain/result.js";

/** Stable read and PE decoding boundary, independent of an active disassembler session. */
export interface PeResourcesPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectPeResourcesInput,
    options?: ExecutionOptions,
  ): Promise<Result<PeResources, AnalysisError>>;
}
