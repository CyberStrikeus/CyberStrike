import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { InspectEvmInterfaceInput } from "../../domain/evm/evmInterface.js";
import type { EvidenceSubjectTarget } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";

/** Successful EVM interface recovery must identify the selected local file. */
export type EvmInterfaceExecution = Omit<AnalysisExecution, "subject"> & {
  readonly subject: EvidenceSubjectTarget & { readonly format: "file" };
};

/** Replaceable offline interface-recovery engine, independent of wallets and chain clients. */
export interface EvmInterfacePort {
  close?(): Promise<void>;
  inspect(
    input: InspectEvmInterfaceInput,
    options?: ExecutionOptions,
  ): Promise<Result<EvmInterfaceExecution, AnalysisError>>;
}
