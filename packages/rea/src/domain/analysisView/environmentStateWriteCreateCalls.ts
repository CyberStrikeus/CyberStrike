import type { JsonValue } from "../jsonValue.js";
import {
  isObject,
  ownMember,
  same,
  scalarText,
  type JsonObject,
} from "./environmentStateRules.js";
import { storedKinds } from "./environmentStateWriteApply.js";
import { fittedClockFormat } from "./environmentStateWriteClockFormats.js";
import { composedValue } from "./environmentStateWriteComposed.js";
import { emptyReference } from "./environmentStateWriteReferences.js";
import {
  alikeRules,
  isBlankValue,
  type FieldRule,
  type WriteBody,
} from "./environmentStateWriteRules.js";
import {
  containsDelimited,
  replaceDelimited,
  sequenceNumber,
  slugOf,
  type Ampersand,
} from "./environmentStateWriteValues.js";

type Default = { readonly member: string; readonly value: JsonValue };
type Blank = NonNullable<WriteBody["blank"]>[number];

/** What earlier calls showed that a merge must respect: members stored unsorted as sent, and the value showing each clock's width. */
export interface EarlierEvidence {
  readonly kept: ReadonlySet<string>;
  readonly clockOf: (field: string) => JsonValue | undefined;
  /** The integer the exemplar showed in an unruled field above every value its type held, where a sequence may start. */
  readonly startOf?: (field: string) => number | undefined;
  readonly createCollections?: readonly string[];
  /** The largest integer an echoed field held on the plan's accepted creates, across the type or in the later call's collection. */
  readonly sentLargest?: (
    field: string,
    scope: "collection" | "type",
  ) => number | undefined;
  /** How the plan's accepted calls and the type's held entities spelled `&` in each field's slug; absent where none showed one. */
  readonly ampersands?: ReadonlyMap<string, AmpersandSpelling>;
}

/** How a field's slug showed `&`: dropped, as the word, or in a way neither spelling gives. */
export type AmpersandSpelling = "dropped" | Ampersand | "unknown";

/** The plan's rule for a field and a later call's agree: equal, clocks one spelling covers given what earlier calls showed, slugs that differ only in how they spell `&`, or made objects alike but in the counts only the later call could show. */
const agreeing = (
  held: FieldRule,
  later: FieldRule,
  values: {
    readonly field: string;
    readonly later: JsonValue | undefined;
    readonly earlier: EarlierEvidence;
    readonly exemplar: JsonObject;
    readonly laterEntity: JsonObject;
  },
): FieldRule | undefined => {
  const alike = alikeRules(held, later, values.earlier.kept);
  if (alike !== undefined) return alike;
  if (held.rule === "made-object" && later.rule === "made-object")
    return madeAlike(
      held,
      later,
      ownMember(values.exemplar, values.field),
      values.earlier,
    );
  const spelled = ampersandSpelled(
    held,
    { rule: later, entity: values.laterEntity },
    values.earlier.ampersands?.get(values.field),
  );
  if (spelled !== undefined) return spelled;
  if (held.rule !== "clock" || later.rule !== "clock") return undefined;
  const format = fittedClockFormat(
    held.format,
    values.later,
    values.earlier.clockOf(values.field),
  );
  return format === undefined ? undefined : { ...held, format };
};

type MadeObject = Extract<FieldRule, { rule: "made-object" }>;

/** Two made-object rules as one: the same clocks, format and own members, and the earlier counts among the later's; a count only the later call shows starts at the exemplar's value, which no earlier object could show past, and only while the exemplar is the one create accepted, as earlier creates held it still. */
const madeAlike = (
  held: MadeObject,
  later: MadeObject,
  exemplar: JsonValue | undefined,
  earlier: EarlierEvidence,
): MadeObject | undefined => {
  if (
    !same(held.clocks, later.clocks) ||
    !same(held.own, later.own) ||
    !same(held.format, later.format) ||
    held.counts.some(
      ({ member }) => !later.counts.some((count) => count.member === member),
    )
  )
    return undefined;
  const counts: MadeObject["counts"] = [];
  for (const { member } of later.counts) {
    const kept = held.counts.find((count) => count.member === member);
    // Accepted creates past the exemplar showed this member unchanged, which a count would have moved.
    if (kept === undefined && (earlier.createCollections ?? []).length > 1)
      return undefined;
    const start =
      kept?.start ??
      sequenceNumber(
        isObject(exemplar) ? ownMember(exemplar, member) : undefined,
      );
    if (start === undefined) return undefined;
    counts.push({ member, start });
  }
  return { ...held, counts };
};

/** A rule with its slugs spelled the default way. */
const unspelled = (rule: FieldRule): FieldRule => {
  if (rule.rule === "slug") {
    const { ampersand: _ampersand, ...plain } = rule;
    return plain;
  }
  if (rule.rule !== "composed") return rule;
  return {
    ...rule,
    parts: rule.parts.map((part) =>
      "as" in part && part.as === "slug"
        ? { from: part.from, as: "slug" as const }
        : part,
    ),
  };
};

/** Whether a call's entity holds `&` in a field the rule slugs, which shows how it spells one. */
const showsAmpersand = (rule: FieldRule, entity: JsonObject): boolean =>
  (rule.rule === "slug"
    ? [rule.from]
    : rule.rule === "composed"
      ? rule.parts.flatMap((part) =>
          "as" in part && part.as === "slug" ? [part.from] : [],
        )
      : []
  ).some((field) => {
    const value = ownMember(entity, field);
    return typeof value === "string" && value.includes("&");
  });

/**
 * Two calls' rules that differ only in how a slug spells `&`: the one that spells it as the word, when the call
 * spelling it otherwise slugged no `&`, and no call the plan accepted nor entity the type held dropped one (`shown`).
 */
export const ampersandSpelled = (
  held: FieldRule,
  later: { readonly rule: FieldRule; readonly entity: JsonObject },
  shown: AmpersandSpelling | undefined,
): FieldRule | undefined => {
  const plainHeld = unspelled(held);
  if (!same(plainHeld, unspelled(later.rule))) return undefined;
  const heldSpells = !same(held, plainHeld);
  if (heldSpells === !same(later.rule, unspelled(later.rule))) return undefined;
  if (heldSpells)
    return showsAmpersand(later.rule, later.entity) ? undefined : held;
  return shown === "dropped" || shown === "unknown" ? undefined : later.rule;
};

/** How a rule's slug spells `&`, for a rule that slugs a field. */
const slugSpelling = (rule: FieldRule): AmpersandSpelling | undefined => {
  if (rule.rule === "slug") return rule.ampersand ?? "dropped";
  if (rule.rule !== "composed") return undefined;
  for (const part of rule.parts)
    if ("as" in part && part.as === "slug") return part.ampersand ?? "dropped";
  return undefined;
};

/** Note how a call that slugged `&` spelled it in each field its own rules slug. */
export const noteAmpersands = (
  ampersands: Map<string, AmpersandSpelling>,
  rules: readonly FieldRule[],
  entity: JsonObject,
): void => {
  for (const rule of rules) {
    const spelling = slugSpelling(rule);
    if (spelling !== undefined && showsAmpersand(rule, entity))
      ampersands.set(rule.field, spelling);
  }
};

/** Exact spelling observations in held entities; absence and contradictory spellings remain distinct. */
export const heldAmpersandSpellings = (
  rule: FieldRule,
  held: readonly JsonObject[],
): ReadonlySet<AmpersandSpelling> => {
  const observed = new Set<AmpersandSpelling>();
  if (slugSpelling(rule) === undefined) return observed;
  const plain = unspelled(rule);
  for (const entity of held) {
    if (!showsAmpersand(rule, entity)) continue;
    const stored = ownMember(entity, rule.field);
    if (stored === undefined) continue;
    const source =
      rule.rule === "slug" ? ownMember(entity, rule.from) : undefined;
    const spelled = (spelling: Ampersand | undefined): string | undefined =>
      rule.rule === "slug"
        ? typeof source === "string"
          ? slugOf(source, spelling)
          : undefined
        : plain.rule === "composed"
          ? composedValue(
              plain.parts.map((part) =>
                "as" in part && part.as === "slug" && spelling !== undefined
                  ? { ...part, ampersand: spelling }
                  : part,
              ),
              entity,
            )
          : undefined;
    observed.add(
      spelled(undefined) === stored
        ? "dropped"
        : spelled("and") === stored
          ? "and"
          : "unknown",
    );
  }
  return observed;
};

/** Retain the constraints later rule refinement needs from the same owned observations. */
export const noteHeldAmpersands = (
  ampersands: Map<string, AmpersandSpelling>,
  rules: readonly FieldRule[],
  held: readonly JsonObject[],
): void => {
  for (const rule of rules) {
    const observed = heldAmpersandSpellings(rule, held);
    const known = ampersands.get(rule.field);
    if (observed.has("dropped")) ampersands.set(rule.field, "dropped");
    else if (observed.has("unknown") && known !== "dropped")
      ampersands.set(rule.field, "unknown");
    else if (observed.has("and") && known === undefined)
      ampersands.set(rule.field, "and");
  }
};

/** Defaults joined, undefined when two calls showed one member left out at different values. */
const joinedDefaults = (
  held: readonly Default[],
  added: readonly Default[],
): Default[] | undefined => {
  const joined = new Map(held.map((entry) => [entry.member, entry.value]));
  for (const { member, value } of added) {
    if (joined.has(member) && !same(joined.get(member), value))
      return undefined;
    joined.set(member, value);
  }
  return [...joined].map(([member, value]) => ({ member, value }));
};

/** A later call's rule for a field the plan kept as shown, when it spells the exemplar's value too: a string composed from the exemplar's fields or holding the value it templates, or a sequence that started at its value. */
const spellsExemplar = (
  field: string,
  rule: FieldRule,
  calls: Pick<FieldCalls, "exemplar" | "earlier" | "later">,
): FieldRule | undefined => {
  const value = ownMember(calls.exemplar, field);
  if (rule.rule === "composed")
    return value !== undefined &&
      composedValue(rule.parts, calls.exemplar) === value
      ? rule
      : undefined;
  if (rule.rule === "template") {
    const token = scalarText(ownMember(calls.exemplar, rule.from));
    const next = scalarText(ownMember(calls.later.entity, rule.from));
    return typeof value === "string" &&
      token !== undefined &&
      next !== undefined &&
      containsDelimited(value, token) &&
      replaceDelimited(value, token, next) ===
        ownMember(calls.later.entity, field)
      ? rule
      : undefined;
  }
  if (rule.rule !== "sequence") return undefined;
  const start = calls.earlier.startOf?.(field);
  const collections = calls.earlier.createCollections ?? [];
  if (
    (rule.scope === "type" && collections.length > 1) ||
    (rule.scope === "collection" &&
      new Set(collections).size !== collections.length)
  )
    return undefined;
  return start !== undefined && sequenceNumber(value) === start
    ? { ...rule, start }
    : undefined;
};

/** What two calls show of one field. */
interface FieldCalls {
  readonly before: FieldRule | undefined;
  readonly after: FieldRule | undefined;
  readonly exemplar: JsonObject;
  readonly later: { readonly entity: JsonObject; readonly body: JsonObject };
  readonly sentBefore: ReadonlySet<string>;
  /** The values the plan's calls sent members it fixes or saw sent empty. */
  readonly pinned: ReadonlyMap<string, JsonValue>;
  /** Members an earlier call left out and the application stored a fixed value for (`body.defaults`). */
  readonly defaulted: ReadonlySet<string>;
  readonly required: readonly string[];
  readonly earlier: EarlierEvidence;
}

/** A reference an earlier later call added: it stays while a call leaves its member out, and agrees with this call's when it shows it. */
const addedReference = (
  field: string,
  added: Extract<FieldRule, { rule: "reference" }>,
  calls: FieldCalls,
): { readonly rule: FieldRule } | undefined => {
  const { after, later } = calls;
  if (!Object.hasOwn(later.entity, field))
    return Object.hasOwn(later.body, added.member)
      ? undefined
      : { rule: added };
  // A call that named nothing and stored nothing agrees, as it does with a reference the first create showed.
  if (
    after === undefined &&
    emptyReference(later.body[added.member], later.entity[field])
  )
    return { rule: added };
  const rule =
    after === undefined
      ? undefined
      : agreeing(added, after, {
          field,
          later: later.entity[field],
          earlier: calls.earlier,
          exemplar: calls.exemplar,
          laterEntity: later.entity,
        });
  return rule === undefined ? undefined : { rule };
};

/** A field one call shows alone, which must be a reference the other call did not send the member of. */
const shownAlone = (
  inExemplar: boolean,
  calls: FieldCalls,
): { readonly rule: FieldRule } | undefined => {
  const own = inExemplar ? calls.before : calls.after;
  if (own?.rule !== "reference") return undefined;
  const sent = inExemplar
    ? Object.hasOwn(calls.later.body, own.member)
    : calls.sentBefore.has(own.member);
  return sent ? undefined : { rule: own };
};

/** A member one call sent and stored as sent, and another left out and the application numbered: the value a call sends, else the next number. */
const sentOrNumbered = (
  before: FieldRule,
  after: FieldRule,
  field: string,
  calls: FieldCalls,
  agree: (held: FieldRule) => FieldRule | undefined,
): FieldRule | undefined => {
  const laterSent = Object.hasOwn(calls.later.body, field);
  if (before.rule === "echo") {
    // Serving numbers past every value a call sent, so a later call numbered at or below one cannot be repeated.
    const numbered = sequenceNumber(ownMember(calls.later.entity, field));
    const largest =
      after.rule === "sequence"
        ? calls.earlier.sentLargest?.(field, after.scope)
        : undefined;
    // An earlier call that left the member out stored a fixed value, so the application does not number it.
    return after.rule === "sequence" &&
      !laterSent &&
      !calls.defaulted.has(field) &&
      (largest === undefined || (numbered !== undefined && numbered > largest))
      ? { ...after, sent: true }
      : undefined;
  }
  if (before.rule !== "sequence") return undefined;
  if (after.rule === "echo")
    return before.sent === true || !calls.sentBefore.has(field)
      ? { ...before, sent: true }
      : undefined;
  if (before.sent !== true || after.rule !== "sequence" || laterSent)
    return undefined;
  const { sent: _sent, ...numbered } = before;
  const merged = agree(numbered);
  return merged?.rule === "sequence" ? { ...merged, sent: true } : undefined;
};

/** One field's rule in the merged plan, and the default it gives a member; undefined when the calls disagree on it. */
const mergedField = (
  field: string,
  calls: FieldCalls,
): { readonly rule?: FieldRule; readonly default?: Default } | undefined => {
  const { before, after, exemplar, later } = calls;
  const inExemplar = Object.hasOwn(exemplar, field);
  if (!inExemplar && before?.rule === "reference")
    return addedReference(field, before, calls);
  if (!inExemplar || !Object.hasOwn(later.entity, field))
    return shownAlone(inExemplar, calls);
  if (before !== undefined && after !== undefined) {
    const values = {
      field,
      later: later.entity[field],
      earlier: calls.earlier,
      exemplar,
      laterEntity: later.entity,
    };
    const rule =
      agreeing(before, after, values) ??
      sentOrNumbered(before, after, field, calls, (held) =>
        agreeing(held, after, values),
      );
    return rule === undefined ? undefined : { rule };
  }
  // A reference one call showed and another that named nothing, storing nothing, agree.
  if (
    before?.rule === "reference" &&
    after === undefined &&
    emptyReference(later.body[before.member], later.entity[field])
  )
    return { rule: before };
  if (
    before === undefined &&
    after?.rule === "reference" &&
    emptyReference(calls.pinned.get(after.member), exemplar[field])
  )
    return { rule: after };
  // The plan echoes a member this call left out: what it stored there is the member's default.
  if (before !== undefined)
    return before.rule === "echo" && !Object.hasOwn(later.body, field)
      ? {
          rule: before,
          default: { member: field, value: later.entity[field]! },
        }
      : undefined;
  if (before === undefined && after !== undefined) {
    const rule = spellsExemplar(field, after, calls);
    if (rule !== undefined) return { rule };
  }
  // This call echoes a member the plan's calls left out: what they stored there is its default.
  if (after !== undefined)
    return after.rule === "echo" && !calls.required.includes(field)
      ? {
          rule: after,
          default: { member: field, value: ownMember(exemplar, field)! },
        }
      : undefined;
  return same(ownMember(exemplar, field), later.entity[field]) ? {} : undefined;
};

/**
 * A create plan widened by a later call, explained on its own: both calls show the same fields, but for a reference
 * whose member a call without it did not send (one an earlier call added stays), every field both rule they rule alike
 * as far as earlier calls allow, a field neither rules holds one value, and where only one echoes a member the other
 * left out, the member becomes optional with the value the call that left it out stored. Members either call sent are
 * accepted, and only those every call sent are required. Undefined when the calls disagree otherwise, so the later call
 * stays unexplained.
 */
export const mergedCreatePlan = (
  plan: { readonly rules: readonly FieldRule[]; readonly body: WriteBody },
  exemplar: JsonObject,
  later: {
    readonly entity: JsonObject;
    readonly body: JsonObject;
    readonly rules: readonly FieldRule[];
    readonly contract: WriteBody;
  },
  earlier: EarlierEvidence = {
    kept: new Set(),
    clockOf: (field) => ownMember(exemplar, field),
  },
): { readonly rules: FieldRule[]; readonly body: WriteBody } | undefined => {
  const held = new Map(plan.rules.map((rule) => [rule.field, rule]));
  const shown = new Map(later.rules.map((rule) => [rule.field, rule]));
  const sentBefore = new Set([
    ...plan.body.accepted,
    ...plan.body.fixed.map(({ member }) => member),
    ...plan.body.required,
  ]);
  const pinned = new Map<string, JsonValue>([
    ...(plan.body.blank ?? []).map(({ member, sent }): [string, JsonValue] => [
      member,
      sent,
    ]),
    ...plan.body.fixed.map(({ member, sent }): [string, JsonValue] => [
      member,
      sent,
    ]),
  ]);
  const merged = new Map<string, FieldRule>();
  const defaults: Default[] = [];
  for (const field of new Set([
    ...Object.keys(exemplar),
    ...Object.keys(later.entity),
    ...held.keys(),
  ])) {
    const outcome = mergedField(field, {
      before: held.get(field),
      after: shown.get(field),
      exemplar,
      later,
      sentBefore,
      pinned,
      defaulted: new Set(
        (plan.body.defaults ?? []).map(({ member }) => member),
      ),
      required: plan.body.required,
      earlier,
    });
    if (outcome === undefined) return undefined;
    if (outcome.rule !== undefined) merged.set(field, outcome.rule);
    if (outcome.default !== undefined) defaults.push(outcome.default);
  }
  // A member a reference reads is accepted with any id, though a call that named nothing showed it fixed.
  const read = new Set(
    [...merged.values()].flatMap((rule) =>
      rule.rule === "reference" ? [rule.member] : [],
    ),
  );
  const body = mergedBody(
    released(plan.body, read),
    {
      ...later,
      contract: released(later.contract, read),
    },
    exemplar,
  );
  const joined =
    body === undefined
      ? undefined
      : joinedDefaults(plan.body.defaults ?? [], defaults);
  if (body === undefined || joined === undefined) return undefined;
  // The plan's rules keep their order; rules the later call adds follow.
  return {
    rules: [
      ...plan.rules.flatMap((rule) => {
        const kept = merged.get(rule.field);
        return kept === undefined ? [] : [kept];
      }),
      ...[...merged.values()].filter((rule) => !held.has(rule.field)),
    ],
    body: joined.length === 0 ? body : { ...body, defaults: joined },
  };
};

/** Every empty value recorded calls sent a member, the earliest first. */
const joinedBlanks = (
  held: readonly Blank[],
  added: readonly Blank[],
): Blank[] => {
  const blank = [...held];
  for (const entry of added)
    if (
      !blank.some(
        ({ member, sent }) => member === entry.member && same(sent, entry.sent),
      )
    )
      blank.push(entry);
  return blank;
};

/** A body contract with the members references read accepted, and kept as sent empty, rather than fixed at the empty value a call sent. */
const released = (body: WriteBody, read: ReadonlySet<string>): WriteBody => {
  const freed = body.fixed.filter(
    ({ member, sent }) => read.has(member) && emptyReference(sent, sent),
  );
  if (freed.length === 0) return body;
  return {
    ...body,
    fixed: body.fixed.filter((entry) => !freed.includes(entry)),
    blank: [
      ...(body.blank ?? []),
      ...freed.filter(
        ({ member }) => !body.blank?.some((entry) => entry.member === member),
      ),
    ],
    accepted: [
      ...body.accepted,
      ...freed
        .map(({ member }) => member)
        .filter((member) => !body.accepted.includes(member)),
    ],
  };
};

/** Two calls' body contracts joined, undefined when a member one accepts with any value the other fixes, or both fix it at different values. */
const mergedBody = (
  body: WriteBody,
  later: {
    readonly body: JsonObject;
    readonly contract: WriteBody;
    readonly entity: JsonObject;
  },
  exemplar: JsonObject,
): WriteBody | undefined => {
  const fixed = new Map(body.fixed.map((entry) => [entry.member, entry.sent]));
  const { contract } = later;
  if (
    contract.accepted.some((member) => fixed.has(member)) ||
    contract.fixed.some(
      (entry) =>
        body.accepted.includes(entry.member) ||
        (fixed.has(entry.member) && !same(fixed.get(entry.member), entry.sent)),
    ) ||
    contract.envelope !== body.envelope
  )
    return undefined;
  const added = contract.accepted.filter(
    (member) => !body.accepted.includes(member),
  );
  const blank = joinedBlanks(body.blank ?? [], contract.blank ?? []);
  return {
    ...body,
    accepted: [...body.accepted, ...added],
    fixed: [
      ...body.fixed,
      ...contract.fixed.filter((entry) => !fixed.has(entry.member)),
    ],
    required: body.required.filter(
      (member) =>
        Object.hasOwn(later.body, member) && !isBlankValue(later.body[member]),
    ),
    identity: body.identity ?? contract.identity,
    kinds: [...body.kinds, ...storedKinds(added, exemplar, later.entity)],
    ...(blank.length === 0 ? {} : { blank }),
  };
};
