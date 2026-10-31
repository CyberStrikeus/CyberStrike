import {
  compareUnicodeCodePoints as compare,
  compositeKey,
} from "../unicodeCodePointOrder.js";
import { VERSION_TOKEN, type RoutePart } from "./environmentManifestRules.js";
import { ROUTE_RULES } from "./webNetworkRouteTemplates.js";

const DROPPED_NAME_LITERALS = new Set(["api", "apis", "namespaces", "default"]);
const TOOL_NAME_LIMIT = 60;
const BASE_RULES: ReadonlySet<string> = new Set(ROUTE_RULES);

const sanitizeToken = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/gu, "_")
    .replaceAll(/_+/gu, "_")
    .replace(/^_/u, "")
    .replace(/_$/u, "");

const singular = (word: string): string => {
  if (word.endsWith("ies") && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
};

const paramBaseName = (parts: readonly RoutePart[], index: number): string => {
  const part = parts[index];
  if (part?.kind !== "param") return "";
  // A prefix-variance parameter is named as the parameter it shares a position with.
  switch (part.rule === "prefix-variance" ? part.sharedRule : part.rule) {
    case "numeric":
      return "id";
    case "uuid":
      return "uuid";
    case "hex":
      return "hash";
    case "iso-date":
      return "date";
    case "after-uid-literal":
    case "opaque-token":
      return "uid";
    case "sibling-variance": {
      const previous = parts[index - 1];
      const stem =
        previous?.kind === "literal"
          ? sanitizeToken(singular(previous.value))
          : "";
      return stem.length > 0 ? `${stem}_id` : "id";
    }
    case "sibling-pair-variance": {
      // The role was fixed when the pair formed; the plural literal precedes the pair's first half.
      const role = part.pairRole ?? "namespace";
      const plural = parts[role === "name" ? index - 2 : index - 1];
      const stem =
        plural?.kind === "literal" ? sanitizeToken(singular(plural.value)) : "";
      return stem.length > 0 ? `${stem}_${role}` : role;
    }
  }
};

/** Parameter names in segment order; repeated names get numeric suffixes. */
export const parameterNames = (parts: readonly RoutePart[]): string[] => {
  const used = new Map<string, number>();
  return parts.flatMap((part, index) => {
    if (part.kind !== "param") return [];
    const base = paramBaseName(parts, index);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return [count === 0 ? base : `${base}_${String(count + 1)}`];
  });
};

/** Format-rule placeholders keep their api-surface spelling; opt-in rules use the parameter name. */
export const pathTemplate = (
  parts: readonly RoutePart[],
  names: readonly string[],
): string => {
  let next = 0;
  return `/${parts
    .map((part) => {
      if (part.kind === "literal") return part.value;
      const name = names[next] ?? "";
      next += 1;
      return BASE_RULES.has(part.rule) ? `{${part.rule}}` : `{${name}}`;
    })
    .join("/")}`;
};

/** Names assigned in one manifest and the next suffix to try for each colliding truncated base. */
export interface ToolNameRegistry {
  readonly used: Set<string>;
  readonly nextSuffix: Map<string, number>;
}
export const toolNameRegistry = (): ToolNameRegistry => ({
  used: new Set(),
  nextSuffix: new Map(),
});
/** Deterministic tool name from the method and route literals, unique within a manifest. */
export const toolName = (
  method: string,
  parts: readonly RoutePart[],
  names: readonly string[],
  registry: ToolNameRegistry,
): string => {
  const literals = parts.flatMap((part, index) => {
    if (part.kind !== "literal") return [];
    const value = part.value;
    if (
      value.length === 0 ||
      DROPPED_NAME_LITERALS.has(value) ||
      VERSION_TOKEN.test(value) ||
      (value === "uid" && parts[index + 1]?.kind === "param")
    )
      return [];
    return [value.split(".")[0] ?? ""];
  });
  const base =
    sanitizeToken(
      [
        method.toLowerCase(),
        ...literals,
        ...(names.length > 0 ? ["by", ...names] : []),
      ].join("_"),
    ) || "tool";
  const truncate = (text: string, limit: number): string =>
    text.slice(0, limit).replace(/_+$/u, "");
  let candidate = truncate(base, TOOL_NAME_LIMIT);
  if (registry.used.has(candidate)) {
    let suffix = 2;
    for (;;) {
      const tail = `_${String(suffix)}`;
      const prefix = truncate(base, TOOL_NAME_LIMIT - tail.length);
      // Suffixes can truncate distinct full names to the same prefix. Share
      // progress for that actual candidate family, separately for each width:
      // a longer suffix can change the prefix and must not skip free short names.
      const namespace = compositeKey([prefix, tail.length]);
      const next = registry.nextSuffix.get(namespace) ?? suffix;
      if (next > suffix) {
        suffix = next;
        continue;
      }
      candidate = `${prefix}${tail}`;
      registry.nextSuffix.set(namespace, suffix + 1);
      if (!registry.used.has(candidate)) break;
      suffix += 1;
    }
  }
  registry.used.add(candidate);
  return candidate;
};

/** Sort tools by template then method with locale-independent ordering. */
export const compareTools = (
  left: { readonly template: string; readonly method: string },
  right: { readonly template: string; readonly method: string },
): number =>
  compare(left.template, right.template) || compare(left.method, right.method);
