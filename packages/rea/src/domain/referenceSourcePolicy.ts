/** Caller-selected path exclusions for historical source imports. */
export interface ReferenceSourcePolicy {
  readonly secretPatterns: readonly string[];
}
