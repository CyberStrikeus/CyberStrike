import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  InspectErlangBeamInput,
  ErlangBeam,
} from "../../domain/erlang/beam.js";
import type { Result } from "../../domain/result.js";

/** Stable read and BEAM IFF decoding, independent of a disassembler session. */
export interface BeamPort {
  readonly identity: ProviderIdentity;
  close(): Promise<void>;
  inspect(
    input: InspectErlangBeamInput,
    options?: ExecutionOptions,
  ): Promise<Result<ErlangBeam, AnalysisError>>;
}
