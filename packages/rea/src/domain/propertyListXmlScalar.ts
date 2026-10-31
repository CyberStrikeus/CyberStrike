import { err, ok, type Result } from "./result.js";

// Integer parsing examines UTF-8 bytes; real scanning examines CFString
// characters. Native plutil controls distinguish their leading-whitespace sets;
// notably, this host rejects U+202F despite its inclusion in older CF source.
const INTEGER_WHITESPACE =
  "[\\u0000-\\u0020\\u007f\\u2000-\\u200b\\u205f\\u3000]*";
const REAL_WHITESPACE =
  "[\\u0000-\\u0020\\u007f-\\u00a0\\u2000-\\u200b\\u3000\\ufeff]*";
const INTEGER_LITERAL = new RegExp(
  `^${INTEGER_WHITESPACE}(?:([+-])${INTEGER_WHITESPACE})?(?:0[xX]([\\da-fA-F]+)|(\\d+))$`,
  "u",
);
const REAL_LEADING_WHITESPACE = new RegExp(`^${REAL_WHITESPACE}`, "u");

/** Parse CF-style decimal or hexadecimal integer text without losing precision. */
export const parseXmlPlistIntegerLiteral = (
  raw: string,
): bigint | undefined => {
  const match = INTEGER_LITERAL.exec(raw);
  if (match === null) return undefined;

  const magnitude = BigInt(
    match[2] === undefined ? match[3]! : `0x${match[2]}`,
  );
  return match[1] === "-" ? -magnitude : magnitude;
};

/**
 * Parse UTC fields without JavaScript string-date parsing or calendar rollover.
 * Syntax failures and unsupported date representations retain distinct reasons.
 */
export const decodeXmlPlistDateLiteral = (
  raw: string,
): Result<Date, "invalid-literal" | "unrepresentable"> => {
  const match = /^(-?)(\d+)-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/u.exec(
    raw,
  );
  if (match === null) return err("invalid-literal");

  const yearMagnitude = Number(match[2]);
  const year = match[1] === "-" ? -yearMagnitude : yearMagnitude;
  const month = Number(match[3]);
  const day = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);

  if (
    !Number.isSafeInteger(year) ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return err("unrepresentable");

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]!;
  if (day < 1 || day > daysInMonth) return err("unrepresentable");

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return Number.isNaN(date.getTime()) ? err("unrepresentable") : ok(date);
};

/** Parse a complete decimal or CF-spelled non-finite real literal. */
export const parseXmlPlistRealLiteral = (
  raw: string,
): Result<number, "invalid-literal" | "unrepresentable"> => {
  // This content has passed XML well-formedness and character-node checks.
  // Expand references only outside CDATA; retain original line endings, which
  // the DOM's compatibility normalization would otherwise erase.
  const text = raw.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>|&#(?:x([\da-fA-F]+)|(\d+));|&(amp|lt|gt|apos|quot);/gu,
    (
      _token,
      cdata: string | undefined,
      hex: string | undefined,
      decimal: string | undefined,
      name: string | undefined,
    ) => {
      if (cdata !== undefined) return cdata;
      if (hex !== undefined)
        return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal !== undefined)
        return String.fromCodePoint(Number.parseInt(decimal, 10));
      return name === "amp"
        ? "&"
        : name === "lt"
          ? "<"
          : name === "gt"
            ? ">"
            : name === "apos"
              ? "'"
              : '"';
    },
  );
  // CF compares complete non-finite spellings before scanning a decimal.
  if (text.length <= 9) {
    switch (text.toLowerCase()) {
      case "nan":
        return ok(Number.NaN);
      case "+infinity":
      case "infinity":
      case "+inf":
      case "inf":
        return ok(Number.POSITIVE_INFINITY);
      case "-infinity":
      case "-inf":
        return ok(Number.NEGATIVE_INFINITY);
    }
  }

  const numericText = text.replace(REAL_LEADING_WHITESPACE, "");
  if (
    !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u.test(
      numericText,
    )
  )
    return err("invalid-literal");
  const value = Number(numericText);
  return Number.isFinite(value) ? ok(value) : err("unrepresentable");
};
