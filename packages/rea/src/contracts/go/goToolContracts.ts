import {
  goBinarySchema,
  inspectGoBinaryInputSchema,
} from "../../domain/go/goBinary.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { analysisDetailOutputSchemaOf } from "../analysisDetail.js";
import { goBinarySummaryViewResultSchema } from "../../domain/analysisView/analysisView.js";

/** Static Go metadata is independent of active native-analysis providers and host toolchains. */
export const GO_TOOL_CONTRACTS = [
  {
    name: "inspect_go_binary",
    ...toolContractMetadata("inspect_go_binary"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect embedded Go compiler version, main module, dependency/replacement versions and build settings in an explicit local ELF, PE or thin Mach-O image, or the slice of a universal Mach-O named by architecture (read without lipo; artifact stays the universal file, selected_slice records the slice and source ranges stay file offsets). Default detail complete returns original artifact SHA-256, exact build-info source ranges, raw framed module bytes and unparsed module-text lines inline as observed Evidence. Explicit detail summary retains the same complete parent and returns compiler/main-module identity, counts, source ranges and parent_evidence_id. Query retained rows through inspect_analysis_view kind go, collection dependencies or settings; select exact dependency paths or setting keys, indices, fields and pagination. Rows always retain their original index scoped to the parent Evidence; empty filters select none. Runtime dependency completeness remains unknown. Supports inline and historical pointer encodings without installing Go, opening a disassembler, executing the target, writing temporary files or accessing the network. Missing metadata is reported as unknown, not proof that an image is not Go. Does not recover functions, source mappings, types or runtime behavior. Resource guards bound files to 256 MiB and charge each distinct build-info search span in full against a cumulative 256 MiB header-search budget, with partial overlaps charged separately; they also bound aggregate embedded strings to 1 MiB, structural table decoding to 16 MiB and complete inline metadata to 8 MiB; malformed, unsupported and oversized inputs receive typed failures rather than partial success.",
    inputSchema: inspectGoBinaryInputSchema,
    outputSchema: analysisDetailOutputSchemaOf(
      goBinarySchema,
      goBinarySummaryViewResultSchema,
    ),
    examples: [
      {
        title: "Inspect embedded build provenance",
        input: { path: "/artifacts/application" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
