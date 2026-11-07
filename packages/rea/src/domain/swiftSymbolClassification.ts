const LEGACY_CATEGORIES = [
  ["_TtC", "classes"],
  ["_TtV", "structs"],
  ["_TtO", "enums"],
  ["_TtP", "protocols"],
  ["_TtE", "extensions"],
] as const;

/** Supported procedure categories derived from Swift symbol encodings. */
export type SwiftTypeCategory = (typeof LEGACY_CATEGORIES)[number][1] | "other";

const NOMINAL_CATEGORIES: ReadonlyMap<string, SwiftTypeCategory> = new Map([
  ["C", "classes"],
  ["V", "structs"],
  ["O", "enums"],
  ["P", "protocols"],
]);

/**
 * Recognize Swift manglings and decode literal module/nominal contexts.
 * Substitutions, generic contexts, and other encodings remain unknown.
 */
export const classifySwiftSymbol = (
  name: string,
):
  | {
      readonly category: SwiftTypeCategory | null;
      readonly protocolIdentity: boolean;
    }
  | undefined => {
  const prefix = /^_?(?:\$[sS]|_T0)/u.exec(name);
  if (prefix === null) {
    if (!name.startsWith("_Tt")) return undefined;
    return {
      category:
        LEGACY_CATEGORIES.find(([prefix]) => name.startsWith(prefix))?.[1] ??
        null,
      protocolIdentity: name.startsWith("_TtP"),
    };
  }
  const mangling = name.slice(prefix[0].length);
  let offset = identifierEnd(mangling, 0);
  if (offset === undefined) return { category: null, protocolIdentity: false };
  let category: SwiftTypeCategory | null = null;
  let protocolIdentity = false;
  for (;;) {
    const end = identifierEnd(mangling, offset);
    if (end === undefined) {
      // A protocol member retains its enclosing category, but only the exact
      // descriptor terminal identifies the protocol itself.
      protocolIdentity =
        category === "protocols" && mangling.slice(offset) === "Mp";
      // A zero-prefixed identifier uses word substitutions or Punycode. We
      // cannot tell whether it continues a nested type or names a member, so
      // retaining the outer category would be a guess.
      if (
        mangling.charAt(offset) === "0" ||
        // A substituted module can introduce a constrained extension after
        // the nominal type. This parser does not decode that context, so it
        // cannot retain the preceding nominal category as the member's owner.
        mangling.startsWith("AA", offset)
      )
        category = null;
      break;
    }
    const kind = mangling.charAt(end);
    const nominal = NOMINAL_CATEGORIES.get(kind);
    if (nominal === undefined) {
      // Current swiftc emits protocol descriptors as `…<Nominal>Mp` without
      // the nominal `P` marker (e.g. `_$s4main7ScoringMp`). Decode that exact
      // suffix; unknown substitution encodings stay unclassified, never guessed.
      if (mangling.slice(end) === "Mp") {
        category = "protocols";
        protocolIdentity = true;
      } else if (kind === "E" && category !== null) category = "extensions";
      break;
    }
    category = nominal;
    offset = end + 1;
  }
  return { category, protocolIdentity };
};

/**
 * Prefixes accepted by Swift's demangler as manglings. This is deliberately
 * narrower than visible Swift runtime class names (`_Tt…`): those names are
 * useful metadata symbols but are not themselves demangler manglings.
 */
const SWIFT_MANGLING_PREFIXES = [
  "_T0",
  "$S",
  "_$S",
  "$s",
  "_$s",
  "@__swiftmacro_",
  "$e",
  "_$e",
] as const;

/** Recognize names the Swift demangler accepts as mangled symbols. */
export const isSwiftMangledSymbolName = (name: string): boolean =>
  SWIFT_MANGLING_PREFIXES.some((prefix) => name.startsWith(prefix));

/**
 * A Swift symbol carries either a demangler mangling or a name the category
 * decoder already accepts, including visible runtime class names (`_Tt…`) and
 * the optional leading underscore of legacy encodings (`__T0…`). Whether the
 * nominal category can be decoded is a separate question, so it must not decide
 * whether the symbol is Swift at all.
 */
export const isSwiftSymbolName = (name: string): boolean =>
  isSwiftMangledSymbolName(name) || classifySwiftSymbol(name) !== undefined;

const identifierEnd = (
  mangling: string,
  offset: number,
): number | undefined => {
  const lengthToken = /^[1-9][0-9]*/u.exec(mangling.slice(offset))?.[0];
  if (lengthToken === undefined) return undefined;
  const start = offset + lengthToken.length;
  const end = start + Number(lengthToken);
  // Swift identifiers with substitutions/punycode need a fuller decoder.
  if (
    !Number.isSafeInteger(end) ||
    end > mangling.length ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(mangling.slice(start, end))
  )
    return undefined;
  return end;
};
