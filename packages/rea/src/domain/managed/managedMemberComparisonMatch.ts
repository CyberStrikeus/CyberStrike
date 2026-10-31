import {
  hasCompleteMethodRows,
  type ManagedComparisonScope,
} from "./managedMemberComparisonCoverage.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import {
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
} from "./managedArtifact.js";
import { readManagedInspectionEvidence } from "./managedInspectionEvidence.js";
import type {
  ManagedMemberComparisonResult,
  ManagedMemberComparisonSide,
} from "./managedMemberComparison.js";
import {
  comparableSides,
  signatureIdentity,
} from "./managedMemberSignatureIdentity.js";
type Method = ManagedMemberInspection["methods"][number];
type Field = ManagedMemberInspection["fields"][number];

type MatchBasis =
  ManagedMemberComparisonResult["methods"][number]["match"]["basis"];
type ConcreteMatchBasis = Exclude<MatchBasis, "none">;

interface Keyed<Item> {
  readonly item: Item;
  /** Declared type and name; an unresolved type is null, the name remains. */
  readonly identity: string;
  /** Declared identity could not be resolved; display facts remain. */
  readonly identityUnavailable: boolean;
  readonly exactKey: string | null;
  readonly signatureKey: string | null;
  /** The name-free exact signature, resolved where both sides resolve it. */
  readonly signatureId: string;
  readonly structuralKey: string | null;
}

interface MatchedPair<Item> {
  readonly left: Keyed<Item>;
  readonly right: Keyed<Item>;
  readonly basis: ConcreteMatchBasis;
  readonly confidence: "exact" | "high";
}

interface Ambiguous<Item> {
  readonly left: readonly Keyed<Item>[];
  readonly right: readonly Keyed<Item>[];
  readonly basis: ConcreteMatchBasis;
}

/** A declared type: a historical bare name or a tagged observed nominal digest. */
type DeclaredName = string | string[] | null;
type DeclaredNameOf = (item: Method | Field) => DeclaredName;
const keyIdentity = (
  item: Method | Field,
  declared: DeclaredNameOf,
  kind: "method" | "field",
) => {
  const declaringType = declared(item);
  const signatureId = signatureIdentity(item.signature);
  return {
    identity: digestCanonicalValue(
      [declaringType, item.name],
      "Managed comparison",
    ),
    identityUnavailable: declaringType === null,
    signatureId,
    signatureKey:
      declaringType === null
        ? null
        : digestCanonicalValue(
            [`${kind}-signature`, declaringType, item.name, signatureId],
            "Managed comparison",
          ),
  };
};

const keyMethod = (item: Method, declared: DeclaredNameOf): Keyed<Method> => ({
  item,
  ...keyIdentity(item, declared, "method"),
  exactKey:
    item.body.status === "present" &&
    item.body.il_sha256 !== null &&
    item.body.normalized_il_sha256 !== null
      ? digestCanonicalValue(
          [
            "method-exact",
            signatureIdentity(item.signature),
            item.body.il_sha256,
            item.body.normalized_il_sha256,
          ],
          "Managed comparison",
        )
      : null,
  structuralKey:
    item.signature.parse_status === "decoded" && item.body.status === "present"
      ? digestCanonicalValue(
          [
            "method-structural",
            // Decoded type strings carry build-local rows; the identity names them.
            signatureIdentity(item.signature),
            item.body.status,
            item.body.header_format,
            item.body.il_size,
            item.body.max_stack,
            item.body.init_locals,
            item.body.opcode_counts,
            item.body.anchors.map(({ opcode, operand_kind, operand }) => [
              opcode,
              operand_kind,
              operand_kind === "constant" ? operand : null,
            ]),
            item.body.exception_regions.map((region) => [
              region.flags,
              region.try_length,
              region.handler_length,
              region.class_token === null ? null : "type-token",
              region.filter_offset === null ? null : "filter",
            ]),
          ],
          "Managed comparison",
        )
      : null,
});

const keyField = (item: Field, declared: DeclaredNameOf): Keyed<Field> => ({
  item,
  ...keyIdentity(item, declared, "field"),
  exactKey:
    item.signature.parse_status === "decoded"
      ? digestCanonicalValue(
          ["field-exact", signatureIdentity(item.signature)],
          "Managed comparison",
        )
      : null,
  // Field matching has no structural round: flags/type display strings do
  // not establish a field signature identity.
  structuralKey: null,
});

const matchMethods = (
  left: readonly Keyed<Method>[],
  right: readonly Keyed<Method>[],
  allowRemap: boolean,
) =>
  matchByKeys({
    left,
    right,
    rounds: [
      {
        basis: "exact-il-signature",
        key: declaredAs(({ exactKey }) => exactKey),
      },
      {
        basis: "exact-signature",
        key: ({ signatureKey }) => signatureKey,
        competitionKey: ({ signatureId }) => signatureId,
      },
      {
        basis: "structural-method-shape",
        // An unresolved owner has no declared shape match to prove.
        key: declaredAs((keyed) =>
          keyed.identityUnavailable ? null : keyed.structuralKey,
        ),
        competitionKey: ({ structuralKey }) => structuralKey,
      },
      {
        basis: "exact-il-signature",
        key: ({ exactKey }) => (allowRemap ? exactKey : null),
        remap: true,
      },
      {
        basis: "structural-method-shape",
        key: ({ structuralKey }) => (allowRemap ? structuralKey : null),
        competitionKey: ({ structuralKey }) => structuralKey,
        remap: true,
      },
    ],
  });

const matchFields = (
  left: readonly Keyed<Field>[],
  right: readonly Keyed<Field>[],
  allowRemap: boolean,
) =>
  matchByKeys({
    left,
    right,
    rounds: [
      {
        basis: "field-signature",
        key: declaredAs(({ exactKey }) => exactKey),
      },
      {
        basis: "exact-signature",
        key: ({ signatureKey }) => signatureKey,
        competitionKey: ({ signatureId }) => signatureId,
      },
      {
        basis: "field-signature",
        key: ({ exactKey }) => (allowRemap ? exactKey : null),
        remap: true,
      },
    ],
  });

export type ManagedMethodMatches = ReturnType<typeof matchMethods>;
export type ManagedFieldMatches = ReturnType<typeof matchFields>;

interface MatchRound<Item> {
  readonly basis: ConcreteMatchBasis;
  readonly key: (item: Keyed<Item>) => string | null;
  /** Name-free evidence paired with the retained member name for contesting. */
  readonly competitionKey?: (item: Keyed<Item>) => string | null;
  /**
   * The key omits the declared type, so a pair may join different declared
   * identities; same-identity pairs were taken by earlier rounds. Contention
   * still retains the member name, which unresolved owners keep as evidence.
   * A member whose own identity is still unpaired on the other side does not
   * take part, and a group with a member of an unresolved type stays ambiguous.
   */
  readonly remap?: true;
}

interface MatchByKeysInput<Item> {
  readonly left: readonly Keyed<Item>[];
  readonly right: readonly Keyed<Item>[];
  readonly rounds: readonly MatchRound<Item>[];
}

/** Narrow a key to members of one declared type and name. */
const declaredAs =
  <Item>(key: (item: Keyed<Item>) => string | null) =>
  (item: Keyed<Item>): string | null => {
    const value = key(item);
    return value === null || item.identityUnavailable
      ? null
      : digestCanonicalValue([item.identity, value], "Managed comparison");
  };

const matchByKeys = <Item extends Declared>({
  left,
  right,
  rounds,
}: MatchByKeysInput<Item>): {
  readonly pairs: readonly MatchedPair<Item>[];
  readonly ambiguous: readonly Ambiguous<Item>[];
  readonly leftOnly: readonly Keyed<Item>[];
  readonly rightOnly: readonly Keyed<Item>[];
} => {
  const usedLeft = new Set<Keyed<Item>>();
  const usedRight = new Set<Keyed<Item>>();
  const pairedLeft = new Set<Keyed<Item>>();
  const pairedRight = new Set<Keyed<Item>>();
  const pairs: MatchedPair<Item>[] = [];
  const ambiguous: Ambiguous<Item>[] = [];
  for (const round of rounds) {
    const competitionKey = round.competitionKey ?? ((item) => item.exactKey);
    const unpairedLeft = unpairedOf(left, pairedLeft);
    const unpairedRight = unpairedOf(right, pairedRight);
    const declarable = declaredCandidates(
      unpairedLeft,
      unpairedRight,
      competitionKey,
    );
    const openLeft = left.filter((item) => !usedLeft.has(item));
    const openRight = right.filter((item) => !usedRight.has(item));
    // Only open candidates can justify overriding a held declared identity:
    // consumed ambiguous rows remain identity barriers, but cannot join a
    // later remap group to establish its ambiguity.
    const remapContested =
      round.remap === true
        ? ownerlessContested([openLeft, openRight], competitionKey)
        : new Set<string>();
    const leftGroups = groupBy(
      round.remap === true
        ? remappable(openLeft, unpairedRight, competitionKey, remapContested)
        : openLeft.filter(declarable),
      round.key,
    );
    const rightGroups = groupBy(
      round.remap === true
        ? remappable(openRight, unpairedLeft, competitionKey, remapContested)
        : openRight.filter(declarable),
      round.key,
    );
    for (const [key, leftItems] of leftGroups) {
      const rightItems = rightGroups.get(key);
      if (rightItems === undefined) continue;
      // An unresolved owner may be either member's own counterpart, so a
      // remap group it joins stays ambiguous.
      const refused =
        round.remap === true &&
        [...leftItems, ...rightItems].some(
          ({ identityUnavailable }) => identityUnavailable,
        );
      if (!refused && leftItems.length === 1 && rightItems.length === 1) {
        const [leftItem] = leftItems;
        const [rightItem] = rightItems;
        if (leftItem === undefined || rightItem === undefined) continue;
        usedLeft.add(leftItem);
        usedRight.add(rightItem);
        pairedLeft.add(leftItem);
        pairedRight.add(rightItem);
        pairs.push({
          left: leftItem,
          right: rightItem,
          basis: round.basis,
          confidence:
            round.basis === "exact-il-signature" ||
            round.basis === "exact-signature" ||
            round.basis === "field-signature"
              ? "exact"
              : "high",
        });
      } else {
        for (const item of leftItems) usedLeft.add(item);
        for (const item of rightItems) usedRight.add(item);
        ambiguous.push({
          left: leftItems,
          right: rightItems,
          basis: round.basis,
        });
      }
    }
  }
  // Contention can prevent a declared signature pair even when CIL/shape
  // evidence cannot form a later remap. Held ambiguities still contest
  // ownership; only proven pairs leave that evidence pool. Group only open
  // candidates so held members retain their original ambiguity and provenance.
  for (const group of unresolvedSignatureAmbiguities(
    left.filter((item) => !usedLeft.has(item)),
    right.filter((item) => !usedRight.has(item)),
    ownerlessContested(
      [unpairedOf(left, pairedLeft), unpairedOf(right, pairedRight)],
      (member) => member.signatureId,
    ),
  )) {
    for (const item of group.left) usedLeft.add(item);
    for (const item of group.right) usedRight.add(item);
    ambiguous.push(group);
  }
  return {
    pairs,
    ambiguous,
    leftOnly: left.filter((item) => !usedLeft.has(item)),
    rightOnly: right.filter((item) => !usedRight.has(item)),
  };
};

/** Open signature choices contested by unresolved owners, including held rows. */
const unresolvedSignatureAmbiguities = <Item extends Declared>(
  left: readonly Keyed<Item>[],
  right: readonly Keyed<Item>[],
  contested: ReadonlySet<string>,
): Ambiguous<Item>[] => {
  const key = (member: Keyed<Item>): string =>
    competitionIdentityKey(member, member.signatureId) ?? "";
  const leftGroups = groupBy(left, key);
  const rightGroups = groupBy(right, key);
  const groups: Ambiguous<Item>[] = [];
  for (const [signature, leftItems] of leftGroups) {
    const rightItems = rightGroups.get(signature);
    if (!contested.has(signature) || rightItems === undefined) continue;
    groups.push({
      left: leftItems,
      right: rightItems,
      basis: "exact-signature",
    });
  }
  return groups;
};

interface Declared {
  readonly declaring_type: string | null;
  readonly name: string;
}

const unpairedOf = <Item>(
  items: readonly Keyed<Item>[],
  paired: ReadonlySet<Keyed<Item>>,
): Keyed<Item>[] => items.filter((item) => !paired.has(item));

/**
 * Round-specific evidence keys an unresolved owner competes for, paired with
 * its retained member name. Another same-name member on the same side can be
 * the unresolved row's owner; a different name cannot. Contested candidates
 * stay in remap rounds rather than pairing by declared identity.
 */
const competitionIdentityKey = <Item extends Declared>(
  member: Keyed<Item>,
  evidenceKey: string | null,
): string | null =>
  evidenceKey === null ? null : JSON.stringify([member.item.name, evidenceKey]);

const ownerlessContested = <Item extends Declared>(
  sides: readonly (readonly Keyed<Item>[])[],
  keyOf: (item: Keyed<Item>) => string | null,
): ReadonlySet<string> => {
  const contested = new Set<string>();
  for (const side of sides) {
    const seen = new Map<string, number>();
    const ownerless = new Set<string>();
    for (const member of side) {
      const key = competitionIdentityKey(member, keyOf(member));
      if (key === null) continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (member.identityUnavailable) ownerless.add(key);
    }
    for (const key of ownerless)
      if ((seen.get(key) ?? 0) > 1) contested.add(key);
  }
  return contested;
};

/**
 * Members a remap round may group: an unresolved owner, which keeps its group
 * ambiguous; a member whose selected key an unresolved owner competes for, so the
 * group that preserved the base matcher's ambiguity can form; or no member of
 * the same declared identity left unpaired on the other side, whether
 * one-sided or in an ambiguous group. The sets are taken before grouping, so
 * no group order decides a remap.
 */
const remappable = <Item extends Declared>(
  items: readonly Keyed<Item>[],
  others: readonly Keyed<Item>[],
  keyOf: (item: Keyed<Item>) => string | null,
  contested: ReadonlySet<string>,
): Keyed<Item>[] => {
  const kept = new Set(others.map(({ identity }) => identity));
  return items.filter((member) => {
    const key = keyOf(member);
    return (
      (key !== null &&
        contested.has(competitionIdentityKey(member, key) ?? "")) ||
      member.identityUnavailable ||
      !kept.has(member.identity)
    );
  });
};

/** A declared round needs a resolved owner and no unresolved contender. */
const declaredCandidates = <Item extends Declared>(
  left: readonly Keyed<Item>[],
  right: readonly Keyed<Item>[],
  keyOf: (item: Keyed<Item>) => string | null,
): ((member: Keyed<Item>) => boolean) => {
  const contested = ownerlessContested([left, right], keyOf);
  return (member) => {
    if (member.identityUnavailable) return false;
    const key = competitionIdentityKey(member, keyOf(member));
    return key === null || !contested.has(key);
  };
};

const groupBy = <Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string | null,
): Map<string, readonly Item[]> => {
  const grouped = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  return grouped;
};

/**
 * Pair only members whose declaring type both sides observed. A member outside
 * the other side's selection stays one-sided, so a type selection never yields
 * a remap to a member of a type the other side did not inspect.
 */
const matchObserved = <Item extends Declared>(
  left: readonly Item[],
  right: readonly Item[],
  sides: {
    readonly inLeft: (item: Item) => boolean;
    readonly inRight: (item: Item) => boolean;
  },
  match: (
    left: readonly Keyed<Item>[],
    right: readonly Keyed<Item>[],
  ) => ReturnType<typeof matchByKeys<Item>>,
  keyLeft: (item: Item) => Keyed<Item>,
  keyRight: (item: Item) => Keyed<Item>,
): ReturnType<typeof matchByKeys<Item>> => {
  const matched = match(
    left.filter(sides.inRight).map(keyLeft),
    right.filter(sides.inLeft).map(keyRight),
  );
  return {
    ...matched,
    leftOnly: [
      ...matched.leftOnly,
      ...left.filter((item) => !sides.inRight(item)).map(keyLeft),
    ],
    rightOnly: [
      ...matched.rightOnly,
      ...right.filter((item) => !sides.inLeft(item)).map(keyRight),
    ],
  };
};

export const keyMembers = (
  observedLeft: ManagedMemberComparisonSide,
  observedRight: ManagedMemberComparisonSide,
  scope: ManagedComparisonScope,
): {
  readonly methodMatches: ReturnType<typeof matchMethods>;
  readonly fieldMatches: ReturnType<typeof matchFields>;
} => {
  const [left, right] = comparableSides(observedLeft, observedRight);
  const modern =
    left.result.nesting_read !== null && right.result.nesting_read !== null;
  const declared = (
    inspection: ManagedMemberInspection,
    names: ReadonlyMap<string, string | null>,
  ): DeclaredNameOf => {
    return (item) => {
      if (inspection.nesting_read === false) return null;
      const digest = names.get(item.declaring_type_token ?? "");
      // A historical counterpart cannot repair an observed current name gap.
      if (inspection.nesting_read !== null && digest == null) return null;
      // Historical observations retain their explicitly limited bare-name mode.
      if (!modern) return item.declaring_type;
      return digest == null ? null : ["nominal-name-sha256", digest];
    };
  };
  const declaredLeft = declared(left.result, scope.left.names);
  const declaredRight = declared(right.result, scope.right.names);
  return {
    methodMatches: matchObserved(
      left.result.methods,
      right.result.methods,
      scope,
      (a, b) =>
        matchMethods(
          a,
          b,
          left.result.metadata.status === "complete" &&
            right.result.metadata.status === "complete" &&
            hasCompleteMethodRows(left.result) &&
            hasCompleteMethodRows(right.result),
        ),
      (item) => keyMethod(item, declaredLeft),
      (item) => keyMethod(item, declaredRight),
    ),
    fieldMatches: matchObserved(
      left.result.fields,
      right.result.fields,
      scope,
      (a, b) =>
        matchFields(
          a,
          b,
          left.result.metadata.status === "complete" &&
            right.result.metadata.status === "complete",
        ),
      (item) => keyField(item, declaredLeft),
      (item) => keyField(item, declaredRight),
    ),
  };
};

export const readManagedMemberEvidence = (
  evidence: unknown,
  path: "left" | "right",
) =>
  readManagedInspectionEvidence(
    evidence,
    "inspect_managed_members",
    managedMemberInspectionSchema,
    { operation: "compare_managed_members", path: [path] },
  );
