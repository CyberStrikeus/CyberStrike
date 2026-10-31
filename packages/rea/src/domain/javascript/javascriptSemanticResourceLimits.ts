import type {
  JavaScriptSemanticResourceLimit,
  JavaScriptSemanticValue,
} from "./javascriptSemanticValueTypes.js";

/** Maximum distinct alternatives retained in one normalized primitive value. */
export const SEMANTIC_PRIMITIVE_CANDIDATE_LIMIT = 256;
/** Maximum active expression nesting during inert semantic evaluation. */
export const SEMANTIC_EXPRESSION_DEPTH_LIMIT = 256;
/** Getter jobs and local result work retained in one precise query. */
export const SEMANTIC_GETTER_EXPANSION_LIMIT = 512;
/** Additional selector states retained by one precise alias query. */
export const SEMANTIC_ALIAS_SELECTION_LIMIT = 512;
/** Bound normalized strings and transient keys independently of transport limits. */
export const SEMANTIC_PRIMITIVE_JSON_BYTES_LIMIT = 1_048_576;

const RESOURCE_LIMIT_REASON: Record<JavaScriptSemanticResourceLimit, string> = {
  "primitive-candidates":
    "Primitive candidate budget exceeded (maximum 256 alternatives).",
  "primitive-bytes":
    "Primitive string-byte budget exceeded (maximum 1048576 estimated JSON bytes).",
  "expression-depth":
    "Semantic expression depth budget exceeded (maximum 256 nested expressions).",
  "getter-expansion":
    "Getter expansion was conservatively bounded (maximum 512 scheduled states or a growing receiver cycle).",
  "alias-selections":
    "Alias selection expansion was conservatively bounded (maximum 512 additional selector states); selected paths remain unknown.",
};

/** Check UTF-16 length against worst-case JSON escaping without flattening. */
const jsonStringBytesFromLength = (codeUnits: number): number =>
  codeUnits * 6 + 2;

/** Bound string payload before JSON key serialization or candidate creation. */
export const exceedsSemanticPrimitiveStringByteBudget = (
  strings: Iterable<string>,
): boolean => {
  let total = 0;
  for (const value of strings) {
    total += jsonStringBytesFromLength(value.length);
    if (total > SEMANTIC_PRIMITIVE_JSON_BYTES_LIMIT) return true;
  }
  return false;
};

/** Bound all outputs of a primitive addition before concatenating any. */
export const exceedsSemanticPrimitiveAdditionByteBudget = (
  left: readonly (string | number | boolean | null)[],
  right: readonly (string | number | boolean | null)[],
): boolean => {
  let total = 0;
  for (const leftValue of left) {
    for (const rightValue of right) {
      if (typeof leftValue !== "string" && typeof rightValue !== "string")
        continue;
      const length = String(leftValue).length + String(rightValue).length;
      total += jsonStringBytesFromLength(length);
      if (total > SEMANTIC_PRIMITIVE_JSON_BYTES_LIMIT) return true;
    }
  }
  return false;
};

/** Bound template interpolation outputs before creating concatenated strings. */
export const exceedsSemanticTemplateByteBudget = (
  prefixes: readonly string[],
  suffixes: readonly string[],
): boolean => {
  let total = 0;
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      total += jsonStringBytesFromLength(prefix.length + suffix.length);
      if (total > SEMANTIC_PRIMITIVE_JSON_BYTES_LIMIT) return true;
    }
  }
  return false;
};

/** Make an explicit unknown value tagged with the semantic resource bound. */
export const semanticResourceLimitUnknown = (
  resourceLimit: JavaScriptSemanticResourceLimit,
): JavaScriptSemanticValue => ({
  status: "unknown",
  reason: RESOURCE_LIMIT_REASON[resourceLimit],
  resourceLimit,
});

/** Display label for one stable resource classification. */
export const semanticResourceLimitReason = (
  resourceLimit: JavaScriptSemanticResourceLimit,
): string => RESOURCE_LIMIT_REASON[resourceLimit];
