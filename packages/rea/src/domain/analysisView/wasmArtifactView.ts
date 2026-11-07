import { analysisViewInputError } from "./analysisViewErrors.js";
import { z } from "zod";
import { uniqueSorted } from "../canonicalOrdering.js";
import { err, ok } from "../result.js";
import { parseAnalysisViewResult } from "./analysisViewParent.js";
import {
  wasmArtifactSchema,
  wasmArtifactMatchesSubject,
} from "../wasm/wasmArtifact.js";
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

/** Source forms and text from completed WASM Evidence; this never executes a VM. */
export const wasmViewRequestSchema = z.strictObject({
  kind: z.literal("wasm"),
  facet: z.enum([
    "sections",
    "imports",
    "exports",
    "candidates",
    "glue",
    "wat",
    "headers",
    "details",
    "tool_profile",
  ]),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

export const wasmViewItemSchema = z.union([
  wasmArtifactSchema.shape.sections,
  wasmArtifactSchema.shape.imports,
  wasmArtifactSchema.shape.candidates,
  wasmArtifactSchema.shape.glue,
  wasmArtifactSchema.shape.tool_profile,
  analysisTextPageItemSchema,
]);

/** Counts are observations of the completed producer, independent of runtime semantics. */
export const wasmSummarySchema = z.strictObject({
  bytes: wasmArtifactSchema.shape.artifact.shape.bytes,
  validation: wasmArtifactSchema.shape.validation,
  debug_name_metadata: wasmArtifactSchema.shape.debug_name_metadata,
  custom_section_warnings: wasmArtifactSchema.shape.custom_section_warnings,
  available_counts: z.strictObject({
    sections: z.int().nonnegative(),
    imports: z.int().nonnegative(),
    exports: z.int().nonnegative(),
    candidates: z.int().nonnegative(),
    glue: z.int().nonnegative(),
  }),
  wat: wasmArtifactSchema.shape.wat
    .omit({ text: true })
    .extend({ code_units: z.int().nonnegative() }),
  tool_profile: wasmArtifactSchema.shape.tool_profile,
  runtime_execution: wasmArtifactSchema.shape.runtime_execution,
  network_fetch: wasmArtifactSchema.shape.network_fetch,
  limitation_count: z.int().nonnegative(),
});

/** Read the exact retained WABT forms with source identity and explicit uncertainty. */
export const projectWasmArtifactView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof wasmViewRequestSchema>
  >(admitted, "summary", "wasm");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "WASM Evidence supports summary and wasm views.",
        },
      ]),
    );
  const parsed = parseAnalysisViewResult(wasmArtifactSchema, parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  if (
    !wasmArtifactMatchesSubject(
      report.artifact,
      parent.subject == null
        ? null
        : {
            sha256: parent.subject.digest.sha256,
            format: parent.subject.format,
          },
    )
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "WASM parent Evidence subject must identify the report's file format and SHA-256.",
        },
      ]),
    );
  const limitations = uniqueSorted([
    ...parent.limitations,
    ...report.limitations,
  ]);
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_wasm_artifact" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations,
    unknowns: [
      "Decoded WAT is not original source. Runtime behavior and network acquisition were not performed.",
      ...(report.glue.some((glue) => glue.parse_status !== "complete")
        ? [
            "Selected glue parsing is incomplete; unmatched references do not establish absence.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: {
        bytes: report.artifact.bytes,
        validation: report.validation,
        debug_name_metadata: report.debug_name_metadata,
        custom_section_warnings: report.custom_section_warnings,
        available_counts: {
          sections: report.sections.length,
          imports: report.imports.length,
          exports: report.exports.length,
          candidates: report.candidates.length,
          glue: report.glue.length,
        },
        wat: {
          sha256: report.wat.sha256,
          representation: report.wat.representation,
          code_units: report.wat.text.length,
        },
        tool_profile: report.tool_profile,
        runtime_execution: report.runtime_execution,
        network_fetch: report.network_fetch,
        limitation_count: limitations.length,
      },
      coverage: completeWithinViewCoverage(
        report.sections.length + report.imports.length + report.exports.length,
        report.sections.length + report.imports.length + report.exports.length,
      ),
    });
  if (view.facet === "tool_profile") {
    if (view.offset !== 0)
      return err(
        analysisViewInputError([
          {
            path: ["view", "offset"],
            reason: "invalid_value",
            message: "Singleton tool_profile requires offset 0.",
          },
        ]),
      );
    return ok({
      kind: "wasm" as const,
      view,
      item: report.tool_profile,
      coverage: completeWithinViewCoverage(1, 1),
      ...shared,
    });
  }
  if (
    view.facet === "wat" ||
    view.facet === "headers" ||
    view.facet === "details"
  ) {
    const text = view.facet === "wat" ? report.wat.text : report[view.facet];
    const page = analysisTextPage(text, view.offset, view.limit, view.facet);
    return page.ok
      ? ok({ kind: "wasm" as const, view, ...page.value, ...shared })
      : page;
  }
  const rows = report[view.facet];
  const item = rows.slice(view.offset, view.offset + view.limit);
  return ok({
    kind: "wasm" as const,
    view,
    item,
    coverage: pageViewCoverage(view.offset, item.length, rows.length),
    ...shared,
  });
};
