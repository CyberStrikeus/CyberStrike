import { analysisViewInputError } from "./analysisViewErrors.js";
import { analysisTextPage } from "./analysisViewText.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import type { FunctionDossier } from "../native/functionDossier.js";
import { jsonValueSchema } from "../jsonValue.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type NativeFacetAnalysisView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

type Artifact = { readonly path: string; readonly sha256: string };

const viewError = (message: string): AnalysisError =>
  analysisViewInputError([
    { path: ["view"], reason: "invalid_value", message },
  ]);

const parentFields = (
  parent: AnalysisViewParent,
  dossier: FunctionDossier,
  artifact: Artifact,
) => {
  const flow = dossier.native_value_flow;
  const api = dossier.native_api;
  const unknowns: string[] = [];
  if (flow === null) unknowns.push("native_value_flow was not recorded");
  else if (!flow.available)
    unknowns.push("native_value_flow unavailable: " + flow.reason);
  else if (flow.truncated)
    unknowns.push(
      "native_value_flow is truncated; omitted observations remain unknown",
    );
  if (api === null) unknowns.push("native_api was not recorded");
  else if (!api.available)
    unknowns.push(
      "native_api unavailable: " + api.reason,
      ...api.residual_unknowns,
    );
  return {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "analyze_function" as const,
    parent_digest: parent.evidenceId.slice(3),
    procedure_address: dossier.procedure.address,
    artifact,
    limitations: uniqueSorted([
      ...parent.limitations,
      ...dossier.limitations,
      ...(flow?.limitations ?? []),
      ...(api?.available ? api.limitations : []),
    ]),
    unknowns: uniqueSorted(unknowns),
  };
};

const nativeRows = (
  dossier: FunctionDossier,
  facet: Exclude<
    NativeFacetAnalysisView["facet"],
    "procedure" | "pseudocode" | "native_api" | "value_flow_summary"
  >,
): readonly unknown[] | undefined => {
  const sourceFlow = dossier.native_value_flow;
  const flow = sourceFlow?.available ? sourceFlow : undefined;
  return {
    assembly: dossier.assembly,
    basic_blocks: dossier.basic_blocks,
    comments: dossier.comments,
    callers: dossier.callers,
    callees: dossier.callees,
    incoming_references: dossier.incoming_references,
    outgoing_references: dossier.outgoing_references,
    unresolved_calls: dossier.unresolved_calls,
    referenced_strings: dossier.referenced_strings,
    referenced_names: dossier.referenced_names,
    swift_string_literals: dossier.swift_string_literals,
    swift_string_literal_omissions: dossier.swift_string_literal_omissions,
    value_flow_operations: flow?.operations,
    value_flow_def_use: flow?.def_use,
    value_flow_effects: flow?.effects,
    value_flow_parameters: flow?.parameters,
    value_flow_parameter_uses: flow?.parameter_uses,
  }[facet];
};

type FacetAvailability = NonNullable<FunctionDossier["facet_availability"]>;
type FacetAvailabilityKey = keyof FacetAvailability;

/** Row facets whose provider availability is declared under another key. */
const facetAvailabilityKeys: Readonly<
  Partial<Record<string, FacetAvailabilityKey>>
> = {
  incoming_references: "references",
  outgoing_references: "references",
  referenced_strings: "strings_names",
  referenced_names: "strings_names",
  basic_blocks: "cfg",
};

const facetAvailability = (
  dossier: FunctionDossier,
  facet: string,
): FacetAvailability[FacetAvailabilityKey] | undefined =>
  dossier.facet_availability?.[
    facetAvailabilityKeys[facet] ?? (facet as FacetAvailabilityKey)
  ];

/** Reasons the provider declared row facets unavailable; empty rows there are not observations. */
const unavailableFacetUnknowns = (dossier: FunctionDossier): string[] => {
  const availability = dossier.facet_availability;
  if (availability === undefined) return [];
  return Object.entries(availability).flatMap(([facet, status]) =>
    status.available ? [] : [`${facet} unavailable: ${status.reason}`],
  );
};

/** Optional dossier records; the native facet path reports them "not recorded" when omitted. */
const optionalFacets = [
  "unresolved_calls",
  "swift_string_literals",
  "swift_string_literal_omissions",
] as const;

/** Omitted optional records are unknown, not empty, so the summary names them. */
const unrecordedFacetUnknowns = (dossier: FunctionDossier): string[] =>
  optionalFacets.flatMap((facet) =>
    dossier[facet] === undefined ? [`${facet} not recorded`] : [],
  );

/** Compact dossier summary: identity, pseudocode size, facet counts and value-flow availability. */
const summarizeDossier = (dossier: FunctionDossier) => {
  const sourceFlow = dossier.native_value_flow;
  const flow = sourceFlow?.available ? sourceFlow : undefined;
  // A count is unknown, not zero, when the provider declared its facet unavailable.
  const count = (facet: string, rows: readonly unknown[]): number | null =>
    facetAvailability(dossier, facet)?.available === false ? null : rows.length;
  // An omitted optional record is unknown, not zero.
  const recorded = (rows: readonly unknown[] | undefined): number | null =>
    rows === undefined ? null : rows.length;
  return {
    procedure: {
      name: dossier.procedure.name,
      address: dossier.procedure.address,
    },
    pseudocode: {
      available:
        dossier.facet_availability?.pseudocode?.available ??
        dossier.pseudocode.length > 0,
      code_units: dossier.pseudocode.length,
    },
    value_flow: {
      available: flow !== undefined,
      truncated: flow?.truncated ?? false,
    },
    facet_availability: dossier.facet_availability ?? null,
    counts: {
      assembly: count("assembly", dossier.assembly),
      basic_blocks: count("basic_blocks", dossier.basic_blocks),
      comments: count("comments", dossier.comments),
      callers: count("callers", dossier.callers),
      callees: count("callees", dossier.callees),
      incoming_references: count(
        "incoming_references",
        dossier.incoming_references,
      ),
      outgoing_references: count(
        "outgoing_references",
        dossier.outgoing_references,
      ),
      unresolved_calls: recorded(dossier.unresolved_calls),
      referenced_strings: count(
        "referenced_strings",
        dossier.referenced_strings,
      ),
      referenced_names: count("referenced_names", dossier.referenced_names),
      swift_string_literals: recorded(dossier.swift_string_literals),
      swift_string_literal_omissions: recorded(
        dossier.swift_string_literal_omissions,
      ),
      // Value-flow rows are unknown, not zero, when value flow was not recorded
      // or the provider declared it unavailable; parentFields names which.
      value_flow_operations: flow?.operations.length ?? null,
      value_flow_def_use: flow?.def_use.length ?? null,
      value_flow_effects: flow?.effects.length ?? null,
      value_flow_parameters: flow?.parameters.length ?? null,
      value_flow_parameter_uses: flow?.parameter_uses.length ?? null,
    },
    limitation_count: dossier.limitations.length,
  };
};

const summaryView = (
  view: SummaryAnalysisView,
  dossier: FunctionDossier,
  common: ReturnType<typeof parentFields>,
) => ({
  kind: "summary" as const,
  view,
  summary: summarizeDossier(dossier),
  coverage: completeWithinViewCoverage(1, 1),
  ...common,
  unknowns: uniqueSorted([
    ...common.unknowns,
    ...unavailableFacetUnknowns(dossier),
    ...unrecordedFacetUnknowns(dossier),
  ]),
});

/** Project bounded native function facets from complete retained Evidence without reanalysis. */
export const projectNativeFunctionView = (
  parent: AnalysisViewParent,
  dossier: FunctionDossier,
  view: AdmittedView,
) => {
  if (view.kind !== "native" && view.kind !== "summary")
    return err(
      viewError("analyze_function Evidence requires a native or summary view."),
    );
  assertOwnedView<SummaryAnalysisView | NativeFacetAnalysisView>(
    view,
    "summary",
    "native",
  );
  const artifact = parent.artifact;
  if (!artifact)
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Native function Evidence requires an artifact-bound subject.",
        },
      ]),
    );
  const common = parentFields(parent, dossier, artifact);
  if (view.kind === "summary") return ok(summaryView(view, dossier, common));
  const availability = facetAvailability(dossier, view.facet);
  if (availability?.available === false)
    common.unknowns = uniqueSorted([...common.unknowns, availability.reason]);
  const singleton = (item: unknown) => ({
    kind: "native" as const,
    view,
    item: jsonValueSchema.parse(item),
    coverage: completeWithinViewCoverage(1, 1),
    ...common,
  });
  if (availability?.available === false) return ok(singleton(availability));
  const flow = dossier.native_value_flow;
  if (
    view.facet === "procedure" ||
    view.facet === "native_api" ||
    view.facet === "value_flow_summary"
  ) {
    if (view.offset !== 0)
      return err(viewError("Singleton native facets require offset 0."));
    if (view.facet === "procedure") return ok(singleton(dossier.procedure));
    if (view.facet === "native_api")
      return ok(
        singleton(
          dossier.native_api ?? { available: false, reason: "not recorded" },
        ),
      );
    const status =
      flow === null
        ? { available: false, reason: "not recorded" }
        : !flow.available
          ? { available: false, reason: flow.reason }
          : {
              available: true,
              provenance: flow.provenance,
              truncated: flow.truncated,
              omitted_operations_lower_bound:
                flow.omitted_operations_lower_bound,
              known_omitted_inputs: flow.known_omitted_inputs,
              known_omitted_edges: flow.known_omitted_edges,
              operations: flow.operations.length,
              def_use: flow.def_use.length,
              effects: flow.effects.length,
              parameters: flow.parameters.length,
              parameter_uses: flow.parameter_uses.length,
            };
    return ok(singleton(status));
  }
  if (view.facet === "pseudocode") {
    const page = analysisTextPage(dossier.pseudocode, view.offset, view.limit);
    return page.ok
      ? ok({ kind: "native" as const, view, ...page.value, ...common })
      : page;
  }
  const rows = nativeRows(dossier, view.facet);
  if (rows === undefined)
    return ok(
      singleton({
        available: false,
        // Only value-flow facets inherit the value-flow failure reason; an
        // older dossier simply has no unresolved_calls record, and a target
        // whose provider does not decode Swift literals has no such record.
        reason:
          view.facet.startsWith("value_flow_") && flow?.available === false
            ? flow.reason
            : "not recorded",
      }),
    );
  const items = rows.slice(view.offset, view.offset + view.limit);
  return ok({
    kind: "native" as const,
    view,
    item: jsonValueSchema.parse(items),
    coverage: pageViewCoverage(view.offset, items.length, rows.length),
    ...common,
  });
};
