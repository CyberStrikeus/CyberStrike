import { analysisViewInputError } from "./analysisViewErrors.js";
import { z } from "zod";
import { flutterResultSchemas } from "../flutter/flutterBuildAnalysis.js";
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

const aotSchema = flutterResultSchemas.inspect_dart_aot;

/** Snapshot identity and original coverage, without unrelated string inventories. */
export const dartAotSummarySchema = aotSchema.extend({
  string_pool: aotSchema.shape.string_pool
    .omit({ package_uris: true, dart_uris: true, class_like_tokens: true })
    .extend({
      returned_counts: z.strictObject({
        package_uris: z.int().nonnegative(),
        dart_uris: z.int().nonnegative(),
        class_like_tokens: z.int().nonnegative(),
      }),
    }),
});

/** Pages of the producer-returned strings, preserving original order and scope. */
export const dartAotViewRequestSchema = z.strictObject({
  kind: z.literal("dart-aot"),
  collection: z.enum(["package_uris", "dart_uris", "class_like_tokens"]),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

export const dartAotViewContextSchema = z.strictObject({
  abi: aotSchema.shape.abi,
  libapp: aotSchema.shape.libapp,
  source_coverage: aotSchema.shape.coverage,
  string_pool: dartAotSummarySchema.shape.string_pool,
});

/** Reuse authenticated AOT Evidence without opening the APK or rescanning its ELF. */
export const projectDartAotView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof dartAotViewRequestSchema>
  >(admitted, "summary", "dart-aot");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "Dart AOT Evidence supports summary and string-pool pages.",
        },
      ]),
    );
  const parsed = parseAnalysisViewResult(aotSchema, parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const { package_uris, dart_uris, class_like_tokens, ...pool } =
    report.string_pool;
  const string_pool = {
    ...pool,
    returned_counts: {
      package_uris: package_uris.length,
      dart_uris: dart_uris.length,
      class_like_tokens: class_like_tokens.length,
    },
  };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_dart_aot" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.target.path, sha256: report.target.sha256 },
    limitations: [...parent.limitations],
    unknowns: [
      "String-pool entries are byte-pattern observations, not recovered typed classes or functions.",
      "Counts ending in _at_least remain lower bounds; exhausting returned strings does not establish a complete snapshot inventory.",
      ...(parent.subject == null
        ? [
            "The parent has no recorded subject; its normalized target identity cannot be cross-checked against a subject digest.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: { ...report, string_pool },
      coverage: completeWithinViewCoverage(1, 1),
    });
  const collection = report.string_pool[view.collection];
  const items = collection.slice(view.offset, view.offset + view.limit);
  return ok({
    kind: "dart-aot" as const,
    view,
    ...shared,
    items,
    abi: report.abi,
    libapp: report.libapp,
    source_coverage: report.coverage,
    string_pool,
    coverage: pageViewCoverage(view.offset, items.length, collection.length),
  });
};
