/**
 * These immutable projection facts also identify exact historical summaries.
 * Preserve their shipped wording: changing it requires another explicit
 * historical projection variant rather than rewriting retained Evidence.
 */
export const ARTIFACT_INVENTORY_VIEW_CAVEATS = Object.freeze({
  /** Added for ordinary root formats by ce1f4b1bb. */
  unknownTraversal:
    "Producer traversal coverage is unknown; missing matches do not prove source absence.",
  /** Added for ordinary root formats by b395190e4. */
  unknownContentHashes:
    "Content hashes are unknown for some recorded files; missing node IDs do not prove content absence.",
});
