import type {
  JavaScriptAnalysisAccumulator,
  JavaScriptFindingContext,
  JavaScriptModuleRange,
  LocatedJavaScriptFinding,
  LocatedJavaScriptFindingInput,
} from "./javascriptStaticAnalysisState.js";

interface IndexedModuleRange {
  readonly order: number;
  readonly range: JavaScriptModuleRange;
}

interface ModuleRangeTreeNode {
  left?: ModuleRangeTreeNode;
  right?: ModuleRangeTreeNode;
  best?: IndexedModuleRange;
}

/** Incremental point lookup preserving insertion-order precedence for overlaps. */
export class JavaScriptModuleRangeIndex {
  private readonly root: ModuleRangeTreeNode = {};
  private readonly end: number;
  private nextOrder = 0;

  /** Create an empty offset index bounded by the analyzed source length. */
  constructor(sourceLength: number) {
    this.end = Math.max(1, sourceLength + 1);
  }

  /** Add a module range in the same discovery order used by the analysis pass. */
  add(range: JavaScriptModuleRange): void {
    const indexed = { order: this.nextOrder, range };
    this.nextOrder += 1;
    const start = Math.max(0, range.start);
    const end = Math.min(this.end, range.end + 1);
    if (start < end) this.insert(this.root, 0, this.end, start, end, indexed);
  }

  /** Return the first discovered inclusive range containing an offset. */
  find(offset: number | null | undefined): JavaScriptModuleRange | undefined {
    if (
      offset === null ||
      offset === undefined ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= this.end
    )
      return undefined;
    let node: ModuleRangeTreeNode | undefined = this.root;
    let low = 0;
    let high = this.end;
    let best: IndexedModuleRange | undefined;
    while (node !== undefined) {
      if (
        node.best !== undefined &&
        (best === undefined || node.best.order < best.order)
      )
        best = node.best;
      if (high - low <= 1) break;
      const middle = low + Math.floor((high - low) / 2);
      if (offset < middle) {
        node = node.left;
        high = middle;
      } else {
        node = node.right;
        low = middle;
      }
    }
    return best?.range;
  }

  private insert(
    node: ModuleRangeTreeNode,
    low: number,
    high: number,
    queryLow: number,
    queryHigh: number,
    value: IndexedModuleRange,
  ): void {
    if (queryLow <= low && high <= queryHigh) {
      if (node.best === undefined || value.order < node.best.order)
        node.best = value;
      return;
    }
    const middle = low + Math.floor((high - low) / 2);
    if (queryLow < middle) {
      node.left ??= {};
      this.insert(node.left, low, middle, queryLow, queryHigh, value);
    }
    if (queryHigh > middle) {
      node.right ??= {};
      this.insert(node.right, middle, high, queryLow, queryHigh, value);
    }
  }
}

/** Add one module-attributable finding once per source location. */
export const addLocatedFinding = <
  Value extends { readonly module_key: string | null },
>(
  context: JavaScriptFindingContext,
  input: LocatedJavaScriptFindingInput<Value>,
): void =>
  addFindingOnce(
    context.accumulator,
    `${input.key}\0${String(input.node.start)}`,
    () =>
      input.collection.push({
        offset: input.node.start ?? -1,
        value: input.value,
      }),
  );

/** Reserve one deterministic finding key before mutating an accumulator. */
export const addFindingOnce = (
  accumulator: JavaScriptAnalysisAccumulator,
  key: string,
  add: () => void,
): void => {
  if (accumulator.seen.has(key)) return;
  accumulator.seen.add(key);
  add();
};

/** Attach recovered bundle-module ownership to findings after traversal. */
export const finalizeLocatedFindings = <
  Value extends { readonly module_key: string | null },
>(
  values: readonly LocatedJavaScriptFinding<Value>[],
  modules: JavaScriptModuleRangeIndex,
): Value[] =>
  values.map(({ offset, value }) => {
    const module = modules.find(offset);
    return {
      ...value,
      module_key: module?.key ?? null,
      ...(module === undefined ? {} : { module_runtime: module.runtime }),
    };
  });
