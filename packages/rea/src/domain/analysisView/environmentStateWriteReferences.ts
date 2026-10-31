import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import {
  isObject,
  same,
  scalarText,
  type JsonObject,
  type StateEntity,
} from "./environmentStateRules.js";
import type { FieldRule, WriteBody } from "./environmentStateWriteRules.js";

type ReferenceRule = Extract<FieldRule, { rule: "reference" }>;

/** The fields of each entity of a type with an id the state holds, one per collection holding one. */
export type ReferencedEntity = (
  type: string,
  id: string,
) => readonly JsonObject[];

/** A member name with its trailing id dropped and lower case, to tie `parentId` to `parent`. */
const stemOf = (name: string): string =>
  name
    .replace(/(?:Id|ID|_id|_ID|Ids|_ids)$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");

/** Whether every member of an object holds the value an entity holds there. */
const projects = (object: JsonObject, fields: JsonObject): boolean =>
  Object.entries(object).every(
    ([key, value]) => Object.hasOwn(fields, key) && same(fields[key], value),
  );

/**
 * A created or updated object field that repeats fields of the entity a sent member names, as the state holds it: a
 * parent beside `parentId`. Several members naming such entities resolve to the one named like the field; undefined
 * when none does, or when that leaves more than one. An id that names entities of one type in several collections
 * names none, since serving could not tell which.
 */
export const referenceRule = (
  field: string,
  value: JsonValue | undefined,
  body: JsonObject,
  named: (id: string) => readonly StateEntity[],
): ReferenceRule | undefined => {
  if (Array.isArray(value)) return listReferenceRule(field, value, body, named);
  if (!isObject(value) || Object.keys(value).length < 2) return undefined;
  const matches = new Map<string, { member: string; type: string }>();
  for (const [member, sent] of Object.entries(body)) {
    const id = scalarText(sent);
    if (id === undefined || id.length === 0) continue;
    const held = named(id);
    for (const entity of held)
      if (
        projects(value, entity.fields) &&
        held.filter((other) => other.type === entity.type).length === 1
      )
        matches.set(`${member} ${entity.type}`, { member, type: entity.type });
  }
  const candidates = [...matches.values()];
  const chosen =
    candidates.length === 1
      ? candidates
      : candidates.filter(({ member }) => stemOf(member) === stemOf(field));
  return chosen.length === 1
    ? {
        field,
        rule: "reference",
        member: chosen[0]!.member,
        type: chosen[0]!.type,
        fields: Object.keys(value),
      }
    : undefined;
};

/**
 * A created or updated list field holding, in order, the entities a sent list of ids names, as the state holds them:
 * tags beside `tagIds`. The member is the one named like the field; every element must project one entity of one type.
 */
const listReferenceRule = (
  field: string,
  value: readonly JsonValue[],
  body: JsonObject,
  named: (id: string) => readonly StateEntity[],
): ReferenceRule | undefined => {
  if (value.length === 0 || !value.every(isObject)) return undefined;
  // A list field is named for its items, as `tags` beside `tagIds`.
  const stems = new Set([stemOf(field), stemOf(field).replace(/s$/u, "")]);
  const members = Object.entries(body).filter(
    ([member, sent]) =>
      stems.has(stemOf(member)) &&
      Array.isArray(sent) &&
      sent.length === value.length,
  );
  if (members.length !== 1) return undefined;
  const [member, sent] = members[0]! as [string, JsonValue[]];
  const types = new Set<string>();
  for (const [index, element] of value.entries()) {
    const id = scalarText(sent[index]);
    const held = id === undefined ? [] : named(id);
    const match = held.filter((entity) =>
      projects(element as JsonObject, entity.fields),
    );
    if (match.length !== 1) return undefined;
    types.add(match[0]!.type);
  }
  if (types.size !== 1) return undefined;
  // Every recorded element must list the same fields. A union would add a key one element omitted, and an empty object lists none.
  const [recorded, ...rest] = value.map((element) =>
    Object.keys(element as JsonObject),
  );
  if (
    recorded === undefined ||
    recorded.length === 0 ||
    rest.some(
      (fields) =>
        fields.length !== recorded.length ||
        fields.some((field) => !recorded.includes(field)),
    )
  )
    return undefined;
  return {
    field,
    rule: "reference",
    member,
    type: [...types][0]!,
    fields: recorded,
    many: true,
  };
};

/** Whether a call's member and the entity's field show a reference to nothing: a `null` id and field, or empty lists. */
export const emptyReference = (
  sent: JsonValue | undefined,
  stored: JsonValue | undefined,
): boolean =>
  (sent === null && stored === null) ||
  (Array.isArray(sent) &&
    sent.length === 0 &&
    Array.isArray(stored) &&
    stored.length === 0);

/** A reference's value for a call: the named entity's fields it lists, or undefined when the call does not send its member. */
export const referencedValue = (
  rule: ReferenceRule,
  body: JsonObject,
  referenced: ReferencedEntity | undefined,
  blank?: WriteBody["blank"],
): Result<JsonValue | undefined, string> => {
  if (!Object.hasOwn(body, rule.member)) return ok(undefined);
  const sent = body[rule.member]!;
  // A call naming nothing stores nothing, as a recorded call that sent the member `null` did.
  if (
    sent === null &&
    blank?.some((entry) => entry.member === rule.member && entry.sent === null)
  )
    return ok(null);
  if (rule.many === true) {
    if (!Array.isArray(sent))
      return err(`Member ${rule.member} sends no list of ids.`);
    const { many: _many, ...single } = rule;
    const values: JsonValue[] = [];
    for (const one of sent) {
      const value = referencedValue(single, { [rule.member]: one }, referenced);
      if (!value.ok) return value;
      values.push(value.value ?? null);
    }
    return ok(values);
  }
  const id = scalarText(sent);
  const held = id === undefined ? [] : (referenced?.(rule.type, id) ?? []);
  const [fields] = held;
  if (fields === undefined)
    return err(
      `Member ${rule.member} names no entity of ${rule.type} the environment holds, which ${rule.field} repeats.`,
    );
  if (held.length > 1)
    return err(
      `Member ${rule.member} names entities of ${rule.type} in ${held.length} collections, so ${rule.field} cannot tell which it repeats.`,
    );
  return ok(
    Object.fromEntries(
      rule.fields.flatMap((key) =>
        Object.hasOwn(fields, key) ? [[key, fields[key]!]] : [],
      ),
    ),
  );
};
