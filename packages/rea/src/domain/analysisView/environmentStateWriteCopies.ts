import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  pointerTokens,
  scalarText,
  type JsonObject,
  type StateEntity,
} from "./environmentStateRules.js";
import { GENERATED } from "./environmentStateWriteGenerated.js";
import type { FieldRule } from "./environmentStateWriteRules.js";
import { delimitedOffsets, readClock } from "./environmentStateWriteValues.js";

/** Shorter body strings are too common to show that a field copied one. */
export const COPY_MIN_LENGTH = 8;

/** A string that embeds a generated value, or a long value copied from the call, delimited is rebuilt around the new value. */
export const templateRule = (
  entity: JsonObject,
  field: string,
  sources: readonly FieldRule[],
): FieldRule | undefined => {
  const value = ownMember(entity, field);
  if (typeof value !== "string") return undefined;
  for (const rule of sources) {
    const token = scalarText(ownMember(entity, rule.field));
    const generated = GENERATED.has(rule.rule);
    if (
      rule.field !== field &&
      token !== undefined &&
      token.length >= (generated ? 1 : COPY_MIN_LENGTH) &&
      delimitedOffsets(value, token).length > 0
    )
      return { field, rule: "template", from: rule.field };
  }
  return undefined;
};

/** Body members the entity stores as sent, under their own name (echo) or only another (a copy of the whole member), or names an entity by (a reference). */
export const storedMembers = (
  rules: readonly FieldRule[],
  entity: JsonObject,
): Set<string> =>
  new Set(
    rules.flatMap((rule) => {
      if (rule.rule === "echo") return [rule.field];
      if (rule.rule === "reference") return [rule.member];
      const tokens = rule.rule === "copy" ? pointerTokens(rule.from) : [];
      // A member also stored otherwise under its own name is not stored as sent.
      return tokens.length === 1 && !Object.hasOwn(entity, tokens[0]!)
        ? tokens
        : [];
    }),
  );

/** A letter or digit, which joins a token to the text around it. */
const WORD = /[\p{L}\p{N}]/u;

const joins = (character: string | undefined): boolean =>
  character !== undefined && WORD.test(character);

/**
 * The texts that hold each token delimited, read in one pass per text: from each start after a
 * delimiter, each length a token has that a delimiter ends, rather than a search per token and text.
 */
const holdersOf = (
  texts: ReadonlyMap<string, string>,
  tokens: ReadonlySet<string>,
): Map<string, Set<string>> => {
  const lengths = [...new Set([...tokens].map((token) => token.length))].sort(
    (left, right) => left - right,
  );
  const holders = new Map<string, Set<string>>();
  for (const [field, text] of texts)
    for (let at = 0; at < text.length; at += 1) {
      if (joins(text[at - 1])) continue;
      for (const length of lengths) {
        if (at + length > text.length) break;
        if (joins(text[at + length])) continue;
        const token = text.slice(at, at + length);
        if (tokens.has(token))
          holders.set(token, (holders.get(token) ?? new Set()).add(field));
      }
    }
  return holders;
};

/** Copy or echo rules whose value also sits in text no template rebuilds around it, so a call changing their member would leave that text stale. */
export const strandedCopies = (
  rules: readonly FieldRule[],
  entity: JsonObject,
  texts: readonly string[],
): Set<string> => {
  const rebuilt = new Map(
    rules.flatMap((rule) =>
      rule.rule === "template" ? [[rule.field, rule.from] as const] : [],
    ),
  );
  const sources = rules.flatMap((rule) => {
    const token = scalarText(ownMember(entity, rule.field));
    return (rule.rule === "copy" || rule.rule === "echo") &&
      token !== undefined &&
      token.length >= COPY_MIN_LENGTH
      ? [{ field: rule.field, token }]
      : [];
  });
  const holders = holdersOf(
    new Map(
      texts.flatMap((field) => {
        const value = ownMember(entity, field);
        return typeof value === "string" ? [[field, value] as const] : [];
      }),
    ),
    new Set(sources.map((source) => source.token)),
  );
  return new Set(
    sources.flatMap(({ field, token }) =>
      [...(holders.get(token) ?? [])].some(
        (holder) => holder !== field && rebuilt.get(holder) !== field,
      )
        ? [field]
        : [],
    ),
  );
};

/** A member name that reads as a reference to another entity: `parentId`, `parent_id`. */
const REFERENCE_NAME = /(?:[a-z0-9]Id|[a-z0-9]ID|_id|_ID)$/;

/** The shortest stem that ties a field's name to a member's. */
const STEM_MIN_LENGTH = 3;

/** A name's stem: letters and digits in lower case, less a reference's `Id`. */
const stemOf = (name: string): string =>
  name
    .replace(REFERENCE_NAME, (suffix) => suffix.slice(0, -2))
    .replace(/_$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");

/** Whether a field's name relates to a member's: one stem begins the other (`parentId` and `parentName`, `dateEndDate` and `dateEnd`). */
const related = (member: string, field: string): boolean => {
  const [left, right] = [stemOf(member), stemOf(field)];
  return (
    Math.min(left.length, right.length) >= STEM_MIN_LENGTH &&
    (left.startsWith(right) || right.startsWith(left))
  );
};

/** The entities a member's value names: of the types whose paths hold its stem, when any does. */
const namedBy = (
  member: string,
  id: string,
  named: (id: string) => readonly StateEntity[],
): readonly StateEntity[] => {
  const candidates = named(id);
  const stem = stemOf(member);
  const scoped = candidates.filter((entity) =>
    entity.type
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, "")
      .includes(stem),
  );
  return scoped.length > 0 ? scoped : candidates;
};

/**
 * Body members naming another entity whose own text a field named after the member repeats under
 * another name (a parent's name beside its id): a call naming another entity would leave that field
 * stale. A value shorter than a copy names an entity only under a member named as a reference.
 */
export const referencedMembers = (
  body: JsonObject,
  entity: JsonObject,
  texts: readonly string[],
  named: (id: string) => readonly StateEntity[],
): Set<string> => {
  const members = new Set<string>();
  for (const [member, sent] of Object.entries(body)) {
    const id = scalarText(sent);
    if (
      id === undefined ||
      (id.length < COPY_MIN_LENGTH && !REFERENCE_NAME.test(member))
    )
      continue;
    const referenced = namedBy(member, id, named).filter(
      (other) => other.fields !== entity,
    );
    if (referenced.length === 0) continue;
    // A reference repeated under another reference's name is the same entity named twice, not its text.
    const repeats = (field: string): boolean => {
      const value = ownMember(entity, field);
      return (
        typeof value === "string" &&
        value.length >= COPY_MIN_LENGTH &&
        !REFERENCE_NAME.test(field) &&
        referenced.some((other) =>
          Object.entries(other.fields).some(
            ([key, text]) =>
              key !== field && !REFERENCE_NAME.test(key) && text === value,
          ),
        )
      );
    };
    if (texts.some((field) => related(member, field) && repeats(field)))
      members.add(member);
  }
  return members;
};

/** A date the call sent and an instant derived from it differ by at most a time zone and a day boundary. */
const DERIVED_INSTANT_MS = 2 * 86_400_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The instant a string spells: an ISO date, or a time readClock reads. */
const instantOf = (value: JsonValue | undefined): number | undefined => {
  if (typeof value !== "string") return undefined;
  return DATE_ONLY.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : readClock(value)?.ms;
};

/** Body members sending a date or time that a constant named after the member lies within two days of: the application derived it, so another value would leave it stale. */
export const instantMembers = (
  body: JsonObject,
  entity: JsonObject,
  constants: readonly string[],
): Set<string> => {
  const instants = constants.flatMap((field) => {
    const at = instantOf(ownMember(entity, field));
    return at === undefined ? [] : [{ field, at }];
  });
  return new Set(
    Object.entries(body).flatMap(([member, sent]) => {
      const ms = instantOf(sent);
      return ms !== undefined &&
        instants.some(
          ({ field, at }) =>
            Math.abs(at - ms) <= DERIVED_INSTANT_MS && related(member, field),
        )
        ? [member]
        : [];
    }),
  );
};
