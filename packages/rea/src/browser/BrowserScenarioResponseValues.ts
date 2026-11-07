import { visit, type JSONPath } from "jsonc-parser";
import { isExactJsonNumber } from "../domain/exactJsonNumber.js";
import { safeParseJson } from "../domain/safeJson.js";
import { err, ok, type Result } from "../domain/result.js";
import type { BrowserScenarioSaveEntry } from "../domain/browserScenarioValues.js";

/** Bound decoded JSON before parsing; UTF-8 needs at most three bytes per UTF-16 code unit. */
export const MAX_SAVED_RESPONSE_CHARACTERS = 4_000_000;
export const MAX_SAVED_RESPONSE_BYTES = 3 * MAX_SAVED_RESPONSE_CHARACTERS;

interface ResponseValueIssue {
  readonly _tag: "ResponseValueIssue";
  readonly message: string;
}
const issue = (message: string): ResponseValueIssue => ({
  _tag: "ResponseValueIssue",
  message,
});

export interface ResponseValue {
  readonly entry: BrowserScenarioSaveEntry;
  readonly value: string | number;
}

const pointerTokens = (pointer: string): readonly string[] =>
  pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

/** Keep unrelated fields usable while marking numbers that cannot be selected exactly. */
export const parseScenarioValueJson = (text: string) =>
  safeParseJson(text, (_key, value, context) =>
    typeof value === "number" && !isExactJsonNumber(value, context?.source)
      ? Number.NaN
      : value,
  );

/** Exact own-property lookup: an absent pointer remains distinct from a non-scalar value. */
export const responsePointerValue = (
  value: unknown,
  pointer: string,
): unknown => {
  let current = value;
  for (const key of pointerTokens(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)(?![\s\S])/u.test(key)) return undefined;
      current = current[Number(key)];
    } else if (
      typeof current === "object" &&
      current !== null &&
      Object.hasOwn(current, key)
    )
      current = (current as Record<string, unknown>)[key];
    else return undefined;
  }
  return current;
};

/** Both bindings and source-body redaction use the same decoded values and exact-number policy. */
export const readResponseValues = (
  body: string | Uint8Array | undefined,
  entries: readonly BrowserScenarioSaveEntry[],
  missing: "fail" | "ignore",
): Result<
  { readonly values: readonly ResponseValue[]; readonly text: string },
  ResponseValueIssue
> => {
  if (
    body === undefined ||
    (typeof body !== "string" && body.byteLength > MAX_SAVED_RESPONSE_BYTES)
  )
    return err(issue("the response is too large to save values from."));
  let text: string;
  try {
    text =
      typeof body === "string"
        ? body
        : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            body,
          );
  } catch {
    return err(
      issue(
        "the response is not valid UTF-8 JSON, so no value can be saved from it.",
      ),
    );
  }
  if (text.length > MAX_SAVED_RESPONSE_CHARACTERS)
    return err(issue("the response is too large to save values from."));
  const parsed = parseScenarioValueJson(text);
  if (!parsed.ok)
    return err(
      issue("the response is not JSON, so no value can be saved from it."),
    );
  const selected: ResponseValue[] = [];
  for (const entry of entries) {
    const value = responsePointerValue(parsed.value, entry.json_pointer);
    if (value === undefined && missing === "ignore") continue;
    if (typeof value !== "string" && typeof value !== "number")
      return err(
        issue(
          `the response has no string or number at ${entry.json_pointer} to save as ${entry.name}.`,
        ),
      );
    if (typeof value === "number" && !Number.isFinite(value))
      return err(
        issue(
          `the number at ${entry.json_pointer} cannot be saved exactly (not finite or JSON conversion would lose precision).`,
        ),
      );
    selected.push({ entry, value });
  }
  return ok({ values: selected, text });
};

interface ResponseBodySource {
  headers(): Readonly<Record<string, string>>;
  request(): { sizes?(): Promise<{ readonly responseBodySize: number }> };
  body(): Promise<Buffer>;
}

/** DEFLATE decodes at most 1032 bytes per byte it reads (zlib's limit), so a gzip or deflate body's received size bounds its decoded size. */
const DEFLATE_MAX_EXPANSION = 1032;

/** The most bytes a response decodes to, from the bytes received (or its declared length, for one served from cache) and its content codings; undefined when they cannot bound it. */
export const decodedBodyBound = (
  received: number | undefined,
  headers: Readonly<Record<string, string>>,
): number | undefined => {
  const declared = headers["content-length"]?.trim();
  const bytes =
    received !== undefined && Number.isSafeInteger(received) && received > 0
      ? received
      : declared !== undefined && /^[1-9]\d{0,14}$/u.test(declared)
        ? Number(declared)
        : undefined;
  if (bytes === undefined) return undefined;
  let bound = bytes;
  for (const coding of (headers["content-encoding"] ?? "").split(",")) {
    const name = coding.trim().toLowerCase();
    if (name === "" || name === "identity") continue;
    if (name !== "gzip" && name !== "x-gzip" && name !== "deflate")
      return undefined;
    bound *= DEFLATE_MAX_EXPANSION;
  }
  return bound;
};

/** The caller owns deadline/cancellation; unknown decoded bounds never request a whole body. */
export const readBoundedResponseBody = async (
  response: ResponseBodySource,
  maxBytes: number,
): Promise<Result<Buffer, ResponseValueIssue>> => {
  const request = response.request();
  const size =
    request.sizes === undefined
      ? undefined
      : (await request.sizes()).responseBodySize;
  if (size !== undefined && size > maxBytes)
    return err(issue("the response is too large to save values from."));
  const bound = decodedBodyBound(size, response.headers());
  if (bound === undefined)
    return err(
      issue(
        "the decoded response size cannot be bounded before reading it; this response body was not read.",
      ),
    );
  if (bound > maxBytes)
    return err(
      issue(
        "the response could decode past the size limit; this response body was not read.",
      ),
    );
  const body = await response.body();
  return body.length > maxBytes
    ? err(issue("the response is too large to save values from."))
    : ok(body);
};

/** Replace selected JSON tokens and known decoded string secrets; preserve other source spellings and whitespace. */
export const redactResponseSource = (
  text: string,
  values: readonly ResponseValue[],
  redact: (value: string) => string,
  maxBytes: number,
  maxAllocationBytes: number,
): Result<Buffer | undefined, ResponseValueIssue> => {
  const markers = new Map(
    values.map(({ entry, value }) => [
      JSON.stringify(pointerTokens(entry.json_pointer)),
      redact(String(value)),
    ]),
  );
  const parts: string[] = [];
  let cursor = 0;
  let bytes = Buffer.byteLength(text);
  const replace = (offset: number, length: number, marker: string): void => {
    const replacement = JSON.stringify(marker);
    bytes +=
      Buffer.byteLength(replacement) -
      Buffer.byteLength(text.slice(offset, offset + length));
    if (bytes > maxBytes || bytes * 4 > maxAllocationBytes)
      throw new Error(
        "Structural source redaction exceeds the selected body allocation budget.",
      );
    parts.push(text.slice(cursor, offset), replacement);
    cursor = offset + length;
  };
  const markerAt = (path: JSONPath): string | undefined =>
    markers.get(JSON.stringify(path.map(String)));
  const container = (
    _offset: number,
    _length: number,
    _line: number,
    _column: number,
    path: () => JSONPath,
  ): void => {
    if (markerAt(path()) !== undefined)
      throw new Error(
        "A marked source field has conflicting scalar/container representations; its source content was withheld.",
      );
  };
  try {
    visit(
      text,
      {
        onObjectBegin: container,
        onArrayBegin: container,
        onLiteralValue: (
          value: unknown,
          offset,
          length,
          _line,
          _column,
          path,
        ) => {
          let marker = markerAt(path());
          if (marker === undefined) {
            const raw = text.slice(offset, offset + length);
            const rendered =
              typeof value === "number" && !isExactJsonNumber(value, raw)
                ? undefined
                : String(value);
            const decoded =
              rendered === undefined ? undefined : redact(rendered);
            if (decoded !== undefined && decoded !== rendered) marker = decoded;
            if (marker === undefined && typeof value !== "string") {
              const redacted = redact(raw);
              if (redacted !== raw) marker = redacted;
            }
          }
          if (marker !== undefined) replace(offset, length, marker);
        },
        onObjectProperty: (property, offset, length) => {
          const redacted = redact(property);
          if (redacted !== property) replace(offset, length, redacted);
        },
        onError: () => {
          throw new Error("The marked source is not valid JSON.");
        },
      },
      { disallowComments: true, allowTrailingComma: false },
    );
    if (parts.length === 0) return ok(undefined);
    parts.push(text.slice(cursor));
    return ok(Buffer.from(parts.join("")));
  } catch (cause: unknown) {
    return err(
      issue(
        cause instanceof Error
          ? cause.message
          : "Structural source redaction failed.",
      ),
    );
  }
};
