import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectRustBinaryInput,
  RustBinary,
} from "../../domain/rust/rustBinary.js";
import type { Result } from "../../domain/result.js";

/** Replaceable offline dependency reader with no target-execution authority. */
export interface RustBinaryPort {
  readonly identity: ProviderIdentity;
  close(): Promise<void>;
  inspect(
    input: InspectRustBinaryInput,
    options?: ExecutionOptions,
  ): Promise<Result<RustBinary, AnalysisError>>;
}
