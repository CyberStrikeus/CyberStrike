import { analysisViewInputError } from "./analysisViewErrors.js";
import { z } from "zod";
import { uniqueSorted } from "../canonicalOrdering.js";
import { evmInterfaceSchema } from "../evm/evmInterface.js";
import { err, ok } from "../result.js";
import { parseAnalysisViewResult } from "./analysisViewParent.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  ownedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import {
  analysisTextPage,
  analysisTextPageItemSchema,
} from "./analysisViewText.js";

/** Retained inferred candidates or exact text; offsets for text count UTF-16 code units. */
export const evmViewRequestSchema = z.strictObject({
  kind: z.literal("evm"),
  facet: z.enum(["functions", "bytecode_hex", "stdout", "stderr"]),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

export const evmViewItemSchema = z.union([
  evmInterfaceSchema.shape.functions,
  analysisTextPageItemSchema,
]);

/** Complete inferred interface facts without the unrequested hex or duplicated stdout. */
export const evmSummarySchema = z.strictObject({
  artifact: evmInterfaceSchema.shape.artifact,
  bytecode: evmInterfaceSchema.shape.bytecode.omit({ hex: true }),
  evidence_kind: evmInterfaceSchema.shape.evidence_kind,
  functions: evmInterfaceSchema.shape.functions,
  discovery_completeness: evmInterfaceSchema.shape.discovery_completeness,
  runtime_execution: evmInterfaceSchema.shape.runtime_execution,
  diagnostics: evmInterfaceSchema.shape.diagnostics
    .omit({ stdout: true })
    .extend({
      stdout_code_units: z.int().nonnegative(),
    }),
  limitations: evmInterfaceSchema.shape.limitations,
});

/** Select already authenticated producer facts; no interpreter or provider is invoked. */
export const projectEvmInterfaceView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof evmViewRequestSchema>
  >(admitted, "summary", "evm");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "EVM Evidence supports summary and evm views.",
        },
      ]),
    );
  const parsed = parseAnalysisViewResult(evmInterfaceSchema, parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const subject = parent.subject;
  if (
    subject == null ||
    subject.format !== "file" ||
    subject.digest.sha256 !== report.artifact.sha256
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "EVM parent subject must identify the report's carrier format and SHA-256.",
        },
      ]),
    );
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_evm_interface" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: uniqueSorted([...parent.limitations, ...report.limitations]),
    unknowns: [
      "Candidates remain inferred; discovery completeness, bytecode kind, hardfork and deployment authenticity are unknown. Runtime execution was not performed.",
    ],
  };
  if (view.kind === "summary") {
    const { hex: _hex, ...bytecode } = report.bytecode;
    const { stdout, ...diagnostics } = report.diagnostics;
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: {
        artifact: report.artifact,
        bytecode,
        evidence_kind: report.evidence_kind,
        functions: report.functions,
        discovery_completeness: report.discovery_completeness,
        runtime_execution: report.runtime_execution,
        diagnostics: { ...diagnostics, stdout_code_units: stdout.length },
        limitations: report.limitations,
      },
      coverage: completeWithinViewCoverage(
        report.functions.length,
        report.functions.length,
      ),
    });
  }
  if (view.facet === "functions") {
    const item = report.functions.slice(view.offset, view.offset + view.limit);
    return ok({
      kind: "evm" as const,
      view,
      item,
      ...shared,
      coverage: pageViewCoverage(
        view.offset,
        item.length,
        report.functions.length,
      ),
    });
  }
  const text =
    view.facet === "bytecode_hex"
      ? report.bytecode.hex
      : report.diagnostics[view.facet];
  const page = analysisTextPage(text, view.offset, view.limit, view.facet);
  return page.ok
    ? ok({ kind: "evm" as const, view, ...page.value, ...shared })
    : page;
};
