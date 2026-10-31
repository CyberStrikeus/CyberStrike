import * as t from "@babel/types";
import { childNodes } from "./javascriptSemanticTraversal.js";

/** Syntax alone can establish an exit, but never a branch's contextual truth. */
export type ElectronStatementFallthrough =
  | { readonly kind: "exit" }
  | {
      readonly kind: "branch";
      readonly test: t.Expression;
      readonly consequentExits: boolean;
      readonly alternateExits: boolean;
    };

interface Completion {
  readonly fallthrough: boolean;
  readonly exits: boolean;
  readonly breaks: ReadonlySet<string>;
  /** Unsupported control flow may leave the current labelled statement. */
  readonly uncertain: boolean;
}

const FALLTHROUGH: Completion = {
  fallthrough: true,
  exits: false,
  breaks: new Set(),
  uncertain: false,
};
const EXIT: Completion = {
  fallthrough: false,
  exits: true,
  breaks: new Set(),
  uncertain: false,
};
const UNKNOWN: Completion = { ...FALLTHROUGH, uncertain: true };

const mergeCompletions = (left: Completion, right: Completion): Completion => ({
  fallthrough: left.fallthrough || right.fallthrough,
  exits: left.exits || right.exits,
  breaks: new Set([...left.breaks, ...right.breaks]),
  uncertain: left.uncertain || right.uncertain,
});

interface PrefixEntry {
  readonly position: number;
  readonly fact: ElectronStatementFallthrough;
}

interface BlockIndex {
  readonly positions: WeakMap<t.Node, number>;
  readonly entries: readonly PrefixEntry[];
}

/**
 * One collector's immutable syntax facts. Positions replace repeated body
 * searches; ordinary fallthrough statements need no replay. Conditional tests
 * remain present even when neither branch exits, since evaluating them belongs
 * to the invocation's symbolic environment and can establish unknown coverage.
 */
export class ElectronCallPathBlockPrefixes {
  readonly #blocks = new WeakMap<t.BlockStatement, BlockIndex>();
  readonly #facts = new WeakMap<
    t.Statement,
    ElectronStatementFallthrough | null
  >();

  constructor(
    private readonly admitVisit: () => boolean,
    private readonly parents?: WeakMap<t.Node, t.Node>,
  ) {}

  /** Retain jumps that may leave an unsupported construct, without entering functions. */
  private possibleJumps(root: t.Node): Completion | undefined {
    const breaks = new Set<string>();
    let uncertain = false;
    const pending: Array<{ node: t.Node; depth: number }> = [
      { node: root, depth: 0 },
    ];
    while (pending.length > 0) {
      const item = pending.pop();
      if (item === undefined) break;
      const { node, depth } = item;
      if (!this.admitVisit()) return undefined;
      if (depth >= 128) {
        uncertain = true;
        continue;
      }
      if (t.isFunction(node) || t.isClass(node)) continue;
      if (
        (t.isBreakStatement(node) || t.isContinueStatement(node)) &&
        node.label
      ) {
        // Labels inside this unsupported construct consume their own jumps.
        let parent = this.parents?.get(node);
        let local = false;
        while (parent && parent !== root) {
          if (!this.admitVisit()) return undefined;
          if (
            t.isLabeledStatement(parent) &&
            parent.label.name === node.label.name
          ) {
            local = true;
            break;
          }
          parent = this.parents?.get(parent);
        }
        if (!local) breaks.add(node.label.name);
      }
      for (const child of childNodes(node))
        pending.push({ node: child, depth: depth + 1 });
    }
    return { ...FALLTHROUGH, breaks, uncertain };
  }

  /** Track local breaks separately so unreachable statements cannot invent an exit. */
  private completion(
    node: t.Node | null | undefined,
    depth = 0,
  ): Completion | undefined {
    if (!node) return FALLTHROUGH;
    if (depth >= 128) return UNKNOWN;
    if (!this.admitVisit()) return undefined;
    if (t.isReturnStatement(node) || t.isThrowStatement(node)) return EXIT;
    if (t.isBreakStatement(node))
      return {
        fallthrough: false,
        exits: false,
        breaks: new Set([node.label?.name ?? ""]),
        uncertain: false,
      };
    if (t.isLabeledStatement(node)) {
      const body = this.completion(node.body, depth + 1);
      if (body === undefined || !body.breaks.has(node.label.name)) return body;
      const breaks = new Set(body.breaks);
      breaks.delete(node.label.name);
      return { ...body, fallthrough: true, breaks };
    }
    if (t.isBlockStatement(node)) {
      let result = FALLTHROUGH;
      for (const child of node.body) {
        if (!result.fallthrough) break;
        const next = this.completion(child, depth + 1);
        if (next === undefined) return undefined;
        result = mergeCompletions({ ...result, fallthrough: false }, next);
      }
      return result;
    }
    if (
      t.isLoop(node) ||
      t.isSwitchStatement(node) ||
      t.isTryStatement(node) ||
      t.isWithStatement(node)
    )
      return this.possibleJumps(node);
    if (!t.isIfStatement(node)) return FALLTHROUGH;
    const consequent = this.completion(node.consequent, depth + 1);
    if (consequent === undefined) return undefined;
    const alternate = this.completion(node.alternate, depth + 1);
    return alternate === undefined
      ? undefined
      : mergeCompletions(consequent, alternate);
  }

  private exits(
    node: t.Node | null | undefined,
    block: t.BlockStatement,
  ): boolean | undefined {
    const result = this.completion(node);
    if (result === undefined || result.fallthrough || result.uncertain)
      return result === undefined ? undefined : false;
    for (const label of result.breaks) {
      if (!label || !this.parents) return false;
      let matched = false;
      for (
        let parent = this.parents.get(block), n = 0;
        parent && n < 128;
        parent = this.parents.get(parent), n++
      ) {
        if (!this.admitVisit()) return undefined;
        if (t.isFunction(parent)) break;
        if (t.isLabeledStatement(parent) && parent.label.name === label) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return result.exits || result.breaks.size > 0;
  }

  statement(
    statement: t.Statement,
    block: t.BlockStatement,
  ): ElectronStatementFallthrough | null | undefined {
    const cached = this.#facts.get(statement);
    if (cached !== undefined) return cached;
    let fact: ElectronStatementFallthrough | null;
    if (t.isIfStatement(statement)) {
      if (!this.admitVisit()) return undefined;
      const consequent = this.exits(statement.consequent, block);
      const alternate = this.exits(statement.alternate, block);
      if (consequent === undefined || alternate === undefined) return undefined;
      fact =
        consequent && alternate
          ? { kind: "exit" }
          : {
              kind: "branch",
              test: statement.test,
              consequentExits: consequent,
              alternateExits: alternate,
            };
    } else {
      const result = this.exits(statement, block);
      if (result === undefined) return undefined;
      fact = result ? { kind: "exit" } : null;
    }
    this.#facts.set(statement, fact);
    return fact;
  }

  *before(
    block: t.BlockStatement,
    child: t.Node,
  ): Generator<
    void,
    | { readonly entries: readonly PrefixEntry[]; readonly before: number }
    | undefined
  > {
    let index = this.#blocks.get(block);
    if (index === undefined) {
      const positions = new WeakMap<t.Node, number>();
      const entries: PrefixEntry[] = [];
      for (const [position, statement] of block.body.entries()) {
        if (!this.admitVisit()) return undefined;
        positions.set(statement, position);
        const fact = this.statement(statement, block);
        if (fact === undefined) return undefined;
        if (fact !== null) entries.push({ position, fact });
        if ((position + 1) % 1024 === 0) yield;
      }
      index = { positions, entries };
      this.#blocks.set(block, index);
    }
    const before = index.positions.get(child);
    return before === undefined
      ? undefined
      : { entries: index.entries, before };
  }
}
