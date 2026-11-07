import { z } from "zod";
import { analysisViewInputError } from "./analysisViewErrors.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type { JsonValue } from "../jsonValue.js";
import { isImmutableJsonSnapshot } from "../immutableJson.js";
import {
  il2cppMetadataImageSchema,
  il2cppMetadataMemberSchema,
  il2cppMetadataMethodSchema,
  il2cppMetadataSectionSchema,
  il2cppMetadataParameterSchema,
  il2cppMetadataStringLiteralSchema,
  il2cppMethodAddressSchema,
  il2cppGenericMethodInstanceSchema,
  il2cppGenericMethodIssueSchema,
  il2cppGenericMethodLinkSchema,
  il2cppBinaryLinkSchema,
  il2cppCodeGenModuleSchema,
  il2cppTypeReferenceSchema,
  il2cppMetadataObjectSchema,
  il2cppMetadataParentSchema,
  il2cppMetadataMemberCollections,
  il2cppMetadataBinaryCollections,
  il2cppMetadataTypeSchema,
} from "../il2cpp/il2cppMetadata.js";
import { err, ok, type Result } from "../result.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
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

const countsSchema = z.strictObject({
  sections: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
  types: z.number().int().nonnegative(),
  methods: z.number().int().nonnegative(),
  nested_types: z.number().int().nonnegative(),
  fields: z.number().int().nonnegative().nullable(),
  properties: z.number().int().nonnegative().nullable(),
  events: z.number().int().nonnegative().nullable(),
  parameters: z.number().int().nonnegative().nullable(),
  string_literals: z.number().int().nonnegative().nullable(),
  code_gen_modules: z.number().int().nonnegative().nullable(),
  method_addresses: z.number().int().nonnegative().nullable(),
  /** method_addresses rows per state; null when native observations were not collected. */
  method_address_states: z
    .strictObject({
      code: z.number().int().nonnegative(),
      no_body: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    })
    .nullable(),
  return_types: z.number().int().nonnegative().nullable(),
  field_types: z.number().int().nonnegative().nullable(),
  parameter_types: z.number().int().nonnegative().nullable(),
  /** Null unless generic_instances was requested, or before it was collected. */
  generic_method_instances: z.number().int().nonnegative().nullable(),
  /** generic_method_instances rows per state; null as above. */
  generic_method_instance_states: z
    .strictObject({
      code: z.number().int().nonnegative(),
      no_body: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    })
    .nullable(),
  /** generic_methods.issues rows; null as above. */
  generic_method_issues: z.number().int().nonnegative().nullable(),
});

export const il2cppMetadataSummarySchema = il2cppMetadataObjectSchema
  .omit({
    sections: true,
    images: true,
    types: true,
    methods: true,
    fields: true,
    properties: true,
    events: true,
    parameters: true,
    string_literals: true,
    method_addresses: true,
    return_types: true,
    field_types: true,
    parameter_types: true,
    generic_method_instances: true,
    binary: true,
  })
  .extend({
    // Links retained before generic instances existed omit generic_methods.
    // Issues page through generic_method_issues; the summary keeps a count.
    binary: il2cppBinaryLinkSchema
      .omit({ code_gen_modules: true })
      .extend({
        generic_methods: il2cppGenericMethodLinkSchema
          .omit({ issues: true })
          .nullable(),
      })
      .partial({ generic_methods: true })
      .nullable()
      .optional(),
    counts: countsSchema,
  });

const indexSchema = z.number().int().nonnegative();
const sectionRowSchema = il2cppMetadataSectionSchema.extend({
  index: indexSchema,
});
const imageRowSchema = il2cppMetadataImageSchema.extend({ index: indexSchema });
const typeRowSchema = il2cppMetadataTypeSchema.extend({ index: indexSchema });
const methodRowSchema = il2cppMetadataMethodSchema.extend({
  index: indexSchema,
});
const memberRowSchema = il2cppMetadataMemberSchema.extend({
  index: indexSchema,
});
const parameterRowSchema = il2cppMetadataParameterSchema.extend({
  index: indexSchema,
});
const stringLiteralRowSchema = il2cppMetadataStringLiteralSchema.extend({
  index: indexSchema,
});
const methodAddressRowSchema = il2cppMethodAddressSchema.extend({
  index: indexSchema,
});
const typeReferenceRowSchema = il2cppTypeReferenceSchema.extend({
  index: indexSchema,
});
const genericInstanceRowSchema = il2cppGenericMethodInstanceSchema.extend({
  index: indexSchema,
});
const codeGenModuleRowSchema = il2cppCodeGenModuleSchema.extend({
  index: indexSchema,
});
const genericIssueRowSchema = il2cppGenericMethodIssueSchema.extend({
  index: indexSchema,
});
const indexPage = {
  kind: z.literal("il2cpp-metadata"),
  indices: z.array(indexSchema).optional(),
  offset: indexSchema.default(0),
  limit: z.number().int().positive().default(64),
};
const page = { ...indexPage, names: z.array(z.string()).optional() };
const declaringTypes = z.array(z.number().int().min(-1)).optional();

/** Filters intersect; pages use metadata order and always retain the source row index. */
export const il2cppMetadataViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...page,
      collection: z.literal("sections"),
      fields: z.array(sectionRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("images"),
      fields: z.array(imageRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("types"),
      image_indices: z.array(indexSchema).optional(),
      namespaces: z.array(z.string()).optional(),
      declaring_types: declaringTypes,
      fields: z.array(typeRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("methods"),
      declaring_types: declaringTypes,
      fields: z.array(methodRowSchema.keyof()).optional(),
    }),
    ...(["fields", "properties", "events"] as const).map((collection) =>
      z.strictObject({
        ...page,
        collection: z.literal(collection),
        declaring_types: declaringTypes,
        fields: z.array(memberRowSchema.keyof()).optional(),
      }),
    ),
    z.strictObject({
      ...page,
      collection: z.literal("parameters"),
      method_indices: z.array(indexSchema).optional(),
      fields: z.array(parameterRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...indexPage,
      collection: z.literal("string_literals"),
      fields: z.array(stringLiteralRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...indexPage,
      collection: z.literal("method_addresses"),
      addresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{1,16}$/u)).optional(),
      states: z.array(il2cppMethodAddressSchema.shape.state).optional(),
      fields: z.array(methodAddressRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("generic_method_instances"),
      /** Metadata method indices of the generic definitions. */
      method_indices: z.array(indexSchema).optional(),
      addresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{1,16}$/u)).optional(),
      states: z.array(il2cppGenericMethodInstanceSchema.shape.state).optional(),
      fields: z.array(genericInstanceRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...indexPage,
      collection: z.literal("generic_method_issues"),
      /** genericMethodTable rows the issues leave unknown. */
      rows: z.array(indexSchema).optional(),
      fields: z.array(genericIssueRowSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...indexPage,
      collection: z.literal("code_gen_modules"),
      image_indices: z.array(indexSchema).optional(),
      fields: z.array(codeGenModuleRowSchema.keyof()).optional(),
    }),
    ...(["return_types", "field_types"] as const).map((collection) =>
      z.strictObject({
        ...page,
        collection: z.literal(collection),
        fields: z.array(typeReferenceRowSchema.keyof()).optional(),
      }),
    ),
    z.strictObject({
      ...page,
      collection: z.literal("parameter_types"),
      // Owners come from the retained parameters collection.
      method_indices: z.array(indexSchema).optional(),
      fields: z.array(typeReferenceRowSchema.keyof()).optional(),
    }),
  ],
);

export const il2cppMetadataViewItemsSchema = z.union([
  z.array(sectionRowSchema.partial().required({ index: true })),
  z.array(imageRowSchema.partial().required({ index: true })),
  z.array(typeRowSchema.partial().required({ index: true })),
  z.array(methodRowSchema.partial().required({ index: true })),
  z.array(memberRowSchema.partial().required({ index: true })),
  z.array(parameterRowSchema.partial().required({ index: true })),
  z.array(stringLiteralRowSchema.partial().required({ index: true })),
  z.array(methodAddressRowSchema.partial().required({ index: true })),
  z.array(typeReferenceRowSchema.partial().required({ index: true })),
  z.array(codeGenModuleRowSchema.partial().required({ index: true })),
  z.array(genericInstanceRowSchema.partial().required({ index: true })),
  z.array(genericIssueRowSchema.partial().required({ index: true })),
]);

export const il2cppMetadataViewContextSchema = z.strictObject({
  metadata_version: il2cppMetadataObjectSchema.shape.metadata_version,
  counts: countsSchema,
  binary_source: il2cppBinaryLinkSchema
    .pick({
      artifact: true,
      format: true,
      architecture: true,
      image_base: true,
    })
    .optional(),
});

type Report = z.infer<typeof il2cppMetadataParentSchema>;
type Request = z.infer<typeof il2cppMetadataViewRequestSchema>;
type BinaryLink = NonNullable<Report["binary"]>;
type CollectionRows = Omit<Report, "binary"> & {
  code_gen_modules: BinaryLink["code_gen_modules"];
  generic_method_issues: NonNullable<BinaryLink["generic_methods"]>["issues"];
};
type Row = NonNullable<CollectionRows[Request["collection"]]>[number];
interface CheckedReport {
  readonly report: Report;
  readonly counts: z.infer<typeof countsSchema>;
}

const readMetadataReport = createAnalysisViewResultReader(
  il2cppMetadataParentSchema,
);
// The validated immutable report owns its derived counts for its lifetime.
const checkedReports = new WeakMap<object, CheckedReport>();

const parseMetadataReport = (
  parent: AnalysisViewParent,
): Result<CheckedReport, AnalysisError> => {
  const parsed = readMetadataReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const reusable = isImmutableJsonSnapshot(report);
  const cached = reusable ? checkedReports.get(report) : undefined;
  if (cached !== undefined) return ok(cached);
  const checked = {
    report,
    counts: {
      sections: report.sections.length,
      images: report.images.length,
      types: report.types.length,
      methods: report.methods.length,
      nested_types: report.types.reduce(
        (count, type) => count + Number(type.declaring_type !== -1),
        0,
      ),
      fields: report.fields?.length ?? null,
      properties: report.properties?.length ?? null,
      events: report.events?.length ?? null,
      parameters: report.parameters?.length ?? null,
      string_literals: report.string_literals?.length ?? null,
      code_gen_modules: report.binary?.code_gen_modules.length ?? null,
      method_addresses:
        report.binary == null
          ? null
          : (report.method_addresses?.length ?? null),
      method_address_states:
        (report.binary == null ? undefined : report.method_addresses)?.reduce(
          (states, row) => {
            if (row.state === "code") states.code++;
            else if (row.state === "no-body") states.no_body++;
            else states.unknown++;
            return states;
          },
          { code: 0, no_body: 0, unknown: 0 },
        ) ?? null,
      return_types:
        report.binary == null ? null : (report.return_types?.length ?? null),
      field_types:
        report.binary == null ? null : (report.field_types?.length ?? null),
      parameter_types:
        report.binary == null ? null : (report.parameter_types?.length ?? null),
      generic_method_instances: report.generic_method_instances?.length ?? null,
      generic_method_instance_states:
        report.generic_method_instances?.reduce(
          (states, row) => {
            if (row.state === "code") states.code++;
            else if (row.state === "no-body") states.no_body++;
            else states.unknown++;
            return states;
          },
          { code: 0, no_body: 0, unknown: 0 },
        ) ?? null,
      generic_method_issues:
        report.binary?.generic_methods?.issues.length ?? null,
    },
  };
  if (reusable) checkedReports.set(report, checked);
  return ok(checked);
};

/** Direct batch lookup visits selected indices only; metadata order is stable. */
function* rowIndices(length: number, indices: number[] | undefined) {
  if (indices === undefined) {
    for (let index = 0; index < length; index++) yield index;
  } else {
    for (const index of [...new Set(indices)].sort((a, b) => a - b))
      if (index < length) yield index;
  }
}

const selectFields = (
  row: Row,
  index: number,
  fields: Set<string> | undefined,
) => {
  const item: { index: number } & Record<string, JsonValue> = { index };
  const values: Readonly<Record<string, JsonValue>> = row;
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value !== undefined && (fields === undefined || fields.has(key)))
      item[key] = value;
  }
  return item;
};

/** Compile caller selections once; large batches do not multiply per-row work. */
const selection = (view: Request, report: Report) => {
  const names =
    !("names" in view) || view.names === undefined
      ? undefined
      : new Set(view.names);
  const owners =
    !("declaring_types" in view) || view.declaring_types === undefined
      ? undefined
      : new Set(view.declaring_types);
  const addresses =
    (view.collection === "method_addresses" ||
      view.collection === "generic_method_instances") &&
    view.addresses !== undefined
      ? new Set(view.addresses.map((value) => BigInt(value).toString(16)))
      : undefined;
  const states =
    (view.collection === "method_addresses" ||
      view.collection === "generic_method_instances") &&
    view.states !== undefined
      ? new Set<string>(view.states)
      : undefined;
  const methods =
    (view.collection === "parameters" ||
      view.collection === "parameter_types" ||
      view.collection === "generic_method_instances") &&
    view.method_indices !== undefined
      ? new Set(view.method_indices)
      : undefined;
  // A parameter type row is owned by the method of the parameter at its
  // index; parameter and generic instance rows name their method.
  const parameterOwner = (row: Row, index: number) =>
    "method" in row
      ? row.method
      : view.collection === "parameter_types"
        ? report.parameters?.[index]?.method
        : undefined;
  const namespaces =
    view.collection !== "types" || view.namespaces === undefined
      ? undefined
      : new Set(view.namespaces);
  const imageIndices =
    view.collection === "types" ? view.image_indices : undefined;
  const ranges: { start: number; end: number }[] = [];
  if (imageIndices !== undefined) {
    const selected = [...new Set(imageIndices)]
      .flatMap((index) => {
        const image = report.images[index];
        return image === undefined || image.type_count === 0
          ? []
          : [
              {
                start: image.type_start,
                end: image.type_start + image.type_count,
              },
            ];
      })
      .sort((a, b) => a.start - b.start);
    for (const range of selected) {
      const last = ranges.at(-1);
      if (last !== undefined && range.start <= last.end)
        last.end = Math.max(last.end, range.end);
      else ranges.push(range);
    }
  }
  const issueRows =
    view.collection === "generic_method_issues" && view.rows !== undefined
      ? new Set(view.rows)
      : undefined;
  const moduleImages =
    view.collection === "code_gen_modules" && view.image_indices !== undefined
      ? new Set(view.image_indices)
      : undefined;
  if (
    [
      moduleImages,
      issueRows,
      addresses,
      states,
      names,
      owners,
      namespaces,
      methods,
      imageIndices,
    ].every((filter) => filter === undefined)
  )
    return undefined;
  return (row: Row, index: number) => {
    if (
      moduleImages !== undefined &&
      (!("image" in row) || !moduleImages.has(row.image))
    )
      return false;
    if (issueRows !== undefined && (!("row" in row) || !issueRows.has(row.row)))
      return false;
    if (
      addresses !== undefined &&
      (!("address" in row) ||
        row.address === null ||
        !addresses.has(BigInt(row.address).toString(16)))
    )
      return false;
    if (states !== undefined && (!("state" in row) || !states.has(row.state)))
      return false;
    if (
      names !== undefined &&
      (!("name" in row) || row.name === null || !names.has(row.name))
    )
      return false;
    if (
      owners !== undefined &&
      (!("declaring_type" in row) || !owners.has(row.declaring_type))
    )
      return false;
    if (
      namespaces !== undefined &&
      (!("namespace" in row) || !namespaces.has(row.namespace))
    )
      return false;
    if (methods !== undefined) {
      const method = parameterOwner(row, index);
      if (method === null || method === undefined || !methods.has(method))
        return false;
    }
    if (imageIndices === undefined) return true;
    let lower = 0;
    let upper = ranges.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (ranges[middle]!.start <= index) lower = middle + 1;
      else upper = middle;
    }
    const range = ranges[lower - 1];
    return range !== undefined && index < range.end;
  };
};

/** Reuse retained facts; source indices stay distinct from filtered page offsets. */
export const projectIl2cppMetadataView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof il2cppMetadataViewRequestSchema>
  >(admitted, "summary", "il2cpp-metadata");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "IL2CPP metadata Evidence supports summary and selected sections, images, types, methods, member, parameter, string literal, method address, type reference, generic method instance and generic method issue pages.",
        },
      ]),
    );
  const parsed = parseMetadataReport(parent);
  if (!parsed.ok) return parsed;
  const { report, counts } = parsed.value;
  const subject = parent.subject;
  if (
    subject != null &&
    (subject.format !== "file" ||
      subject.digest.sha256 !== report.artifact.sha256)
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "IL2CPP metadata artifact identity does not match its parent subject.",
        },
      ]),
    );
  const {
    sections,
    images,
    types,
    methods,
    fields,
    properties,
    events,
    parameters,
    string_literals,
    method_addresses,
    return_types,
    field_types,
    parameter_types,
    generic_method_instances,
    ...identity
  } = report;
  const allRows = {
    code_gen_modules: report.binary?.code_gen_modules,
    generic_method_issues:
      report.binary?.generic_methods === null
        ? null
        : report.binary?.generic_methods?.issues,
    sections,
    images,
    types,
    methods,
    fields,
    properties,
    events,
    parameters,
    string_literals,
    method_addresses,
    return_types,
    field_types,
    parameter_types,
    generic_method_instances,
  };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_il2cpp_metadata" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: [...parent.limitations],
    unknowns: [
      ...(report.binary != null && report.binary.code_gen_modules_field === null
        ? [
            "Module-array association is inferred from executable byte patterns; instruction boundaries and runtime use remain unverified.",
          ]
        : []),
      ...(report.binary != null && report.binary.types_field === null
        ? [
            "Type-table association and types_count are inferred from executable byte patterns and Il2CppType-shaped records; instruction boundaries and runtime use remain unverified.",
          ]
        : []),
      ...[
        ...il2cppMetadataMemberCollections,
        ...il2cppMetadataBinaryCollections,
      ]
        .filter((name) => report[name] === undefined)
        .map(
          (name) =>
            `Retained Evidence did not collect ${name}; its count is unknown. Reinspect the metadata to acquire these facts.`,
        ),
      ...(report.binary != null && report.generic_method_instances === undefined
        ? [
            "Retained Evidence did not collect generic_method_instances; its count is unknown. Reinspect with generic_instances to acquire these facts.",
          ]
        : report.generic_method_instances === null
          ? [
              "Generic method instances were not requested; their count is unknown.",
            ]
          : []),
      report.binary == null
        ? "Names come from unencrypted metadata only; native code addresses and runtime registration remain unknown."
        : report.binary.generic_methods == null
          ? "Addresses come from static binary tables; runtime behavior and generic instance code remain unknown."
          : "Addresses come from static binary tables; runtime behavior and generic instances outside genericMethodTable remain unknown.",
      ...(parent.subject == null
        ? [
            "The parent has no recorded subject; its normalized artifact identity cannot be cross-checked against a subject digest.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary") {
    const binary =
      report.binary == null
        ? report.binary
        : (({ code_gen_modules: _modules, generic_methods, ...facts }) => ({
            ...facts,
            ...(generic_methods === undefined
              ? {}
              : {
                  generic_methods:
                    generic_methods === null
                      ? null
                      : (({ issues: _issues, ...registration }) =>
                          registration)(generic_methods),
                }),
          }))(report.binary);
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: {
        ...identity,
        ...(binary === undefined ? {} : { binary }),
        counts,
      },
      coverage: completeWithinViewCoverage(1, 1),
    });
  }
  const nativeUnavailable =
    report.binary == null &&
    [
      "method_addresses",
      "return_types",
      "field_types",
      "parameter_types",
    ].includes(view.collection);
  const rows = nativeUnavailable ? undefined : allRows[view.collection];
  if (rows === null)
    return err(
      analysisViewInputError([
        {
          path: ["view", "collection"],
          reason: "invalid_value",
          message:
            "Generic method instances were not requested for this Evidence, so they are unknown; inspect again with generic_instances and binary_path.",
        },
      ]),
    );
  if (rows === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view", "collection"],
          reason: "invalid_value",
          message: `Retained Evidence did not collect ${view.collection}; inspect the metadata again to acquire these facts.`,
        },
      ]),
    );
  if (
    view.collection === "parameter_types" &&
    view.method_indices !== undefined &&
    report.parameters === undefined
  )
    return err(
      analysisViewInputError([
        {
          path: ["view", "method_indices"],
          reason: "invalid_value",
          message:
            "Retained Evidence did not collect parameters, so parameter owners are unknown; inspect the metadata again to select parameter types by method.",
        },
      ]),
    );
  const matches = selection(view, report);
  const selectedFields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  const items = [];
  let total = 0;
  if (matches === undefined && view.indices === undefined) {
    total = rows.length;
    const end = Math.min(rows.length, view.offset + view.limit);
    for (let index = Math.min(view.offset, rows.length); index < end; index++)
      items.push(selectFields(rows[index]!, index, selectedFields));
  } else {
    for (const index of rowIndices(rows.length, view.indices)) {
      const row = rows[index]!;
      if (matches !== undefined && !matches(row, index)) continue;
      if (total >= view.offset && items.length < view.limit)
        items.push(selectFields(row, index, selectedFields));
      total++;
    }
  }
  return ok({
    kind: "il2cpp-metadata" as const,
    view,
    ...shared,
    items,
    metadata_version: report.metadata_version,
    ...(report.binary == null
      ? {}
      : {
          binary_source: {
            artifact: report.binary.artifact,
            format: report.binary.format,
            architecture: report.binary.architecture,
            image_base: report.binary.image_base,
          },
        }),
    counts,
    coverage: pageViewCoverage(view.offset, items.length, total),
  });
};
