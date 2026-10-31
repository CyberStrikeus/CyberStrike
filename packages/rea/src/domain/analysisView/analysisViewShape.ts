import { z } from "zod";
import { prefixedDigestSchema } from "../digests.js";

export const summaryViewSchema = z.strictObject({ kind: z.literal("summary") });
export const facetViewSchema = z.strictObject({
  kind: z.literal("facet"),
  facet: z.enum(["mitigations", "linkage"]),
});
const indexSelectorSchema = z.strictObject({
  index: z.int().nonnegative(),
});
const nameSelectorSchema = z.strictObject({
  name: z
    .string()
    .describe(
      "Exact UTF-8 section or symbol name, matched against retained source bytes. Use index for non-UTF-8 names or unresolved name bytes.",
    ),
});
const pathSelectorSchema = z.strictObject({
  path: z
    .string()
    .describe(
      "Exact observed module path or original source-map reference from a module page; an empty reference is valid.",
    ),
});
const nodeIdSelectorSchema = z.strictObject({
  node_id: prefixedDigestSchema("jag_node"),
});
const moduleItemViewSchema = z.strictObject({
  kind: z.literal("item"),
  collection: z.literal("modules"),
  selector: z.union([pathSelectorSchema, nodeIdSelectorSchema]),
});
const sectionOrSymbolItemViewSchema = z.strictObject({
  kind: z.literal("item"),
  collection: z.enum(["sections", "symbols"]),
  selector: z.union([indexSelectorSchema, nameSelectorSchema]),
});
/**
 * The collection-specific selector alternatives are expressed in the owning
 * contract so the advertised JSON Schema preserves them: modules accept
 * path/node_id, sections and symbols accept index/name. Refinement-only
 * constraints do not survive JSON Schema conversion, so the advertised
 * schema previously accepted combinations that runtime input validation
 * rejects.
 */
export const itemViewSchema = z.discriminatedUnion("collection", [
  moduleItemViewSchema,
  sectionOrSymbolItemViewSchema,
]);
export const pageViewSchema = z.strictObject({
  kind: z.literal("page"),
  collection: z.enum(["sections", "symbols", "modules"]),
  offset: z.int().nonnegative(),
  limit: z.int().positive(),
});

/** Bounded native function facets of already authenticated analyze_function Evidence. */
export const nativeViewSchema = z.strictObject({
  kind: z.literal("native"),
  facet: z.enum([
    "procedure",
    "pseudocode",
    "assembly",
    "basic_blocks",
    "comments",
    "callers",
    "callees",
    "incoming_references",
    "outgoing_references",
    "unresolved_calls",
    "referenced_strings",
    "referenced_names",
    "swift_string_literals",
    "swift_string_literal_omissions",
    "native_api",
    "value_flow_summary",
    "value_flow_operations",
    "value_flow_def_use",
    "value_flow_effects",
    "value_flow_parameters",
    "value_flow_parameter_uses",
  ]),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

export type SummaryAnalysisView = z.output<typeof summaryViewSchema>;
export type FacetAnalysisView = z.output<typeof facetViewSchema>;
export type ItemAnalysisView = z.output<typeof itemViewSchema>;
export type PageAnalysisView = z.output<typeof pageViewSchema>;
export type NativeFacetAnalysisView = z.output<typeof nativeViewSchema>;

/** Views that group a capture's records into tools. */
export type GroupingViewKind =
  | "api-surface"
  | "environment-manifest"
  | "environment-state"
  | "environment-coverage";

/**
 * View request already admitted by analysisViewRequestSchema.
 * Projectors use this supertype so they do not import the request union.
 */
export type AdmittedView = { readonly kind: string };

/**
 * Restore the owning schema output after admission.
 * analysisViewRequestSchema already checked the fields for these kinds.
 */
export const ownedView = <View extends { readonly kind: string }>(
  view: AdmittedView,
  ...kinds: readonly View["kind"][]
): View | undefined =>
  (kinds as readonly string[]).includes(view.kind) ? (view as View) : undefined;

/** Narrow an admitted view after the projector has rejected other kinds. */
export function assertOwnedView<View extends { readonly kind: string }>(
  view: AdmittedView,
  ...kinds: readonly View["kind"][]
): asserts view is View {
  if (!(kinds as readonly string[]).includes(view.kind)) {
    throw new Error(
      `Analysis view kind ${JSON.stringify(view.kind)} is not owned by this projector.`,
    );
  }
}
