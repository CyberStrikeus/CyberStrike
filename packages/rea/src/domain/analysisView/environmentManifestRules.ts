import { compositeKey } from "../unicodeCodePointOrder.js";
import {
  spelledLikeObserved,
  spellingSummary,
  type SpellingSummary,
} from "./environmentManifestSpelling.js";
import type { RouteRule } from "./webNetworkRouteTemplates.js";

/** Opt-in template rules applied after the four exact format rules. */
export const TEMPLATE_RULES = [
  "after-uid-literal",
  "opaque-token",
  "sibling-variance",
  "sibling-pair-variance",
  "prefix-variance",
] as const;
export type TemplateRule = (typeof TEMPLATE_RULES)[number];
/** The opt-in rules whose parameters a prefix-variance parameter can share; never itself, so shared evidence does not chain. */
type SharedRule = Exclude<TemplateRule, "prefix-variance">;

export type JsonTypeName =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null";

/** Value-free top-level JSON key types of one recorded request body. */
export interface BodyShape {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonTypeName>>;
}

export interface LiteralPart {
  readonly kind: "literal";
  readonly value: string;
}
interface ParamFields {
  readonly kind: "param";
  readonly values: ReadonlySet<string>;
  /** Which half of a sibling-pair-variance pair; fixed when the pair forms so later merges cannot change it. */
  readonly pairRole?: "namespace" | "name";
}
export type ParamPart =
  | (ParamFields & { readonly rule: RouteRule | SharedRule })
  | (ParamFields & {
      readonly rule: "prefix-variance";
      /** The rule of the parameter this one shares a position with, which also names it. */
      readonly sharedRule: SharedRule;
    });
export type RoutePart = LiteralPart | ParamPart;

/** One candidate tool: a merged request-line group on the primary origin. */
export interface ToolGroup {
  readonly method: string;
  readonly origin: string;
  readonly api_surface_template: string;
  readonly parts: readonly RoutePart[];
  /** Record positions in admission order; the first is the earliest record. */
  readonly positions: readonly number[];
  readonly statuses: ReadonlySet<number>;
  readonly contentTypes: ReadonlySet<string>;
  readonly queryNames: ReadonlySet<string>;
  readonly bodyShape: BodyShape | null;
}

const OPAQUE_TOKEN = /^(?=.*\d)(?=.*[a-z])[a-z0-9]{12,}$/u;
export const VERSION_TOKEN = /^v\d/u;
const STOP_WORDS = new Set([
  "search",
  "settings",
  "errors",
  "list",
  "members",
  "versions",
  "health",
  "merged",
  "usage",
  "checks",
  "dto",
  "markdown",
]);
/** Longest route sibling-variance compares; every position rebuilds a key over the whole route. */
export const SIBLING_VARIANCE_SEGMENT_LIMIT = 32;
/** The rules that compare routes and so skip those beyond the segment limit. */
export const SEGMENT_LIMITED_RULES = [
  "sibling-variance",
  "sibling-pair-variance",
  "prefix-variance",
] as const;
const OPT_IN_RULES: ReadonlySet<string> = new Set(TEMPLATE_RULES);

const param = (rule: SharedRule, values: Iterable<string>): ParamPart => ({
  kind: "param",
  rule,
  values: new Set(values),
});

const partKey = (part: RoutePart): unknown =>
  part.kind === "literal" ? part.value : ["param", part.rule];

const withParts = (
  group: ToolGroup,
  parts: readonly RoutePart[],
): ToolGroup => ({
  ...group,
  parts,
});

const earliest = (groups: readonly ToolGroup[]): ToolGroup =>
  groups.reduce((best, group) =>
    (group.positions[0] ?? Infinity) < (best.positions[0] ?? Infinity)
      ? group
      : best,
  );

/** Merge groups around `shape`; literal siblings of its templated positions become observed values. */
const mergeGroups = (
  groups: readonly ToolGroup[],
  shape = earliest(groups),
): ToolGroup => {
  if (groups.length === 1) return groups[0]!;
  const primary = earliest(groups);
  return {
    method: primary.method,
    origin: primary.origin,
    api_surface_template: primary.api_surface_template,
    parts: shape.parts.map((part, index) =>
      part.kind === "literal"
        ? part
        : {
            ...part,
            values: new Set(
              groups.flatMap((group) => {
                const sibling = group.parts[index];
                if (sibling === undefined) return [];
                return sibling.kind === "param"
                  ? [...sibling.values]
                  : [sibling.value];
              }),
            ),
          },
    ),
    positions: groups
      .flatMap((group) => group.positions)
      .sort((left, right) => left - right),
    statuses: new Set(groups.flatMap((group) => [...group.statuses])),
    contentTypes: new Set(groups.flatMap((group) => [...group.contentTypes])),
    queryNames: new Set(groups.flatMap((group) => [...group.queryNames])),
    bodyShape: primary.bodyShape,
  };
};

const rebucket = (
  groups: readonly ToolGroup[],
  keyOf: (part: RoutePart) => unknown = partKey,
  shapeOf: (bucket: readonly ToolGroup[]) => ToolGroup = earliest,
): ToolGroup[] => {
  const buckets = new Map<string, ToolGroup[]>();
  for (const group of groups) {
    const key = compositeKey([
      group.method,
      group.origin,
      ...group.parts.map(keyOf),
    ]);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [group]);
    else bucket.push(group);
  }
  return [...buckets.values()].map((bucket) =>
    mergeGroups(bucket, shapeOf(bucket)),
  );
};

const templateAfterUidLiteral = (parts: readonly RoutePart[]): RoutePart[] =>
  parts.map((part, index) => {
    const previous = parts[index - 1];
    return part.kind === "literal" &&
      previous?.kind === "literal" &&
      previous.value === "uid" &&
      !STOP_WORDS.has(part.value)
      ? param("after-uid-literal", [part.value])
      : part;
  });

const templateOpaqueTokens = (parts: readonly RoutePart[]): RoutePart[] =>
  parts.map((part) =>
    part.kind === "literal" &&
    OPAQUE_TOKEN.test(part.value) &&
    !VERSION_TOKEN.test(part.value)
      ? param("opaque-token", [part.value])
      : part,
  );

const literalAt = (group: ToolGroup, position: number): string => {
  const part = group.parts[position];
  return part?.kind === "literal" ? part.value : "";
};

/** The siblings whose literal looks like an identifier: each carries a digit or colon, or three or more are hyphenated names under a plural literal. Stop words never qualify. */
const identifierLikeSiblings = (
  literal: readonly ToolGroup[],
  position: number,
): ReadonlySet<ToolGroup> => {
  const eligible = new Set<ToolGroup>();
  const previous = literal[0]?.parts[position - 1];
  const plural = previous?.kind === "literal" && previous.value.endsWith("s");
  const hyphenated: ToolGroup[] = [];
  for (const group of literal) {
    const value = literalAt(group, position);
    if (STOP_WORDS.has(value)) continue;
    if (/[\d:]/u.test(value)) eligible.add(group);
    if (plural && value.includes("-")) hyphenated.push(group);
  }
  if (hyphenated.length >= 3)
    for (const group of hyphenated) eligible.add(group);
  return eligible;
};

const optInParamAt = (group: ToolGroup, position: number): boolean => {
  const part = group.parts[position];
  return part?.kind === "param" && OPT_IN_RULES.has(part.rule);
};

/** Merge the identifier-like literal siblings into one sibling-variance parameter; other literals stay their own tools. */
const mergeLiteralSiblings = (
  literal: readonly ToolGroup[],
  position: number,
): ToolGroup[] => {
  const eligible = identifierLikeSiblings(literal, position);
  if (eligible.size < 2) return [...literal];
  const groups = [...eligible];
  const first = earliest(groups);
  const shape = withParts(
    first,
    first.parts.map((part, index) =>
      index === position
        ? param("sibling-variance", [literalAt(first, position)])
        : part,
    ),
  );
  return [
    mergeGroups(
      groups.map((group) => (group === first ? shape : group)),
      shape,
    ),
    ...literal.filter((group) => !eligible.has(group)),
  ];
};

/** Fold literal siblings into an opt-in parameter only; format-rule parameters absorb no literal. */
const mergeSiblings = (
  bucket: readonly ToolGroup[],
  position: number,
): ToolGroup[] => {
  if (bucket.length < 2) return [...bucket];
  const templated = bucket.filter(
    (group) => group.parts[position]?.kind === "param",
  );
  const literal = bucket.filter(
    (group) => group.parts[position]?.kind === "literal",
  );
  const targets = templated.filter((group) => optInParamAt(group, position));
  if (targets.length === 0)
    return [...templated, ...mergeLiteralSiblings(literal, position)];
  const target = earliest(targets);
  const foldable = new Set(
    literal.filter((group) => !STOP_WORDS.has(literalAt(group, position))),
  );
  return [
    mergeGroups([target, ...foldable], target),
    ...templated.filter((group) => group !== target),
    ...literal.filter((group) => !foldable.has(group)),
  ];
};

/** Merge groups that differ in exactly one identifier-like segment at index two or later. */
const mergeSiblingVariance = (groups: readonly ToolGroup[]): ToolGroup[] => {
  let current = [...groups];
  const longest = Math.max(0, ...current.map((group) => group.parts.length));
  for (let position = 2; position < longest; position += 1) {
    const buckets = new Map<string, ToolGroup[]>();
    const output: ToolGroup[] = [];
    for (const group of current) {
      if (position >= group.parts.length) {
        output.push(group);
        continue;
      }
      const key = compositeKey([
        group.method,
        group.origin,
        group.parts.length,
        ...group.parts.map((part, index) =>
          index === position ? null : partKey(part),
        ),
      ]);
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [group]);
      else bucket.push(group);
    }
    for (const bucket of buckets.values())
      output.push(...mergeSiblings(bucket, position));
    current = output;
  }
  return current;
};

/** Fewest distinct literal pairs that make two adjacent positions one templated pair. */
export const SIBLING_PAIR_MINIMUM = 3;

/**
 * Both positions are literals that are neither stop words nor versions, right after a plural literal
 * and before another literal: a trailing pair such as `/users/alice/followers` names a sub-resource.
 */
const pairCandidate = (group: ToolGroup, position: number): boolean => {
  const previous = group.parts[position - 1];
  const first = group.parts[position];
  const second = group.parts[position + 1];
  return (
    previous?.kind === "literal" &&
    previous.value.endsWith("s") &&
    !STOP_WORDS.has(previous.value) &&
    first?.kind === "literal" &&
    second?.kind === "literal" &&
    group.parts[position + 2]?.kind === "literal" &&
    [first.value, second.value].every(
      (value) => !STOP_WORDS.has(value) && !VERSION_TOKEN.test(value),
    )
  );
};

/** Merge one bucket when its pairs are distinct enough and both positions vary; otherwise keep its tools. */
const mergePairBucket = (
  bucket: readonly ToolGroup[],
  position: number,
): ToolGroup[] => {
  const pairs = new Set(
    bucket.map((group) =>
      compositeKey([
        literalAt(group, position),
        literalAt(group, position + 1),
      ]),
    ),
  );
  const firsts = new Set(bucket.map((group) => literalAt(group, position)));
  const seconds = new Set(
    bucket.map((group) => literalAt(group, position + 1)),
  );
  if (pairs.size < SIBLING_PAIR_MINIMUM || firsts.size < 2 || seconds.size < 2)
    return [...bucket];
  const first = earliest(bucket);
  const shape = withParts(
    first,
    first.parts.map((part, index) =>
      index === position || index === position + 1
        ? {
            ...param("sibling-pair-variance", [literalAt(first, index)]),
            pairRole: index === position ? "namespace" : "name",
          }
        : part,
    ),
  );
  return [
    mergeGroups(
      bucket.map((group) => (group === first ? shape : group)),
      shape,
    ),
  ];
};

/** Merge groups that differ in two adjacent literals after a plural literal, such as `/repos/{owner}/{repo}/…`. */
const mergeSiblingPairs = (groups: readonly ToolGroup[]): ToolGroup[] => {
  let current = [...groups];
  const longest = Math.max(0, ...current.map((group) => group.parts.length));
  for (let position = 2; position + 1 < longest; position += 1) {
    const buckets = new Map<string, ToolGroup[]>();
    const output: ToolGroup[] = [];
    for (const group of current) {
      if (!pairCandidate(group, position)) {
        output.push(group);
        continue;
      }
      const key = compositeKey([
        group.method,
        group.origin,
        group.parts.length,
        ...group.parts.map((part, index) =>
          index === position || index === position + 1 ? null : partKey(part),
        ),
      ]);
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [group]);
      else bucket.push(group);
    }
    for (const bucket of buckets.values())
      output.push(...mergePairBucket(bucket, position));
    current = output;
  }
  return current;
};

/** A part by the rule that names it: a prefix-variance parameter keys as the parameter it shares. */
const nameKey = (part: RoutePart): unknown =>
  part.kind === "literal"
    ? part.value
    : [
        "param",
        part.rule === "prefix-variance" ? part.sharedRule : part.rule,
        part.pairRole ?? null,
      ];

const prefixKey = (group: ToolGroup, position: number): string =>
  compositeKey([group.origin, ...group.parts.slice(0, position).map(nameKey)]);

/** A parameter a position can share: the earliest tool's parameter of one naming rule, and every value tools named by that rule observed there. */
interface SharedDonor {
  readonly part: ParamPart & { readonly rule: SharedRule };
  readonly values: Set<string>;
}

const isShared = (
  part: RoutePart | undefined,
): part is ParamPart & { readonly rule: SharedRule } =>
  part?.kind === "param" &&
  part.rule !== "prefix-variance" &&
  OPT_IN_RULES.has(part.rule);

/** A position's donors, earliest first, with each one's spelling summarised once for every literal it is compared with. */
type SharedPosition = readonly (SharedDonor & {
  readonly spelling: SpellingSummary;
})[];

/** Opt-in parameters at one position by their preceding parts, one donor per naming rule, so a value stays with the parameter that observed it. */
const sharedPositions = (
  groups: readonly ToolGroup[],
  position: number,
): Map<string, SharedPosition> => {
  const donors = new Map<string, Map<string, SharedDonor>>();
  const ordered = [...groups].sort(
    (left, right) => (left.positions[0] ?? 0) - (right.positions[0] ?? 0),
  );
  for (const group of ordered) {
    const part = group.parts[position];
    if (!isShared(part)) continue;
    const key = prefixKey(group, position);
    const byRule = donors.get(key) ?? new Map<string, SharedDonor>();
    donors.set(key, byRule);
    const rule = compositeKey([nameKey(part)]);
    const known = byRule.get(rule);
    if (known === undefined)
      byRule.set(rule, { part, values: new Set(part.values) });
    else for (const value of part.values) known.values.add(value);
  }
  return new Map(
    [...donors].map(([key, byRule]) => [
      key,
      [...byRule.values()].map((donor) => ({
        ...donor,
        spelling: spellingSummary(donor.values),
      })),
    ]),
  );
};

/** The donor a literal shares a position with: one that observed it, else one it is spelled like, earliest first; never for an empty literal, a stop word or a version. */
const donorFor = (
  value: string,
  donors: SharedPosition,
): SharedDonor | undefined =>
  value === "" || STOP_WORDS.has(value) || VERSION_TOKEN.test(value)
    ? undefined
    : (donors.find((donor) => donor.values.has(value)) ??
      donors.find((donor) => spelledLikeObserved(value, donor.spelling)));

/** The bucket's earliest group, with each position's parameter taken from a group that templated it by its own rule when one did. */
const sharedShape = (bucket: readonly ToolGroup[]): ToolGroup => {
  const first = earliest(bucket);
  return withParts(
    first,
    first.parts.map((part, index) =>
      part.kind === "param" && part.rule === "prefix-variance"
        ? (bucket.map((group) => group.parts[index]).find(isShared) ?? part)
        : part,
    ),
  );
};

/** Template literals at positions another tool templates by an opt-in rule after the same preceding parts, at any method or length. */
const mergePrefixVariance = (groups: readonly ToolGroup[]): ToolGroup[] => {
  let current = [...groups];
  const longest = Math.max(0, ...current.map((group) => group.parts.length));
  for (let position = 0; position < longest; position += 1) {
    const shared = sharedPositions(current, position);
    if (shared.size === 0) continue;
    current = current.map((group) => {
      const part = group.parts[position];
      const donors =
        part?.kind === "literal"
          ? shared.get(prefixKey(group, position))
          : undefined;
      const known =
        part?.kind === "literal" && donors !== undefined
          ? donorFor(part.value, donors)
          : undefined;
      if (part?.kind !== "literal" || known === undefined) return group;
      // Copies the shared parameter's pair role; the values are this literal only.
      const templated: ParamPart = {
        ...known.part,
        rule: "prefix-variance",
        sharedRule: known.part.rule,
        values: new Set([part.value]),
      };
      return withParts(
        group,
        group.parts.map((other, index) =>
          index === position ? templated : other,
        ),
      );
    });
  }
  return rebucket(current, nameKey, sharedShape);
};

/** Run a comparing pass over routes within the segment limit; longer routes keep their groups. */
const withinSegmentLimit = (
  groups: readonly ToolGroup[],
  pass: (groups: readonly ToolGroup[]) => ToolGroup[],
): ToolGroup[] => [
  ...pass(
    groups.filter(
      (group) => group.parts.length <= SIBLING_VARIANCE_SEGMENT_LIMIT,
    ),
  ),
  ...groups.filter(
    (group) => group.parts.length > SIBLING_VARIANCE_SEGMENT_LIMIT,
  ),
];

/** Apply the selected opt-in rules in fixed order; every merge is an inference. */
export const applyTemplateRules = (
  groups: readonly ToolGroup[],
  rules: ReadonlySet<TemplateRule>,
): ToolGroup[] => {
  let current = [...groups];
  if (rules.has("after-uid-literal"))
    current = current.map((group) =>
      withParts(group, templateAfterUidLiteral(group.parts)),
    );
  if (rules.has("opaque-token"))
    current = current.map((group) =>
      withParts(group, templateOpaqueTokens(group.parts)),
    );
  current = rebucket(current);
  // Pairs merge first: a single-position merge could otherwise template one
  // half of a pair and leave too few literal pairs to recognize.
  if (rules.has("sibling-pair-variance"))
    current = withinSegmentLimit(current, mergeSiblingPairs);
  if (rules.has("sibling-variance"))
    current = withinSegmentLimit(current, mergeSiblingVariance);
  // Last, so it can share the parameters every other rule produced.
  if (rules.has("prefix-variance"))
    current = withinSegmentLimit(current, mergePrefixVariance);
  return current;
};
