import {
  Alias,
  isAlias,
  isMap,
  isNode,
  isSeq,
  visit,
  type Document,
  type Node,
} from "yaml";

interface AliasCopies {
  readonly targets: ReadonlyMap<Alias, Node | undefined>;
  readonly removed: ReadonlySet<Node>;
  readonly retained: Map<Node, Node>;
  readonly copied: Set<Node>;
  readonly survivingNames: Map<Node, string>;
  readonly visiting: Set<Node>;
  readonly validated: Set<Node>;
  readonly names: Set<string>;
  readonly reusedNames: ReadonlySet<string>;
}

const copyAliasComments = (source: Alias, copy: Node): Node => {
  for (const key of ["commentBefore", "comment"] as const) {
    const comment = source[key];
    if (comment === undefined) continue;
    copy[key] = copy[key] === undefined ? comment : `${copy[key]}\n${comment}`;
  }
  return copy;
};

const aliasTarget = (source: Alias, context: AliasCopies): Node => {
  const target = context.targets.get(source);
  if (target === undefined)
    throw new TypeError("Cannot preserve an unresolved Hermes YAML alias");
  return target;
};

/** Check copied dependencies even when their definitions will stay in place. */
const validateAliasValue = (source: Node, context: AliasCopies): void => {
  if (context.validated.has(source)) return;
  if (context.visiting.has(source))
    throw new TypeError("Cannot preserve cyclic Hermes YAML aliases");
  context.visiting.add(source);
  visit(source, {
    Alias: (_key, node) =>
      validateAliasValue(aliasTarget(node, context), context),
  });
  context.visiting.delete(source);
  context.validated.add(source);
};

const newAnchorName = (anchor: string, context: AliasCopies): string => {
  let index = 1;
  let name = `${anchor}_rea_preserved`;
  while (context.names.has(name)) name = `${anchor}_rea_preserved_${index++}`;
  context.names.add(name);
  return name;
};

/** Reuse the surviving owner; a later same-name definition must not capture it. */
const survivingAlias = (target: Node, context: AliasCopies): Alias => {
  if (isAlias(target) || target.anchor === undefined)
    throw new TypeError("Invalid Hermes YAML alias target");
  if (!context.reusedNames.has(target.anchor)) return new Alias(target.anchor);
  let name = context.survivingNames.get(target);
  if (name === undefined) {
    name = newAnchorName(target.anchor, context);
    context.survivingNames.set(target, name);
  }
  return new Alias(name);
};

/** Keep source bindings, including nested aliases whose names were later reused. */
const copyAliasValue = (
  source: Node,
  context: AliasCopies,
  cloned?: Node,
): Node => {
  if (isAlias(source)) {
    const target = aliasTarget(source, context);
    return copyAliasComments(
      source,
      context.removed.has(target)
        ? copyAliasValue(target, context)
        : survivingAlias(target, context),
    );
  }
  if (context.visiting.has(source))
    throw new TypeError("Cannot preserve cyclic Hermes YAML aliases");
  const retained = context.retained.get(source);
  if (
    retained !== undefined &&
    !isAlias(retained) &&
    retained.anchor !== undefined
  )
    return new Alias(retained.anchor);
  const copy = cloned ?? source.clone();
  if (!isNode(copy) || isAlias(copy))
    throw new TypeError("Invalid Hermes YAML value copy");
  context.copied.add(source);
  if (source.anchor !== undefined) {
    copy.anchor = newAnchorName(source.anchor, context);
    context.retained.set(source, copy);
  }
  context.visiting.add(source);
  const child = (value: unknown, copied: unknown): unknown =>
    isNode(value)
      ? copyAliasValue(value, context, isNode(copied) ? copied : undefined)
      : copied;
  if (isMap(source) && isMap(copy)) {
    for (const [index, pair] of source.items.entries()) {
      const copied = copy.items[index];
      if (copied === undefined) continue;
      copied.key = child(pair.key, copied.key);
      copied.value = child(pair.value, copied.value);
    }
  } else if (isSeq(source) && isSeq(copy)) {
    copy.items = source.items.map((value, index) =>
      child(value, copy.items[index]),
    );
  }
  context.visiting.delete(source);
  return copy;
};

/** Preserve other consumers before removing anchored configuration nodes. */
export const preserveHermesAliasValues = (
  document: Document,
  previous: readonly unknown[],
): ReadonlySet<Node> => {
  const roots = previous.filter(isNode);
  const removed = new Set<Node>();
  for (const root of roots)
    visit(root, {
      Value: (_key, node) => {
        if (node.anchor !== undefined) removed.add(node);
      },
    });
  if (removed.size === 0) return new Set();
  const targets = new Map<Alias, Node | undefined>();
  const names = new Set<string>();
  const reusedNames = new Set<string>();
  visit(document, {
    Alias: (_key, node) => {
      targets.set(node, node.resolve(document));
    },
    Value: (_key, node) => {
      if (node.anchor === undefined) return;
      if (names.has(node.anchor)) reusedNames.add(node.anchor);
      names.add(node.anchor);
    },
  });
  const context: AliasCopies = {
    targets,
    removed,
    retained: new Map(),
    copied: new Set(),
    survivingNames: new Map(),
    visiting: new Set(),
    validated: new Set(),
    names,
    reusedNames,
  };
  const replacements = new Map<Node, Node>();
  visit(document, {
    Alias: (_key, node, path) => {
      if (!roots.some((root) => path.includes(root))) {
        const target = targets.get(node);
        if (target === undefined || !removed.has(target)) return;
        validateAliasValue(target, context);
        replacements.set(
          node,
          copyAliasComments(node, copyAliasValue(target, context)),
        );
      }
    },
  });
  // Plan every binding against the original document before moving any anchor.
  for (const [target, name] of context.survivingNames)
    if (!isAlias(target)) target.anchor = name;
  visit(document, {
    Alias: (_key, node) => {
      const replacement = replacements.get(node);
      if (replacement !== undefined) return replacement;
      const target = targets.get(node);
      const name =
        target === undefined ? undefined : context.survivingNames.get(target);
      return name === undefined
        ? undefined
        : copyAliasComments(node, new Alias(name));
    },
  });
  return context.copied;
};
