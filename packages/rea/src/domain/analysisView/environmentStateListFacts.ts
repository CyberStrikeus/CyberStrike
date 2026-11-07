import { identifierWords } from "./environmentStateWords.js";
import type { JsonValue } from "../jsonValue.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import type { StateGateContext, StatePlan } from "./environmentStateGate.js";
import { startsAtBeginning } from "./environmentStatePaging.js";
import {
  envelopeMembers,
  mintedFor,
} from "./environmentStateResponseMembers.js";
import {
  ownMember,
  collectionPathOf,
  isObject,
  listItems,
  listsIds,
  pointerTo,
  pointerTokens,
  recordedItemCount,
  same,
  scalarText,
  type JsonObject,
  type ListedIds,
} from "./environmentStateRules.js";

/** The latest recordings that list their whole collection in state order, and the counters that equal the item count on each of them, or on every line when none does. */
export const listFacts = (
  context: StateGateContext,
  plan: StatePlan,
  union: { add(object: JsonObject): void },
): {
  readonly whole: ReadonlySet<number>;
  readonly counters: string[];
  readonly minted: string[];
  readonly listedIds: ListedIds[];
} => {
  const field = context.idField(plan.type);
  const whole = new Set<number>();
  const counting = new Map<number, string[]>();
  const listing = new Set<string>();
  const names = mintedFor(context.minted, plan.latest);
  const minted = new Set<string>();
  for (const record of plan.latest)
    context.withBody(record.ordinal, (body) => {
      const items =
        body === undefined ? undefined : listItems(body, plan.pointer);
      if (body === undefined || items === undefined) return;
      for (const name of envelopeMembers(body, names, plan.pointer))
        minted.add(name);
      items.forEach((item) => union.add(item));
      const parent = plan.pointer === "" || !isObject(body) ? {} : body;
      // A member listing the ids of two or more items does so by design, not by chance.
      if (items.length >= 2)
        for (const [name, value] of Object.entries(parent))
          if (
            name !== pointerTokens(plan.pointer)[0] &&
            listsIds(value, items, field)
          )
            listing.add(name);
      const counted = itemTotals(parent, plan.pointer).filter(
        ([, value]) => recordedItemCount(value) !== undefined,
      );
      counting.set(
        record.ordinal,
        counted
          .filter(([, value]) => recordedItemCount(value) === items.length)
          .map(([counter]) => counter),
      );
      // Only a line that pages at most can hold its whole collection; a total that differs from
      // the number listed, or a next page, shows it is partial.
      if (
        !startsAtBeginning(record.query) ||
        counted.some(
          ([, value]) => recordedItemCount(value) !== items.length,
        ) ||
        Object.keys(parent).some((name) => continues(name, parent[name]))
      )
        return;
      const ids = items.map((item) => scalarText(ownMember(item, field)) ?? "");
      const expected = context
        .inCollection(plan.type, collectionPathOf(record, false))
        .map((entity) => entity.id);
      if (same(ids, expected)) whole.add(record.ordinal);
    });
  // Counter presence is per envelope. Keep every observed page counter;
  // renderStateList updates only one the selected base actually counted.
  const counters = [...new Set([...counting.values()].flat())].sort(compare);
  return {
    whole,
    counters,
    minted: [...minted].sort(compare),
    listedIds: [...listing].sort(compare).map((member) => ({ member, field })),
  };
};

/**
 * A list envelope's item totals, each by its counter: a top-level member's name, or the pointer to one in a
 * top-level object beside the list, such as `/pageInfo/totalRows`; a top-level name starting with `/` is named by
 * its pointer, so a counter starting with `/` is always one.
 */
export const itemTotals = (
  parent: JsonObject,
  listPointer: string,
): [counter: string, value: JsonValue | undefined][] => {
  const root = pointerTokens(listPointer)[0];
  const totals: [string, JsonValue | undefined][] = [];
  for (const [name, value] of Object.entries(parent))
    if (isItemTotal(name))
      totals.push([name.startsWith("/") ? pointerTo(name) : name, value]);
    else if (isObject(value) && name !== root)
      for (const [inner, count] of Object.entries(value))
        if (isItemTotal(inner))
          totals.push([`${pointerTo(name)}${pointerTo(inner)}`, count]);
  return totals;
};

const LISTED_NOUNS = new Set(["elements", "entries", "items", "results"]);

/** Item totals, including compact `totalcount`/`itemcount` and `numberOfElements`; page counts and account IDs are excluded. */
export const isItemTotal = (name: string): boolean => {
  const tokens = identifierWords(name);
  return (
    (tokens.some(
      (token) =>
        token === "total" ||
        token === "count" ||
        token === "totalcount" ||
        token === "itemcount",
    ) ||
      (tokens.includes("number") &&
        tokens.some((token) => LISTED_NOUNS.has(token)))) &&
    !tokens.some(
      (token) => token === "page" || token === "pages" || token === "per",
    )
  );
};

const CONTINUATION_NAMES = new Set([
  "hasmore",
  "next",
  "nextcursor",
  "nextpage",
  "nextpagetoken",
  "nexttoken",
]);

/** A top-level `has_more`, `next` or next-page token member that says more items follow. */
const continues = (name: string, value: JsonValue | undefined): boolean =>
  CONTINUATION_NAMES.has(identifierWords(name).join("")) &&
  value !== undefined &&
  value !== null &&
  value !== false &&
  value !== "";
