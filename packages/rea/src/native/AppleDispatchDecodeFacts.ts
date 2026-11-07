/** Stable internal decode issues used to derive public facet coverage. */
export type DispatchFacet =
  | "objc_class_method_ivar_metadata"
  | "binary_relative_pointers"
  | "objc_properties_categories"
  | "pointer_fixups"
  | "swift_conformances_static_witness_slots"
  | "swift_declarations"
  | "swift_class_vtable_descriptors";

export interface DecodeIssue {
  readonly facet: DispatchFacet;
  readonly code: string;
  readonly location?: string;
  readonly message: string;
}

export interface FacetDecodeFacts {
  readonly facet: DispatchFacet;
  readonly examined: number;
  readonly decoded: number;
  readonly exhaustive: boolean;
  readonly issues: readonly DecodeIssue[];
}

export const issue = (
  facet: DispatchFacet,
  code: string,
  message: string,
  location?: string,
): DecodeIssue => ({
  facet,
  code,
  message,
  ...(location === undefined ? {} : { location }),
});
