import { analysisViewInputError } from "./analysisViewErrors.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import {
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
} from "../managed/managedArtifact.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import { z } from "zod";
import { managedMembersViewRequestSchema } from "./managedMemberViewSchemas.js";
import { managedViewIdentityUnknowns } from "./managedArtifactView.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";

import type {
  ManagedMembersViewRequest,
  ManagedMemberSummary,
  ManagedMemberCollection as MemberCollection,
  ManagedMemberViewRow as Row,
} from "./managedMemberViewSchemas.js";

type Selection<C extends MemberCollection, T extends Row, K extends keyof T> = {
  readonly collection: C;
  readonly rows: readonly T[] | null | undefined;
  readonly identity: readonly K[];
  readonly name?: keyof T;
  readonly declaringType?: keyof T;
};

const collectionPage = (
  report: ManagedMemberInspection,
  view: ManagedMembersViewRequest,
) => {
  const { collection } = view;
  switch (collection) {
    case "types":
      return selectRows(
        {
          collection,
          rows: report.types,
          identity: ["token", "row_offset"],
          name: "name",
        },
        view,
      );
    case "exported_types":
      return selectRows(
        {
          collection,
          rows: report.exported_types,
          identity: ["token", "row_offset"],
          name: "name",
        },
        view,
      );
    case "fields":
      return selectRows(
        {
          collection,
          rows: report.fields,
          identity: ["token", "row_offset", "declaring_type_token"],
          name: "name",
          declaringType: "declaring_type",
        },
        view,
      );
    case "methods":
      return selectRows(
        {
          collection,
          rows: report.methods,
          identity: ["token", "row_offset", "declaring_type_token"],
          name: "name",
          declaringType: "declaring_type",
        },
        view,
      );
    case "member_refs":
      return selectRows(
        {
          collection,
          rows: report.member_refs,
          identity: ["token", "row_offset", "parent_token"],
          name: "name",
          declaringType: "parent_name",
        },
        view,
      );
    case "call_edges":
      return selectRows(
        {
          collection,
          rows: report.call_edges,
          identity: ["caller_token", "il_offset", "target_token", "opcode"],
          name: "target_name",
          declaringType: "target_declaring_type",
        },
        view,
      );
    case "field_accesses":
      return selectRows(
        {
          collection,
          rows: report.field_accesses,
          identity: ["method_token", "il_offset", "field_token", "opcode"],
          name: "field_name",
          declaringType: "field_declaring_type",
        },
        view,
      );
    case "user_strings":
      return selectRows(
        {
          collection,
          rows: report.user_strings?.literals,
          identity: ["token", "offset"],
        },
        view,
      );
  }
};

/** Keep only one page while counting matches; never copy the matched inventory. */
const selectRows = <
  C extends MemberCollection,
  T extends Row,
  K extends keyof T,
>(
  source: Selection<C, T, K>,
  view: ManagedMembersViewRequest,
) => {
  if (source.rows == null) return null;
  const names =
    "names" in view && view.names !== undefined
      ? new Set(view.names)
      : undefined;
  const declaringTypes =
    "declaring_types" in view && view.declaring_types !== undefined
      ? new Set(view.declaring_types)
      : undefined;
  const fields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  const filtering = names !== undefined || declaringTypes !== undefined;
  if (!filtering && fields === undefined)
    return {
      page: {
        collection: source.collection,
        rows: source.rows.slice(view.offset, view.offset + view.limit),
      },
      total: source.rows.length,
    };
  const selected: (Partial<T> & Pick<T, K> & { source_index: number })[] = [];
  const start = filtering ? 0 : Math.min(view.offset, source.rows.length);
  const end = filtering
    ? source.rows.length
    : Math.min(view.offset + view.limit, source.rows.length);
  let total = filtering ? 0 : source.rows.length;
  let unresolved = 0;
  for (let index = start; index < end; index++) {
    const row = source.rows[index];
    if (row === undefined) continue;
    const matched = matchRow(row, source, { names, declaringTypes });
    if (matched === false) continue;
    if (matched === null) {
      unresolved++;
      continue;
    }
    const ordinal = filtering ? total++ : index;
    if (ordinal < view.offset || selected.length >= view.limit) continue;
    selected.push(projectRow(row, index, fields, source.identity));
  }
  return {
    page: {
      collection: source.collection,
      rows: selected,
      source_count: source.rows.length,
      unresolved_filter_rows: unresolved,
    },
    total,
  };
};

const projectRow = <T extends Row, K extends keyof T>(
  row: T,
  index: number,
  fields: ReadonlySet<string> | undefined,
  identity: readonly K[],
): Partial<T> & Pick<T, K> & { source_index: number } => {
  const projected: Partial<T> & { source_index: number } = {
    ...row,
    source_index: index,
  };
  if (fields !== undefined) {
    for (const key of Object.keys(row) as (keyof T & string)[])
      if (!fields.has(key) && !identity.includes(key as K))
        delete projected[key];
  }
  // Keys in identity come from the parsed row and are never removed above.
  return projected as Partial<T> & Pick<T, K> & { source_index: number };
};

const matchRow = <T extends Row>(
  row: T,
  source: { readonly name?: keyof T; readonly declaringType?: keyof T },
  filters: {
    readonly names: ReadonlySet<string> | undefined;
    readonly declaringTypes: ReadonlySet<string> | undefined;
  },
): boolean | null => {
  const name = matches(
    filters.names,
    source.name === undefined ? undefined : row[source.name],
  );
  const declaringType = matches(
    filters.declaringTypes,
    source.declaringType === undefined ? undefined : row[source.declaringType],
  );
  if (name === false || declaringType === false) return false;
  return name === null || declaringType === null ? null : true;
};

const matches = (
  selection: ReadonlySet<string> | undefined,
  value: unknown,
): boolean | null => {
  if (selection === undefined) return true;
  if (selection.size === 0) return false;
  return typeof value === "string" ? selection.has(value) : null;
};

const parseMemberReport = createAnalysisViewResultReader(
  managedMemberInspectionSchema,
);

/** Everything but the member collections, which are replaced by their counts. */
const summarizeMembers = (
  report: ManagedMemberInspection,
): ManagedMemberSummary => {
  const {
    types,
    exported_types,
    fields,
    methods,
    member_refs,
    call_edges,
    field_accesses,
    user_strings,
    ...identity
  } = report;
  return {
    ...identity,
    user_strings:
      user_strings === null
        ? null
        : { state: user_strings.state, issues: user_strings.issues },
    reported_counts: {
      types: types.length,
      exported_types: exported_types?.length ?? null,
      fields: fields.length,
      methods: methods.length,
      member_refs: member_refs.length,
      call_edges: call_edges.length,
      field_accesses: field_accesses.length,
      user_strings: user_strings?.literals.length ?? null,
    },
  };
};

/** Project authenticated member Evidence without reading a path or invoking a provider. */
export const projectManagedMemberView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (view.kind !== "summary" && view.kind !== "managed-members")
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Managed member inspection supports summary and managed-members views.",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof managedMembersViewRequestSchema>
  >(view, "summary", "managed-members");
  const parsed = parseMemberReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_managed_members" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: uniqueSorted([...parent.limitations, ...report.limitations]),
    unknowns: [
      "Collection counts and pages cover producer-returned rows; member completeness remains the original coverage, not an absence claim about unreturned rows.",
      ...(report.selection === null
        ? []
        : [
            "Exported types and member references cover the whole assembly; the other collections cover only the selected declaring types.",
          ]),
      ...managedViewIdentityUnknowns(
        parent,
        report.identity_scope.requires_mvid,
      ),
    ],
  };
  if (view.kind === "summary") {
    const summary = summarizeMembers(report);
    const total = Object.values(summary.reported_counts).reduce<number>(
      (sum, count) => sum + (count ?? 0),
      0,
    );
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary,
      coverage: completeWithinViewCoverage(total, total),
    });
  }
  const selected = collectionPage(report, view);
  if (selected === null)
    return err(
      analysisViewInputError([
        {
          path: ["view", "collection"],
          reason: "invalid_value",
          message: `The parent Evidence did not examine ${view.collection}; repeat inspect_managed_members with the current runtime to record it.`,
        },
      ]),
    );
  const { page, total } = selected;
  if (
    "unresolved_filter_rows" in page &&
    page.unresolved_filter_rows !== undefined &&
    page.unresolved_filter_rows > 0
  )
    shared.unknowns.push(
      `${page.unresolved_filter_rows} source rows have unknown requested names or declaring types and may match the filters; the matched total excludes them.`,
    );
  return ok({
    kind: "managed-members" as const,
    view,
    page,
    ...shared,
    module: report.module,
    signature_resolution: report.signature_resolution,
    nesting_read: report.nesting_read,
    identity_scope: report.identity_scope,
    selection: report.selection,
    method_rows: report.method_rows,
    source_metadata_status: report.metadata.status,
    source_coverage:
      view.collection === "user_strings" && report.user_strings !== null
        ? {
            state: report.user_strings.state,
            issues: report.user_strings.issues,
          }
        : report.coverage,
    coverage: pageViewCoverage(view.offset, page.rows.length, total),
  });
};
