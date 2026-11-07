/** Slots retained by a shallow copy after exclusions or an array prefix. */
export interface JavaScriptSemanticPropertySelection {
  readonly excludedKeys: readonly string[];
  readonly startIndex?: number;
}

/** Internal mutation path, including selected children of a shallow copy. */
export type JavaScriptSemanticPropertyPath = readonly (
  | string
  | number
  | null
  | JavaScriptSemanticPropertySelection
)[];

/** Join equal-depth may-effect projections without claiming an exact selector. */
export function joinSemanticPropertyPaths(
  previous: readonly (string | null)[],
  incoming: readonly (string | null)[],
): readonly (string | null)[] | undefined;
export function joinSemanticPropertyPaths(
  previous: JavaScriptSemanticPropertyPath,
  incoming: JavaScriptSemanticPropertyPath,
): JavaScriptSemanticPropertyPath | undefined;
export function joinSemanticPropertyPaths(
  previous: JavaScriptSemanticPropertyPath,
  incoming: JavaScriptSemanticPropertyPath,
): JavaScriptSemanticPropertyPath | undefined {
  if (previous.length !== incoming.length) return undefined;
  const joined = previous.map((key, index) =>
    joinPropertySelections(key, incoming[index]!),
  );
  return joined.every((key, index) => key === previous[index])
    ? previous
    : joined;
}

const joinPropertySelections = (
  previous: JavaScriptSemanticPropertyPath[number],
  incoming: JavaScriptSemanticPropertyPath[number],
): JavaScriptSemanticPropertyPath[number] => {
  if (keyCovers(previous, incoming)) return previous;
  if (keyCovers(incoming, previous)) return incoming;
  if (previous === null || incoming === null) return null;
  if (typeof previous !== "object" && typeof incoming !== "object") return null;
  if (typeof previous === "object" && typeof incoming === "object")
    return {
      excludedKeys: previous.excludedKeys.filter((key) =>
        incoming.excludedKeys.includes(key),
      ),
      ...(previous.startIndex === undefined || incoming.startIndex === undefined
        ? {}
        : { startIndex: Math.min(previous.startIndex, incoming.startIndex) }),
    };
  const selected = typeof previous === "object" ? previous : incoming;
  const scalar = typeof previous === "object" ? incoming : previous;
  if (typeof selected !== "object" || typeof scalar === "object") return null;
  const index = semanticArrayIndex(scalar);
  return {
    excludedKeys: selected.excludedKeys.filter((key) => key !== String(scalar)),
    ...(selected.startIndex === undefined || index === null
      ? {}
      : { startIndex: Math.min(selected.startIndex, index) }),
  };
};

/** Read only canonical JavaScript array indices, excluding named properties. */
export const semanticArrayIndex = (key: string | number): number | null => {
  const index = Number(key);
  return Number.isInteger(index) &&
    index >= 0 &&
    index < 4_294_967_295 &&
    String(index) === String(key)
    ? index
    : null;
};

/** Test an exact key, wildcard, or copied-slot selection against an own key. */
export const semanticPropertyPathKeyMatches = (
  key: JavaScriptSemanticPropertyPath[number],
  name: string,
): boolean => {
  if (key === null) return true;
  if (typeof key !== "object") return String(key) === name;
  if (key.excludedKeys.includes(name)) return false;
  if (key.startIndex === undefined) return true;
  const index = semanticArrayIndex(name);
  return index !== null && index >= key.startIndex;
};

interface PropertyPathCoverageNode {
  terminal: boolean;
  readonly exact: Map<string, PropertyPathCoverageNode>;
  readonly selectors: Map<
    string,
    {
      readonly key: JavaScriptSemanticPropertyPath[number];
      readonly context: string | undefined;
      readonly node: PropertyPathCoverageNode;
    }
  >;
}

const coverageNode = (): PropertyPathCoverageNode => ({
  terminal: false,
  exact: new Map(),
  selectors: new Map(),
});

/** Index exact effect prefixes without widening distinct member paths. */
export class SemanticPropertyPathCoverage {
  readonly #root = coverageNode();

  /** Match optional per-slot receiver identities along the covering prefix. */
  retain(
    path: JavaScriptSemanticPropertyPath,
    contexts?: readonly (string | undefined)[],
  ): boolean {
    if (this.covers(path, contexts)) return false;
    let node = this.#root;
    for (const [offset, key] of path.entries()) {
      const context = contexts?.[offset];
      if (key !== null && typeof key !== "object") {
        const name = JSON.stringify([String(key), context]);
        let child = node.exact.get(name);
        if (child === undefined) {
          child = coverageNode();
          node.exact.set(name, child);
        }
        node = child;
      } else {
        const identity = JSON.stringify([key, context]);
        let selected = node.selectors.get(identity);
        if (selected === undefined) {
          selected = { key, context, node: coverageNode() };
          node.selectors.set(identity, selected);
        }
        node = selected.node;
      }
    }
    node.terminal = true;
    node.exact.clear();
    node.selectors.clear();
    return true;
  }

  /** Query retained prefixes without changing the coverage index. */
  covers(
    path: JavaScriptSemanticPropertyPath,
    contexts?: readonly (string | undefined)[],
  ): boolean {
    const pending = [{ node: this.#root, offset: 0 }];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      if (current.node.terminal) return true;
      const key = path[current.offset];
      if (key === undefined) continue;
      const context = contexts?.[current.offset];
      if (key !== null && typeof key !== "object") {
        const exact = current.node.exact.get(
          JSON.stringify([String(key), context]),
        );
        if (exact !== undefined)
          pending.push({ node: exact, offset: current.offset + 1 });
      }
      for (const selected of current.node.selectors.values()) {
        if (selected.context === context && keyCovers(selected.key, key))
          pending.push({ node: selected.node, offset: current.offset + 1 });
      }
    }
    return false;
  }
}

const keyCovers = (
  covering: JavaScriptSemanticPropertyPath[number],
  key: JavaScriptSemanticPropertyPath[number],
): boolean => {
  if (covering === null) return true;
  if (key === null) return false;
  if (typeof key !== "object")
    return typeof covering === "object"
      ? semanticPropertyPathKeyMatches(covering, String(key))
      : String(covering) === String(key);
  return (
    typeof covering === "object" &&
    covering.excludedKeys.every((name) => key.excludedKeys.includes(name)) &&
    (covering.startIndex === undefined ||
      (key.startIndex !== undefined && covering.startIndex <= key.startIndex))
  );
};
