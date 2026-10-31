import {
  compareUnicodeCodePoints as compare,
  compositeKey,
} from "../unicodeCodePointOrder.js";

/** Fewest characters of a fixed-length identifier family whose members need not carry a digit. */
const FIXED_LENGTH_MINIMUM = 8;

/** Longest value, in UTF-16 units, compared by spelling; a longer one shares a position only as an observed value. */
const SPELLED_LENGTH_LIMIT = 128;

/** The distinct classes of a text's characters, digits, lower case, upper case and each other character, in one pass; undefined past the spelling limit. */
const characterClasses = (text: string): string | undefined => {
  if (text.length > SPELLED_LENGTH_LIMIT) return undefined;
  const classes = new Set<string>();
  for (const character of text)
    classes.add(
      character >= "0" && character <= "9"
        ? "0"
        : character >= "a" && character <= "z"
          ? "a"
          : character >= "A" && character <= "Z"
            ? "A"
            : character,
    );
  return [...classes].sort(compare).join("");
};

const shapeOf = (length: number, classes: string): string =>
  compositeKey([length, classes]);

/** How a set of observed identifiers is spelled, summarised once so each candidate is checked without rescanning them. */
export interface SpellingSummary {
  /** Each observed value's length and character classes. */
  readonly shapes: ReadonlySet<string>;
  /** The one length of eight or more every observed value has, with the classes they use together. */
  readonly family:
    | { readonly length: number; readonly classes: ReadonlySet<string> }
    | undefined;
}

export const spellingSummary = (
  observed: Iterable<string>,
): SpellingSummary => {
  const shapes = new Set<string>();
  const lengths = new Set<number>();
  const classes = new Set<string>();
  for (const value of observed) {
    lengths.add(value.length);
    const kinds = characterClasses(value);
    if (kinds === undefined) continue;
    shapes.add(shapeOf(value.length, kinds));
    for (const kind of kinds) classes.add(kind);
  }
  const [length] = lengths;
  return {
    shapes,
    family:
      lengths.size === 1 &&
      length! >= FIXED_LENGTH_MINIMUM &&
      length! <= SPELLED_LENGTH_LIMIT
        ? { length: length!, classes }
        : undefined,
  };
};

/** Spelled like an observed identifier: a digit-bearing value with the length and character classes of one, or a member of their fixed-length family. */
export const spelledLikeObserved = (
  value: string,
  observed: SpellingSummary,
): boolean => {
  const classes = characterClasses(value);
  if (classes === undefined) return false;
  const { family } = observed;
  if (
    family !== undefined &&
    value.length === family.length &&
    [...classes].every((kind) => family.classes.has(kind))
  )
    return true;
  return (
    /\d/u.test(value) && observed.shapes.has(shapeOf(value.length, classes))
  );
};
