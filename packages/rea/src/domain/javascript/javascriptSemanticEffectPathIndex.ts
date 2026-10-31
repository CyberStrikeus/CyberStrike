import type { JavaScriptSemanticMemberEffect } from "./javascriptSemanticState.js";
import {
  semanticAliasSelectionChoices,
  type SemanticAliasSelectionPath,
} from "./javascriptSemanticAliasSelections.js";
import {
  semanticPropertyPathKeyMatches,
  type JavaScriptSemanticPropertyPath,
} from "./javascriptSemanticPropertyPaths.js";

/** Whether an effect recorded at one member path can reach a projected read. */
export const semanticEffectPathMatches = (
  effectPath: JavaScriptSemanticPropertyPath,
  path: SemanticAliasSelectionPath,
): boolean =>
  path.length > 0 &&
  effectPath.length <= path.length &&
  effectPath.every((key, index) => {
    const selected = path[index];
    return (
      selected !== undefined &&
      semanticAliasSelectionChoices(selected).some(
        (choice) =>
          choice === null ||
          typeof choice === "object" ||
          semanticPropertyPathKeyMatches(key, String(choice)),
      )
    );
  });

// Most nodes are leaves of one path. Materialize each collection only when it
// holds a record or child.
interface EffectPathNode {
  /** Record positions whose recorded path ends at this depth. */
  ends?: number[];
  /** Children for exact keys, by their string property name. */
  exact?: Map<string, EffectPathNode>;
  /** Child for a wildcard or copied-slot key, which can match any name. */
  open?: EffectPathNode;
}

interface EffectPathIndex {
  readonly root: EffectPathNode;
  indexed: number;
}

// Binding member effects are append-only, so each index extends itself with
// records appended since its previous query and lives as long as its records.
const effectPathIndexes = new WeakMap<
  readonly JavaScriptSemanticMemberEffect[],
  EffectPathIndex
>();

const currentEffectPathIndex = (
  effects: readonly JavaScriptSemanticMemberEffect[],
): EffectPathIndex => {
  let index = effectPathIndexes.get(effects);
  if (index === undefined) {
    index = { root: {}, indexed: 0 };
    effectPathIndexes.set(effects, index);
  }
  for (; index.indexed < effects.length; index.indexed++) {
    let node = index.root;
    for (const key of effects[index.indexed]!.path) {
      if (key === null || typeof key === "object") node = node.open ??= {};
      else {
        const exact = (node.exact ??= new Map());
        const name = String(key);
        let child = exact.get(name);
        if (child === undefined) {
          child = {};
          exact.set(name, child);
        }
        node = child;
      }
    }
    (node.ends ??= []).push(index.indexed);
  }
  return index;
};

// Visit record positions whose recorded path may match a projected read, in
// index order. Only records longer than the read, or with an exact key that no
// selected choice names, are skipped; wildcard and copied-slot keys remain.
// Returns true as soon as `visit` does.
const visitEffectPathCandidates = (
  effects: readonly JavaScriptSemanticMemberEffect[],
  path: SemanticAliasSelectionPath,
  visit: (position: number) => boolean,
): boolean => {
  const pending = [{ node: currentEffectPathIndex(effects).root, depth: 0 }];
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    for (const position of node.ends ?? []) if (visit(position)) return true;
    if (depth >= path.length) continue;
    if (node.open !== undefined)
      pending.push({ node: node.open, depth: depth + 1 });
    const exact = node.exact;
    if (exact === undefined) continue;
    const choices = semanticAliasSelectionChoices(path[depth]!);
    if (choices.some((choice) => choice === null || typeof choice === "object"))
      for (const child of exact.values())
        pending.push({ node: child, depth: depth + 1 });
    else
      for (const name of new Set(choices.map((choice) => String(choice)))) {
        const child = exact.get(name);
        if (child !== undefined)
          pending.push({ node: child, depth: depth + 1 });
      }
  }
  return false;
};

/**
 * Effects whose recorded path may match a projected read, in record order.
 * Candidates are a superset, so callers still apply `semanticEffectPathMatches`.
 */
export const semanticEffectPathCandidates = (
  effects: readonly JavaScriptSemanticMemberEffect[],
  path: SemanticAliasSelectionPath,
): readonly JavaScriptSemanticMemberEffect[] => {
  const positions: number[] = [];
  visitEffectPathCandidates(effects, path, (position) => {
    positions.push(position);
    return false;
  });
  return positions
    .sort((left, right) => left - right)
    .map((position) => effects[position]!);
};

/** Whether any candidate effect for a projected read satisfies `predicate`. */
export const semanticSomeEffectPathCandidate = (
  effects: readonly JavaScriptSemanticMemberEffect[],
  path: SemanticAliasSelectionPath,
  predicate: (effect: JavaScriptSemanticMemberEffect) => boolean,
): boolean =>
  visitEffectPathCandidates(effects, path, (position) =>
    predicate(effects[position]!),
  );
