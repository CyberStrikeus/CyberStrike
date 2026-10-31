import { err, ok, type Result } from "./result.js";

export class XmlPlistDataError extends TypeError {
  readonly _tag = "XmlPlistDataError";
  constructor(
    readonly reason:
      | "non-ascii"
      | "markup"
      | "empty-element"
      | "source-location",
    /** UTF-16 offset within the raw data literal, when known. */
    readonly characterOffset: number | null = null,
  ) {
    super(`Cannot decode XML plist <data>: ${reason}`);
    this.name = "XmlPlistDataError";
  }
}

const BASE64_DIGITS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const C_WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\r"]);

/** Interpret each completed quartet once per pass, including CF's padding resets. */
const visitDataQuartets = (
  text: string,
  visit: (value: number, byteCount: 1 | 2 | 3) => void,
): Result<void, XmlPlistDataError> => {
  let quartet = 0;
  let digits = 0;
  let padding = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 128)
      return err(new XmlPlistDataError("non-ascii", index));
    const character = text[index]!;
    if (character === "=") padding += 1;
    else if (!C_WHITESPACE.has(character)) padding = 0;
    const digit = character === "=" ? 0 : BASE64_DIGITS.indexOf(character);
    if (digit < 0) continue;
    quartet = ((quartet << 6) | digit) & 0xffffff;
    digits += 1;
    if (digits % 4 === 0)
      visit(quartet, padding >= 2 ? 1 : padding === 1 ? 2 : 3);
  }
  return ok(undefined);
};

/** CFPropertyList reads raw ASCII, skips nonalphabet bytes and emits complete quartets. */
export const decodeXmlPlistData = (
  text: string,
): Result<Uint8Array, XmlPlistDataError> => {
  let length = 0;
  const counted = visitDataQuartets(text, (_value, byteCount) => {
    length += byteCount;
  });
  if (!counted.ok) return counted;
  // Count actual output before allocation, including padding in every quartet.
  const bytes = new Uint8Array(length);
  let offset = 0;
  const decoded = visitDataQuartets(text, (value, byteCount) => {
    bytes[offset++] = value >> 16;
    if (byteCount >= 2) bytes[offset++] = value >> 8;
    if (byteCount === 3) bytes[offset++] = value;
  });
  return decoded.ok ? ok(bytes) : decoded;
};
