import type {
  AnalysisExecution,
  ExecutionOptions,
  ProviderAvailability,
} from "../AnalysisProvider.js";
import type { PcapRequest } from "../../domain/pcap/pcapAnalysis.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

/**
 * Packet-capture analysis boundary over caller-supplied tshark/capinfos.
 * Implementation details belong to the provider adapter.
 */
export interface PcapAnalysisPort {
  /** Probe both tools without reading any capture file. */
  inspectAvailability(signal?: AbortSignal): Promise<ProviderAvailability>;
  /** Retry cleanup of retained owned commands and capture snapshots. */
  close(): Promise<void>;
  execute(
    request: PcapRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
