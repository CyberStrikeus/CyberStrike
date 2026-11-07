import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectPeCertificatesInput,
  PeCertificates,
} from "../../domain/native/peCertificates.js";
import type { Result } from "../../domain/result.js";

/** Stable read and PE certificate-table decoding, independent of a disassembler session. */
export interface PeCertificatesPort {
  readonly identity: ProviderIdentity;
  close?(): Promise<void>;
  inspect(
    input: InspectPeCertificatesInput,
    options?: ExecutionOptions,
  ): Promise<Result<PeCertificates, AnalysisError>>;
}
