import { createEvidence } from "../evidence.js";
import type { JsonValue } from "../jsonValue.js";
import type { PcapRequest } from "./pcapAnalysis.js";

/** Domain facts needed by both successful and retained partial observations. */
interface PcapObservation {
  readonly subject?: Parameters<typeof createEvidence>[0] | null;
  readonly provider: Parameters<typeof createEvidence>[1];
  readonly result: JsonValue;
  readonly rawResult: JsonValue | null;
  readonly limitations: readonly string[];
  readonly locations: NonNullable<
    Parameters<typeof createEvidence>[2]["locations"]
  >;
}

/** One owner commits packet aggregation provenance and caller intent into Evidence. */
export const createPcapEvidence = (
  request: PcapRequest,
  observation: PcapObservation,
) =>
  createEvidence(observation.subject ?? undefined, observation.provider, {
    operation: request.operation,
    parameters: request.input,
    result: observation.result,
    rawResult: observation.rawResult,
    limitations: observation.limitations,
    locations: observation.locations,
    confidence:
      request.operation === "inspect_pcap_capture" ? "derived" : "observed",
    ...(request.operation === "inspect_pcap_capture"
      ? { authority: "historical-reference" as const }
      : {}),
  });
