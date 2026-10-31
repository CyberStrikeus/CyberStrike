import { managedDecodeBudget } from "./ManagedDecodeBudget.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import {
  memberListRowLookup,
  memberListTable,
} from "./ManagedMemberPointers.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";
import type {
  MemberDefinitionTable,
  TypeMemberListFacts,
} from "./ManagedTypeMemberLists.js";

type OwnerLookup = (definitionRow: number) => number;
const lookups = new WeakMap<
  TypeMemberListFacts,
  Map<MemberDefinitionTable, OwnerLookup | ManagedReaderFailure>
>();

/** One first-match TypeDef owner per physical member, shared by every inspection facet. */
export const memberDeclaringTypeRowLookup = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  table: MemberDefinitionTable,
  facts: TypeMemberListFacts,
): OwnerLookup => {
  let byTable = lookups.get(facts);
  const cached = byTable?.get(table);
  if (cached instanceof ManagedReaderFailure) throw cached;
  if (cached !== undefined) return cached;
  if (byTable === undefined) {
    byTable = new Map();
    lookups.set(facts, byTable);
  }
  try {
    const positionOf = memberListRowLookup(bytes, layout, table);
    const positions = memberListTable(layout, table)?.rowCount ?? 0;
    const types = layout.table(2)?.rowCount ?? 0;
    managedDecodeBudget(layout).reserve(
      (2 * positions + 3) * Uint32Array.BYTES_PER_ELEMENT + 256,
      layout.table(2)?.offset ?? null,
    );
    const owners = new Uint32Array(positions + 1);
    // Skip already-owned positions so overlapping malformed lists remain near-linear.
    const next = Uint32Array.from({ length: positions + 2 }, (_, p) => p);
    const unowned = (position: number): number => {
      let root = position;
      while (next[root] !== root) root = next[root] ?? root;
      for (let p = position; p !== root;) {
        const following = next[p] ?? root;
        next[p] = root;
        p = following;
      }
      return root;
    };
    for (let row = 1; row <= types; row += 1) {
      const memberStart =
        table === 4
          ? facts.entries[row - 1]?.field
          : facts.entries[row - 1]?.method;
      const start = memberStart?.start.value ?? null;
      const end = memberStart?.end ?? null;
      // A malformed endpoint makes this entire interval uncertain. In
      // particular, zero must not become row one through owner-side clamping.
      if (start !== null && end !== null) {
        const limit = Math.min(end, positions + 1);
        for (
          let p = unowned(Math.min(start, positions + 1));
          p < limit;
          p = unowned(p + 1)
        ) {
          owners[p] = row;
          next[p] = p + 1;
        }
      }
    }
    const definitions = layout.table(table)?.rowCount ?? 0;
    const lookup: OwnerLookup = (definition) =>
      definition < 1 || definition > definitions
        ? 0
        : (owners[positionOf(definition)] ?? 0);
    byTable.set(table, lookup);
    return lookup;
  } catch (cause: unknown) {
    // Replaying a malformed layout must neither rebuild nor charge the index again.
    if (cause instanceof ManagedReaderFailure) byTable.set(table, cause);
    throw cause;
  }
};
