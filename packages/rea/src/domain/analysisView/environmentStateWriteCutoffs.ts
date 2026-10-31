import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";
import {
  isParam,
  rootOf,
  type StateRecordFacts,
} from "./environmentStateRules.js";

interface WriteRootNode {
  readonly children: Map<string, WriteRootNode>;
  wildcard: WriteRootNode | undefined;
  exact: StateRecordFacts | undefined;
  first: StateRecordFacts | undefined;
}

const node = (): WriteRootNode => ({
  children: new Map(),
  wildcard: undefined,
  exact: undefined,
  first: undefined,
});

/** Parsed write roots with the earliest write at each prefix and subtree. */
export class StateWriteCutoffs {
  readonly #root: WriteRootNode;

  constructor(
    writes: readonly StateRecordFacts[],
    bases: ReadonlyMap<string, number>,
    private readonly before: (
      left: StateRecordFacts,
      right: StateRecordFacts,
    ) => boolean,
    retain: (bytes: number) => void,
  ) {
    // Admission covers node maps, references and the iterative lookup frontier.
    retain(ENTRY_BYTES * 4);
    this.#root = node();
    for (const write of writes) {
      let current = this.#root;
      current.first = this.#earlier(current.first, write);
      for (const segment of rootOf(write.path, bases)) {
        const wildcard = isParam(segment);
        let child = wildcard ? current.wildcard : current.children.get(segment);
        if (child === undefined) {
          retain(ENTRY_BYTES * 4 + textBytes(segment.length));
          child = node();
          if (wildcard) current.wildcard = child;
          else current.children.set(segment, child);
        }
        current = child;
        current.first = this.#earlier(current.first, write);
      }
      current.exact = this.#earlier(current.exact, write);
    }
  }

  #earlier(
    left: StateRecordFacts | undefined,
    right: StateRecordFacts | undefined,
  ): StateRecordFacts | undefined {
    if (right === undefined) return left;
    return left === undefined || this.before(right, left) ? right : left;
  }

  /** Earliest ancestor/descendant match; parameters on either side match any one segment. */
  first(root: readonly string[]): StateRecordFacts | undefined {
    const nodes = [this.#root];
    const depths = [0];
    let first: StateRecordFacts | undefined;
    while (nodes.length > 0) {
      const current = nodes.pop()!;
      const depth = depths.pop()!;
      first = this.#earlier(first, current.exact);
      if (
        depth === root.length ||
        (depth === root.length - 1 && isParam(root[depth]!))
      ) {
        first = this.#earlier(first, current.first);
        continue;
      }
      const segment = root[depth]!;
      if (isParam(segment)) {
        for (const child of current.children.values()) {
          nodes.push(child);
          depths.push(depth + 1);
        }
      } else {
        const child = current.children.get(segment);
        if (child !== undefined) {
          nodes.push(child);
          depths.push(depth + 1);
        }
      }
      if (current.wildcard !== undefined) {
        nodes.push(current.wildcard);
        depths.push(depth + 1);
      }
    }
    return first;
  }
}
