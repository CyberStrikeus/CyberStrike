import { isNode, type Node, type YAMLSeq } from "yaml";

/** Move unique argument annotations with their value; keep ambiguous comments on the list. */
export const retainYamlSequenceAnnotations = (
  previous: YAMLSeq,
  next: YAMLSeq,
  valueOf: (item: unknown) => unknown,
  retain: (source: Node, target: Node) => Node,
  ownsComments: (source: Node) => boolean,
): void => {
  const sourceCounts = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  const targets = new Map<string, number>();
  for (const item of previous.items) {
    const value = valueOf(item);
    if (typeof value === "string")
      sourceCounts.set(value, (sourceCounts.get(value) ?? 0) + 1);
  }
  next.items.forEach((item, index) => {
    const value = valueOf(item);
    if (typeof value !== "string" || !isNode(item)) return;
    targetCounts.set(value, (targetCounts.get(value) ?? 0) + 1);
    targets.set(value, index);
  });
  const orphaned: string[] = [];
  for (const source of previous.items) {
    if (!isNode(source)) continue;
    const value = valueOf(source);
    const index =
      typeof value === "string" &&
      sourceCounts.get(value) === 1 &&
      targetCounts.get(value) === 1
        ? targets.get(value)
        : undefined;
    const target = index === undefined ? undefined : next.items[index];
    if (index !== undefined && isNode(target))
      next.items[index] = retain(source, target);
    else if (ownsComments(source)) {
      for (const comment of [source.commentBefore, source.comment])
        if (typeof comment === "string") orphaned.push(comment);
    }
  }
  if (orphaned.length > 0)
    next.commentBefore = [next.commentBefore, ...orphaned]
      .filter((comment): comment is string => typeof comment === "string")
      .join("\n");
};
