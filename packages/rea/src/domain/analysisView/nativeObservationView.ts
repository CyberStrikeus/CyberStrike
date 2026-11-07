import type { AnalysisError } from "../analysisErrorBase.js";
import { z } from "zod";
import { evidenceSubjectIdentity } from "../evidence.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { jsonValueSchema } from "../jsonValue.js";
import { analysisInputErrorFromIssues } from "../inputIssueProjection.js";
import { err, ok, type Result } from "../result.js";
import {
  nativeAddressListSchema,
  nativeObservationSourceSchemas,
  type NativeObservation,
} from "../native/nativeObservation.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import {
  pageViewCoverage,
  completeWithinViewCoverage,
} from "./analysisViewCoverage.js";
import {
  nativeContextViewRequestSchema,
  nativeObservationViewRequestSchema,
  nativeSourceContextSchema,
  type NativeSourceContext,
} from "./nativeObservationSchemas.js";
import { projectNativeGraphRows } from "./nativeGraphView.js";

const readAddresses = createAnalysisViewResultReader(nativeAddressListSchema);
const readAddress = createAnalysisViewResultReader(
  nativeObservationSourceSchemas.procedure_address,
);
const readResolution = createAnalysisViewResultReader(
  nativeObservationSourceSchemas.resolve_containing_procedure,
);
const readGraph = createAnalysisViewResultReader(
  nativeObservationSourceSchemas.get_call_graph,
);
const readSource = (
  parent: AnalysisViewParent,
): Result<NativeObservation, AnalysisError> => {
  switch (parent.operation) {
    case "procedure_callees":
    case "procedure_callers": {
      const read = readAddresses(parent);
      return read.ok
        ? ok({ operation: parent.operation, result: read.value })
        : read;
    }
    case "procedure_address": {
      const read = readAddress(parent);
      return read.ok
        ? ok({ operation: parent.operation, result: read.value })
        : read;
    }
    case "resolve_containing_procedure": {
      const read = readResolution(parent);
      return read.ok
        ? ok({ operation: parent.operation, result: read.value })
        : read;
    }
    case "get_call_graph": {
      const read = readGraph(parent);
      return read.ok
        ? ok({ operation: parent.operation, result: read.value })
        : read;
    }
    default:
      return err(
        analysisViewInputError([
          {
            path: ["source"],
            reason: "invalid_value",
            message:
              "This parent does not record a supported native observation.",
          },
        ]),
      );
  }
};
const readContext = (
  parent: AnalysisViewParent,
  source: NativeObservation,
): Result<NativeSourceContext, AnalysisError> => {
  const values = {
    subject: parent.subject,
    provider: parent.provider,
    analysis_profile: parent.analysisProfile,
    authority: parent.authority,
    environment: parent.environment,
    limitations: parent.limitations,
    result_limitations:
      source.operation === "get_call_graph" ? source.result.limitations : null,
  };
  const parsed = nativeSourceContextSchema.safeParse(values);
  return parsed.success
    ? ok(parsed.data)
    : err(
        analysisInputErrorFromIssues(
          "inspect_analysis_view",
          parsed.error.issues.map((issue) => ({
            ...issue,
            path: ["source", ...issue.path],
          })),
          { source: values },
          { cause: parsed.error },
        ),
      );
};
const selectedRows = <Value>(
  values: readonly Value[],
  selection: { readonly offset: number; readonly limit: number },
) =>
  values
    .slice(selection.offset, selection.offset + selection.limit)
    .map((value, index) => ({ source_index: selection.offset + index, value }));

const observationRows = (
  source: NativeObservation,
  view: { readonly offset: number; readonly limit: number },
) => {
  switch (source.operation) {
    case "procedure_address":
      return {
        parent_operation: source.operation,
        total: 1,
        items: {
          type: "addresses" as const,
          rows: selectedRows([source.result], view).map((row) => ({
            source_index: row.source_index,
            address: row.value,
          })),
        },
      };
    case "procedure_callees":
    case "procedure_callers":
      return {
        parent_operation: source.operation,
        total: source.result.length,
        items: {
          type: "addresses" as const,
          rows: selectedRows(source.result, view).map((row) => ({
            source_index: row.source_index,
            address: row.value,
          })),
        },
      };
    case "resolve_containing_procedure":
      return {
        parent_operation: source.operation,
        total: 1,
        items: {
          type: "resolutions" as const,
          rows: selectedRows([source.result], view).map((row) => ({
            source_index: row.source_index,
            record: row.value,
          })),
        },
      };
    case "get_call_graph":
      return {
        parent_operation: source.operation,
        ...projectNativeGraphRows(source.result, view),
      };
  }
};
const contextRows = (
  source: NativeSourceContext,
  view: z.output<typeof nativeContextViewRequestSchema>,
) => {
  switch (view.facet) {
    case "overview": {
      const {
        analysis_profile,
        limitations: _limitations,
        result_limitations: _result,
        ...overview
      } = source;
      return {
        facet: view.facet,
        view: { ...view, facet: view.facet },
        total: 1,
        items: {
          type: "overview" as const,
          rows: selectedRows(
            [
              {
                ...overview,
                analysis_profile_digest: analysis_profile?.digest ?? null,
              },
            ],
            view,
          ).map((row) => ({
            source_index: row.source_index,
            record: row.value,
          })),
        },
      };
    }
    case "analysis-profile":
      return {
        facet: view.facet,
        view: { ...view, facet: view.facet },
        total: 1,
        items: {
          type: "analysis-profile" as const,
          rows: selectedRows([source.analysis_profile], view).map((row) => ({
            source_index: row.source_index,
            record: row.value,
          })),
        },
      };
    case "limitations":
      return {
        facet: view.facet,
        view: { ...view, facet: view.facet },
        total: source.limitations.length,
        items: {
          type: "limitations" as const,
          rows: selectedRows(source.limitations, view).map((row) => ({
            source_index: row.source_index,
            text: row.value,
          })),
        },
      };
    case "result-limitations":
      return {
        facet: view.facet,
        view: { ...view, facet: view.facet },
        total: source.result_limitations?.length ?? null,
        items: {
          type: "result-limitations" as const,
          rows:
            source.result_limitations === null
              ? null
              : selectedRows(source.result_limitations, view).map((row) => ({
                  source_index: row.source_index,
                  text: row.value,
                })),
        },
      };
  }
};

/** Select recorded native facts without repeating provider profiles or complete caveat inventories. */
export const projectNativeObservationView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (
    view.kind !== "summary" &&
    view.kind !== "native-observation" &&
    view.kind !== "native-context"
  )
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Use summary, native-observation or native-context with this source.",
        },
      ]),
    );
  assertOwnedView<
    | SummaryAnalysisView
    | z.output<typeof nativeObservationViewRequestSchema>
    | z.output<typeof nativeContextViewRequestSchema>
  >(view, "summary", "native-observation", "native-context");
  const source = readSource(parent);
  if (!source.ok) return source;
  const context = readContext(parent, source.value);
  if (!context.ok) return context;
  const sourceContext = {
    materialization: "reference" as const,
    digest: digestCanonicalValue(
      {
        ...context.value,
        subject: evidenceSubjectIdentity(context.value.subject),
      },
      "Native source context",
    ),
    evidence_limitation_count: context.value.limitations.length,
    result_limitation_count: context.value.result_limitations?.length ?? null,
  };
  const common = {
    parent_evidence_id: parent.evidenceId,
    parent_digest: parent.evidenceId.slice(3),
    artifact: parent.artifact ?? null,
    source_provider: context.value.provider,
    source_analysis_profile_digest:
      context.value.analysis_profile?.digest ?? null,
    source_parameters: jsonValueSchema.parse(parent.parameters ?? {}),
    source_context: sourceContext,
    limitations: ["Source caveats require native-context."],
    unknowns: [
      "Interpretation beyond recorded rows is unknown until source caveats are read.",
    ],
  };
  if (view.kind === "native-context") {
    const { total, ...page } = contextRows(context.value, view);
    return ok({
      ...common,
      kind: "native-context" as const,
      ...page,
      parent_operation: source.value.operation,
      coverage:
        total === null
          ? completeWithinViewCoverage(0, 0)
          : pageViewCoverage(view.offset, page.items.rows?.length ?? 0, total),
      unknowns:
        total === null
          ? [
              "Result limitations are not applicable to this primitive observation; null does not report an examined empty list.",
            ]
          : common.unknowns,
    });
  }
  const selection = view.kind === "summary" ? { offset: 0, limit: 64 } : view;
  const page = observationRows(source.value, selection);
  const { total, ...payload } = page;
  const observation = {
    ...common,
    ...payload,
    summary: { observations: total },
    coverage: pageViewCoverage(selection.offset, page.items.rows.length, total),
  };
  return view.kind === "summary"
    ? ok({ ...observation, kind: "summary" as const, view })
    : ok({ ...observation, kind: "native-observation" as const, view });
};
