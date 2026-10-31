import type { FunctionDossier } from "../../domain/native/functionDossier.js";
import {
  nativeApiInspectionResultSchema,
  type NativeApiBoundary,
  type NativeApiInspectionResult,
} from "../../domain/native/nativeApiBoundary.js";

const unavailableBoundary = (): NativeApiBoundary => ({
  available: false,
  reason:
    "The selected provider did not expose a structured native API boundary model.",
  residual_unknowns: [
    "What are the function's return and parameter boundary types?",
    "Does this function dispatch through a jump table with recoverable data addresses?",
  ],
});

/** Project one analyzed-function dossier into inspectable native API substeps. */
export const projectNativeApiInspection = (
  dossier: FunctionDossier,
): NativeApiInspectionResult => {
  const boundary = dossier.native_api ?? unavailableBoundary();
  const unsupportedBranches = boundary.available
    ? []
    : ["structured-boundary-types", "jump-table-data-mapping"];
  const residualUnknowns = boundary.available
    ? availableResidualUnknowns(boundary)
    : boundary.residual_unknowns;
  return nativeApiInspectionResultSchema.parse({
    procedure: {
      address: dossier.procedure.address,
      name: dossier.procedure.name,
    },
    boundary,
    substeps: [
      {
        operation: "analyze_function",
        status: "completed",
        observations: [
          "provider function dossier",
          "provider pseudocode classification",
          "provider control-flow observations",
        ],
      },
      {
        operation: "project_native_api_boundary",
        status: boundary.available ? "completed" : "unsupported",
        observations: boundary.available
          ? [
              "return and parameter boundary types",
              "confidence and inference evidence",
              "jump-table dispatch, data, and target addresses",
            ]
          : [boundary.reason],
      },
      {
        operation: "preserve_residual_unknowns",
        status: "completed",
        observations:
          residualUnknowns.length === 0
            ? ["no additional structured-boundary unknowns"]
            : residualUnknowns,
      },
    ],
    unsupported_branches: unsupportedBranches,
    residual_unknowns: residualUnknowns,
  });
};

const availableResidualUnknowns = (
  boundary: Extract<NativeApiBoundary, { readonly available: true }>,
): readonly string[] => {
  const unknowns: string[] = [];
  for (const table of boundary.jump_tables) {
    if (table.default_targets.length === 0)
      unknowns.push(
        `Which default or out-of-range path, if any, belongs to the dispatch at ${table.dispatch_address}?`,
      );
    if (table.mappings.length === 0)
      unknowns.push(
        `Which case values and targets belong to the dispatch at ${table.dispatch_address}?`,
      );
    if (table.data_sources.length === 0)
      unknowns.push(
        `What backing data address produced the jump table dispatched at ${table.dispatch_address}?`,
      );
    if (
      table.data_sources.some(
        ({ entry_count: count, entry_size_bytes: size }) =>
          count === null || size === null,
      )
    )
      unknowns.push(
        `What are the exact entry size and count for candidate jump-table data dispatched at ${table.dispatch_address}?`,
      );
    if (table.mappings.some(({ case_value: value }) => value === null))
      unknowns.push(
        `Which source-level case values correspond to every target dispatched at ${table.dispatch_address}?`,
      );
  }
  for (const value of [boundary.return_type, ...boundary.parameters]) {
    if (value.confidence === "low")
      unknowns.push(
        `Can the inferred ${value.role} type ${value.data_type} be confirmed with imported metadata or an ABI probe?`,
      );
  }
  return [...new Set(unknowns)];
};
