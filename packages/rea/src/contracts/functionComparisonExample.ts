import { enhancedInputSchemas } from "./enhancedInputs.js";
import { createEvidence } from "../domain/evidence.js";
import { jsonValueSchema } from "../domain/jsonValue.js";

const dossier = (text: string) =>
  jsonValueSchema.parse({
    procedure: {
      address: "0x1000",
      name: "main",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "imported" as const,
      },
      classification: null,
      body: {
        available: false,
        reason: "The fixture omits function-body extent observations.",
      },
      signature: "int main(void)",
      locals: [],
    },
    pseudocode: text,
    assembly: ["ret"],
    comments: [],
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    basic_blocks: [{ start: "0x1000", end: "0x1001", successors: [] }],
    native_api: null,
    native_value_flow: null,
    facet_availability: {
      pseudocode: { available: true },
      assembly: { available: true },
      comments: { available: true },
      callers: { available: true },
      callees: { available: true },
      references: { available: true },
      strings_names: { available: true },
      cfg: { available: true },
    },
    limitations: ["The fixture omits native API and value-flow observations."],
  });

const observe = (digit: string, text: string) =>
  createEvidence(
    {
      path: `/tmp/function-${digit}`,
      sha256: digit.repeat(64),
      format: "mach-o",
    },
    {
      id: "rea-workflow",
      name: "REA composed investigation workflow",
      version: "1",
    },
    {
      operation: "analyze_function",
      parameters: enhancedInputSchemas.analyze_function.parse({
        procedure: "main",
      }),
      result: dossier(text),
      confidence: "derived",
      authority: "shipped-artifact",
      relationshipCoverage: { status: "complete" },
    },
  );

/** Canonical explicit function pair used in public contract examples. */
export const FUNCTION_COMPARISON_EXAMPLE = {
  left: observe("0", "return 0;"),
  right: observe("1", "return 1;"),
} as const;
