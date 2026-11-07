import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  GoBinary,
  InspectGoBinaryInput,
} from "../../domain/go/goBinary.js";
import type { Result } from "../../domain/result.js";

/** Replaceable offline build-information reader with no target-execution authority. */
export interface GoBinaryPort {
  readonly identity: ProviderIdentity;
  close(): Promise<void>;
  inspect(
    input: Omit<InspectGoBinaryInput, "detail">,
    options?: ExecutionOptions,
  ): Promise<Result<GoBinary, AnalysisError>>;
}
