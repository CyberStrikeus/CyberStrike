import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectPeImportsInput,
  PeImports,
} from "../../domain/native/peImports.js";
import type { Result } from "../../domain/result.js";

/** Stable read and PE import-table decoding, independent of a disassembler session. */
export interface PeImportsPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectPeImportsInput,
    options?: ExecutionOptions,
  ): Promise<Result<PeImports, AnalysisError>>;
}
