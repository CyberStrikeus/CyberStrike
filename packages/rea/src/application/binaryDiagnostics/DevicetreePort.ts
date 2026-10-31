import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectDevicetreeInput,
  Devicetree,
} from "../../domain/firmware/devicetree.js";
import type { Result } from "../../domain/result.js";

/** Stable read and devicetree-table decoding, independent of a disassembler session. */
export interface DevicetreePort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectDevicetreeInput,
    options?: ExecutionOptions,
  ): Promise<Result<Devicetree, AnalysisError>>;
}
