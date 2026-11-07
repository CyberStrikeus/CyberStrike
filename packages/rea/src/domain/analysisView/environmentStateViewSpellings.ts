import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  isObject,
  same,
  type JsonObject,
} from "./environmentStateRules.js";
import { readClock, type ClockFormat } from "./environmentStateWriteValues.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";

/** Retain the bytes a view's learned members keep, as the gate's budget counts them. */
type Retain = (bytes: number) => void;

/** Whether two objects show the same keys, in any order. */
const sameKeys = (left: readonly string[], shown: JsonObject): boolean =>
  left.length === Object.keys(shown).length &&
  left.every((key) => Object.hasOwn(shown, key));

/** The spellings a view always gives clock fields where its recordings spell the stored instant otherwise. */
export class ClockSpellings {
  /** Each category retains one spelling or a permanent mixed marker, never an expanding format history. */
  readonly #fields = new Map<
    string,
    {
      matched: ClockFormat | null | undefined;
      other: ClockFormat | null | undefined;
    }
  >();

  /** Per object field, the keys every recording showed in the first one's order, or null once two differ, and whether one showed fewer than stored. */
  readonly #shapes = new Map<
    string,
    { keys: string[] | null; projects: boolean }
  >();

  constructor(private readonly retain: Retain) {
    retain(ENTRY_BYTES);
  }

  #shape(
    field: string,
    shown: JsonObject,
    stored: JsonValue | undefined,
  ): void {
    const keys = Object.keys(shown);
    const projects =
      isObject(stored) &&
      Object.keys(stored).some((key) => !Object.hasOwn(shown, key));
    const facts = this.#shapes.get(field);
    if (facts === undefined) {
      this.retain(
        ENTRY_BYTES * 2 +
          textBytes(field.length) +
          keys.reduce(
            (sum, key) => sum + ENTRY_BYTES + textBytes(key.length),
            0,
          ),
      );
      this.#shapes.set(field, { keys, projects });
      return;
    }
    if (facts.keys !== null && !sameKeys(facts.keys, shown)) facts.keys = null;
    facts.projects ||= projects;
  }

  #note(
    field: string,
    category: "matched" | "other",
    format: ClockFormat | null,
  ): void {
    let facts = this.#fields.get(field);
    if (facts === undefined) {
      this.retain(ENTRY_BYTES + textBytes(field.length));
      facts = { matched: undefined, other: undefined };
      this.#fields.set(field, facts);
    }
    const held = facts[category];
    if (held === undefined) {
      if (format !== null)
        this.retain(
          ENTRY_BYTES +
            (format.kind === "iso" ? textBytes(format.zone.length) : 0),
        );
      facts[category] = format;
    } else if (held !== null && !same(held, format)) facts[category] = null;
  }

  note(stored: JsonObject, shown: JsonObject): void {
    for (const [field, value] of Object.entries(shown)) {
      if (isObject(value)) this.#shape(field, value, ownMember(stored, field));
      const now = readClock(value);
      if (now === undefined) continue;
      const was = Object.hasOwn(stored, field)
        ? readClock(stored[field])
        : undefined;
      if (
        was === undefined ||
        was.ms !== now.ms ||
        was.subMillisecond !== now.subMillisecond
      ) {
        this.#note(field, "other", now.format);
        continue;
      }
      const spelled = same(stored[field], value) ? null : now.format;
      this.#note(field, "matched", spelled);
    }
  }

  /** The fields whose objects every recording showed with the same keys, fewer than one stored. */
  get #nested(): { readonly nested_fields?: Record<string, string[]> } {
    const nested = [...this.#shapes].flatMap(([field, { keys, projects }]) =>
      keys !== null && projects ? [[field, keys] as const] : [],
    );
    return nested.length === 0
      ? {}
      : { nested_fields: Object.fromEntries(nested) };
  }

  /** The view members: the spelling of fields it always spells otherwise, and the keys of objects it shows fewer of. */
  get view(): {
    readonly clock_formats?: Record<string, ClockFormat>;
    readonly nested_fields?: Record<string, string[]>;
  } {
    const formats: [string, ClockFormat][] = [];
    for (const [field, { matched, other }] of this.#fields) {
      if (
        matched === undefined ||
        matched === null ||
        other === null ||
        (other !== undefined && !same(other, matched))
      )
        continue;
      if (formats.length === 0) this.retain(ENTRY_BYTES * 2);
      // Both the temporary entry and its returned object member remain covered.
      this.retain(ENTRY_BYTES * 2 + textBytes(field.length));
      formats.push([field, matched]);
    }
    return {
      ...(formats.length === 0
        ? {}
        : { clock_formats: Object.fromEntries(formats) }),
      ...this.#nested,
    };
  }
}
