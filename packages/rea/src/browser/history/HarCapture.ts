import { createHash } from "node:crypto";
import { LosslessNumber } from "lossless-json";
import { parseCaptureJson } from "./CaptureJson.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { isCanonicalBase64 } from "../../domain/stringPatterns.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  type WebNetworkCapture,
  type WebNetworkCaptureRecord,
} from "../../domain/webNetworkCapture.js";
import { CaptureFormatError } from "./CaptureFormatError.js";
import {
  CaptureRedaction,
  captureObject,
  capturePointer,
} from "./CaptureRedaction.js";
import { createHarValidator } from "./HarSchema.js";
import { HAR_CAPTURE_PROVIDER_IDENTITY } from "./CaptureRelease.js";

type DecodedCapture = Omit<
  WebNetworkCapture,
  "artifact" | "format" | "runtime_attribution" | "limitations"
>;
type Projection = Pick<
  WebNetworkCaptureRecord,
  "reported" | "numeric_literals" | "binary_fields" | "redactions"
>;

/** Decode a retained HAR, validating a disposable projection of source facts. */
export const decodeHarCapture = (
  text: string,
  sensitiveValues: readonly string[],
): DecodedCapture => {
  const raw = parseCaptureJson(text, "HAR");
  const validation = projectHar(raw, [], "validation");
  const adaptedPlaywrightEntries = new Set(
    createHarValidator()(validation.reported),
  );
  if (
    !captureObject(raw) ||
    !captureObject(raw.log) ||
    !Array.isArray(raw.log.entries)
  )
    throw new CaptureFormatError("format", "HAR must contain log.entries.");
  if (raw.log.version !== "1.2")
    throw new CaptureFormatError(
      "unsupported",
      "Only the pinned HAR 1.2 schema profile is supported.",
      "/log/version",
    );
  const entries = raw.log.entries;
  const recordsExcluded = ["log", "entries"].some((key) =>
    sensitiveValues.some((literal) => key.includes(literal)),
  );
  const container = projectHar(
    { ...raw, log: { ...raw.log, entries: null } },
    sensitiveValues,
    "container",
  );
  const records = entries.map((entry, ordinal): WebNetworkCaptureRecord => {
    // Validate each original record even when a structural ancestor excludes it.
    const projected = projectHar(entry, sensitiveValues, "entry");
    const projection: Projection = recordsExcluded
      ? {
          reported: null,
          numeric_literals: [],
          binary_fields: [],
          redactions: [{ pointer: "", reason: "explicit-sensitive-value" }],
        }
      : projected;
    return {
      ordinal,
      location: recordsExcluded
        ? { kind: "unknown", reason: "explicit-sensitive-value" }
        : { kind: "json-pointer", pointer: `/log/entries/${ordinal}` },
      ...projection,
      limitations: [
        "HAR text without an encoding declaration is producer-decoded Unicode. Unsupported declared body encodings remain opaque; original body bytes remain unknown unless content explicitly uses valid base64. Declared sizes are preserved independently of retained bytes. mitmproxy 12.2.3 SaveHar may report null optional postData.text; that null is retained and omitted only from the upstream validation copy.",
        ...(adaptedPlaywrightEntries.has(ordinal)
          ? [
              "This capture declares Playwright 1.58.2 and reports bracketed IPv6 serverIPAddress. Original spellings are retained; brackets were removed only from valid IPv6 values in the validation copy. Producer declarations are not authenticated.",
            ]
          : []),
        ...(recordsExcluded
          ? [
              "This record's payload and sidecars are excluded because its structural ancestor property was explicitly marked sensitive.",
            ]
          : []),
      ],
    };
  });
  return {
    decoder: { ...HAR_CAPTURE_PROVIDER_IDENTITY },
    container: {
      reported: container.reported,
      numeric_literals: container.numeric_literals,
      redactions: container.redactions,
      records_pointer: recordsExcluded ? null : "/log/entries",
    },
    total_records: records.length,
    records,
  };
};

/** Relative HTTP paths belong only to entries, never similarly named container extensions. */
const projectHar = (
  value: unknown,
  sensitiveValues: readonly string[],
  scope: "validation" | "container" | "entry",
): Projection => {
  const redact = scope !== "validation";
  const redactor = new CaptureRedaction(
    sensitiveValues,
    scope === "entry" ? value : undefined,
  );
  const numeric_literals: Projection["numeric_literals"] = [];
  const binary_fields: Projection["binary_fields"] = [];
  const projectNumber = (item: LosslessNumber, pointer: string): JsonValue => {
    // Evidence publishes an unsafe number as null; the schema must still judge it as a number.
    if (!redact) return validationNumber(item.value);
    const number = redactor.number(item, pointer, redact);
    if (number === null) return null;
    numeric_literals.push({
      pointer,
      producer_type: "json-number",
      literal: number.literal,
    });
    return number.reported;
  };
  const visit = (
    item: unknown,
    pointer: string,
    depth: number,
    parent?: Readonly<Record<string, unknown>>,
  ): JsonValue => {
    if (depth > WEB_NETWORK_CAPTURE_LIMITS.depth)
      throw new CaptureFormatError(
        "input-limit",
        "HAR exceeds the 64-level complete-evidence nesting budget. This release has no runtime override.",
        pointer,
      );
    if (
      scope === "entry" &&
      parent !== undefined &&
      redactor.harCredential(pointer, parent)
    )
      return redactor.credential(pointer);
    if (item instanceof LosslessNumber) return projectNumber(item, pointer);
    if (typeof item === "string") {
      if (
        scope === "entry" &&
        pointer === "/response/content/text" &&
        parent?.encoding === "base64"
      ) {
        const bytes = decodeHarBase64(item, pointer);
        const contentBase64 = bytes.toString("base64");
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const hidden =
          redactor.sensitiveBytes(bytes) ||
          sensitiveValues.some(
            (literal) =>
              item.includes(literal) ||
              contentBase64.includes(literal) ||
              sha256.includes(literal) ||
              String(bytes.length).includes(literal),
          );
        binary_fields.push(
          hidden
            ? {
                pointer,
                representation: "har-base64-content",
                state: "redacted",
                content_base64: null,
                bytes: null,
                sha256: null,
              }
            : {
                pointer,
                representation: "har-base64-content",
                state: "retained",
                content_base64: contentBase64,
                bytes: bytes.length,
                sha256,
              },
        );
        if (hidden) {
          redactor.redactions.push({
            pointer,
            reason: "explicit-sensitive-value",
          });
          return null;
        }
      }
      return redact
        ? redactor.text(
            item,
            pointer,
            scope === "entry"
              ? redactor.harTransportUrl(pointer, parent)
              : undefined,
          )
        : item;
    }
    if (item === null || typeof item === "boolean") return item;
    if (Array.isArray(item))
      return item.map((child, index) =>
        visit(child, capturePointer(pointer, String(index)), depth + 1),
      );
    if (captureObject(item))
      return Object.fromEntries(
        Object.entries(item).flatMap(([key, child]) => {
          if (
            redact &&
            sensitiveValues.some((literal) => key.includes(literal))
          ) {
            const beforeNumbers = numeric_literals.length;
            const beforeBinaries = binary_fields.length;
            const beforeRedactions = redactor.redactions.length;
            visit(child, capturePointer(pointer, key), depth + 1, item);
            numeric_literals.splice(beforeNumbers);
            binary_fields.splice(beforeBinaries);
            redactor.redactions.splice(beforeRedactions);
            redactor.redactions.push({
              pointer,
              reason: "explicit-sensitive-value",
              scope: "property-name",
            });
            return [];
          }
          return [
            [key, visit(child, capturePointer(pointer, key), depth + 1, item)],
          ];
        }),
      );
    throw new CaptureFormatError(
      "format",
      "HAR parser returned a non-JSON value.",
      pointer,
    );
  };
  return {
    reported: visit(value, "", 0),
    numeric_literals,
    binary_fields,
    redactions: redactor.redactions,
  };
};

/**
 * A JSON number lexeme as the validation copy carries it: its nearest double, unless rounding or
 * overflow erased a fractional part, so the schema's `integer` checks the lexeme, not the double.
 */
const validationNumber = (literal: string): number => {
  const nearest = Number(literal);
  if (integerLexeme(literal)) return nearest;
  if (Number.isFinite(nearest) && !Number.isInteger(nearest)) return nearest;
  return literal.startsWith("-") ? -0.5 : 0.5;
};

/** Whether a JSON number lexeme denotes an integer, decided from its digits and exponent. */
const integerLexeme = (literal: string): boolean => {
  const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (match === null) return false;
  const [, whole = "", fraction = "", exponent = "0"] = match;
  const digits = `${whole}${fraction}`;
  const significant = digits.replace(/0+$/, "");
  if (/^0*$/.test(significant)) return true;
  const trailingZeros = digits.length - significant.length;
  return Number(exponent) - fraction.length + trailingZeros >= 0;
};

const decodeHarBase64 = (value: string, pointer: string): Buffer => {
  const compact = value.replace(/[\t\n\r ]/g, "");
  if (!isCanonicalBase64(compact))
    throw new CaptureFormatError(
      "format",
      "HAR content declares base64 but its text is not valid canonical base64 (ASCII whitespace is allowed).",
      pointer,
    );
  return Buffer.from(compact, "base64");
};
