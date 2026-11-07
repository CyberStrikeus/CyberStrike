import { z } from "zod";
import { il2cppMetadataSummaryViewResultSchema } from "../../domain/analysisView/analysisView.js";
import {
  il2cppMetadataSchema,
  inspectIl2cppMetadataInputSchema,
} from "../../domain/il2cpp/il2cppMetadata.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Static IL2CPP metadata is independent of native-analysis providers and Unity installations. */
export const IL2CPP_TOOL_CONTRACTS = [
  {
    name: "inspect_il2cpp_metadata",
    ...toolContractMetadata("inspect_il2cpp_metadata"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect local Unity IL2CPP metadata (24/27/29/31/39), optionally linking a caller-selected 64-bit little-endian Mach-O, PE or ELF binary. Static reading only. Default summary retains complete Evidence; use parent_evidence_id with inspect_analysis_view kind il2cpp-metadata for named collections, indices, fields and paging. Parameters accept method_indices; method_addresses accept addresses and states. Stable row indices are scoped to the metadata digest; native pages also identify the binary. Native states distinguish executable code, observed zero slots (no-body), and unknown owners/relocations. Shared addresses preserve all methods. code_gen_modules pages accept image_indices; summaries omit that table. Type names are C#-like; version27 retains indices with unknown names. generic_instances adds genericMethodTable rows with Il2CppDumper-style names (versions 27/29/31, static CodeRegistration and MetadataRegistration); generic_method_instances pages accept method_indices, addresses and states; summaries count issues, paged as generic_method_issues. Unrequested native counts are null. Static-table links are derived; the x86-64/arm64 executable-byte fallback is inferred and does not verify instruction boundaries. Input guards:256MiB metadata/1GiB binary;64MiB encoded report; one active inspection. Unsupported layouts, pointer encodings and resource limits have typed reasons. Full Evidence remains available with detail complete. Neither static linking nor structural agreement proves runtime behavior or a same-build pair.",
    inputSchema: inspectIl2cppMetadataInputSchema,
    outputSchema: evidenceResultOf(
      z.union([il2cppMetadataSchema, il2cppMetadataSummaryViewResultSchema]),
    ),
    examples: [
      {
        title: "Summarize metadata and retain rows for paging",
        input: {
          path: "/artifacts/Data/Managed/Metadata/global-metadata.dat",
          detail: "summary",
        },
      },
      {
        title: "Link method addresses from a universal macOS binary",
        input: {
          path: "/artifacts/Game.app/Contents/Resources/Data/il2cpp_data/Metadata/global-metadata.dat",
          binary_path:
            "/artifacts/Game.app/Contents/Frameworks/GameAssembly.dylib",
          binary_architecture: "arm64",
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
