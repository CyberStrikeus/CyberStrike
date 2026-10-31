import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { z } from "zod";
import { evidenceInputSchema } from "../../domain/evidenceReference.js";
import { wasmInterfaceSchema } from "../../domain/wasm/wasmInterface.js";
import { toolContractMetadata } from "../toolEffects.js";
import type { ToolContract } from "../toolContractTypes.js";

export const compareWasmInterfacesInputSchema = z.strictObject({
  left: evidenceInputSchema.describe(
    "Exact complete inspect_wasm_artifact Evidence or retained session reference",
  ),
  right: evidenceInputSchema.describe(
    "Exact complete inspect_wasm_artifact Evidence or retained session reference",
  ),
  scope: z
    .enum(["imports", "exports", "both"])
    .describe(
      "Explicit interface selection; static equality does not establish runtime compatibility",
    ),
});
const identity = z.object({
  evidence_id: z.string(),
  artifact: z.object({
    path: z.string(),
    sha256: z.string(),
    bytes: z.int().nonnegative(),
  }),
});
export const wasmInterfaceComparisonSchema = z.object({
  left: identity,
  right: identity,
  scope: z.enum(["imports", "exports", "both"]),
  coverage: z.enum(["complete-within-inputs", "partial", "unknown"]),
  changes: z.array(
    z.object({
      direction: z.enum(["import", "export"]),
      module: z.string().nullable(),
      name: z.string(),
      state: z.enum(["added", "removed", "changed", "unchanged", "unknown"]),
      left: wasmInterfaceSchema.shape.entries,
      right: wasmInterfaceSchema.shape.entries,
      reason: z.string().nullable(),
    }),
  ),
  summary: z.object({
    added: z.number(),
    removed: z.number(),
    changed: z.number(),
    unchanged: z.number(),
    unknown: z.number(),
  }),
  limitations: z.array(z.string()),
});
export const COMPARE_WASM_INTERFACES_CONTRACT = {
  name: "compare_wasm_interfaces",
  ...toolContractMetadata("compare_wasm_interfaces"),
  kind: "application",
  description:
    "Compare typed core WASM import/export names, kinds and exact signatures from two authenticated inspect_wasm_artifact Evidence records. Select imports, exports or both explicitly. MCP references resolve in the current session; CLI references use an explicitly selected --evidence-bundle. Duplicate names, unsupported types and missing historical interface facets remain unknown. Preserve original module digests and every occurrence; no source acquisition, module execution or runtime-compatibility inference.",
  inputSchema: compareWasmInterfacesInputSchema,
  outputSchema: evidenceResultOf(wasmInterfaceComparisonSchema),
  examples: [],
} as const satisfies ToolContract;
