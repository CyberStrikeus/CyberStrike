import { z } from "zod";
import {
  inspectGpuCodeObjectsInputSchema,
  gpuCodeObjectsSchema,
} from "../../domain/gpu/gpuCodeObjects.js";
import {
  gpuCodeObjectsSummaryViewResultSchema,
  gpuCodeObjectsPageViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
export const GPU_TOOL_CONTRACTS = [
  {
    name: "inspect_gpu_code_objects",
    ...toolContractMetadata("inspect_gpu_code_objects"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect static CUDA/HIP GPU code objects in local ELF/PE hosts, CUDA fatbins, CUBIN, PTX and Clang HIP bundles (CUDA LZ4/Zstd and CCOB v1/v2/v3 zlib/Zstd). Default inventory reads directories; full-file SHA-256 always streams every byte. analysis kernels decodes only selected object_ids/targets (object_ids require expected_sha256 from their inventory), retaining all inventory rows and explicit partial/unknown states. Reports PTX virtual registers, CUBIN physical registers/nv.info parameters/shared memory and AMDGPU MessagePack kernel declarations separately. No GPU tools, target execution, network, SASS disassembly or host launch correlation. Unsupported CUDA compression retains encoded locations. Default summary retains complete Evidence; optional view returns a selected targets/objects/kernels page or PTX text page in this call. inspect_analysis_view kind gpu-code-objects reuses retained facts without reopening files; PTX text uses UTF-16 code-unit pages. Object IDs are positional within artifact.sha256. One active inspection; 128 MiB/object, 512 MiB decoded work, 16 MiB retained facts. Full Evidence includes selected PTX text artifacts with SHA-256 and encoded/decoded provenance.",
    inputSchema: inspectGpuCodeObjectsInputSchema,
    outputSchema: evidenceResultOf(
      z.union([
        gpuCodeObjectsSchema,
        gpuCodeObjectsSummaryViewResultSchema,
        gpuCodeObjectsPageViewResultSchema,
      ]),
    ),
    examples: [
      {
        title: "List embedded GPU targets before selecting payloads",
        input: {
          path: "/artifacts/application.so",
          analysis: "inventory",
          detail: "summary",
          view: { collection: "targets" },
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
