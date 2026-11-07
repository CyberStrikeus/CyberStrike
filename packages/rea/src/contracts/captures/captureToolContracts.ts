import {
  inspectPacketFieldsInputSchema,
  packetFieldsCatalogSchema,
} from "../../domain/captures/packetFields.js";
import {
  inspectPacketCaptureInputSchema,
  packetCaptureSchema,
} from "../../domain/captures/packetCapture.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
export const CAPTURE_TOOL_CONTRACTS = [
  {
    name: "inspect_packet_fields",
    ...toolContractMetadata("inspect_packet_fields"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Discover protocols or field names/types registered in the installed TShark 4.x. kind defaults to protocols; use fields and optional exact protocol abbreviation to select field definitions. query searches name/abbreviation/description by case-insensitive literal substring using Unicode simple case folding. Return 50 matches by default with offset/limit paging; null requests all remaining within resource limits. Preserve type/base/bitmask/description, duplicate registrations, source line numbers, coverage, tool identity and diagnostics. Linux, TShark 4.x (PATH or absolute REA_TSHARK_COMMAND) and prlimit required. No capture file, interface or binary target needed. Registrations describe tool capabilities, not observed traffic. Each call rereads the glossary; use selected fields with inspect_packet_capture.",
    inputSchema: inspectPacketFieldsInputSchema,
    outputSchema: evidenceResultOf(packetFieldsCatalogSchema),
    examples: [
      { title: "Find USB protocol registrations", input: { query: "usb" } },
      {
        title: "Find the installed USB vendor-ID field",
        input: { kind: "fields", protocol: "usb", query: "idVendor" },
      },
    ],
  },
  {
    name: "inspect_packet_capture",
    ...toolContractMetadata("inspect_packet_capture"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect caller-selected fields in an existing local packet capture with TShark 4.x. Return 50 matching frames by default, with match_offset/match_limit paging and coverage counts; match_limit:null requests all remaining matches. Preserve repeated values, frame numbers, display filter, decode-as rules and pass mode in inline Evidence with source/tool identity and diagnostics. Optional packet_limit counts input packets before filtering; output paging does not shorten dissection or two-pass reassembly. Requires Linux, util-linux prlimit, and TShark 4.x on PATH or through absolute REA_TSHARK_COMMAND. File-only analysis; no live capture or device communication. Missing fields or no matches do not establish absence of device traffic.",
    inputSchema: inspectPacketCaptureInputSchema,
    outputSchema: evidenceResultOf(packetCaptureSchema),
    examples: [
      {
        title: "Inspect UDP exchanges in a recording",
        input: {
          path: "/artifacts/device.pcapng",
          fields: ["ip.addr", "udp.port", "data.data"],
          display_filter: "udp",
          decode_as: [],
          packet_limit: null,
          two_pass: true,
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
