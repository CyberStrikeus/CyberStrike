import {
  modelArtifactViewRequestSchema,
  modelTypeRowSchema,
} from "../model/modelArtifactQuery.js";
import { z } from "zod";
import {
  modelArtifactSchema,
  modelArtifactObjectSchema,
  modelMetadataSchema,
  modelTensorSchema,
  modelSourceSchema,
  type ModelArtifact,
} from "../model/modelArtifact.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import { isImmutableJsonSnapshot } from "../immutableJson.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  boundedViewMessages,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

const HEADLINE_TEXT_LIMIT = 512;

export const modelArtifactSummarySchema = modelArtifactObjectSchema
  .omit({ metadata: true, tensors: true, totals: true })
  .extend({
    totals: modelArtifactObjectSchema.shape.totals.omit({ by_type: true }),
    counts: z.strictObject({
      metadata: z.number().int().nonnegative(),
      tensors: z.number().int().nonnegative(),
      types: z.number().int().nonnegative(),
    }),
    headlines: z.array(
      modelMetadataSchema.omit({
        source_offset: true,
        source_length: true,
        json_pointer: true,
      }),
    ),
    chat_template_present: z.boolean(),
  });

const summarizeModel = (
  report: ModelArtifact,
): z.infer<typeof modelArtifactSummarySchema> => {
  const {
    tensors,
    metadata,
    totals: { by_type, ...totals },
    ...identity
  } = report;
  const headlineKeys = new Set([
    "general.architecture",
    "general.name",
    "general.file_type",
    "tokenizer.ggml.model",
    "format",
  ]);
  const architecture = metadata.find(
    (row) => row.key === "general.architecture",
  )?.value;
  if (
    typeof architecture === "string" &&
    architecture.length <= HEADLINE_TEXT_LIMIT - ".context_length".length
  )
    headlineKeys.add(`${architecture}.context_length`);
  return {
    ...identity,
    totals,
    counts: {
      tensors: tensors.length,
      metadata: metadata.length,
      types: by_type.length,
    },
    headlines: metadata
      .filter(
        (row) =>
          headlineKeys.has(row.key) &&
          row.element_count === null &&
          row.element_type === null &&
          row.type.length <= HEADLINE_TEXT_LIMIT &&
          (row.value === null ||
            typeof row.value === "boolean" ||
            typeof row.value === "number" ||
            (typeof row.value === "string" &&
              row.value.length <= HEADLINE_TEXT_LIMIT)),
      )
      .map(
        ({
          source_offset: _offset,
          source_length: _length,
          json_pointer: _pointer,
          ...row
        }) => row,
      ),
    chat_template_present: metadata.some(
      (row) =>
        row.type === "STRING" &&
        typeof row.value === "string" &&
        (row.key === "tokenizer.chat_template" ||
          row.key.startsWith("tokenizer.chat_template.")),
    ),
  };
};
const modelContextSchema = modelArtifactSummarySchema.omit({
  artifact: true,
  coverage: true,
  limitations: true,
});

export const modelArtifactViewItemsSchema = z.union([
  z.array(modelTypeRowSchema.partial().required({ index: true })),
  z.array(modelTensorSchema.partial().required({ index: true })),
  z.array(modelMetadataSchema.partial().required({ index: true })),
]);
export const modelArtifactViewContextSchema = z.strictObject({
  source: modelSourceSchema,
  model: modelContextSchema,
  source_coverage: modelArtifactObjectSchema.shape.coverage,
});

type Checked = {
  report: ModelArtifact;
  summary: z.infer<typeof modelArtifactSummarySchema>;
  model: z.infer<typeof modelContextSchema>;
  names: Map<string, number>;
  keys: Map<string, number>;
  typeRows: z.infer<typeof modelTypeRowSchema>[];
  types: Map<string, number>;
};
const checked = new WeakMap<object, Checked>();
const readReport = createAnalysisViewResultReader(modelArtifactSchema);
const read = (parent: AnalysisViewParent): Result<Checked, AnalysisError> => {
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const reusable = isImmutableJsonSnapshot(report);
  const cached = reusable ? checked.get(report) : undefined;
  const subject = parent.subject;
  if (subject != null && subject.digest.sha256 !== report.artifact.sha256)
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Model full-file subject does not match its recorded artifact",
        },
      ]),
    );
  if (cached !== undefined) return ok(cached);
  const summary = summarizeModel(report);
  const {
    artifact: _artifact,
    coverage: _coverage,
    limitations: _limitations,
    ...model
  } = summary;
  const value = {
    report,
    summary,
    model,
    typeRows: report.totals.by_type.map((row, index) => ({ index, ...row })),
    types: new Map(
      report.totals.by_type.map((row, index) => [row.type, index]),
    ),
    names: new Map(report.tensors.map((row) => [row.name, row.index])),
    keys: new Map(report.metadata.map((row) => [row.key, row.index])),
  };
  if (reusable) checked.set(report, value);
  return ok(value);
};

/** Historical pages never reopen weights or report a scoped header digest as full-file identity. */
export const projectModelArtifactView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (view.kind !== "summary" && view.kind !== "model-artifact")
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Model Evidence supports summary and model-artifact metadata/tensor/type pages",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof modelArtifactViewRequestSchema>
  >(view, "summary", "model-artifact");
  const parsed = read(parent);
  if (!parsed.ok) return parsed;
  const {
    report,
    summary,
    model,
    names,
    keys,
    types: typeIndices,
    typeRows,
  } = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_model_artifact" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: boundedViewMessages(
      parent.limitations,
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "Tensor values, runtime execution and inference quality were not inspected.",
      ...(report.artifact.sha256 === null
        ? [
            "Full-file content identity is unknown; header_sha256 commits only to declarations.",
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
        ...summary,
        limitations: boundedViewMessages(
          summary.limitations,
          parent.evidenceId,
          "limitations",
        ),
      },
      coverage: completeWithinViewCoverage(1, 1),
    });
  const rows =
    view.collection === "tensors"
      ? report.tensors
      : view.collection === "metadata"
        ? report.metadata
        : typeRows;
  const selectedNames =
    view.collection === "tensors"
      ? view.names
      : view.collection === "metadata"
        ? view.keys
        : view.types;
  const lookup =
    view.collection === "tensors"
      ? names
      : view.collection === "metadata"
        ? keys
        : typeIndices;
  const indices =
    view.indices === undefined ? undefined : new Set(view.indices);
  const types =
    view.collection === "tensors" && view.types !== undefined
      ? new Set(view.types)
      : undefined;
  const storageStates =
    view.collection === "tensors" && view.storage_validation !== undefined
      ? new Set(view.storage_validation)
      : undefined;
  let selected: number[] | undefined;
  if (selectedNames !== undefined)
    selected = [
      ...new Set(
        selectedNames.flatMap((name) => {
          const index = lookup.get(name);
          return index === undefined ? [] : [index];
        }),
      ),
    ].sort((a, b) => a - b);
  else if (indices !== undefined)
    selected = [...indices]
      .filter((index) => index < rows.length)
      .sort((a, b) => a - b);
  if (
    indices !== undefined ||
    types !== undefined ||
    storageStates !== undefined
  )
    selected = (selected ?? rows.map((row) => row.index)).filter((index) => {
      const row = rows[index]!;
      return (
        (indices === undefined || indices.has(index)) &&
        (types === undefined || types.has(row.type)) &&
        (storageStates === undefined ||
          ("storage_validation" in row &&
            storageStates.has(row.storage_validation)))
      );
    });
  const total = selected?.length ?? rows.length;
  const pageIndices =
    selected === undefined
      ? Array.from(
          {
            length: Math.max(
              0,
              Math.min(view.limit, rows.length - view.offset),
            ),
          },
          (_, index) => view.offset + index,
        )
      : selected.slice(view.offset, view.offset + view.limit);
  const fields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  const items = pageIndices.map((index) => {
    const row = rows[index]!;
    const result: Record<string, JsonValue> = { index };
    for (const [name, value] of Object.entries(row))
      if (fields === undefined || fields.has(name)) result[name] = value;
    return result;
  });
  return ok({
    kind: "model-artifact" as const,
    view,
    ...shared,
    source: report.artifact,
    model,
    source_coverage: report.coverage,
    items: modelArtifactViewItemsSchema.parse(items),
    coverage: pageViewCoverage(view.offset, items.length, total),
  });
};
