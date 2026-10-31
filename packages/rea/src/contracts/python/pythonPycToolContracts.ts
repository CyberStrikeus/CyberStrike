import {
  inspectPythonPycInputSchema,
  pythonPycSchema,
} from "../../domain/python/pythonPyc.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { analysisDetailOutputSchemaOf } from "../analysisDetail.js";
import { z } from "zod";
import {
  pythonPycSummaryViewResultSchema,
  pythonPycCodeObjectsViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import {
  pythonPycCompleteDeliveryShape,
  pythonPycSummaryDeliveryShape,
} from "../../domain/analysisView/pythonPycView.js";

/** Delivery selection does not change provider inputs or complete Evidence identity. */
export const inspectPythonPycRequestSchema = z
  .discriminatedUnion("detail", [
    inspectPythonPycInputSchema.extend(pythonPycCompleteDeliveryShape),
    inspectPythonPycInputSchema.extend(pythonPycSummaryDeliveryShape),
  ])
  .meta({ "x-rea-root-discriminator": "detail" });

/** Static CPython pyc inspection is independent of active native-analysis providers. */
export const PYTHON_PYC_TOOL_CONTRACTS = [
  {
    name: "inspect_python_pyc",
    ...toolContractMetadata("inspect_python_pyc"),
    kind: "artifact-provider",
    requiresActiveTarget: true,
    description:
      "Inspect one explicit local CPython 3.7–3.13 .pyc file with a supported 16-byte header without executing bytecode, invoking CPython or recovering source. Returns the header (magic, pinned python_version, PEP 552 flags, source hash or mtime/size), the top-level code object with nested functions, names, const summaries, and bytecode length/SHA-256. Complete output is the default. detail summary retains the complete Evidence and returns header/coverage. Include an optional python-pyc code_objects view to return selected names/indices/fields in the first call; inspect_analysis_view pages the same retained source later. Every matching display name survives under its parent-scoped source_index; nested_code represents code-constant references, not runtime calls. Marshal is walked with object, depth and string budgets; unsupported magics/layouts, truncated streams and exhausted budgets return no partial success. A decoded header is not proof the matching .py is present. Portable on supported Node hosts; no Python installation required.",
    inputSchema: inspectPythonPycRequestSchema,
    outputSchema: analysisDetailOutputSchemaOf(
      pythonPycSchema,
      z.union([
        pythonPycSummaryViewResultSchema,
        pythonPycCodeObjectsViewResultSchema,
      ]),
    ),
    examples: [
      {
        title:
          "Return selected function facts immediately and retain the complete report",
        input: {
          path: "/artifacts/module.pyc",
          detail: "summary",
          view: {
            kind: "python-pyc",
            collection: "code_objects",
            names: ["parse_args"],
            fields: ["name", "qualname", "bytecode", "nested_code"],
          },
        },
      },
      {
        title: "Inspect a CPython 3.12 pyc header and nested code objects",
        input: { path: "/artifacts/module.pyc" },
      },
      {
        title:
          "Retain the complete pyc report and return only its header and coverage",
        input: { path: "/artifacts/module.pyc", detail: "summary" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
