import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import {
  ownMember,
  setOwnMember,
  IDENTITY_NAMES,
  isObject,
  same,
  scalarText,
  type JsonObject,
} from "./environmentStateRules.js";
import {
  laterObservation,
  type ObservationSearch,
} from "./environmentStateWriteObserve.js";
import { singleQueryValues } from "../recordedTransportUrl.js";
import { queryKey, queryValuesKey } from "./environmentStateCheckedLines.js";
import type { FieldRule } from "./environmentStateWriteRules.js";
import {
  containsDelimited,
  isUuid,
  readClock,
  formatClock,
  sequenceNumber,
  spelledLike,
  type ClockFormat,
} from "./environmentStateWriteValues.js";

/** A clock value counts as written by the request when it lies this close to the request's start. */
const CLOCK_WINDOW_MS = 10 * 60_000;

/** A created object's clocks lie at most this long after the request that stamped them, as a read's restamp of a write's lies from it. */
const NESTED_WINDOW_MS = 2_000;

/** A clock stored in whole seconds may read up to this long before the request that stamped it. */
const TRUNCATION_MS = 1_000;

/** An opaque generated token: letters and digits, optionally `_` or `-`, long enough to name one entity. */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/u;

/** Verbs a field naming who last changed an entity starts with, where its `created` counterpart names who made it. */
const CHANGED_BY: ReadonlySet<string> = new Set([
  "modified",
  "updated",
  "edited",
  "changed",
]);

/** Trailing words that name a reference rather than what it refers to. */
const REFERENCE_WORDS: ReadonlySet<string> = new Set(["id", "ids", "name"]);

/** The shortest sent text a derived value must show to come from it. */
const DERIVED_TEXT_MIN = 8;

/** A value naming one of a few states, as `draft` or `published` does. */
const STATE_WORD = /^[a-z][a-z_-]{0,23}$/u;

export const isClockNear = (
  value: JsonValue,
  startMs: number | undefined,
): boolean => {
  const clock = readClock(value);
  return (
    clock !== undefined &&
    startMs !== undefined &&
    Math.abs(clock.ms - startMs) <= CLOCK_WINDOW_MS
  );
};

/** Whether a value is an opaque token other than a UUID or clock, spelled like the exemplar when one is given. */
export const isOpaqueToken = (
  value: JsonValue | undefined,
  exemplar?: JsonValue,
): value is string =>
  typeof value === "string" &&
  OPAQUE_TOKEN.test(value) &&
  /[0-9]/u.test(value) &&
  /[A-Za-z]/u.test(value) &&
  (exemplar === undefined ||
    (typeof exemplar === "string" && exemplar.length === value.length)) &&
  !isUuid(value) &&
  readClock(value) === undefined;

/** A body that wraps one object in a one-element array under its only member, as `{"posts":[{...}]}` does: the member and the object. */
export const envelopeOf = (
  body: JsonValue | undefined,
): { readonly member: string; readonly object: JsonObject } | undefined => {
  if (!isObject(body)) return undefined;
  const members = Object.keys(body);
  const wrapped =
    members.length === 1 ? ownMember(body, members[0]!) : undefined;
  return Array.isArray(wrapped) && wrapped.length === 1 && isObject(wrapped[0]!)
    ? { member: members[0]!, object: wrapped[0] }
    : undefined;
};

/** A call's body as a plan with this envelope takes it: the object it wraps, the body itself without one, or undefined when the envelope is missing. */
export const unenveloped = (
  body: JsonValue | undefined,
  envelope: string | undefined,
): JsonValue | undefined => {
  if (envelope === undefined) return body;
  const wrapped = envelopeOf(body);
  return wrapped?.member === envelope ? wrapped.object : undefined;
};

/** The request object and its wrapping, decided once from known entity fields and retained by the plan. */
export const plannedBody = (
  body: JsonValue | undefined,
  plan: { readonly built: boolean; readonly envelope: string | undefined },
  knownField: (member: string) => boolean,
): { readonly object: JsonObject; readonly envelope?: string } | undefined => {
  const wrapped = plan.built ? undefined : envelopeOf(body);
  const envelope = plan.built
    ? plan.envelope
    : wrapped !== undefined && !knownField(wrapped.member)
      ? wrapped.member
      : undefined;
  const object = unenveloped(body, envelope);
  return object !== undefined && isObject(object)
    ? { object, ...(envelope === undefined ? {} : { envelope }) }
    : undefined;
};

/** Whether two queries name the same values; a query repeating a name with another value matches none. */
export const sameQuery = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => {
  const key = queryKey(left);
  return key !== undefined && key === queryKey(right);
};

/**
 * A write call's query as its recording pins it, which may change what the body does: each
 * parameter the recording sent, at the call's value or else the recorded one; an error naming the
 * recorded query when the call sends another value or parameter.
 */
export const pinnedQuery = (
  recorded: string | null | undefined,
  call: ReadonlyMap<string, string>,
): Result<ReadonlyMap<string, string>, string> => {
  const values = singleQueryValues(recorded ?? undefined);
  const pinned = new Map([...(values ?? []), ...call]);
  const spelled = [...(values ?? [])]
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return values !== undefined &&
    queryValuesKey(pinned) === queryValuesKey(values)
    ? ok(pinned)
    : err(
        `takes only the query its recording sent (${spelled === "" ? "none" : spelled}).`,
      );
};

/** Whether the type's other entities hold the field as objects agreeing with this one but in the members, which hold other clocks. */
const sharedBesides = (
  field: string,
  object: JsonObject,
  members: readonly string[],
  others: readonly JsonObject[],
): boolean => {
  const held = others.flatMap((other) => {
    const value = ownMember(other, field);
    return value !== undefined && isObject(value) ? [value] : [];
  });
  return (
    held.length > 0 &&
    held.every((other) =>
      [...new Set([...Object.keys(other), ...Object.keys(object)])].every(
        (key) =>
          members.includes(key)
            ? readClock(ownMember(other, key)) !== undefined &&
              !same(ownMember(other, key), ownMember(object, key))
            : same(ownMember(other, key), ownMember(object, key)),
      ),
    )
  );
};

/** The nested-clock rule for an object whose members hold clocks in one format, when the type shows them stamped per entity. */
const nestedRule = (
  field: string,
  object: JsonObject,
  members: readonly string[],
  others: readonly JsonObject[],
): FieldRule | undefined => {
  const formats = new Set(
    members.map((key) =>
      JSON.stringify(readClock(ownMember(object, key))?.format),
    ),
  );
  return members.length > 0 &&
    formats.size === 1 &&
    sharedBesides(field, object, members, others)
    ? {
        field,
        rule: "nested-clock",
        members: [...members],
        format: readClock(ownMember(object, members[0]!))!.format,
      }
    : undefined;
};

/** The rule for an object field an update changed only in clocks the request wrote. */
export const nestedClockRule = (
  field: string,
  values: { readonly before: JsonValue | undefined; readonly after: JsonValue },
  evidence: {
    readonly startMs: number | undefined;
    readonly others: readonly JsonObject[];
  },
): FieldRule | undefined => {
  const { before, after } = values;
  if (before === undefined || !isObject(before) || !isObject(after))
    return undefined;
  const changed = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => !same(ownMember(before, key), ownMember(after, key)));
  return changed.every(
    (key) =>
      Object.hasOwn(after, key) && isClockNear(after[key]!, evidence.startMs),
  )
    ? nestedRule(field, after, changed, evidence.others)
    : undefined;
};

/** On a create, an object whose every clock the request stamped, where the type's other entities show the same object stamped otherwise. */
export const createdNestedClock = (
  field: string,
  value: JsonValue,
  evidence: {
    readonly startMs: number | undefined;
    readonly type: readonly JsonObject[];
  },
): FieldRule | undefined => {
  const { startMs } = evidence;
  if (!isObject(value) || startMs === undefined) return undefined;
  const members = Object.keys(value).filter(
    (key) => readClock(value[key]) !== undefined,
  );
  // A clock read before the request, past a whole second's truncation, belongs to an entity made earlier.
  const stamped = members.every((key) => {
    const ms = readClock(ownMember(value, key))!.ms;
    return ms >= startMs - TRUNCATION_MS && ms <= startMs + NESTED_WINDOW_MS;
  });
  return stamped ? nestedRule(field, value, members, evidence.type) : undefined;
};

/** Whether an application that answers a clock as `written` stores it as `read` spells it: both ISO, the read at a coarser precision and otherwise alike. Replay and serving respell an update's clocks by this one rule. */
export const readSpellsCoarser = (
  written: JsonValue | undefined,
  read: JsonValue | undefined,
): boolean => {
  const [value, stored] = [readClock(written), readClock(read)];
  return (
    value?.format.kind === "iso" &&
    stored?.format.kind === "iso" &&
    stored.format.fraction < value.format.fraction &&
    same({ ...stored.format, fraction: 0 }, { ...value.format, fraction: 0 })
  );
};

/** An update's fields as its application stores them: each clock at the coarser precision its plan's read-back spelled it. */
export const readSpelledClocks = (
  rules: readonly FieldRule[],
  written: JsonObject,
  read: JsonObject | undefined,
): JsonObject => {
  if (read === undefined) return written;
  const fields = { ...written };
  for (const rule of rules) {
    if (rule.rule !== "clock") continue;
    const answered = ownMember(written, rule.field);
    const shown = ownMember(read, rule.field);
    if (!readSpellsCoarser(answered, shown)) continue;
    const clock = readClock(answered)!;
    const spelled = formatClock(
      clock.ms,
      readClock(shown)!.format,
      clock.subMillisecond,
    );
    if (spelled !== undefined) setOwnMember(fields, rule.field, spelled);
  }
  return fields;
};

/** Whether a clock is one a request starting at `startMs` stamped, in the given format. */
export const stampedBy = (
  value: JsonValue | undefined,
  format: ClockFormat,
  startMs: number | undefined,
): boolean => {
  const clock = readClock(value);
  return (
    clock !== undefined &&
    startMs !== undefined &&
    same(clock.format, format) &&
    clock.ms >= startMs - TRUNCATION_MS &&
    clock.ms <= startMs + NESTED_WINDOW_MS
  );
};

/** The largest integer the objects hold at a member, spelled as the exemplar spells it. */
const largestAt = (
  objects: readonly JsonObject[],
  member: string,
  exemplar: JsonValue | undefined,
): number | undefined => {
  let largest: number | undefined;
  for (const object of objects) {
    const value = sequenceNumber(ownMember(object, member), exemplar);
    if (value !== undefined && (largest === undefined || value > largest))
      largest = value;
  }
  return largest;
};

/** The objects held entities keep at a field. */
export const heldObjects = (
  entities: readonly JsonObject[],
  field: string,
): JsonObject[] =>
  entities.flatMap((entity) => {
    const value = ownMember(entity, field);
    return value !== undefined && isObject(value) ? [value] : [];
  });

/** One past the largest integer held objects show at a member, never below a start. */
export const nextMadeCount = (
  objects: readonly JsonObject[],
  count: { readonly member: string; readonly start: number },
  exemplar: JsonValue | undefined,
): number => {
  const largest = largestAt(objects, count.member, exemplar);
  return Math.max(
    largest === undefined ? count.start : largest + 1,
    count.start,
  );
};

/**
 * On a create, an object the application made with the entity: members holding a clock the request stamped, others the
 * entity's own identity or one past the largest integer held objects show there, and the rest as every held object
 * shows them. Undefined without a stamped clock, since only that shows the request made the object.
 */
export const createdMadeObject = (
  field: string,
  value: JsonValue,
  evidence: {
    readonly startMs: number | undefined;
    readonly type: readonly JsonObject[];
    readonly entity: JsonObject;
    readonly idField: string;
  },
): FieldRule | undefined => {
  const { startMs } = evidence;
  if (!isObject(value) || startMs === undefined) return undefined;
  const keys = Object.keys(value);
  const clocks = keys.filter((key) => {
    const ms = readClock(value[key])?.ms;
    return (
      ms !== undefined &&
      ms >= startMs - TRUNCATION_MS &&
      ms <= startMs + NESTED_WINDOW_MS
    );
  });
  const format =
    clocks.length === 0 ? undefined : readClock(value[clocks[0]!])!.format;
  if (
    format === undefined ||
    clocks.some((key) => !same(readClock(value[key])!.format, format))
  )
    return undefined;
  const id = scalarText(ownMember(evidence.entity, evidence.idField));
  const own = keys.filter(
    (key) =>
      !clocks.includes(key) &&
      id !== undefined &&
      scalarText(value[key]) === id,
  );
  const held = heldObjects(evidence.type, field);
  const counts = keys.flatMap((key) => {
    if (clocks.includes(key) || own.includes(key)) return [];
    const integer = sequenceNumber(value[key]);
    const largest = largestAt(held, key, value[key]);
    return integer !== undefined &&
      largest !== undefined &&
      integer === largest + 1
      ? [{ member: key, start: integer }]
      : [];
  });
  const varying = new Set([
    ...clocks,
    ...own,
    ...counts.map(({ member }) => member),
  ]);
  const alike = held.every((object) =>
    [...new Set([...Object.keys(object), ...keys])].every(
      (key) =>
        varying.has(key) || same(ownMember(object, key), ownMember(value, key)),
    ),
  );
  return alike
    ? { field, rule: "made-object", clocks, format, own, counts }
    : undefined;
};

/** A served made object: the exemplar's, its clocks set to the write's clock and each count to the value `next` gives; its own members follow the entity's identity once written. */
export const madeObjectValue = (
  base: JsonValue | undefined,
  rule: Extract<FieldRule, { rule: "made-object" }>,
  clock: JsonValue,
  next: (count: { readonly member: string; readonly start: number }) => number,
): Result<JsonValue, string> => {
  if (base === undefined || !isObject(base))
    return err(`The plan holds no ${rule.field} object to make.`);
  const made: JsonObject = { ...base };
  for (const member of rule.clocks) setOwnMember(made, member, clock);
  for (const count of rule.counts)
    setOwnMember(
      made,
      count.member,
      spelledLike(ownMember(base, count.member) ?? "", next(count)),
    );
  return ok(made);
};

/** A served nested clock: the object the entity holds, or the observed one for a create, with its stamped members set to the clock. */
export const nestedClockValue = (
  base: JsonValue | undefined,
  rule: Extract<FieldRule, { rule: "nested-clock" }>,
  clock: JsonValue,
): Result<JsonValue, string> =>
  base !== undefined && isObject(base)
    ? ok({
        ...base,
        ...Object.fromEntries(rule.members.map((member) => [member, clock])),
      })
    : err(`The entity holds no ${rule.field} object for the write to stamp.`);

/** A created opaque token's proof: independent generation, an unsupported nested link, or insufficient evidence. */
export const createdToken = (
  field: string,
  entity: JsonObject,
  type: readonly JsonObject[],
): "independent" | "linked" | undefined => {
  const value = ownMember(entity, field);
  if (
    !isOpaqueToken(value) ||
    type.length === 0 ||
    !type.every(
      (member) =>
        ownMember(member, field) !== value &&
        isOpaqueToken(ownMember(member, field), value),
    )
  )
    return undefined;
  if (
    Object.entries(entity).some(
      ([other, held]) =>
        other !== field &&
        (held === value ||
          (typeof held === "object" &&
            held !== null &&
            containsDelimited(held, value))),
    )
  )
    return "linked";
  return "independent";
};

/** What judging an unsent change reads: the entity before and after, the call's body and the type's other entities. */
interface ChangeEvidence {
  readonly before: JsonObject;
  readonly after: JsonObject;
  readonly call: { readonly body: JsonObject };
  readonly others: readonly JsonObject[];
}

/** An update's new opaque token: not sent, not held elsewhere, spelled like the one it replaced. */
export const freshToken = (
  evidence: ChangeEvidence,
  field: string,
): boolean => {
  const before = ownMember(evidence.before, field);
  const after = ownMember(evidence.after, field);
  return (
    isOpaqueToken(after, before) &&
    isOpaqueToken(before) &&
    before !== after &&
    !containsDelimited(evidence.call.body, after) &&
    !Object.entries(evidence.after).some(
      ([name, value]) => name !== field && containsDelimited(value, after),
    ) &&
    !evidence.others.some((other) => containsDelimited(other, after))
  );
};

/** A name's words, lower case: camel case, `_`, `-` and spaces split them. */
const wordsOf = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);

/** A name without the trailing words that make it a reference: `assignedUserId` and `assignedUserName` share `assigned user`. */
const referentOf = (name: string): string => {
  const words = wordsOf(name);
  while (words.length > 1 && REFERENCE_WORDS.has(words.at(-1)!)) words.pop();
  return words.join(" ");
};

/** The words of the `created…by` counterpart of a `modified…by`-style field, as `createdByName` is `modifiedByName`'s. */
const creatorOf = (field: string): string | undefined => {
  const words = wordsOf(field);
  const at = words[0] === "last" ? 1 : 0;
  return CHANGED_BY.has(words[at] ?? "") && words[at + 1] === "by"
    ? ["created", ...words.slice(at + 1)].join(" ")
    : undefined;
};

/** The acting user an update stamps on a `modified…by`-style field, as the entity's `created…by` counterpart already names them. */
export const stampRule = (
  evidence: ChangeEvidence,
  field: string,
): FieldRule | undefined => {
  const after = ownMember(evidence.after, field);
  const creator = creatorOf(field);
  if (typeof after !== "string" || after.length === 0 || creator === undefined)
    return undefined;
  // A field naming what the call sent refers to that, not to the acting user.
  if (
    Object.keys(evidence.call.body).some(
      (member) => referentOf(member) === referentOf(field),
    )
  )
    return undefined;
  return Object.entries(evidence.before).some(
    ([other, value]) => value === after && wordsOf(other).join(" ") === creator,
  )
    ? { field, rule: "stamp", value: after }
    : undefined;
};

/** The other `…by` field naming the acting user (`modifiedById` beside `modifiedByName`), stamped with it when the recorded call shows it at its `created…by` counterpart's value. */
export const pairedStamps = (
  evidence: ChangeEvidence,
  rules: readonly FieldRule[],
): FieldRule[] => {
  const ruled = new Set(rules.map((rule) => rule.field));
  return rules.flatMap((rule) =>
    rule.rule === "stamp"
      ? Object.keys(evidence.after).flatMap((sibling): FieldRule[] => {
          const value = evidence.after[sibling] ?? null;
          const creator = creatorOf(sibling);
          return !ruled.has(sibling) &&
            value !== null &&
            creator !== undefined &&
            referentOf(sibling) === referentOf(rule.field) &&
            Object.entries(evidence.before).some(
              ([other, held]) =>
                same(held, value) && wordsOf(other).join(" ") === creator,
            )
            ? [{ field: sibling, rule: "stamp", value }]
            : [];
        })
      : [],
  );
};

/** A sent string's text, markup aside: what a value derived from it shows. */
const textOf = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
    : undefined;

/** A value an update derived from the one member it sent and stores nowhere: one that shows that member's text. */
export const derivedRule = (
  evidence: ChangeEvidence,
  field: string,
): FieldRule | undefined => {
  const after = ownMember(evidence.after, field);
  if (after === undefined || readClock(after) !== undefined) return undefined;
  const { body } = evidence.call;
  const unstored = Object.keys(body).filter(
    (member) =>
      !Object.hasOwn(evidence.after, member) &&
      !Object.hasOwn(evidence.before, member),
  );
  const text =
    unstored.length === 1 ? textOf(ownMember(body, unstored[0]!)) : undefined;
  const shown = typeof after === "string" ? after : JSON.stringify(after);
  return text !== undefined &&
    text.length >= DERIVED_TEXT_MIN &&
    shown.includes(text)
    ? {
        field,
        rule: "derived",
        value: after,
        from: ownMember(evidence.before, field) ?? null,
        member: unstored[0]!,
      }
    : undefined;
};

/** Why a call cannot take an update's rules: a derived value for an entity holding another than the recorded one, or a held clock not sent or sent otherwise than the entity holds it. */
export const stampProblem = (
  rules: readonly FieldRule[],
  before: JsonObject,
  sent: JsonObject,
): string | undefined => {
  for (const rule of rules) {
    if (
      rule.rule === "derived" &&
      Object.hasOwn(sent, rule.member) &&
      !same(ownMember(before, rule.field) ?? null, rule.from)
    )
      return `Member ${rule.member} is accepted only on an entity whose ${rule.field} is as the recorded call found it, since the application derives ${rule.field} from it.`;
    if (rule.rule === "held-clock" && !Object.hasOwn(sent, rule.field))
      return `Member ${rule.field} must be sent with the value the entity holds, as the recorded call did.`;
    if (
      rule.rule === "held-clock" &&
      !same(ownMember(sent, rule.field), ownMember(before, rule.field))
    )
      return `Member ${rule.field} must repeat the value the entity holds, as the recorded call did.`;
  }
  return undefined;
};

/** The identity values of the objects an entity nests, by the stem of the field each sits under: what a member like `collection_id` names. */
const nestedIdentities = (entity: JsonObject): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const [field, nested] of Object.entries(entity)) {
    if (!isObject(nested)) continue;
    const texts = IDENTITY_NAMES.flatMap((name) => {
      const text = scalarText(ownMember(nested, name));
      return text === undefined ? [] : [text];
    });
    if (texts.length === 0) continue;
    const stem = referentOf(field);
    index.set(stem, new Set([...(index.get(stem) ?? []), ...texts]));
  }
  return index;
};

/** Whether a state word goes with other values elsewhere: one entities share, where every entity in another state holds a field the new one leaves null, or the reverse. */
const stateOf = (
  entity: JsonObject,
  member: string,
  value: JsonValue,
  type: readonly JsonObject[],
): boolean => {
  if (typeof value !== "string" || !STATE_WORD.test(value)) return false;
  const held = type.flatMap((other) =>
    Object.hasOwn(other, member) ? [JSON.stringify(other[member])] : [],
  );
  // A value every entity holds its own of names it, not a state.
  if (new Set(held).size === held.length) return false;
  const others = type.filter(
    (other) => Object.hasOwn(other, member) && !same(other[member], value),
  );
  const unset = (held: JsonValue | undefined) => (held ?? null) === null;
  return (
    others.length > 0 &&
    Object.keys(entity).some(
      (field) =>
        field !== member &&
        others.every(
          (other) =>
            unset(ownMember(other, field)) !== unset(ownMember(entity, field)),
        ),
    )
  );
};

/**
 * Echoed members accepted only with their recorded value: one naming an object the entity nests, which serving
 * would keep as recorded, and on a create a state other fields go with.
 */
export const pinnedEchoes = (
  entity: JsonObject,
  body: JsonObject,
  type?: readonly JsonObject[],
): Set<string> => {
  const nested = nestedIdentities(entity);
  // A member names the object nested under the field it refers to, as `collection_id` does `collection`.
  const namesNested = (member: string, value: JsonValue): boolean => {
    const text = scalarText(value);
    return (
      text !== undefined && nested.get(referentOf(member))?.has(text) === true
    );
  };
  return new Set(
    Object.entries(body).flatMap(([member, value]) =>
      namesNested(member, value) ||
      (type !== undefined && stateOf(entity, member, value, type))
        ? [member]
        : [],
    ),
  );
};

/**
 * A write's fields as stored: each nested clock as the first later read of the entity shows it restamped, else as the
 * call showed it.
 */
export const restampedFields = (
  search: ObservationSearch,
  target: Parameters<typeof laterObservation>[1],
  shown: JsonObject,
  rules: readonly FieldRule[],
): JsonObject => {
  const nested = rules.flatMap((rule) =>
    rule.rule === "nested-clock" ? [rule] : [],
  );
  if (nested.length === 0) return shown;
  const later = laterObservation(search, target);
  const fields = { ...shown };
  for (const rule of nested) {
    const read = storedRestamp(
      ownMember(shown, rule.field),
      ownMember(later?.object, rule.field),
      rule.members,
    );
    if (read !== undefined) setOwnMember(fields, rule.field, read);
  }
  return fields;
};

/** A read's object where it differs from a write's only in the stamped members, each within seconds: the instant the application stored. */
export const storedRestamp = (
  own: JsonValue | undefined,
  read: JsonValue | undefined,
  members: readonly string[],
): JsonValue | undefined => {
  if (own === undefined || read === undefined) return undefined;
  if (!isObject(own) || !isObject(read)) return undefined;
  for (const key of new Set([...Object.keys(own), ...Object.keys(read)])) {
    if (!members.includes(key)) {
      if (!same(ownMember(own, key), ownMember(read, key))) return undefined;
      continue;
    }
    const [written, stored] = [
      readClock(ownMember(own, key)),
      readClock(ownMember(read, key)),
    ];
    if (
      written === undefined ||
      stored === undefined ||
      Math.abs(written.ms - stored.ms) > NESTED_WINDOW_MS
    )
      return undefined;
  }
  return read;
};
