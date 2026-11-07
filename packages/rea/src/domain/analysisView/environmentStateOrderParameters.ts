import { identifierWords } from "./environmentStateWords.js";
/** Parameter names a list query reads as the field it sorts by. */
export const SORT: ReadonlySet<string> = new Set([
  "order",
  "orderby",
  "order_by",
  "ordering",
  "sort",
  "sortby",
  "sort_by",
]);
/** Parameter names a list query reads as the direction it sorts in, given `asc` or `desc`. */
export const DIRECTION: ReadonlySet<string> = new Set([
  "dir",
  "direction",
  "order",
  "orderdirection",
  "order_direction",
  "sortdir",
  "sort_dir",
  "sortorder",
  "sort_order",
]);

/** Sort and direction names with their separators dropped, as `order_by` is spelled `orderBy` too. */
const ORDER_NAMES = new Set(
  [...SORT, ...DIRECTION].map((name) => name.replaceAll("_", "")),
);
/** Words that open a name asking for an order. */
const ORDER_STARTS = new Set([
  "order",
  "ordering",
  "sort",
  "sorter",
  "sorters",
  "sorts",
]);
/** Words that may follow them in such a name: `sort-column`, `sortKey`. */
const ORDER_WORDS = new Set([
  "asc",
  "by",
  "column",
  "desc",
  "dir",
  "direction",
  "field",
  "key",
  "mode",
  "order",
  "type",
]);

/** Direction names with their separators dropped, and those of them that name no sort field. */
const DIRECTION_NAMES = new Set(
  [...DIRECTION].map((name) => name.replaceAll("_", "")),
);
const DIRECTION_ONLY = new Set(
  [...DIRECTION]
    .filter((name) => !SORT.has(name))
    .map((name) => name.replaceAll("_", "")),
);

/** A parameter name's words, bracketed parts dropped: `sort[0][field]` is `sort`, `sortKey` is `sort`, `key`. */
const wordsOf = (name: string): string[] =>
  identifierWords(name.replace(/\[[^\]]*\]/gu, ""));

/** Whether a query parameter asks for an order, in any common spelling: `sort[0][field]`, `_sort`, `sort-direction`, `sortKey`, `orderBy`, `reverse`. */
export const appliesOrder = (name: string): boolean => {
  const words = wordsOf(name);
  if (words.length === 0) return false;
  return (
    (words.length === 1 && words[0] === "reverse") ||
    ORDER_NAMES.has(words.join("")) ||
    (ORDER_STARTS.has(words[0]!) &&
      words.slice(1).every((word) => ORDER_WORDS.has(word)))
  );
};

/** Whether a parameter names only the direction of an order, as `dir`, `sortDirection`, `reverse` or json-server's `_order` beside `_sort` do, not the field it sorts by. */
export const namesDirection = (name: string): boolean => {
  const words = wordsOf(name);
  const last = words.at(-1);
  return (
    name === "_order" ||
    DIRECTION_ONLY.has(words.join("")) ||
    last === "dir" ||
    last === "direction" ||
    (words.length === 1 && last === "reverse")
  );
};

/** The direction a value names, `asc` or `desc`, in short or long spelling. */
export const directionOf = (value: string): "asc" | "desc" | undefined => {
  const lower = value.toLowerCase();
  if (lower === "asc" || lower === "ascending") return "asc";
  if (lower === "desc" || lower === "descending") return "desc";
  return undefined;
};

/**
 * The role a parameter asking for an order plays given a value: the field to sort by, a direction given
 * one, or `none` for a reversal it cannot apply; undefined for any other parameter, and for a direction
 * name given no direction, which is an ordinary parameter. An order parameter is never without effect.
 */
export const orderRole = (
  name: string,
  value: string,
): "sort" | "direction" | "none" | undefined => {
  if (!appliesOrder(name)) return undefined;
  const directional =
    namesDirection(name) || DIRECTION_NAMES.has(wordsOf(name).join(""));
  if (directional && directionOf(value) !== undefined) return "direction";
  if (!namesDirection(name)) return "sort";
  return name.toLowerCase() === "reverse" &&
    !["", "0", "false"].includes(value.toLowerCase())
    ? "none"
    : undefined;
};
