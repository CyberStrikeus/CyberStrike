import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectKernelModuleInput,
  KernelModule,
} from "../../domain/native/kernelModule.js";
import type { Result } from "../../domain/result.js";

/** Stable read and kernel-module metadata decoding, independent of a disassembler session. */
export interface KernelModulePort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectKernelModuleInput,
    options?: ExecutionOptions,
  ): Promise<Result<KernelModule, AnalysisError>>;
}
