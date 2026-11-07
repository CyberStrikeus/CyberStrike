import type { JsonObject } from "../../domain/analysisView/environmentStateRules.js";
import type { BodyAddress } from "../../domain/analysisView/environmentStateWriteRules.js";
import { isUuid } from "../../domain/analysisView/environmentStateWriteValues.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { ProbeToolCall } from "./environmentCompareMatch.js";

/** Field names that hold an identifier: `id`, `uuid`, `guid`, or names ending in `id` or `_id`. */
export const ID_FIELD = /^(id|uuid|guid)$|(_id|Id|ID|_uuid|Uuid)$/u;

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalarId = (value: JsonValue | undefined): value is string | number =>
  (typeof value === "string" && value !== "") ||
  (typeof value === "number" && Number.isFinite(value));

/** Entity identity fields, whose values an answer's own collection scopes. */
export const IDENTITY_FIELD = /^(id|uuid|guid)$/u;

/**
 * Live identifier values and the environment's values they stand for, in both directions: one map for the whole probe,
 * and one per collection for the ids of its own entities, since two collections can reuse a live id for entities the
 * environment holds under different ids.
 */
export class IdMap {
  readonly #toEnv = new Map<string, string | number>();
  readonly #toLive = new Map<string, string | number>();
  readonly #scoped = new Map<string, Map<string, string | number>>();
  readonly #envValues = new Set<string>();
  readonly #stateReferenceFields = new Map<string, Set<string>>();
  // Equal-pair collisions can make either side unsafe: raw equality on the second pair would hide its conflict.
  readonly #ambiguousEnvValues = new Set<string>();
  #conflicts = 0;

  /**
   * Pair a live value with an environment value. The first pairing of either side wins; if a conflict includes an equal
   * pair, the accepted global destination is withheld from translation so raw equality cannot hide that conflict. A
   * collection keeps its own first pairing, including equal values. `size` counts usable non-identity translations.
   */
  learn(
    live: string | number,
    env: string | number,
    scope?: string,
    stateReferenceField?: string,
  ): void {
    const liveKey = String(live);
    const envKey = String(env);
    if (scope !== undefined && !this.#pairScoped(scope, liveKey, env, envKey))
      return;
    if (scope !== undefined && liveKey === envKey) return;
    const known = this.#toEnv.get(liveKey);
    if (known !== undefined) {
      if (String(known) !== envKey) {
        this.#conflicts += 1;
        if (liveKey === envKey) this.#ambiguousEnvValues.add(String(known));
      } else if (stateReferenceField !== undefined)
        this.#noteStateReference(liveKey, stateReferenceField);
      return;
    }
    const knownLive = this.#toLive.get(envKey);
    if (knownLive !== undefined) {
      this.#conflicts += 1;
      if (String(knownLive) === envKey || liveKey === envKey)
        this.#ambiguousEnvValues.add(envKey);
      return;
    }
    this.#toEnv.set(liveKey, env);
    this.#toLive.set(envKey, live);
    this.#envValues.add(envKey);
    if (stateReferenceField !== undefined)
      this.#noteStateReference(liveKey, stateReferenceField);
  }

  /** Store one collection's pairing. False when it conflicts with a pairing that collection already kept. */
  #pairScoped(
    scope: string,
    liveKey: string,
    env: string | number,
    envKey: string,
  ): boolean {
    const scoped =
      this.#scoped.get(scope) ?? new Map<string, string | number>();
    const known = scoped.get(liveKey);
    if (known !== undefined) {
      if (String(known) !== envKey) this.#conflicts += 1;
      return false;
    }
    for (const value of scoped.values()) {
      if (String(value) === envKey) {
        this.#conflicts += 1;
        return false;
      }
    }
    scoped.set(liveKey, env);
    this.#scoped.set(scope, scoped);
    this.#envValues.add(envKey);
    return true;
  }

  /** The environment's value for a live one: the collection's own when a scope is given and it knows one, else the probe's. */
  env(live: string | number, scope?: string): string | number | undefined {
    const liveKey = String(live);
    const scoped =
      scope === undefined ? undefined : this.#scoped.get(scope)?.get(liveKey);
    if (scoped !== undefined) return scoped;
    const global = this.#toEnv.get(liveKey);
    return global !== undefined && !this.#ambiguousEnvValues.has(String(global))
      ? global
      : undefined;
  }

  hasLive(value: string | number): boolean {
    const key = String(value);
    return (
      this.#toEnv.has(key) ||
      [...this.#scoped.values()].some((scoped) => scoped.has(key))
    );
  }

  hasEnv(value: string | number): boolean {
    return this.#envValues.has(String(value));
  }

  #noteStateReference(value: string, field: string): void {
    const fields = this.#stateReferenceFields.get(value) ?? new Set<string>();
    fields.add(field);
    this.#stateReferenceFields.set(value, fields);
  }

  /** A non-identifier string field that learning proved is an id in environment state. */
  isStateReference(value: string, field: string): boolean {
    return this.#stateReferenceFields.get(String(value))?.has(field) ?? false;
  }

  get size(): number {
    return [...this.#toEnv].filter(
      ([live, env]) =>
        live !== String(env) && !this.#ambiguousEnvValues.has(String(env)),
    ).length;
  }

  get conflicts(): number {
    return this.#conflicts;
  }
}

/** A field every object element has as a non-empty string, unique on its side; not an identifier, which differs across sides. */
const keyCandidates = (items: readonly JsonObject[]): Set<string> => {
  const candidates = new Set<string>();
  const first = items[0];
  if (first === undefined) return candidates;
  for (const key of Object.keys(first)) {
    if (ID_FIELD.test(key)) continue;
    const values = items.map((item) => item[key]);
    if (
      values.every((value) => typeof value === "string" && value !== "") &&
      new Set(values).size === values.length
    )
      candidates.add(key);
  }
  return candidates;
};

/** How two arrays pair: by a natural key, by position because no key is shared, or by position although a shared key paired nothing. */
interface Pairing {
  readonly pairs: Array<readonly [number, number]>;
  readonly by: "key" | "position" | "unmatched";
}

const pairing = (
  live: readonly JsonValue[],
  env: readonly JsonValue[],
): Pairing => {
  const byPosition = (by: Pairing["by"]): Pairing => ({
    pairs: Array.from(
      { length: Math.min(live.length, env.length) },
      (_, index) => [index, index] as const,
    ),
    by,
  });
  if (!live.every(isObject) || !env.every(isObject))
    return byPosition("position");
  const liveItems = live as readonly JsonObject[];
  const envItems = env as readonly JsonObject[];
  const envKeys = keyCandidates(envItems);
  const shared = [...keyCandidates(liveItems)].filter((key) =>
    envKeys.has(key),
  );
  let best: Array<readonly [number, number]> = [];
  for (const key of shared.sort()) {
    const envIndex = new Map(envItems.map((item, index) => [item[key], index]));
    const pairs: Array<readonly [number, number]> = [];
    for (const [index, item] of liveItems.entries()) {
      const match = envIndex.get(item[key]);
      if (match !== undefined) pairs.push([index, match]);
    }
    if (pairs.length > best.length) best = pairs;
  }
  if (best.length > 0) return { pairs: best, by: "key" };
  return byPosition(shared.length > 0 ? "unmatched" : "position");
};

/**
 * Pair two arrays' object elements by the natural key that pairs the most, as [live index, env index]; arrays of other
 * values, or with no shared key, pair by position up to the shorter length.
 */
export const pairElements = (
  live: readonly JsonValue[],
  env: readonly JsonValue[],
): Array<readonly [number, number]> => pairing(live, env).pairs;

/** Whether an object's keys are evidently identifiers: digits or UUIDs, or each the identity of the entry it keys. */
const keyedByIds = (
  entries: readonly (readonly [string, JsonValue])[],
): boolean =>
  entries.every(
    ([key, value]) =>
      /^\d+$/u.test(key) ||
      isUuid(key) ||
      (isObject(value) &&
        Object.entries(value).some(
          ([field, held]) =>
            IDENTITY_FIELD.test(field) &&
            isScalarId(held) &&
            String(held) === key,
        )),
  );

/** Whether an answer's object is keyed by learned ids, read as learning reads one: a key both sides share needs every key evidently an id, and otherwise each entry is an entity or each key evidently an id. */
export const keyedByLearnedIds = (
  live: JsonObject,
  env: JsonObject,
  map: IdMap,
): boolean => {
  const entries = Object.entries(live);
  if (!entries.some(([key]) => map.hasLive(key))) return false;
  return entries.some(([key]) => Object.hasOwn(env, key))
    ? keyedByIds(entries)
    : entries.every(([, value]) => isObject(value)) || keyedByIds(entries);
};

/**
 * Two objects keyed by ids, whose object values pair by a natural key: each pair maps the live key to the environment's
 * and is learned from in turn. Returns whether the objects were read that way.
 */
const learnKeyedEntries = (
  live: JsonObject,
  env: JsonObject,
  context: LearnContext,
  own: boolean,
  at: string,
): boolean => {
  const liveEntries = Object.entries(live);
  const envEntries = Object.entries(env);
  const shared = liveEntries.filter(([key]) => Object.hasOwn(env, key)).length;
  if (
    liveEntries.length === 0 ||
    envEntries.length === 0 ||
    shared === liveEntries.length ||
    !liveEntries.every(([, value]) => isObject(value)) ||
    !envEntries.every(([, value]) => isObject(value))
  )
    return false;
  const paired = pairing(
    liveEntries.map(([, value]) => value),
    envEntries.map(([, value]) => value),
  );
  // Re-seeded ids can reuse a key for another entity, but ordinary fields overlap too: keys that overlap are read as ids
  // only when they evidently are ids and every entry pairs.
  if (
    paired.by !== "key" ||
    (shared > 0 &&
      (paired.pairs.length !== liveEntries.length ||
        !keyedByIds(liveEntries) ||
        !keyedByIds(envEntries)))
  )
    return false;
  for (const [left, right] of paired.pairs) {
    const [liveKey, liveValue] = liveEntries[left]!;
    const [envKey, envValue] = envEntries[right]!;
    context.map.learn(liveKey, envKey, own ? context.scope : undefined);
    learnAt(liveValue, envValue, context, {
      at: childPointer(at, liveKey),
      own,
    });
  }
  return true;
};

/** What learning reads besides the two values: the map it adds to, the ids the state holds, and where the answer's own entities sit. */
interface LearnContext {
  readonly map: IdMap;
  readonly heldIds: ReadonlySet<string>;
  readonly scope: string | undefined;
  /** JSON pointer of the answer's own entity, or of the array holding its entities. */
  readonly entityAt: string;
  /** The write answers with the new id alone, at `entityAt`, rather than an entity object. */
  readonly identity: boolean;
}

/** Two values under one key as a pair of ids, when they are: an identifier field, or outside one only a string the state holds as an id, since a counter that equals an id is not one. */
const idPair = (
  key: string,
  value: JsonValue,
  other: JsonValue | undefined,
  heldIds: ReadonlySet<string>,
): readonly [string | number, string | number] | undefined =>
  isScalarId(value) &&
  isScalarId(other) &&
  (ID_FIELD.test(key) ||
    (typeof value === "string" &&
      typeof other === "string" &&
      heldIds.has(other)))
    ? [value, other]
    : undefined;

const childPointer = (at: string, key: string | number): string =>
  `${at}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

const learnAt = (
  live: JsonValue | undefined,
  env: JsonValue | undefined,
  context: LearnContext,
  place: { readonly at: string; readonly own: boolean },
): void => {
  if (Array.isArray(live) && Array.isArray(env)) {
    // Items paired only by position stand for the same entities only when nothing could pair them by a key and the
    // arrays are the same length; otherwise a filtered or reordered list would teach wrong ids.
    const paired = pairing(live, env);
    if (
      paired.by === "unmatched" ||
      (paired.by === "position" && live.length !== env.length)
    )
      return;
    for (const [left, right] of paired.pairs)
      learnAt(live[left], env[right], context, {
        at: childPointer(place.at, left),
        own: place.at === context.entityAt,
      });
    return;
  }
  if (!isObject(live) || !isObject(env)) {
    if (
      context.identity &&
      place.at === context.entityAt &&
      isScalarId(live) &&
      isScalarId(env)
    )
      context.map.learn(live, env, context.scope);
    return;
  }
  const own = place.own || place.at === context.entityAt;
  if (learnKeyedEntries(live, env, context, own, place.at)) return;
  for (const [key, value] of Object.entries(live)) {
    if (!Object.hasOwn(env, key)) continue;
    const other = env[key];
    const pair = idPair(key, value, other, context.heldIds);
    if (pair !== undefined) {
      const stateReferenceField =
        !ID_FIELD.test(key) &&
        typeof value === "string" &&
        typeof other === "string" &&
        context.heldIds.has(other);
      context.map.learn(
        ...pair,
        own && IDENTITY_FIELD.test(key) ? context.scope : undefined,
        stateReferenceField ? key : undefined,
      );
    } else
      learnAt(value, other, context, {
        at: childPointer(place.at, key),
        own: false,
      });
  }
};

/**
 * Learn identifier pairs from the live and environment answers to one call: identifier fields, and strings the state holds
 * as ids, of objects that pair, at any depth. The identity fields of the answer's own entities, the object or the items of
 * the array at `entityAt` (the root by default), are also learned under `scope`, the collection the call names. A write
 * whose response is only the new id (`identity`) learns that scalar at `entityAt`.
 */
export const learnIds = (
  live: JsonValue | undefined,
  env: JsonValue | undefined,
  map: IdMap,
  known: {
    /** Ids the environment's state holds, which mark a string outside identifier fields as an id. */
    readonly heldIds: ReadonlySet<string>;
    readonly scope?: string;
    readonly entityAt?: string;
    readonly identity?: boolean;
  },
): void =>
  learnAt(
    live,
    env,
    {
      map,
      heldIds: known.heldIds,
      scope: known.scope,
      entityAt: known.entityAt ?? "",
      identity: known.identity === true,
    },
    { at: "", own: false },
  );

/** A live identifier as the environment's value, in its own type; unchanged when unmapped. */
const inEnvTerms = (
  value: string | number,
  env: string | number | undefined,
): JsonValue => {
  if (env === undefined) return value;
  return typeof value === "string"
    ? String(env)
    : typeof env === "number"
      ? env
      : value;
};

/** A value with every string or number equal to a mapped live identifier replaced by the environment's value, in its own type. */
export const translateValue = (value: JsonValue, map: IdMap): JsonValue => {
  if (Array.isArray(value))
    return value.map((item) => translateValue(item, map));
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        translateValue(item, map),
      ]),
    );
  return isScalarId(value) ? inEnvTerms(value, map.env(value)) : value;
};

/** A bulk write's body argument, how it names its entities, and the collection whose own mapping translates those ids. */
export interface BulkIds {
  readonly body: string;
  readonly address: BodyAddress;
  readonly idField: string;
  readonly scope: string;
}

/** A bulk write's body with each id it names translated by its collection's own mapping, and every other value as `translateValue` does. */
const translateBulkBody = (
  body: JsonValue,
  map: IdMap,
  bulk: BulkIds,
): JsonValue => {
  const { address, idField, scope } = bulk;
  const id = (value: JsonValue): JsonValue =>
    isScalarId(value) ? inEnvTerms(value, map.env(value, scope)) : value;
  const entries = (value: JsonValue): JsonValue =>
    Array.isArray(value)
      ? value.map((entry) =>
          address.by === "ids"
            ? id(entry)
            : isObject(entry) && Object.hasOwn(entry, idField)
              ? {
                  ...(translateValue(entry, map) as JsonObject),
                  [idField]: id(entry[idField]!),
                }
              : translateValue(entry, map),
        )
      : translateValue(value, map);
  if (address.member === null) return entries(body);
  return isObject(body)
    ? Object.fromEntries(
        Object.entries(body).map(([key, value]) => [
          key,
          key === address.member ? entries(value) : translateValue(value, map),
        ]),
      )
    : translateValue(body, map);
};

/** The arguments the environment is called with: path values as matched, already in its terms, paging values as sent, a bulk body's ids by their collection's mapping, and every other value translated. */
export const environmentArguments = (
  call: ProbeToolCall,
  map: IdMap,
  bulk?: BulkIds,
): Record<string, JsonValue> =>
  Object.fromEntries(
    Object.entries(call.args).map(([name, value]) => [
      name,
      call.pathArguments.includes(name) || call.pagingArguments.includes(name)
        ? value
        : bulk !== undefined && name === bulk.body
          ? translateBulkBody(value, map, bulk)
          : translateValue(value, map),
    ]),
  );

/**
 * A request path with every segment that decodes to a mapped live identifier replaced by the environment's value,
 * encoded. `scopeAt` names the collection of the segment at a position after the leading slash, whose own mapping wins.
 * `literalAt` keeps a template's literal segments, so a mapped id cannot rename the route itself.
 */
export const translatePath = (
  path: string,
  map: IdMap,
  scopeAt: (index: number) => string | undefined = () => undefined,
  literalAt: (index: number) => boolean = () => false,
): string =>
  path
    .split("/")
    .map((segment, index) => {
      const position = index - 1;
      if (literalAt(position)) return segment;
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return segment;
      }
      const env =
        decoded === "" ? undefined : map.env(decoded, scopeAt(position));
      return env === undefined ? segment : encodeURIComponent(String(env));
    })
    .join("/");
