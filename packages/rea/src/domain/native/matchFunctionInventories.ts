import { digestCanonicalValue } from "../canonicalDigest.js";
import type { MatchingFunction } from "./functionInventory.js";
import type { NativeMatchingCheckpoint } from "./functionByteCoverage.js";
import type {
  NativeFunctionMatch,
  NativeFunctionMatching,
} from "./functionMatching.js";

type Groups = ReadonlyMap<string, MatchingFunction[]>;
type PairingIndexes = readonly [Groups, Groups];
interface MatchInput {
  readonly state: NativeFunctionMatch["state"];
  readonly basis: NativeFunctionMatch["basis"];
  readonly left: MatchingFunction[];
  readonly right: MatchingFunction[];
  readonly reason: string;
}
const index = (
  items: readonly MatchingFunction[],
  key: (item: MatchingFunction) => string | null,
): Groups => {
  const groups = new Map<string, MatchingFunction[]>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    let group = groups.get(value);
    if (group === undefined) groups.set(value, (group = []));
    group.push(item);
  }
  return groups;
};

/** One request owns pairing state; ambiguous components never expand into pair products. */
class InventoryMatcher {
  readonly consumed = new Set<MatchingFunction>();
  readonly matches: NativeFunctionMatch[] = [];
  readonly #parent = new Map<MatchingFunction, MatchingFunction>();
  readonly #ambiguous = new Set<MatchingFunction>();
  constructor(readonly checkpoint: NativeMatchingCheckpoint) {}
  add(input: MatchInput): void {
    const left = input.left.map((x) => x.member),
      right = input.right.map((x) => x.member);
    const leftDossier = left[0]?.dossier_evidence_id,
      rightDossier = right[0]?.dossier_evidence_id;
    this.matches.push({
      match_id: `match_${digestCanonicalValue({ state: input.state, basis: input.basis, left: left.map((x) => x.function_id), right: right.map((x) => x.function_id) })}`,
      state: input.state,
      basis: input.basis,
      left,
      right,
      reason: input.reason,
      compare_functions_input:
        input.state === "matched" && leftDossier != null && rightDossier != null
          ? {
              left: { kind: "retained-evidence", evidence_id: leftDossier },
              right: { kind: "retained-evidence", evidence_id: rightDossier },
            }
          : null,
    });
    for (const item of [...input.left, ...input.right]) this.consumed.add(item);
  }
  async pairUnique(
    groups: PairingIndexes,
    basis: NonNullable<NativeFunctionMatch["basis"]>,
  ): Promise<void> {
    for (const [key, left] of groups[0]) {
      await this.checkpoint();
      const right = groups[1].get(key);
      // Global multiplicity still matters after a different symbol consumes an alias.
      if (
        left.length !== 1 ||
        right?.length !== 1 ||
        this.consumed.has(left[0]!) ||
        this.consumed.has(right[0]!)
      )
        continue;
      this.add({
        state: "matched",
        basis,
        left,
        right,
        reason:
          basis === "exact-symbol"
            ? "Unique exact reported symbol; this does not establish unchanged code or semantic equivalence."
            : "Unique identical observed function bytes, total size and ordered range lengths; relocations are not normalized.",
      });
    }
  }
  #find(item: MatchingFunction): MatchingFunction {
    let root = item;
    while (this.#parent.has(root) && this.#parent.get(root) !== root)
      root = this.#parent.get(root)!;
    let current = item;
    while (this.#parent.has(current) && this.#parent.get(current) !== root) {
      const next = this.#parent.get(current)!;
      this.#parent.set(current, root);
      current = next;
    }
    return root;
  }
  async connectCandidates(indexes: readonly PairingIndexes[]): Promise<void> {
    for (const groups of indexes)
      for (const [key, left] of groups[0]) {
        await this.checkpoint();
        const right = groups[1].get(key);
        if (right === undefined) continue;
        const pending = [...left, ...right].filter(
            (item) => !this.consumed.has(item),
          ),
          first = pending[0];
        if (first === undefined) continue;
        for (const item of pending) {
          this.#parent.set(this.#find(item), this.#find(first));
          this.#ambiguous.add(item);
        }
      }
  }
  async finish(
    left: readonly MatchingFunction[],
    right: readonly MatchingFunction[],
  ): Promise<void> {
    const groups = new Map<
      MatchingFunction,
      { left: MatchingFunction[]; right: MatchingFunction[] }
    >();
    for (const [side, items] of [
      ["left", left],
      ["right", right],
    ] as const)
      for (const item of items) {
        await this.checkpoint();
        if (this.consumed.has(item)) continue;
        if (!this.#ambiguous.has(item)) {
          this.add({
            state: side === "left" ? "only_left" : "only_right",
            basis: null,
            left: side === "left" ? [item] : [],
            right: side === "right" ? [item] : [],
            reason:
              "No exact correspondence in the supplied observed inventories. This is not proof of source addition/removal: renaming, inlining, stripping, byte changes or omitted functions can explain it.",
          });
          continue;
        }
        const root = this.#find(item);
        let group = groups.get(root);
        if (group === undefined)
          groups.set(root, (group = { left: [], right: [] }));
        group[side].push(item);
      }
    for (const group of groups.values())
      this.add({
        state: "unresolved",
        basis: null,
        ...group,
        reason:
          "Repeated exact names/bytes, aliases or observed CFG/call/string fingerprints leave correspondence unresolved. Connected group membership does not imply pairwise equivalence. No candidate is forced into a pair.",
      });
  }
}

/** Match only exact unique facts, preserving every occurrence and all candidate ambiguity. */
export const matchFunctionInventories = async (
  left: readonly MatchingFunction[],
  right: readonly MatchingFunction[],
  options: {
    readonly identicalBytesComparable: boolean;
    readonly checkpoint: NativeMatchingCheckpoint;
  },
): Promise<{
  matches: NativeFunctionMatch[];
  summary: NativeFunctionMatching["summary"];
}> => {
  const names: PairingIndexes = [
    index(left, (x) => x.symbol),
    index(right, (x) => x.symbol),
  ];
  const bytes: PairingIndexes = [
    index(left, (x) =>
      options.identicalBytesComparable ? x.fingerprint : null,
    ),
    index(right, (x) =>
      options.identicalBytesComparable ? x.fingerprint : null,
    ),
  ];
  const structural: PairingIndexes = [
    index(left, (x) => x.member.structural_candidate_sha256),
    index(right, (x) => x.member.structural_candidate_sha256),
  ];
  const matcher = new InventoryMatcher(options.checkpoint);
  await matcher.pairUnique(names, "exact-symbol");
  await matcher.pairUnique(bytes, "identical-bytes");
  await matcher.connectCandidates([names, bytes, structural]);
  await matcher.finish(left, right);
  const summary = { matched: 0, only_left: 0, only_right: 0, unresolved: 0 };
  for (const match of matcher.matches) summary[match.state]++;
  return { matches: matcher.matches, summary };
};
