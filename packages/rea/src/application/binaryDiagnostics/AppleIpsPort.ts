import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  AppleIps,
  InspectAppleIpsInput,
} from "../../domain/native/appleIps.js";
import type { Result } from "../../domain/result.js";

/** Stable read and Apple .ips decoding, independent of a disassembler session. */
export interface AppleIpsPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectAppleIpsInput,
    options?: ExecutionOptions,
  ): Promise<Result<AppleIps, AnalysisError>>;
}
