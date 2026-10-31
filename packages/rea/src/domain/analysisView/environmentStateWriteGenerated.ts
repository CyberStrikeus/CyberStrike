import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  isObject,
  pointerTo,
  type JsonObject,
  type StateEntity,
} from "./environmentStateRules.js";
import type { FieldRule } from "./environmentStateWriteRules.js";
import { isUuid, seededUuid } from "./environmentStateWriteValues.js";

/** The rules whose values the application generates. */
export const GENERATED: ReadonlySet<FieldRule["rule"]> = new Set([
  "identity",
  "sequence",
  "unique",
]);

interface GeneratedUpdateEvidence {
  readonly before: JsonObject;
  readonly after: JsonObject;
  readonly call: { readonly body: JsonObject };
  readonly others: readonly JsonObject[];
}

/** An independently generated UUID: not sent, held by another entity, or linked to another output field. */
export const freshUuid = (
  evidence: GeneratedUpdateEvidence,
  field: string,
): boolean => {
  const before = ownMember(evidence.before, field);
  const after = ownMember(evidence.after, field);
  if (!isUuid(before) || !isUuid(after)) return false;
  const fresh = after.toLowerCase();
  // Scalar generation and nested renewal have separate owners. A shared output UUID
  // is a relation they cannot reproduce, not evidence for independent generation.
  for (const [name, value] of Object.entries(evidence.after))
    if (name !== field && uuidsIn(value).has(fresh)) return false;
  return (
    before.toLowerCase() !== fresh &&
    !uuidsIn(evidence.call.body).has(fresh) &&
    !evidence.others.some((other) => uuidsIn(other).has(fresh))
  );
};

/** What an update renewed in a value: each old UUID's new one, and the pointers (`*` for any array index) it renewed at. */
export interface Renewal {
  /** Canonical identities, independent of each occurrence's source spelling. */
  readonly uuids: ReadonlyMap<string, string>;
  readonly pointers: string[];
}

/** The UUIDs two values hold at each pointer: those that changed, and those kept in place. */
interface Paired {
  readonly renewed: Map<string, string>;
  readonly changedAt: Set<string>;
  readonly keptAt: Set<string>;
  readonly kept: Set<string>;
}

/** The pointer of a value's child, with `*` for an array index. */
const childPointer = (pointer: string, key: string | number): string =>
  `${pointer}${typeof key === "number" ? "/*" : pointerTo(key)}`;

/** Walk two values in step, undefined when they differ in anything but UUIDs or one UUID changes two ways. */
const pairUuids = (before: JsonValue, after: JsonValue): Paired | undefined => {
  const paired: Paired = {
    renewed: new Map(),
    changedAt: new Set(),
    keptAt: new Set(),
    kept: new Set(),
  };
  const pending: (readonly [JsonValue, JsonValue, string])[] = [
    [before, after, ""],
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [was, now, pointer] = next;
    if (isUuid(was) && isUuid(now)) {
      if (was === now) {
        paired.kept.add(was.toLowerCase());
        paired.keptAt.add(pointer);
      } else if (
        was.toLowerCase() === now.toLowerCase() ||
        (paired.renewed.get(was.toLowerCase()) ?? now.toLowerCase()) !==
          now.toLowerCase()
      )
        return undefined;
      else {
        paired.renewed.set(was.toLowerCase(), now.toLowerCase());
        paired.changedAt.add(pointer);
      }
    } else if (Array.isArray(was) && Array.isArray(now)) {
      if (was.length !== now.length) return undefined;
      for (const [index, item] of was.entries())
        pending.push([item, now[index]!, childPointer(pointer, index)]);
    } else if (isObject(was) && isObject(now)) {
      const keys = Object.keys(was);
      if (keys.length !== Object.keys(now).length) return undefined;
      for (const key of keys) {
        if (!Object.hasOwn(now, key)) return undefined;
        pending.push([
          ownMember(was, key)!,
          now[key]!,
          childPointer(pointer, key),
        ]);
      }
    } else if (was !== now) return undefined;
  }
  return paired;
};

/**
 * The UUIDs `after` holds where `before` held others, when the two differ in nothing else: every
 * UUID at a pointer it renewed is new, each old one has one new one, and none was held before.
 */
export const renewedUuids = (
  before: JsonValue,
  after: JsonValue,
): Renewal | undefined => {
  const paired = pairUuids(before, after);
  if (paired === undefined || paired.renewed.size === 0) return undefined;
  const { renewed, changedAt, keptAt, kept } = paired;
  const old = [...renewed.keys()];
  const fresh = [...renewed.values()];
  const held = new Set([...kept, ...old]);
  // A UUID kept where another was renewed, renewed twice into one, or already held is a reference that moved, not a fresh one.
  return [...changedAt].every((at) => !keptAt.has(at)) &&
    old.every((uuid) => !kept.has(uuid)) &&
    new Set(fresh).size === fresh.length &&
    fresh.every((uuid) => !held.has(uuid))
    ? { uuids: renewed, pointers: [...changedAt].sort() }
    : undefined;
};

/** Every UUID a value holds, in lower case. */
export const uuidsIn = (value: JsonValue | undefined): Set<string> => {
  const found = new Set<string>();
  const pending: JsonValue[] = value === undefined ? [] : [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (isUuid(next)) found.add(next.toLowerCase());
    else if (Array.isArray(next) || isObject(next))
      for (const child of Object.values(next)) pending.push(child);
  }
  return found;
};

/** The `renewed` rule of a field whose child rows an update renewed with UUIDs no other entity holds, if it did. */
export const renewedRule = (
  field: string,
  change: { readonly before: JsonValue; readonly after: JsonValue },
  others: readonly JsonObject[],
): FieldRule | undefined => {
  const renewal = renewedUuids(change.before, change.after);
  const held = uuidsIn(others.map((other) => ownMember(other, field) ?? null));
  return renewal !== undefined &&
    [...renewal.uuids.values()].every((uuid) => !held.has(uuid.toLowerCase()))
    ? { field, rule: "renewed", pointers: renewal.pointers }
    : undefined;
};

/** Renewals whose identities are not fresh or whose links the shared nested generator cannot reproduce. */
export const unexplainedRenewals = (
  rules: readonly FieldRule[],
  evidence: GeneratedUpdateEvidence,
): string[] => {
  const { before, after, call, others } = evidence;
  const generated = new Set(
    rules.filter((rule) => rule.rule === "renewed").map((rule) => rule.field),
  );
  if (generated.size === 0) return [];
  // Requests, previous identities and non-renewed output locations have different
  // ownership from generated rows. Their UUIDs cannot be replaced independently.
  const held = uuidsIn([
    before,
    call.body,
    ...others,
    ...Object.entries(after)
      .filter(([field]) => !generated.has(field))
      .map(([, value]) => value),
  ]);
  const renewed = new Map<string, string>();
  const owners = new Map<string, string>();
  const fields = new Set<string>();
  for (const rule of rules) {
    if (rule.rule !== "renewed") continue;
    const renewal = renewedUuids(
      ownMember(before, rule.field)!,
      ownMember(after, rule.field)!,
    );
    for (const [was, now] of renewal?.uuids ?? []) {
      if (
        held.has(now) ||
        (renewed.get(was) ?? now) !== now ||
        (owners.get(now) ?? was) !== was
      )
        fields.add(rule.field);
      renewed.set(was, now);
      owners.set(now, was);
    }
  }
  return [...fields];
};

/** The UUID replacements of one served call: each UUID once in any letter case, seeded by the call and the order it was first renewed in, and spelled in the case of each place it fills. */
export const callRenewal = (seed: string): ((uuid: string) => string) => {
  const order = new Map<string, number>();
  return (uuid) => {
    const key = uuid.toLowerCase();
    if (!order.has(key)) order.set(key, order.size);
    return seededUuid(`${seed}:${String(order.get(key))}`, uuid);
  };
};

/** The fields of every entity but the one named. */
export const otherFields = (
  entities: readonly StateEntity[],
  named: { readonly collection: string; readonly id: string },
): JsonObject[] =>
  entities
    .filter(
      (entity) =>
        entity.id !== named.id || entity.collection !== named.collection,
    )
    .map((entity) => entity.fields);
