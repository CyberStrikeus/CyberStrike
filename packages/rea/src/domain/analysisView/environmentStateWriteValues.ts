import { createHash } from "node:crypto";
import type { JsonValue } from "../jsonValue.js";
import { readRecordedDateTime } from "../offsetDateTime.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";

/** How a recorded clock value is spelled: ISO-8601 with its separator, fraction digits and zone, or an epoch number. */
export type ClockFormat =
  | {
      readonly kind: "iso";
      readonly separator: "T" | " ";
      readonly fraction: number;
      readonly zone: string;
      /** Fraction digits end at the last non-zero one, and the point goes with them, as Go spells nanoseconds; `fraction` is the most shown. */
      readonly trimmed?: true;
    }
  | { readonly kind: "epoch"; readonly unit: "s" | "ms" };

export interface ClockReading {
  readonly ms: number;
  /** Nanoseconds after the floored millisecond, so distinct recorded instants stay distinct. */
  readonly subMillisecond: number;
  readonly format: ClockFormat;
  /** The fraction ends in a zero, which a trimmed spelling never shows, so its width is fixed. */
  readonly fixedWidth: boolean;
}

const MINUTE_MS = 60_000;

/** Minutes east of UTC that a zone suffix names; none and `Z` are UTC. */
const zoneMinutes = (zone: string): number | undefined => {
  if (zone === "" || zone === "Z") return 0;
  if (!/^[+-]\d{2}:?\d{2}$/u.test(zone)) return undefined;
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const remainder = Number(digits.slice(2, 4));
  if (hours > 23 || remainder > 59) return undefined;
  const minutes = hours * 60 + remainder;
  return zone.startsWith("-") ? -minutes : minutes;
};

/** Whether a stored ISO clock format has a supported RFC 3339 offset suffix. */
export const isClockZone = (zone: string): boolean =>
  zoneMinutes(zone) !== undefined;

/** Minutes east of UTC a stored format's zone names. */
export const zoneMinutesForFormat = (zone: string): number => {
  const minutes = zoneMinutes(zone);
  if (minutes === undefined)
    throw new TypeError(`Invalid clock zone in a derived format: ${zone}`);
  return minutes;
};

/** The instant of an ISO-8601 date-time and how it is spelled, or undefined when it is not one. */
const readIsoClock = (value: string): ClockReading | undefined => {
  const reading = readRecordedDateTime(value);
  if (
    reading === undefined ||
    !reading.spelling.secondsPresent ||
    reading.spelling.fractionDigits > 9
  )
    return undefined;
  const { instant, spelling } = reading;
  return {
    ms:
      instant.epochSecond * 1000 + Number(`${instant.fraction}000`.slice(0, 3)),
    subMillisecond: Number(instant.fraction.padEnd(9, "0").slice(3)),
    format: {
      kind: "iso",
      separator: spelling.separator,
      fraction: spelling.fractionDigits,
      zone: spelling.zone,
    },
    // The instant's fraction drops trailing zeros, so a longer spelling ended in one.
    fixedWidth: spelling.fractionDigits > instant.fraction.length,
  };
};

/** The instant a clock value names and its format: an ISO-8601 date-time, or epoch seconds or milliseconds. */
export const readClock = (
  value: JsonValue | undefined,
): ClockReading | undefined => {
  if (typeof value === "string") return readIsoClock(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return undefined;
  if (value >= 1e9 && value < 1e10)
    return {
      ms: value * 1000,
      subMillisecond: 0,
      format: { kind: "epoch", unit: "s" },
      fixedWidth: true,
    };
  if (value >= 1e12 && value < 1e13)
    return {
      ms: value,
      subMillisecond: 0,
      format: { kind: "epoch", unit: "ms" },
      fixedWidth: true,
    };
  return undefined;
};

const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0");

/** An ISO-8601 date-time from the UTC fields of `at`, with fraction digits and a zone suffix. */
const isoText = (
  at: Date,
  separator: string,
  digits: string,
  zone: string,
): string | undefined => {
  const year = at.getUTCFullYear();
  if (!Number.isInteger(year) || year < 0 || year > 9999) return undefined;
  return `${pad(year, 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}${separator}${pad(at.getUTCHours(), 2)}:${pad(at.getUTCMinutes(), 2)}:${pad(at.getUTCSeconds(), 2)}${digits === "" ? "" : `.${digits}`}${zone}`;
};

/** An instant in a recorded format; undefined outside its four-digit ISO year range. Fraction digits past milliseconds are `subMillisecond`'s, else zeros. */
export const formatClock = (
  ms: number,
  format: ClockFormat,
  subMillisecond = 0,
): JsonValue | undefined => {
  if (format.kind === "epoch")
    return format.unit === "s" ? Math.floor(ms / 1000) : ms;
  const at = new Date(ms + zoneMinutesForFormat(format.zone) * MINUTE_MS);
  const digits =
    `${pad(at.getUTCMilliseconds(), 3)}${pad(subMillisecond, 6)}`.slice(
      0,
      format.fraction,
    );
  return isoText(
    at,
    format.separator,
    format.trimmed === true ? digits.replace(/0+$/u, "") : digits,
    format.zone,
  );
};

/**
 * A clock value spelled in another ISO format: its wall clock in the format's zone, under the format's separator, with
 * the value's own fraction digits padded to the format's width, so no digit is lost; an epoch format is computed from
 * the instant.
 */
export const respellClock = (
  value: JsonValue,
  format: ClockFormat,
): JsonValue => {
  const clock = readClock(value);
  if (clock === undefined) return value;
  if (format.kind === "epoch") return formatClock(clock.ms, format) ?? value;
  const millis = ((clock.ms % 1000) + 1000) % 1000;
  // An epoch value's fraction is its milliseconds, without trailing zeros.
  const digits =
    clock.format.kind === "epoch"
      ? pad(millis, 3).replace(/0+$/u, "")
      : `${pad(millis, 3)}${pad(clock.subMillisecond, 6)}`.slice(
          0,
          clock.format.fraction,
        );
  const at = new Date(
    clock.ms - millis + zoneMinutesForFormat(format.zone) * MINUTE_MS,
  );
  return (
    isoText(
      at,
      format.separator,
      format.trimmed === true
        ? digits.replace(/0+$/u, "")
        : digits.padEnd(format.fraction, "0"),
      format.zone,
    ) ?? value
  );
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isUuid = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && UUID.test(value);

/** Digits a generated integer shows at least, as a time-based id does; counts and codes are shorter. */
const GENERATED_INTEGER_DIGITS = 10;

/** A large integer's digits, from a safe JSON number or a string of digits without a leading zero. */
export const generatedIntegerDigits = (
  value: JsonValue | undefined,
): string | undefined => {
  const digits =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string" && /^[1-9]\d*$/u.test(value)
        ? value
        : undefined;
  return digits !== undefined &&
    digits.length >= GENERATED_INTEGER_DIGITS &&
    digits.length <= 20
    ? digits
    : undefined;
};

/** A sent array of strings as an application stores it sorted: in code-point order, when that differs from the sent order and shows two distinct strings. */
export const sortedStrings = (
  sent: JsonValue | undefined,
): string[] | undefined => {
  if (
    !Array.isArray(sent) ||
    !sent.every((item) => typeof item === "string") ||
    new Set(sent).size < 2
  )
    return undefined;
  const sorted = (sent as string[]).toSorted(compareUnicodeCodePoints);
  return sorted.some((item, index) => item !== sent[index])
    ? sorted
    : undefined;
};

/** The value an echo rule stores for a sent value: as sent, or its strings sorted. */
export const echoed = (
  rule: { readonly sorted?: true },
  sent: JsonValue,
): JsonValue => (rule.sorted === true ? (sortedStrings(sent) ?? sent) : sent);

/** Whether a generated integer retains the exemplar's digit count and JSON kind. */
export const likeGeneratedInteger = (
  value: JsonValue | undefined,
  exemplar: JsonValue | undefined,
): boolean => {
  const digits = generatedIntegerDigits(value);
  return (
    digits !== undefined &&
    typeof value === typeof exemplar &&
    digits.length === generatedIntegerDigits(exemplar)?.length
  );
};

/** An integer value as a number, from a JSON number or a string of digits. */
export const integerOf = (value: JsonValue | undefined): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : typeof value === "string" && /^\d{1,15}$/u.test(value)
      ? Number(value)
      : undefined;

/**
 * The next value of a sequence. With nothing taken yet, that is the next held integer, or 1 when
 * the scope holds none. Otherwise it is one past the later of that and the last value taken.
 * A missing side leaves a negative value negative.
 */
export const nextSequence = (
  held: number | undefined,
  taken: number | undefined,
): number =>
  taken === undefined ? (held ?? 1) : Math.max(held ?? taken + 1, taken + 1);

/** The next held integer of a sequence that never goes below its `start`. */
export const startedSequence = (
  held: number | undefined,
  start: number | undefined,
): number | undefined =>
  start === undefined ? held : Math.max(held ?? start, start);

/** An integer spelled as the recorded value spells integers: a number, or a string of digits. */
export const spelledLike = (exemplar: JsonValue, value: number): JsonValue =>
  maskedCount(exemplar) !== undefined
    ? fillMask(exemplar as string, value)
    : typeof exemplar === "string"
      ? String(value)
      : value;

const MASKED_DIGITS = /^\d{2,}(?:-\d{2,})+$/u;

/** The count `-`-separated digit groups of one width spell, such as an asset number `000-005`; dates, versions and addresses are not counts. */
const maskedCount = (value: JsonValue | undefined): number | undefined => {
  if (typeof value !== "string" || !MASKED_DIGITS.test(value)) return undefined;
  const groups = value.split("-");
  if (groups.some((group) => group.length !== groups[0]!.length))
    return undefined;
  const digits = groups.join("");
  return digits.length <= 15 ? Number(digits) : undefined;
};

/** A count that outgrew the exemplar's mask, read only when it is spelled as serving spells it, so dates never match. */
const outgrownMask = (
  value: JsonValue | undefined,
  exemplar: JsonValue | undefined,
): number | undefined => {
  if (typeof value !== "string" || maskedCount(exemplar) === undefined)
    return undefined;
  const digits = value.replaceAll("-", "");
  if (!/^\d{1,15}$/u.test(digits)) return undefined;
  const count = Number(digits);
  return fillMask(exemplar as string, count) === value ? count : undefined;
};

/** A sequence's number: an integer, digit groups that count, or with the sequence's exemplar a count that outgrew its mask. */
export const sequenceNumber = (
  value: JsonValue | undefined,
  exemplar?: JsonValue,
): number | undefined =>
  integerOf(value) ?? maskedCount(value) ?? outgrownMask(value, exemplar);

/** A number written into a mask's digit positions, zero-padded; digits that outgrow the mask lead it. */
const fillMask = (mask: string, value: number): string => {
  const padded = String(value).padStart(mask.replace(/\D/gu, "").length, "0");
  let next = padded.length - 1;
  let out = "";
  for (let at = mask.length - 1; at >= 0; at -= 1) {
    const character = mask[at]!;
    if (/\d/u.test(character)) {
      out = padded[next]! + out;
      next -= 1;
    } else out = character + out;
  }
  return padded.slice(0, next + 1) + out;
};

/** Lower case, with every run of other characters joined by one `-` and none at either end. */
/** How a slug spells `&`: dropped when absent, as Django does, or as the word, as Go's gosimple/slug and JavaScript's slugify do. */
export type Ampersand = "and";

export const slugOf = (text: string, ampersand?: Ampersand): string =>
  (ampersand === "and" ? text.replaceAll("&", " and ") : text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

/** A text's slugs, each with the spelling that gives it: also with `&` as the word when the text holds one. */
export const slugSpellings = (
  text: string,
): readonly { readonly slug: string; readonly ampersand?: Ampersand }[] =>
  text.includes("&")
    ? [{ slug: slugOf(text) }, { slug: slugOf(text, "and"), ampersand: "and" }]
    : [{ slug: slugOf(text) }];

const isAlphanumeric = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** Source offsets stay UTF-16, while delimiter classification reads complete code points. */
const previousCharacter = (text: string, at: number): string | undefined => {
  if (at === 0) return undefined;
  const last = text.charCodeAt(at - 1);
  if (last >= 0xdc00 && last <= 0xdfff && at > 1) {
    const first = text.charCodeAt(at - 2);
    if (first >= 0xd800 && first <= 0xdbff) return text.slice(at - 2, at);
  }
  return text[at - 1];
};

const nextCharacter = (text: string, at: number): string | undefined => {
  const point = text.codePointAt(at);
  return point === undefined ? undefined : String.fromCodePoint(point);
};

/** Whether the character before UTF-16 offset `at` is a letter or digit, joining text that starts there to its left. */
export const joinsBefore = (text: string, at: number): boolean =>
  isAlphanumeric(previousCharacter(text, at));

/** Whether the character at UTF-16 offset `at` is a letter or digit, joining text that ends there to its right. */
export const joinsAfter = (text: string, at: number): boolean =>
  isAlphanumeric(nextCharacter(text, at));

/** Start offsets of `token` in `text` where neither neighbour is a letter or digit. */
export const delimitedOffsets = (text: string, token: string): number[] => {
  const offsets: number[] = [];
  if (token.length === 0) return offsets;
  let at = text.indexOf(token);
  while (at >= 0) {
    const delimited =
      !joinsBefore(text, at) && !joinsAfter(text, at + token.length);
    if (delimited) offsets.push(at);
    // A rejected match may overlap a delimited one, so the search moves on by one character.
    at = text.indexOf(token, at + (delimited ? token.length : 1));
  }
  return offsets;
};

/** `text` with every delimited occurrence of `token` replaced. */
export const replaceDelimited = (
  text: string,
  token: string,
  replacement: string,
): string => {
  let result = "";
  let from = 0;
  for (const at of delimitedOffsets(text, token)) {
    result += text.slice(from, at) + replacement;
    from = at + token.length;
  }
  return result + text.slice(from);
};

/** Whether any string inside a value holds `token` delimited. */
export const containsDelimited = (value: JsonValue, token: string): boolean => {
  const pending: JsonValue[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "string") {
      if (delimitedOffsets(next, token).length > 0) return true;
    } else if (typeof next === "object" && next !== null)
      // One at a time: spreading a wide array into push overflows the call stack.
      for (const child of Array.isArray(next) ? next : Object.values(next))
        pending.push(child);
  }
  return false;
};

/** Whether any number inside a value spells `digits`. */
export const containsNumber = (value: JsonValue, digits: string): boolean => {
  const pending: JsonValue[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "number") {
      if (String(next) === digits) return true;
    } else if (typeof next === "object" && next !== null)
      for (const child of Array.isArray(next) ? next : Object.values(next))
        pending.push(child);
  }
  return false;
};

/** SHA-256 bytes of a seed, extended by counter blocks to the requested length. */
const seededBytes = (seed: string, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let block = 0; block * 32 < length; block += 1) {
    const digest = createHash("sha256")
      .update(`${seed}#${String(block)}`)
      .digest();
    bytes.set(
      digest.subarray(0, Math.min(32, length - block * 32)),
      block * 32,
    );
  }
  return bytes;
};

/** A version 4 UUID derived from a seed, in the recorded value's letter case. */
export const seededUuid = (seed: string, exemplar: string): string => {
  const bytes = seededBytes(seed, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return exemplar === exemplar.toUpperCase() && /[A-F]/u.test(exemplar)
    ? uuid.toUpperCase()
    : uuid;
};

const DIGITS = "0123456789";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();

/** The characters a token of this spelling draws from: hexadecimal, or the digit and letter cases it uses. */
const tokenAlphabet = (exemplar: string): string => {
  if (/^[0-9a-f]+$/u.test(exemplar) && /[0-9]/u.test(exemplar))
    return `${DIGITS}abcdef`;
  if (/^[0-9A-F]+$/u.test(exemplar) && /[0-9]/u.test(exemplar))
    return `${DIGITS}ABCDEF`;
  const alphabet =
    (/[0-9]/u.test(exemplar) ? DIGITS : "") +
    (/[a-z]/u.test(exemplar) ? LOWER : "") +
    (/[A-Z]/u.test(exemplar) ? UPPER : "");
  return alphabet === "" ? LOWER : alphabet;
};

/** A seeded value spelled like the recorded one: a UUID for a UUID or when asked for one, else a token. */
export const seededLike = (
  seed: string,
  exemplar: JsonValue,
  uuid = false,
): string =>
  uuid || isUuid(exemplar)
    ? seededUuid(seed, String(exemplar))
    : seededToken(seed, String(exemplar));

/** A seeded integer with as many digits as the recorded one and none leading zero, as a number when it is one and stays safe. */
export const seededInteger = (seed: string, exemplar: JsonValue): JsonValue => {
  const length = String(exemplar).length;
  const bytes = seededBytes(seed, length);
  // A number keeps under the largest safe integer, which a sixteen-digit one starting with 9 can pass.
  const leading = typeof exemplar === "number" && length >= 16 ? 8 : 9;
  const digits = [...bytes]
    .map((byte, index) =>
      String(index === 0 ? 1 + (byte % leading) : byte % 10),
    )
    .join("");
  return typeof exemplar === "number" ? Number(digits) : digits;
};

/** A token as long as the recorded one, from its alphabet, keeping its other characters in place. */
export const seededToken = (seed: string, exemplar: string): string => {
  const alphabet = tokenAlphabet(exemplar);
  const bytes = seededBytes(seed, exemplar.length);
  return [...exemplar]
    .map((character, index) =>
      /[0-9A-Za-z]/u.test(character)
        ? alphabet[bytes[index]! % alphabet.length]!
        : character,
    )
    .join("");
};
