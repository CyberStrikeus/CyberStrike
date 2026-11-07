import type { PcapAnalysisPort } from "../application/pcap/PcapAnalysisPort.js";
import { PcapProvider } from "../pcap/PcapProvider.js";

/** Construct one pcap provider bound to the caller-selected tools. */
export const createPcapAnalysisProvider = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PcapAnalysisPort => new PcapProvider({ environment });
