import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  ElectronPageInspection,
  ElectronTargetList,
  InspectElectronPageInput,
  ListElectronTargetsInput,
} from "../../domain/javascript/electronObservation.js";
import type { Result } from "../../domain/result.js";

/** Provider-neutral boundary for root-confined Electron file-page observation. */
export interface ElectronObservationPort {
  /** Release provider-owned transports during command or server shutdown. */
  close?(): Promise<void>;
  identity(): ProviderIdentity;
  listTargets(
    input: ListElectronTargetsInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElectronTargetList, AnalysisError>>;
  inspectPage(
    input: InspectElectronPageInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElectronPageInspection, AnalysisError>>;
}
