/** Only these three facts can be unknown; direction is always observed. */
export interface ReferenceCompatibilityRow {
  readonly direction: "in" | "out";
  readonly source: string | null;
  readonly target: string | null;
  readonly kind: string | null;
}

interface ReferenceGroup extends ReferenceCompatibilityRow {
  readonly mask: number;
  count: number;
}

interface FlowEdge {
  readonly to: number;
  readonly reverse: number;
  remaining: number;
}

/** Residual-network invariant. The code is the stable identity. */
class ReferenceFlowError extends Error {
  readonly _tag = "ReferenceFlowError";

  constructor(
    readonly code: "endpoint_unallocated" | "reverse_edge_unallocated",
  ) {
    super(code);
    this.name = "ReferenceFlowError";
  }
}

/** A local residual network: no recursive walk or pairwise adjacency matrix. */
class ReferenceFlow {
  private readonly edges: FlowEdge[][] = [];

  node(): number {
    this.edges.push([]);
    return this.edges.length - 1;
  }

  connect(from: number, to: number, capacity: number): void {
    const forward = this.edges[from];
    const reverse = this.edges[to];
    if (forward === undefined || reverse === undefined)
      throw new ReferenceFlowError("endpoint_unallocated");
    forward.push({ to, reverse: reverse.length, remaining: capacity });
    reverse.push({ to: from, reverse: forward.length - 1, remaining: 0 });
  }

  covers(source: number, sink: number, required: number): boolean {
    let delivered = 0;
    while (delivered < required) {
      const levels = Array<number>(this.edges.length).fill(-1);
      const queue = [source];
      levels[source] = 0;
      for (let index = 0; index < queue.length; index++) {
        const node = queue[index];
        if (node === undefined) break;
        for (const edge of this.edges[node] ?? []) {
          if (edge.remaining <= 0 || levels[edge.to] !== -1) continue;
          levels[edge.to] = (levels[node] ?? -1) + 1;
          queue.push(edge.to);
        }
      }
      if (levels[sink] === -1) return false;
      const next = Array<number>(this.edges.length).fill(0);
      let amount: number;
      while (
        delivered < required &&
        (amount = this.augment(
          source,
          sink,
          required - delivered,
          levels,
          next,
        )) > 0
      )
        delivered += amount;
    }
    return true;
  }

  private augment(
    source: number,
    sink: number,
    capacity: number,
    levels: number[],
    next: number[],
  ): number {
    const nodes = [source];
    const path: FlowEdge[] = [];
    const capacities = [capacity];
    while (nodes.length > 0) {
      const node = nodes[nodes.length - 1];
      if (node === undefined) break;
      if (node === sink) {
        const amount = capacities[capacities.length - 1] ?? 0;
        for (const edge of path) {
          edge.remaining -= amount;
          const reverse = this.edges[edge.to]?.[edge.reverse];
          if (reverse === undefined)
            throw new ReferenceFlowError("reverse_edge_unallocated");
          reverse.remaining += amount;
        }
        return amount;
      }
      const adjacent = this.edges[node] ?? [];
      let edge = adjacent[next[node] ?? 0];
      while (
        edge !== undefined &&
        (edge.remaining <= 0 || levels[edge.to] !== (levels[node] ?? -1) + 1)
      ) {
        next[node] = (next[node] ?? 0) + 1;
        edge = adjacent[next[node] ?? 0];
      }
      if (edge === undefined) {
        levels[node] = -1;
        nodes.pop();
        path.pop();
        capacities.pop();
        continue;
      }
      path.push(edge);
      nodes.push(edge.to);
      capacities.push(
        Math.min(capacities[capacities.length - 1] ?? 0, edge.remaining),
      );
    }
    return 0;
  }
}

const groupRows = (
  rows: readonly ReferenceCompatibilityRow[],
): Map<string, ReferenceGroup> => {
  const groups = new Map<string, ReferenceGroup>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.direction,
      row.source,
      row.target,
      row.kind,
    ]);
    const previous = groups.get(key);
    if (previous !== undefined) previous.count += 1;
    else
      groups.set(key, {
        ...row,
        mask:
          (row.source === null ? 0 : 1) |
          (row.target === null ? 0 : 2) |
          (row.kind === null ? 0 : 4),
        count: 1,
      });
  }
  return groups;
};

/**
 * Decide whether every row can pair without contradicting a known fact.
 * A bucket represents one pair of knowledge masks and their shared facts.
 * Each group joins at most eight buckets, so graph storage is linear in the
 * number of distinct rows. Integer flow preserves multiplicities exactly.
 */
export const referenceFactsCompatible = (
  left: readonly ReferenceCompatibilityRow[],
  right: readonly ReferenceCompatibilityRow[],
): boolean => {
  if (left.length !== right.length) return false;
  if (left.length === 0) return true;
  const leftGroups = groupRows(left);
  const rightGroups = groupRows(right);
  if (
    leftGroups.size === rightGroups.size &&
    [...leftGroups].every(
      ([key, group]) => rightGroups.get(key)?.count === group.count,
    )
  )
    return true;
  if (
    [...leftGroups.values(), ...rightGroups.values()].every(
      ({ mask }) => mask === 7,
    )
  )
    return false;
  // Cancelling an identical complete row is safe: any two partial partners of
  // that row agree on their shared facts and can instead pair with each other.
  // Cancelling identical partial rows is unsafe and must not be done.
  let required = left.length;
  for (const [key, group] of leftGroups) {
    if (group.mask !== 7) continue;
    const other = rightGroups.get(key);
    if (other === undefined) continue;
    const cancelled = Math.min(group.count, other.count);
    group.count -= cancelled;
    other.count -= cancelled;
    required -= cancelled;
    if (group.count === 0) leftGroups.delete(key);
    if (other.count === 0) rightGroups.delete(key);
  }
  const leftMasks = new Set([...leftGroups.values()].map(({ mask }) => mask));
  const rightMasks = new Set([...rightGroups.values()].map(({ mask }) => mask));
  const flow = new ReferenceFlow();
  const source = flow.node();
  const sink = flow.node();
  const buckets = new Map<string, number>();
  const bucket = (
    group: ReferenceGroup,
    leftMask: number,
    rightMask: number,
  ): number => {
    const intersection = leftMask & rightMask;
    const key = JSON.stringify([
      group.direction,
      leftMask,
      rightMask,
      intersection & 1 ? group.source : null,
      intersection & 2 ? group.target : null,
      intersection & 4 ? group.kind : null,
    ]);
    const existing = buckets.get(key);
    if (existing !== undefined) return existing;
    const node = flow.node();
    buckets.set(key, node);
    return node;
  };
  for (const group of leftGroups.values()) {
    const node = flow.node();
    flow.connect(source, node, group.count);
    for (const mask of rightMasks)
      flow.connect(node, bucket(group, group.mask, mask), group.count);
  }
  for (const group of rightGroups.values()) {
    const node = flow.node();
    flow.connect(node, sink, group.count);
    for (const mask of leftMasks)
      flow.connect(bucket(group, mask, group.mask), node, group.count);
  }
  return flow.covers(source, sink, required);
};
