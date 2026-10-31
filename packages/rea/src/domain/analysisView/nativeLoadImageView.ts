import { z } from "zod";
import {
  nativeLoadImageCheckSchema,
  nativeLoadImageObservationSchema,
  nativeLoadImageSchema,
  nativeUnsupportedLoadImageSchema,
  nativeDosLoadImageSchema,
  nativeRawLoadImageSchema,
  nativeDolLoadImageSchema,
} from "../native/nativeLoadImage.js";
import { nativeAddressObservationSchema } from "../native/nativeAddress.js";
import { jsonValueSchema } from "../jsonValue.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  ownedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

const observation = nativeLoadImageObservationSchema.shape;
const rows = {
  source_files: observation.source_files.element,
  mappings: observation.mappings.element,
  relocations: observation.relocations.element,
  entry_points: z.strictObject({ address: nativeAddressObservationSchema }),
  entry_context: observation.entry_context.element,
  checks: nativeLoadImageCheckSchema,
  sections: nativeDolLoadImageSchema.shape.sections.element,
};
const defaultFields: Partial<Record<keyof typeof rows, readonly string[]>> = {
  relocations: rows.relocations
    .pick({
      address: true,
      segment: true,
      offset: true,
      status: true,
      type: true,
      values: true,
    })
    .keyof().options,
  checks: rows.checks
    .pick({ name: true, matched: true, file_offset: true, address: true })
    .keyof().options,
};
const selection = {
  kind: z.literal("native-load-image"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
  indices: z.array(z.int().nonnegative()).optional(),
};
const request = <Name extends keyof typeof rows>(name: Name) =>
  z.strictObject({
    ...selection,
    collection: z.literal(name),
    fields: z
      .array(rows[name].keyof())
      .optional()
      .describe(
        name === "relocations"
          ? "Defaults to address, segment, offset, status, type and values. Select original_bytes_hex or memory_bytes_hex explicitly."
          : name === "checks"
            ? "Defaults to name, matched, file_offset and address. Select expected or observed explicitly; these can contain complete comparison inventories."
            : "Omit to return every recorded field in each selected row.",
      ),
  });

/** Pages retain producer order and original indices within the parent Evidence. */
export const nativeLoadImageViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    request("source_files"),
    request("mappings"),
    request("relocations"),
    request("entry_points"),
    request("entry_context"),
    request("checks"),
    request("sections"),
  ],
);
const items = <Name extends keyof typeof rows>(name: Name) => {
  const records = z.array(
    z.strictObject({
      source_index: z.int().nonnegative(),
      record: rows[name].partial(),
    }),
  );
  return z.strictObject({
    collection: z.literal(name),
    rows:
      name === "checks" || name === "sections" ? records.nullable() : records,
  });
};
export const nativeLoadImageViewItemsSchema = z.discriminatedUnion(
  "collection",
  [
    items("source_files"),
    items("mappings"),
    items("relocations"),
    items("entry_points"),
    items("entry_context"),
    items("checks"),
    items("sections"),
  ],
);

// Keep the format owner's verification states and small identity facts. A
// measured unsupported format must never become a verified empty check set.
export const nativeLoadImageSummarySchema = z.strictObject({
  verification: z.union([
    nativeUnsupportedLoadImageSchema.omit({
      observations: true,
      limitations: true,
    }),
    nativeDosLoadImageSchema.omit({
      observations: true,
      limitations: true,
      checks: true,
    }),
    nativeRawLoadImageSchema.omit({
      observations: true,
      limitations: true,
      checks: true,
    }),
    nativeDolLoadImageSchema.omit({
      observations: true,
      limitations: true,
      checks: true,
      sections: true,
    }),
  ]),
  observation: nativeLoadImageObservationSchema.pick({
    executable_format: true,
    language_id: true,
    compiler_spec_id: true,
    image_base: true,
    default_address_space: true,
  }),
  counts: z.strictObject({
    source_files: z.int().nonnegative(),
    mappings: z.int().nonnegative(),
    relocations: z.int().nonnegative(),
    entry_points: z.int().nonnegative(),
    entry_context: z.int().nonnegative(),
    metadata_recovery: z.int().nonnegative().nullable(),
    checks: z.int().nonnegative().nullable(),
    sections: z.int().nonnegative().nullable(),
  }),
});

const readReport = createAnalysisViewResultReader(nativeLoadImageSchema);

type Row = z.output<(typeof rows)[keyof typeof rows]>;
type PageRequest = z.output<typeof nativeLoadImageViewRequestSchema>;

/** Exact source indices need no inventory scan or persistent lookup index. */
const selectRows = (source: readonly (Row | string)[], view: PageRequest) => {
  const selectedFields = view.fields ?? defaultFields[view.collection];
  const fields =
    selectedFields === undefined ? undefined : new Set<string>(selectedFields);
  const project = (value: Row | string, source_index: number) => {
    const record = typeof value === "string" ? { address: value } : value;
    return {
      source_index,
      record:
        fields === undefined
          ? record
          : Object.fromEntries(
              Object.entries(record).filter(([key]) => fields.has(key)),
            ),
    };
  };
  if (view.indices === undefined)
    return {
      total: source.length,
      rows: source
        .slice(view.offset, view.offset + view.limit)
        .map((value, index) => project(value, view.offset + index)),
    };
  const indices = [...new Set(view.indices)]
    .filter((index) => index < source.length)
    .sort((left, right) => left - right);
  return {
    total: indices.length,
    // The format owner validated a dense collection; these indices are in range.
    rows: indices
      .slice(view.offset, view.offset + view.limit)
      .map((index) => project(source[index]!, index)),
  };
};

/** Query the owner's parsed historical observations without reopening the target. */
export const projectNativeLoadImageView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof nativeLoadImageViewRequestSchema>
  >(admitted, "summary", "native-load-image");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Native load-image Evidence supports summary and native-load-image views.",
        },
      ]),
    );
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const observed = report.observations;
  const { observations: _, limitations, ...verification } = report;
  const {
    checks: __,
    sections: ___,
    ...smallVerification
  } = {
    checks: undefined,
    sections: undefined,
    ...verification,
  };
  const {
    source_files,
    mappings,
    relocations,
    entry_points,
    entry_context,
    metadata_recovery,
    ...identity
  } = observed;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_native_load_image" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: parent.artifact ?? null,
    source_provider: parent.provider ?? null,
    source_analysis_profile_digest: parent.analysisProfile?.digest ?? null,
    source_parameters: jsonValueSchema.parse(parent.parameters ?? null),
    limitations: boundedViewMessages(
      [...parent.limitations, ...limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "Counts and pages describe retained provider observations, not complete runtime mappings or relocation behavior.",
      "Null collection counts or rows mean not recorded or not applicable, not observed absence.",
      ...(report.status === "unsupported" ? [report.reason] : []),
    ],
  };
  if (view.kind === "summary")
    return ok({
      ...shared,
      kind: "summary" as const,
      view,
      summary: {
        verification: smallVerification,
        observation: identity,
        counts: {
          source_files: source_files.length,
          mappings: mappings.length,
          relocations: relocations.length,
          entry_points: entry_points.length,
          entry_context: entry_context.length,
          metadata_recovery: metadata_recovery?.length ?? null,
          checks: "checks" in report ? report.checks.length : null,
          sections: "sections" in report ? report.sections.length : null,
        },
      },
      coverage: completeWithinViewCoverage(1, 1),
    });

  const selected =
    view.collection === "checks"
      ? "checks" in report
        ? report.checks
        : undefined
      : view.collection === "sections"
        ? "sections" in report
          ? report.sections
          : undefined
        : observed[view.collection];
  const page = selectRows(selected ?? [], view);
  return ok({
    ...shared,
    kind: "native-load-image" as const,
    verification_status: report.status,
    view,
    items: nativeLoadImageViewItemsSchema.parse({
      collection: view.collection,
      rows: selected === undefined ? null : page.rows,
    }),
    coverage: pageViewCoverage(view.offset, page.rows.length, page.total),
  });
};
