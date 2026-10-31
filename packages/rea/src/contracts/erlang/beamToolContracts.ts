import {
  inspectErlangBeamInputSchema,
  erlangBeamSchema,
} from "../../domain/erlang/beam.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { analysisDetailOutputSchemaOf } from "../analysisDetail.js";
import { z } from "zod";
import {
  erlangBeamSummaryViewResultSchema,
  erlangBeamTableViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import {
  erlangBeamCompleteDeliveryShape,
  erlangBeamSummaryDeliveryShape,
} from "../../domain/analysisView/erlangBeamView.js";

/** Delivery selection does not change provider inputs or complete Evidence identity. */
export const inspectErlangBeamRequestSchema = z
  .discriminatedUnion("detail", [
    inspectErlangBeamInputSchema.extend(erlangBeamCompleteDeliveryShape),
    inspectErlangBeamInputSchema.extend(erlangBeamSummaryDeliveryShape),
  ])
  .meta({ "x-rea-root-discriminator": "detail" });

/** Static BEAM inspection is independent of active native-analysis providers. */
export const ERLANG_BEAM_TOOL_CONTRACTS = [
  {
    name: "inspect_erlang_beam",
    ...toolContractMetadata("inspect_erlang_beam"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect one explicit local Erlang BEAM IFF container without executing bytecode or installing Erlang. Returns form/chunk byte ranges and payload SHA-256, atoms, export/import/lambda tables with resolved atom names, and the Code header. Complete output is the default. detail summary retains complete Evidence and returns module/header/counts; include a beam view for selected atoms/exports/imports/lambdas/chunks in the first call, then page retained or offline facts with inspect_analysis_view. Exact names/indices/fields select facts; import modules intersects function names. Same-name arities survive under parent-and-collection-scoped source_index; atom and lambda indexes retain their original meaning. Missing tables stay null in counts; unresolved names stay null and runtime absence remains unknown. Reads a stable regular file; malformed/truncated input and exhausted parser budgets return no partial success. Portable on supported Node hosts; no BEAM emulator required.",
    inputSchema: inspectErlangBeamRequestSchema,
    outputSchema: analysisDetailOutputSchemaOf(
      erlangBeamSchema,
      z.union([
        erlangBeamSummaryViewResultSchema,
        erlangBeamTableViewResultSchema,
      ]),
    ),
    examples: [
      {
        title: "Return selected exports and retain the complete BEAM report",
        input: {
          path: "/artifacts/app.beam",
          detail: "summary",
          view: {
            kind: "beam",
            collection: "exports",
            names: ["module_info"],
            fields: ["function_index", "function", "arity", "label"],
          },
        },
      },
      {
        title: "Inspect the complete BEAM structure",
        input: { path: "/artifacts/app.beam" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
