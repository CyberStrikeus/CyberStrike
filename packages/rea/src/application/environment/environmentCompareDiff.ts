import type { JsonObject } from "../../domain/analysisView/environmentStateRules.js";
import type { FieldRule } from "../../domain/analysisView/environmentStateWriteRules.js";
import { matchesClockFormat } from "../../domain/analysisView/environmentStateWriteClockFormats.js";
import {
  composedPartText,
  composedValue,
} from "../../domain/analysisView/environmentStateWriteComposed.js";
import {
  likeGeneratedInteger,
  isUuid,
  readClock,
  type ClockFormat,
  type ClockReading,
} from "../../domain/analysisView/environmentStateWriteValues.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { ReplayedBody } from "./environmentSource.js";
import {
  ID_FIELD,
  IDENTITY_FIELD,
  keyedByLearnedIds,
  pairElements,
  translateValue,
  type IdMap,
} from "./environmentCompareIds.js";

export const DIFFERENCE_CATEGORIES = [
  "status",
  "missing-field",
  "extra-field",
  "value",
  "length",
  "order",
  "clock-format",
  "refused",
  "not-served",
  "no-tool",
  "unmapped-id",
] as const;
export type DifferenceCategory = (typeof DIFFERENCE_CATEGORIES)[number];

/** One way an environment answer differs from the live one: where, and both values cut short. */
export interface Difference {
  readonly category: DifferenceCategory;
  readonly pointer: string;
  readonly live?: string;
  readonly env?: string;
}

/** Values the comparison treated as equal although they differ: mapped ids, clocks of one format, generated values. */
export interface Normalised {
  ids: number;
  clocks: number;
  generated: number;
  /** Live bodies over the replay limit, compared by status only. */
  large_bodies: number;
  /** Live bodies the probe did not record, compared by status only. */
  unobserved_bodies: number;
}

/** At most this many differences are kept per step. */
export const STEP_DIFFERENCE_LIMIT = 20;
const VALUE_CHARS = 120;
const TIME_FIELD =
  /(?:^|[_-])(?:at|time|date|timestamp|created|updated|modified)$/iu;
const TIME_FIELD_CAMEL =
  /(?:At|Time|Date|Timestamp|Created|Updated|Modified)$/u;
const ID_LIST_FIELD = /^(ids|uuids|guids)$/u;

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shown = (value: JsonValue | undefined): string => {
  const text = value === undefined ? "<absent>" : JSON.stringify(value);
  return text.length > VALUE_CHARS ? `${text.slice(0, VALUE_CHARS)}…` : text;
};

const escapePointer = (key: string): string =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");

const formatKey = (format: ClockFormat): string =>
  format.kind === "epoch"
    ? `epoch-${format.unit}`
    : `iso${format.separator}${String(format.fraction)}${format.zone === "" ? "" : format.zone === "Z" ? "Z" : "offset"}`;

/** ISO text has its own clock syntax; numeric epochs require a time-named field. */
const clockReading = (
  value: JsonValue,
  key: string | undefined,
): ClockReading | undefined => {
  if (
    typeof value === "number" &&
    (key === undefined ||
      (!TIME_FIELD.test(key) && !TIME_FIELD_CAMEL.test(key)))
  )
    return undefined;
  return readClock(value);
};

const characterClasses = (text: string): string =>
  [
    ...new Set(
      text
        .replaceAll(/\d/gu, "0")
        .replaceAll(/[a-z]/gu, "a")
        .replaceAll(/[A-Z]/gu, "A"),
    ),
  ]
    .sort()
    .join("");

/** A confirmed response field's rule, and the pointer within that field (`*` marks actual array traversal). */
interface Generation {
  readonly rule: FieldRule;
  readonly pointer: string;
}

/** Whether a confirmed generation rule applies here and both values retain its generated format. */
const generatedPair = (
  live: string | number,
  env: string | number,
  generation: Generation | undefined,
): boolean => {
  if (generation === undefined) return false;
  const { rule, pointer } = generation;
  if (
    rule.rule === "unique" &&
    pointer === "" &&
    likeGeneratedInteger(live, env)
  )
    return true;
  if (typeof live !== "string" || typeof env !== "string") return false;
  if (rule.rule === "renewed")
    return rule.pointers.includes(pointer) && isUuid(live) && isUuid(env);
  if (pointer !== "") return false;
  if (
    rule.rule === "unique" ||
    (rule.rule === "identity" && rule.generator === "uuid")
  )
    return isUuid(live) && isUuid(env);
  if (rule.rule !== "sequence" && rule.rule !== "identity") return false;
  return (
    live.length === env.length &&
    live.length >= 8 &&
    /\d/u.test(live) &&
    /\d/u.test(env) &&
    characterClasses(live) === characterClasses(env)
  );
};

class Differ {
  readonly #rules: ReadonlyMap<string, FieldRule>;
  readonly #composedRules: readonly Extract<FieldRule, { rule: "composed" }>[];
  readonly #generatedToEnv = new Map<string, string>();
  readonly #generatedToLive = new Map<string, string>();
  readonly differences: Difference[] = [];
  readonly normalised: Normalised = {
    ids: 0,
    clocks: 0,
    generated: 0,
    large_bodies: 0,
    unobserved_bodies: 0,
  };

  /** The answer's own entities: where they sit (the object, or the array of them, at `at`) and the collection the call names, whose own mapping their identities compare by. `identity` marks a write that answers with only the new id, at `at`. */
  constructor(
    readonly map: IdMap,
    readonly entity: {
      readonly scope: string | undefined;
      readonly at: string;
      readonly identity: boolean;
      /** Parsed rules of the confirmed write whose entity response is being compared. */
      readonly rules: readonly FieldRule[];
    },
  ) {
    this.#rules = new Map(entity.rules.map((rule) => [rule.field, rule]));
    this.#composedRules = entity.rules.filter(
      (rule) => rule.rule === "composed",
    );
  }

  add(difference: Difference): void {
    this.differences.push(difference);
  }

  /** One answer's generated identities must rename consistently in both directions. */
  #pairGenerated(
    live: string | number,
    env: string | number,
    rule: FieldRule,
  ): boolean {
    const uuid =
      rule.rule === "unique" ||
      rule.rule === "renewed" ||
      (rule.rule === "identity" && rule.generator === "uuid");
    const identity = (value: string | number) =>
      typeof value === "number"
        ? `number:${String(value)}`
        : uuid
          ? `uuid:${value.toLowerCase()}`
          : `string:${value}`;
    const liveKey = identity(live);
    const envKey = identity(env);
    const knownEnv = this.#generatedToEnv.get(liveKey);
    const knownLive = this.#generatedToLive.get(envKey);
    if (
      (knownEnv !== undefined && knownEnv !== envKey) ||
      (knownLive !== undefined && knownLive !== liveKey)
    )
      return false;
    this.#generatedToEnv.set(liveKey, envKey);
    this.#generatedToLive.set(envKey, liveKey);
    return true;
  }

  /** Whether a value compares within the call's collection, as an entity's own identity or a create's bare id does; other ids compare by the probe's mapping. */
  #inCollection(
    pointer: string,
    at: { readonly key?: string; readonly own?: boolean },
  ): boolean {
    return (
      (this.entity.identity && pointer === this.entity.at) ||
      (at.own === true && at.key !== undefined && IDENTITY_FIELD.test(at.key))
    );
  }

  /** Whether an identity both sides hold verbatim is one its collection's mapping gives to another environment entity; a reference's collection is unknown, so it is not judged. */
  #reassigned(
    value: JsonValue,
    pointer: string,
    at: { readonly key?: string; readonly own?: boolean },
  ): boolean {
    if (typeof value !== "string" && typeof value !== "number") return false;
    if (!this.#inCollection(pointer, at)) return false;
    const mapped = this.map.env(value, this.entity.scope);
    return mapped !== undefined && String(mapped) !== String(value);
  }

  scalar(
    live: JsonValue,
    env: JsonValue,
    pointer: string,
    at: {
      readonly key?: string;
      readonly own?: boolean;
      readonly clockKey?: string | undefined;
    } = {},
    generation?: Generation,
  ): void {
    const key = at.clockKey ?? at.key;
    const liveClock = clockReading(live, key);
    const envClock = clockReading(env, key);
    const generatedMatch =
      generation !== undefined &&
      (typeof live === "string" || typeof live === "number") &&
      (typeof env === "string" || typeof env === "number") &&
      liveClock === undefined &&
      envClock === undefined &&
      !this.map.hasLive(live) &&
      !this.map.hasEnv(env) &&
      generatedPair(live, env, generation)
        ? this.#pairGenerated(live, env, generation.rule)
        : undefined;
    if (live === env) {
      if (generatedMatch === false || this.#reassigned(live, pointer, at))
        this.add({
          category: "value",
          pointer,
          live: shown(live),
          env: shown(env),
        });
      return;
    }
    const field = at.key;
    if (
      (typeof live === "string" || typeof live === "number") &&
      (typeof env === "string" || typeof env === "number")
    ) {
      const mapsAsId =
        (field !== undefined && ID_FIELD.test(field)) ||
        this.#inCollection(pointer, at) ||
        (typeof live === "string" &&
          field !== undefined &&
          this.map.isStateReference(live, field));
      const mapped = mapsAsId
        ? this.map.env(
            live,
            this.#inCollection(pointer, at) ? this.entity.scope : undefined,
          )
        : undefined;
      if (mapped !== undefined && String(mapped) === String(env)) {
        this.normalised.ids += 1;
        return;
      }
      if (liveClock !== undefined && envClock !== undefined) {
        const rule = generation?.pointer === "" ? generation.rule : undefined;
        const format =
          rule?.rule === "clock" || rule?.rule === "held-clock"
            ? rule.format
            : undefined;
        const matches =
          format?.kind === "iso" && format.trimmed === true
            ? matchesClockFormat(format, liveClock) &&
              matchesClockFormat(format, envClock)
            : formatKey(liveClock.format) === formatKey(envClock.format);
        if (matches) this.normalised.clocks += 1;
        else
          this.add({
            category: "clock-format",
            pointer,
            live: shown(live),
            env: shown(env),
          });
        return;
      }
      if (generatedMatch === true) {
        this.normalised.generated += 1;
        return;
      }
    }
    this.add({
      category: "value",
      pointer,
      live: shown(live),
      env: shown(env),
    });
  }

  array(
    live: JsonValue[],
    env: JsonValue[],
    pointer: string,
    clockKey: string | undefined,
    generation: Generation | undefined,
  ): void {
    const own = pointer === this.entity.at;
    if (this.sameItems(live, env, pointer)) {
      // Equal/reordered scalar sets still establish unchanged generated pairs;
      // otherwise another field could split an alias hidden by this fast path.
      if (generation !== undefined)
        for (const [index, item] of live.entries())
          this.scalar(
            item,
            item,
            `${pointer}/${String(index)}`,
            { own, clockKey },
            { ...generation, pointer: `${generation.pointer}/*` },
          );
      return;
    }
    const pairs = pairElements(live, env);
    if (live.length !== env.length || pairs.length !== live.length)
      this.add({
        category: "length",
        pointer,
        live: `${String(live.length)} items`,
        env: `${String(env.length)} items (${String(pairs.length)} paired)`,
      });
    const envOrder = pairs.map(([, right]) => right);
    if (
      envOrder.some((right, index) => index > 0 && right < envOrder[index - 1]!)
    )
      this.add({ category: "order", pointer });
    for (const [left, right] of pairs)
      this.value(
        live[left]!,
        env[right]!,
        `${pointer}/${String(left)}`,
        {
          own,
          clockKey,
        },
        generation === undefined
          ? undefined
          : { ...generation, pointer: `${generation.pointer}/*` },
      );
  }

  /** Arrays of scalars holding the same items in another order differ only in order, as sets an application returns unordered do. */
  sameItems(live: JsonValue[], env: JsonValue[], pointer: string): boolean {
    const scalar = (item: JsonValue): boolean =>
      item === null || typeof item !== "object";
    if (live.length !== env.length || !live.every(scalar) || !env.every(scalar))
      return false;
    // Only identifier lists or known string identifiers are translated; numeric measurements stay literal.
    const field = pointer.slice(pointer.lastIndexOf("/") + 1);
    const mapped = live.map((item) => {
      if (
        (typeof item === "string" && this.map.isStateReference(item, field)) ||
        ((typeof item === "number" || typeof item === "string") &&
          ID_LIST_FIELD.test(field))
      )
        return translateValue(item, this.map);
      return item;
    });
    const key = (items: JsonValue[]): string =>
      JSON.stringify(items.map((item) => JSON.stringify(item)).sort());
    if (key(mapped) !== key(env)) return false;
    this.normalised.ids += mapped.filter(
      (item, index) => item !== live[index],
    ).length;
    if (JSON.stringify(mapped) !== JSON.stringify(env))
      this.add({ category: "order", pointer });
    return true;
  }

  object(
    live: JsonObject,
    env: JsonObject,
    pointer: string,
    own = false,
    generation?: Generation,
  ): void {
    const self = own || pointer === this.entity.at;
    // An object keyed by ids compares each member under the environment's key; any other compares field by field.
    const keyed = keyedByLearnedIds(live, env, this.map);
    const envKey = (key: string): string => {
      const mapped = keyed
        ? this.map.env(key, self ? this.entity.scope : undefined)
        : undefined;
      return mapped !== undefined && Object.hasOwn(env, String(mapped))
        ? String(mapped)
        : key;
    };
    const matched = new Set<string>();
    const composed =
      self && this.#composedRules.length > 0
        ? { agreed: new Set<string>(), fields: new Map<string, string>() }
        : undefined;
    for (const [key, value] of Object.entries(live)) {
      const child = `${pointer}/${escapePointer(key)}`;
      const other = envKey(key);
      if (!Object.hasOwn(env, other))
        this.add({
          category: "missing-field",
          pointer: child,
          live: shown(value),
        });
      else {
        matched.add(other);
        const rule = self ? this.#rules.get(key) : undefined;
        if (rule?.rule === "composed" && composed !== undefined) {
          composed.fields.set(key, other);
          continue;
        }
        const before = this.differences.length;
        this.value(
          value,
          env[other]!,
          child,
          {
            key,
            own: self,
            keyed: self && keyed,
          },
          rule !== undefined
            ? { rule, pointer: "" }
            : generation === undefined
              ? undefined
              : {
                  ...generation,
                  pointer: `${generation.pointer}/${escapePointer(key)}`,
                },
        );
        if (this.differences.length === before) composed?.agreed.add(key);
      }
    }
    // Compare source fields once, then reuse their clock/identity decisions.
    // Validate each response's spelling before normalizing its composition.
    if (composed !== undefined) {
      for (const rule of this.#composedRules) {
        const other = composed.fields.get(rule.field);
        if (other === undefined) continue;
        const coherent =
          composedValue(rule.parts, live) === live[rule.field] &&
          composedValue(rule.parts, env) === env[other];
        if (
          coherent &&
          rule.parts.every(
            (part) =>
              !("from" in part) ||
              composed.agreed.has(part.from) ||
              composedPartText(part, live) === composedPartText(part, env),
          )
        ) {
          composed.agreed.add(rule.field);
          if (live[rule.field] !== env[other]) this.normalised.generated += 1;
        } else
          this.add({
            category: "value",
            pointer: `${pointer}/${escapePointer(rule.field)}`,
            live: shown(live[rule.field]),
            env: shown(env[other]),
          });
      }
    }
    for (const [key, value] of Object.entries(env))
      if (!matched.has(key))
        this.add({
          category: "extra-field",
          pointer: `${pointer}/${escapePointer(key)}`,
          env: shown(value),
        });
  }

  /** `own` marks an item of the entity array, or with `key` a field of an own entity; a field's own children are not. */
  value(
    live: JsonValue,
    env: JsonValue,
    pointer: string,
    at: {
      readonly key?: string;
      readonly own?: boolean;
      readonly keyed?: boolean;
      readonly clockKey?: string | undefined;
    } = {},
    generation?: Generation,
  ): void {
    if (Array.isArray(live) && Array.isArray(env))
      this.array(live, env, pointer, at.clockKey ?? at.key, generation);
    else if (isObject(live) && isObject(env))
      this.object(
        live,
        env,
        pointer,
        at.own === true && (at.key === undefined || at.keyed === true),
        generation,
      );
    else if (
      Array.isArray(live) ||
      Array.isArray(env) ||
      isObject(live) ||
      isObject(env)
    )
      this.add({
        category: "value",
        pointer,
        live: shown(live),
        env: shown(env),
      });
    else this.scalar(live, env, pointer, at, generation);
  }
}

/** One answer: its status, and its JSON body, its text, or null without one. */
export interface Answer {
  readonly status: number | null;
  readonly body: ReplayedBody;
  /** Set when the probe did not record the body, so only the status is known. */
  readonly unobserved?: boolean;
}

/** Compare a live answer with the environment's after normalisation. */
export const compareAnswers = (
  live: Answer,
  env: Answer,
  map: IdMap,
  entity: {
    readonly scope?: string;
    readonly at?: string;
    readonly identity?: boolean;
    readonly rules?: readonly FieldRule[];
  } = {},
): { readonly differences: Difference[]; readonly normalised: Normalised } => {
  const differ = new Differ(map, {
    scope: entity.scope,
    at: entity.at ?? "",
    identity: entity.identity === true,
    rules: entity.rules ?? [],
  });
  if (live.status !== env.status)
    differ.add({
      category: "status",
      pointer: "",
      live: String(live.status),
      env: String(env.status),
    });
  if (
    live.body.kind === "cut" ||
    (live.body.kind === "base64" && !live.body.whole)
  )
    differ.normalised.large_bodies += 1;
  else if (live.unobserved === true) differ.normalised.unobserved_bodies += 1;
  else if (
    (live.body.kind === "none" &&
      env.body.kind === "json" &&
      env.body.value === null) ||
    (env.body.kind === "none" &&
      live.body.kind === "json" &&
      live.body.value === null)
  ) {
    // The existing answer contract treats an absent body and JSON null alike.
  } else if (live.body.kind === "base64" || env.body.kind === "base64") {
    const bytes = (body: ReplayedBody): Buffer | undefined => {
      if (body.kind === "base64") return Buffer.from(body.encoded, "base64");
      if (body.kind === "text") return Buffer.from(body.text, "utf8");
      return undefined;
    };
    const liveBytes = bytes(live.body);
    const envBytes = bytes(env.body);
    if (
      liveBytes === undefined ||
      envBytes === undefined ||
      !liveBytes.equals(envBytes)
    )
      differ.add({
        category: "value",
        pointer: "",
        live: shown(live.body),
        env: shown(env.body),
      });
  } else if (live.body.kind !== env.body.kind)
    differ.add({
      category: "value",
      pointer: "",
      live: shown(live.body),
      env: shown(env.body),
    });
  else if (live.body.kind === "json" && env.body.kind === "json")
    differ.value(live.body.value, env.body.value, "");
  else if (live.body.kind === "text" && env.body.kind === "text")
    differ.value(live.body.text, env.body.text, "");
  return { differences: differ.differences, normalised: differ.normalised };
};
