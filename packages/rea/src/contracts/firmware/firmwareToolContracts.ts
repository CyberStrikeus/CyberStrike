import {
  firmwareInputSchemas,
  firmwareResultSchemas,
} from "../../domain/firmware/firmwareAnalysis.js";
import type { ToolContract } from "../toolContractTypes.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "../toolEffects.js";
import { FIRMWARE_TOOL_REQUIREMENTS } from "./firmwareToolRequirements.js";

/** Explicit local firmware observations and extraction, backed by caller-supplied tools. */
export const FIRMWARE_TOOL_CONTRACTS = [
  {
    name: "inspect_firmware_regions",
    ...toolContractMetadata("inspect_firmware_regions"),
    kind: "firmware-provider",
    description: `Inspect signature candidates in a local firmware file with ${FIRMWARE_TOOL_REQUIREMENTS.binwalk.requirement}. Returns offsets, reported lengths, descriptions and raw confidence values. Length validation and runtime addresses remain unknown. No extraction or target execution. Linux, caller-supplied tool, util-linux prlimit and procps ps required; 128 MiB input limit, one worker. Adjust analysis_timeout_ms for the analysis wall-clock budget (default 120000); fixed per-process limits are unchanged.`,
    inputSchema: firmwareInputSchemas.inspect_firmware_regions,
    outputSchema: evidenceResultOf(
      firmwareResultSchemas.inspect_firmware_regions,
    ),
    examples: [
      {
        title: "Inspect firmware regions",
        input: { path: "/tmp/firmware.bin" },
      },
    ],
  },
  {
    name: "extract_firmware",
    ...toolContractMetadata("extract_firmware"),
    kind: "firmware-provider",
    description: `Extract caller-selected firmware bytes with ${FIRMWARE_TOOL_REQUIREMENTS.unblob.requirement} into an absent output directory. Returns verified child paths/digests, task derivations, unknown chunks and uncovered selected input ranges, extraction diagnostics and explicit extraction_gaps rows naming unextracted regions, missing extractor dependencies and a continuation_id referencing shared extraction_continuations recovery instructions. Preserves the default sandbox; publishes regular files only. Linux, caller-supplied tool, format-specific extractors, util-linux prlimit and procps ps required. No mounts or extracted-code execution. Select a returned native file with open_binary for Ghidra analysis; decompressed offsets are not original-file addresses.`,
    inputSchema: firmwareInputSchemas.extract_firmware,
    outputSchema: evidenceResultOf(firmwareResultSchemas.extract_firmware),
    examples: [
      {
        title: "Extract selected firmware",
        input: {
          path: "/tmp/firmware.bin",
          output_directory: "/tmp/firmware-output",
          range: { offset: 64, length: 4096 },
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
