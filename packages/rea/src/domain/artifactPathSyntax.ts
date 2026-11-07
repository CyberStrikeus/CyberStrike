/**
 * Pure string predicates for artifact path syntax. The local artifact
 * resolver, the Electron native specifier check, and (by reference) the
 * live-DOM and source-map URL handling share these character-level rules.
 *
 * Policy divergence (deliberate, not yet unified):
 * - Local artifact paths resolve against an inventoried container root and
 *   report rejected | external | not-found. Confinement is lexical
 *   (normalizeJoinedLogicalPath must stay inside the root).
 * - Live DOM destinations resolve against the document base URL and report
 *   approved | outside_policy | unsupported against allowedOrigins
 *   (see CdpCaptureDocuments.domDestination).
 * - Source-map fetches require exact-origin http(s) without credentials
 *   (see WebSourceMapFetcher.approvedUrl).
 * Unifying those outcome vocabularies is a separate, observable change.
 */

/** Whether a reference carries a URI scheme (`https:`, `file:`, …). */
export const hasScheme = (value: string): boolean =>
  /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);

/** Whether a reference is scheme-qualified or protocol-relative. */
export const looksExternal = (value: string): boolean =>
  hasScheme(value) || value.startsWith("//");

/** Drop any query string and fragment from a declared reference. */
export const stripQueryAndFragment = (value: string): string =>
  value.split("#", 1)[0]?.split("?", 1)[0] ?? "";

/** Path syntax admitted for a canonical artifact path. */
export const admitsCanonicalPathSyntax = (value: string): boolean =>
  !value.includes("\0") &&
  !value.includes("\\") &&
  !/%(?:2e|2f|5c)/iu.test(value);

/** C0 controls and space, which the URL parser strips around its input. */
const isUrlTrimmed = (code: number): boolean => code <= 0x20;

/**
 * The URL text a browser parses from an HTML URL attribute: HTML strips
 * surrounding ASCII whitespace, and the URL parser strips surrounding C0
 * controls and spaces and removes every tab and newline.
 */
export const htmlUrlText = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && isUrlTrimmed(value.charCodeAt(start))) start += 1;
  while (end > start && isUrlTrimmed(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(start, end).replace(/[\t\n\r]/gu, "");
};

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const UTF8_ENCODER = new TextEncoder();

/**
 * Percent-decode a URL path as the URL standard does: valid `%XX` sequences
 * become bytes and any other `%` stays literal. Returns null when the bytes
 * are not UTF-8 or include NUL, because no canonical artifact path can match
 * them. Callers refuse encoded dot and separator bytes before decoding.
 */
export const percentDecodeUrlPath = (value: string): string | null => {
  if (!/%[0-9a-f]{2}/iu.test(value)) return value;
  const bytes: number[] = [];
  for (let index = 0; index < value.length;) {
    const escape = value.slice(index, index + 3);
    if (/^%[0-9a-f]{2}$/iu.test(escape)) {
      bytes.push(Number.parseInt(escape.slice(1), 16));
      index += 3;
      continue;
    }
    const character = String.fromCodePoint(value.codePointAt(index) ?? 0);
    bytes.push(...UTF8_ENCODER.encode(character));
    index += character.length;
  }
  try {
    const decoded = UTF8.decode(new Uint8Array(bytes));
    return decoded.includes("\0") ? null : decoded;
  } catch (cause: unknown) {
    // Invalid UTF-8 cannot name an inventoried path.
    void cause;
    return null;
  }
};
