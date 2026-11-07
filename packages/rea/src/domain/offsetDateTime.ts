import { z } from "zod";

export interface OffsetDateTimeInstant {
  readonly epochSecond: number;
  /** Exact fractional second with insignificant trailing zeroes removed. */
  readonly fraction: string;
}

const CALENDAR_DATE = String.raw`(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))`;
const CLOCK_TIME = String.raw`(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?`;
const UTC_OFFSET = String.raw`(?:Z|[+\x2d](?:[01]\d|2[0-3]):[0-5]\d)`;

/**
 * REA's ISO-8601 timestamps preserve optional seconds and arbitrary fractional
 * precision, including inputs admitted before Zod 4.6.6 required seconds.
 * Keep this grammar independent of the installed validator version. The
 * escaped offset hyphen also compiles in ECMA-262 Unicode-set (`v`) mode.
 */
export const offsetDateTimeSchema = z
  .string()
  .regex(
    new RegExp(`^${CALENDAR_DATE}T${CLOCK_TIME}${UTC_OFFSET}$`, "u"),
    "Use an ISO-8601 date-time with an explicit UTC offset",
  );

/** The same established timestamp grammar with the UTC `Z` designator only. */
export const utcDateTimeSchema = z
  .string()
  .regex(
    new RegExp(`^${CALENDAR_DATE}T${CLOCK_TIME}Z$`, "u"),
    "Use an ISO-8601 date-time in UTC",
  );

/** Parse an already validated offset timestamp without losing sub-millisecond precision. */
export const parseOffsetDateTimeInstant = (
  value: string,
): OffsetDateTimeInstant => {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+\x2d]\d{2}:\d{2})$/u.exec(value);
  if (match === null)
    throw new TypeError("Expected a validated offset date-time.");
  const [, dateTime, fractionalDigits, offset] = match;
  if (dateTime === undefined || offset === undefined)
    throw new TypeError("Expected a validated offset date-time.");
  const wholeSecondMilliseconds = Date.parse(`${dateTime}${offset}`);
  if (
    !Number.isSafeInteger(wholeSecondMilliseconds) ||
    wholeSecondMilliseconds % 1000 !== 0
  )
    throw new TypeError(
      "Offset date-time is outside the supported time range.",
    );
  return {
    epochSecond: wholeSecondMilliseconds / 1000,
    fraction: fractionalDigits?.replace(/0+$/u, "") ?? "",
  };
};

export interface RecordedDateTimeReading {
  readonly instant: OffsetDateTimeInstant;
  readonly spelling: {
    readonly separator: "T" | " ";
    readonly secondsPresent: boolean;
    readonly fractionDigits: number;
    readonly zone: string;
  };
}

/** Distinguish invalid supported spellings from formats this reader does not interpret. */
export const inspectRecordedDateTime = (
  value: string,
):
  | { readonly kind: "valid"; readonly reading: RecordedDateTimeReading }
  | { readonly kind: "invalid" | "unrecognized" } => {
  const match =
    /^(\d{4}-\d{2}-\d{2})([T ])(\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/u.exec(
      value,
    );
  if (match === null) return { kind: "unrecognized" };
  const [, date, separator, time, seconds, fraction = "", zone = ""] = match;
  const offset =
    zone === ""
      ? "Z"
      : zone === "Z" || zone.includes(":")
        ? zone
        : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const normalized = offsetDateTimeSchema.safeParse(
    `${date}T${time}${seconds === undefined ? "" : `:${seconds}`}${fraction === "" ? "" : `.${fraction}`}${offset}`,
  );
  if (!normalized.success) return { kind: "invalid" };
  return {
    kind: "valid",
    reading: {
      instant: parseOffsetDateTimeInstant(normalized.data),
      spelling: {
        separator: separator as "T" | " ",
        secondsPresent: seconds !== undefined,
        fractionDigits: fraction.length,
        zone,
      },
    },
  };
};

/** Parse recorded ISO spelling once, retaining its exact instant and formatting facts. */
export const readRecordedDateTime = (
  value: string,
): RecordedDateTimeReading | undefined => {
  const inspected = inspectRecordedDateTime(value);
  return inspected.kind === "valid" ? inspected.reading : undefined;
};

/** Interpret recorded starts once, preserving exact ISO facts and legacy native-Date admission. */
export const readRecordedStart = (
  value: string,
):
  | {
      readonly instant: OffsetDateTimeInstant;
      readonly interpretation: "recorded-iso" | "native-date";
    }
  | undefined => {
  const inspected = inspectRecordedDateTime(value);
  if (inspected.kind === "valid")
    return {
      instant: inspected.reading.instant,
      interpretation: "recorded-iso",
    };
  if (inspected.kind === "invalid") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? {
        instant: offsetDateTimeInstantFromEpochMilliseconds(milliseconds),
        interpretation: "native-date",
      }
    : undefined;
};

/** Convert a Date.now-style integer into the same exact comparison shape. */
export const offsetDateTimeInstantFromEpochMilliseconds = (
  epochMilliseconds: number,
): OffsetDateTimeInstant => {
  if (!Number.isFinite(epochMilliseconds))
    throw new TypeError("Expected finite epoch milliseconds.");
  if (Math.abs(epochMilliseconds) > Number.MAX_SAFE_INTEGER)
    return { epochSecond: epochMilliseconds / 1000, fraction: "" };
  const epochSecond = Math.floor(epochMilliseconds / 1000);
  const millisecondsWithinSecond = epochMilliseconds - epochSecond * 1000;
  return {
    epochSecond,
    fraction: fractionalSecondFromMilliseconds(millisecondsWithinSecond),
  };
};

const fractionalSecondFromMilliseconds = (milliseconds: number): string => {
  if (milliseconds === 0) return "";
  const [coefficient = "", exponentText] = String(milliseconds)
    .toLowerCase()
    .split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const point = coefficient.indexOf(".");
  const decimalPosition =
    (point < 0 ? coefficient.length : point) + exponent - 3;
  const digits = coefficient.replace(".", "");
  const fraction =
    decimalPosition <= 0
      ? `0.${"0".repeat(-decimalPosition)}${digits}`
      : decimalPosition < digits.length
        ? `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
        : `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  return (
    fraction.includes(".") ? fraction.slice(fraction.indexOf(".") + 1) : ""
  ).replace(/0+$/u, "");
};

/** Compare instants exactly while treating absent fraction digits as zeroes. */
export const compareOffsetDateTimeInstants = (
  left: OffsetDateTimeInstant,
  right: OffsetDateTimeInstant,
): number => {
  if (left.epochSecond !== right.epochSecond)
    return left.epochSecond < right.epochSecond ? -1 : 1;
  const length = Math.max(left.fraction.length, right.fraction.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = left.fraction.charCodeAt(index) || 48;
    const rightDigit = right.fraction.charCodeAt(index) || 48;
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
};
