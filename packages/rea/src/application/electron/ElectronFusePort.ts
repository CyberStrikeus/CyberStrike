import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  ElectronFuseReport,
  InspectElectronFusesInput,
} from "../../domain/electron/electronFuses.js";
import type { Result } from "../../domain/result.js";

/** Replaceable read-only Electron fuse reader with no target-execution authority. */
export interface ElectronFusePort {
  readonly identity: ProviderIdentity;
  /** Release owned read resources, retrying retained cleanup failures. */
  close(): Promise<void>;
  inspect(
    input: InspectElectronFusesInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElectronFuseReport, AnalysisError>>;
}
