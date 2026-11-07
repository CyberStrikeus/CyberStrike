import {
  inspectSignalDecodersInputSchema,
  signalDecodersSchema,
} from "../../domain/signals/signalDecoders.js";
import {
  decodeSignalRecordingInputSchema,
  signalRecordingSchema,
} from "../../domain/signals/signalRecording.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
export const SIGNAL_TOOL_CONTRACTS = [
  {
    name: "inspect_signal_decoders",
    ...toolContractMetadata("inspect_signal_decoders"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Discover installed sigrok protocol decoders or inspect one decoder's channel/option help on Linux. Omit decoder to list ID/name pairs; supply its exact ID for literal help lines with source line numbers. query is a case-insensitive literal substring using Unicode simple case folding; catalog queries match the ID or name independently. Page matches with offset/limit (default 50; null returns all remaining). Reports tool identity, version, diagnostics and examined/matching coverage. Uses configured REA_SIGROK_COMMAND and prlimit; no recording, binary target, hardware scan or acquisition. Each call probes again; decoder modules are trusted, not fully fingerprinted. Use returned IDs/options with decode_signal_recording.",
    inputSchema: inspectSignalDecodersInputSchema,
    outputSchema: evidenceResultOf(signalDecodersSchema),
    examples: [
      { title: "Find installed UART decoders", input: { query: "uart" } },
      {
        title: "Read the installed UART baud-rate option",
        input: { decoder: "uart", query: "baud" },
      },
    ],
  },
  {
    name: "decode_signal_recording",
    ...toolContractMetadata("decode_signal_recording"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Decode an existing local logic/signal recording on Linux with sigrok-cli 0.7.2 and util-linux prlimit. Supply decoder stack, channels and options explicitly; optionally select input format and annotation classes. Return 50 literal output lines by default, with line_offset/line_limit paging; line_limit:null requests all remaining lines. Output windows count display lines, not annotations or samples, and do not shorten decoding. Preserve selected text, sample ranges, stderr, source/tool identity and coverage inline. Configure absolute REA_SIGROK_COMMAND. File-only analysis; no hardware acquisition or device communication. Empty output does not prove absence of traffic.",
    inputSchema: decodeSignalRecordingInputSchema,
    outputSchema: evidenceResultOf(signalRecordingSchema),
    examples: [
      {
        title: "Decode recorded UART RX bytes",
        input: {
          path: "/artifacts/uart.vcd",
          input_format: "vcd",
          decoders: "uart:rx=RX:baudrate=9600",
          annotations: "uart=rx-data",
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
