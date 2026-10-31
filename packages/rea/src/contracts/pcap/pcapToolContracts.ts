import {
  pcapInputSchemas,
  pcapResultSchemas,
} from "../../domain/pcap/pcapAnalysis.js";
import type { ToolContract } from "../toolContractTypes.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "../toolEffects.js";
import {
  analysisDetailSchema,
  analysisDetailOutputSchemaOf,
} from "../analysisDetail.js";
import { pcapCaptureSummaryViewResultSchema } from "../../domain/analysisView/analysisView.js";

/** Packet-capture analysis served by caller-supplied tshark and capinfos. */
export const PCAP_TOOL_CONTRACTS = [
  {
    name: "inspect_pcap_client",
    ...toolContractMetadata("inspect_pcap_client"),
    description:
      "Inspect the caller-selected tshark and capinfos binaries: selected commands, selection sources, and versions. Both tools must be usable. Reads no capture file. REA never installs the Wireshark suite; select binaries with REA_TSHARK_COMMAND and REA_CAPINFOS_COMMAND (absolute) or from PATH.",
    kind: "pcap-provider",
    inputSchema: pcapInputSchemas.inspect_pcap_client,
    outputSchema: evidenceResultOf(pcapResultSchemas.inspect_pcap_client),
    examples: [{ title: "Check the analysis tools", input: {} }],
  },
  {
    name: "inspect_pcap_capture",
    ...toolContractMetadata("inspect_pcap_capture"),
    description:
      "Request detail summary for capture identity/counts, then page retained facts with inspect_analysis_view kind pcap. Default detail complete preserves inline delivery. Inspect one saved pcap or pcapng capture through an owned snapshot: metadata, exact packet count, SHA-256, IPv4/IPv6 address counts, DNS questions and address values from the same single-question response, TLS SNI, protocol distribution and HTTP URIs. All derived inventories are retained within declared resource budgets; unknown DNS attribution and excluded credentials remain explicit. Linux requires util-linux prlimit; Windows uses owned Job Objects. Requires caller-supplied capinfos and tshark; REA never captures traffic.",
    kind: "pcap-provider",
    inputSchema: pcapInputSchemas.inspect_pcap_capture.extend({
      detail: analysisDetailSchema,
    }),
    outputSchema: analysisDetailOutputSchemaOf(
      pcapResultSchemas.inspect_pcap_capture,
      pcapCaptureSummaryViewResultSchema,
    ),
    examples: [
      {
        title: "Inspect a capture file",
        input: { path: "/captures/session.pcap" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
