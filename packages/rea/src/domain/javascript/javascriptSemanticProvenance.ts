import type {
  JavaScriptBindingProvenance,
  JavaScriptModuleOrigin,
} from "./javascriptSemanticIr.js";
import type { JavaScriptSemanticPrimitive } from "./javascriptSemanticValueTypes.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";

/** Construct exact local provenance without inventing module origins. */
export const semanticLocalProvenance = (): JavaScriptBindingProvenance => ({
  status: "local",
  origins: [],
  reason: null,
});

/** Construct an unresolved provenance outcome with an actionable reason. */
export const semanticUnresolvedProvenance = (
  status: "unknown" | "cycle",
  reason: string,
): JavaScriptBindingProvenance => ({ status, origins: [], reason });

/** Construct ambiguous provenance while retaining every origin. */
export const semanticAmbiguousProvenance = (
  origins: readonly JavaScriptModuleOrigin[],
  reason: string,
): JavaScriptBindingProvenance => ({ status: "ambiguous", origins, reason });

/** Normalize exact module origins into one provenance classification. */
export const semanticOriginsProvenance = (
  origins: readonly JavaScriptModuleOrigin[],
): JavaScriptBindingProvenance => {
  const unique = uniqueSemanticOrigins(origins);
  const origin = unique[0];
  return unique.length === 1 && origin !== undefined
    ? { status: "module", origins: [origin], reason: null }
    : semanticAmbiguousProvenance(unique, "Multiple module origins.");
};

/** Deduplicate and canonically order module origins. */
export const uniqueSemanticOrigins = (
  origins: readonly JavaScriptModuleOrigin[],
): JavaScriptModuleOrigin[] =>
  [
    ...new Map(
      origins.map((origin) => [semanticOriginKey(origin), origin]),
    ).values(),
  ].sort((left, right) =>
    compareUnicodeCodePoints(semanticOriginKey(left), semanticOriginKey(right)),
  );

const semanticOriginKey = (origin: JavaScriptModuleOrigin): string =>
  JSON.stringify([
    origin.specifier,
    origin.importedPath,
    origin.resolutionMode ?? "import",
  ]);

/** Canonically distinguish primitive values across type boundaries. */
export const semanticPrimitiveKey = (
  value: JavaScriptSemanticPrimitive,
): string =>
  `${value === null ? "null" : typeof value}:${JSON.stringify(value)}`;

/** Match namespace paths only after the caller has identified a Node built-in. */
export const semanticBuiltinNamespacePath = (
  importedPath: readonly string[],
): boolean =>
  importedPath.length === 0 ||
  (importedPath.length === 1 && importedPath[0] === "default");
