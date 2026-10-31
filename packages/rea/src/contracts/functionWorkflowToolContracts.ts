import { requireOutputSchema } from "./toolOutputSchemaPrimitives.js";
import { jsonObjectSchema } from "../domain/jsonValue.js";
import { analysisDetailSummaryDefaultSchema } from "./analysisDetail.js";
import { enhancedInputSchemas } from "./enhancedInputs.js";
import { TOOL_EXAMPLE_OVERRIDES } from "./toolContractExamples.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import { enhancedOutputSchemas } from "./toolOutputSchemaGroups.js";

type FunctionWorkflowName = "analyze_function" | "inspect_native_api";

/**
 * MCP inputs: the provider input plus analyze_function's delivery detail, which
 * the tool handler separates before any provider call. Composed workflows such
 * as inspect_native_api build provider inputs from enhancedInputSchemas alone.
 */
export const functionWorkflowInputSchemas = {
  analyze_function: enhancedInputSchemas.analyze_function.extend({
    detail: analysisDetailSummaryDefaultSchema,
  }),
  inspect_native_api: enhancedInputSchemas.inspect_native_api,
} as const;

const functionWorkflow = <Name extends FunctionWorkflowName>(
  name: Name,
  description: string,
) => {
  const inputSchema = functionWorkflowInputSchemas[name];
  const outputSchema = requireOutputSchema(enhancedOutputSchemas, name);
  return {
    name,
    ...toolContractMetadata(name),
    description,
    kind: "enhanced",
    requiresActiveTarget: true,
    inputSchema,
    outputSchema,
    examples: [
      {
        title: `Example ${name.replaceAll("_", " ")} request`,
        input: jsonObjectSchema.parse(
          inputSchema.parse(TOOL_EXAMPLE_OVERRIDES[name] ?? {}),
        ),
      },
    ],
  } satisfies ToolContract<Name, typeof inputSchema, typeof outputSchema>;
};

/** Function dossier and native API reconstruction workflow contracts. */
export const FUNCTION_WORKFLOW_TOOL_CONTRACTS = [
  functionWorkflow(
    "analyze_function",
    "Build a dossier for one native function identified by symbol or provider-returned address. Returns identity with complete inclusive analyzed body ranges or explicit unknown, provider-specific pseudocode and assembly, comments, calls, references, referenced strings/names, local CFG blocks, and available native API boundary observations. Ghidra terminal-call assumptions that may cut the analyzed body are reported in limitations with available callee identities. Default detail summary returns a compact dossier (identity, pseudocode size, facet counts, value-flow availability) and retains the complete dossier Evidence in this session; page pseudocode, references, assembly and value-flow through normalized_result.parent_evidence_id with inspect_analysis_view. detail complete returns the full dossier inline.",
  ),
  functionWorkflow(
    "inspect_native_api",
    "Analyze a native API boundary in one function identified by symbol or provider-returned address. Returns confidence, evidence, jump-table dispatch/data/case mappings, separately evidenced default targets, unsupported branches, and residual unknowns. Null case values mean unresolved cases, never a known default.",
  ),
] as const satisfies readonly ToolContract[];
