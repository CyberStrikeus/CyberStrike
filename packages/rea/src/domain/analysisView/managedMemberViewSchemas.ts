import { z } from "zod";
import { managedMemberInspectionSchema } from "../managed/managedArtifact.js";

const member = managedMemberInspectionSchema.shape;

const rows = {
  types: member.types.element,
  exported_types: member.exported_types.unwrap().unwrap().element,
  fields: member.fields.element,
  methods: member.methods.element,
  member_refs: member.member_refs.element,
  call_edges: member.call_edges.element,
  field_accesses: member.field_accesses.element,
  user_strings: member.user_strings.unwrap().unwrap().shape.literals.element,
};
const pageRequest = {
  kind: z.literal("managed-members"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
};
const namedRequest = {
  ...pageRequest,
  names: z
    .array(z.string())
    .exactOptional()
    .describe(
      "Exact name, called-method target_name or accessed field_name; empty matches nothing.",
    ),
};
const declaredRequest = {
  ...namedRequest,
  declaring_types: z
    .array(z.string())
    .exactOptional()
    .describe(
      "Exact defining type (fields/methods), parent type (member_refs), or target type (call_edges/field_accesses). Filters intersect.",
    ),
};

const fieldsOf = <S extends z.ZodEnum>(schema: S) =>
  z
    .array(schema)
    .exactOptional()
    .describe(
      "Project columns; source_index, row tokens and source offsets always remain. Omit for original full rows.",
    );

/** Filters precede paging; omitted fields preserve the existing full rows. */
export const managedMembersViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...namedRequest,
      collection: z.literal("types"),
      fields: fieldsOf(rows.types.keyof()),
    }),
    z.strictObject({
      ...namedRequest,
      collection: z.literal("exported_types"),
      fields: fieldsOf(rows.exported_types.keyof()),
    }),
    z.strictObject({
      ...declaredRequest,
      collection: z.literal("fields"),
      fields: fieldsOf(rows.fields.keyof()),
    }),
    z.strictObject({
      ...declaredRequest,
      collection: z.literal("methods"),
      fields: fieldsOf(rows.methods.keyof()),
    }),
    z.strictObject({
      ...declaredRequest,
      collection: z.literal("member_refs"),
      fields: fieldsOf(rows.member_refs.keyof()),
    }),
    z.strictObject({
      ...declaredRequest,
      collection: z.literal("call_edges"),
      fields: fieldsOf(rows.call_edges.keyof()),
    }),
    z.strictObject({
      ...declaredRequest,
      collection: z.literal("field_accesses"),
      fields: fieldsOf(rows.field_accesses.keyof()),
    }),
    z.strictObject({
      ...pageRequest,
      collection: z.literal("user_strings"),
      fields: fieldsOf(rows.user_strings.keyof()),
    }),
  ],
);

// Filtered/projected rows always carry this coordinate. Historical unfiltered
// pages keep their original full-row shape without it.
const sourceIndex = { source_index: z.int().nonnegative().exactOptional() };
const rowsOf = <C extends string, S extends z.ZodObject>(
  collection: C,
  row: S,
) =>
  z.strictObject({
    collection: z.literal(collection),
    rows: z.array(row.extend(sourceIndex)),
    source_count: z.int().nonnegative().exactOptional(),
    unresolved_filter_rows: z.int().nonnegative().exactOptional(),
  });

/** Source defaults normalize full facts, never omitted projection columns. */
export const managedMembersViewPageSchema = z.discriminatedUnion("collection", [
  rowsOf(
    "types",
    rows.types
      .extend({
        name_sha256: rows.types.shape.name_sha256.removeDefault(),
        enclosing_type_token:
          rows.types.shape.enclosing_type_token.removeDefault(),
      })
      .partial()
      .required({ token: true, row_offset: true }),
  ),
  rowsOf(
    "exported_types",
    rows.exported_types.partial().required({ token: true, row_offset: true }),
  ),
  rowsOf(
    "fields",
    rows.fields
      .partial()
      .required({ token: true, row_offset: true, declaring_type_token: true }),
  ),
  rowsOf(
    "methods",
    rows.methods
      .partial()
      .required({ token: true, row_offset: true, declaring_type_token: true }),
  ),
  rowsOf(
    "member_refs",
    rows.member_refs
      .extend({
        parent_name: rows.member_refs.shape.parent_name.removeDefault(),
      })
      .partial()
      .required({ token: true, row_offset: true, parent_token: true }),
  ),
  rowsOf(
    "call_edges",
    rows.call_edges
      .extend({
        target_identity_sha256:
          rows.call_edges.shape.target_identity_sha256.removeDefault(),
        target_declaring_type:
          rows.call_edges.shape.target_declaring_type.removeDefault(),
      })
      .partial()
      .required({
        caller_token: true,
        il_offset: true,
        target_token: true,
        opcode: true,
      })
      .extend({ il_offset: rows.call_edges.shape.il_offset }),
  ),
  rowsOf(
    "field_accesses",
    rows.field_accesses
      .extend({
        target_identity_sha256:
          rows.field_accesses.shape.target_identity_sha256.removeDefault(),
        field_declaring_type:
          rows.field_accesses.shape.field_declaring_type.removeDefault(),
      })
      .partial()
      .required({
        method_token: true,
        il_offset: true,
        field_token: true,
        opcode: true,
      })
      .extend({ il_offset: rows.field_accesses.shape.il_offset }),
  ),
  rowsOf(
    "user_strings",
    rows.user_strings.partial().required({ token: true, offset: true }),
  ),
]);

const nullableCount = z.int().nonnegative().nullable();

/** Keep identity, selection and coverage; member collections remain retained. */
export const managedMemberSummarySchema = z.strictObject({
  signature_resolution: member.signature_resolution,
  nesting_read: member.nesting_read,
  artifact: member.artifact,
  module: member.module,
  assembly: member.assembly,
  metadata: member.metadata,
  identity_scope: member.identity_scope,
  selection: member.selection.unwrap(),
  method_rows: member.method_rows,
  coverage: member.coverage,
  user_strings: z
    .strictObject({
      state: member.user_strings.unwrap().unwrap().shape.state,
      issues: member.user_strings.unwrap().unwrap().shape.issues,
    })
    .nullable(),
  limitations: member.limitations,
  reported_counts: z.strictObject({
    types: z.int().nonnegative(),
    exported_types: nullableCount,
    fields: z.int().nonnegative(),
    methods: z.int().nonnegative(),
    member_refs: z.int().nonnegative(),
    call_edges: z.int().nonnegative(),
    field_accesses: z.int().nonnegative(),
    user_strings: nullableCount,
  }),
});

export const managedMembersViewContextSchema = z.strictObject({
  module: member.module.exactOptional(),
  signature_resolution: member.signature_resolution,
  nesting_read: member.nesting_read,
  identity_scope: member.identity_scope,
  selection: member.selection.unwrap(),
  method_rows: member.method_rows,
  source_metadata_status: member.metadata.shape.status,
  source_coverage: member.coverage,
});

export type ManagedMembersViewRequest = z.infer<
  typeof managedMembersViewRequestSchema
>;
export type ManagedMemberSummary = z.infer<typeof managedMemberSummarySchema>;
export type ManagedMemberCollection = ManagedMembersViewRequest["collection"];
export type ManagedMemberViewRow = z.infer<
  (typeof rows)[ManagedMemberCollection]
>;
