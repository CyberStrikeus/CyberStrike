/** Raw coordinates are independent of WHATWG's normalized origin and pathname. */
export interface RecordedTransportUrl {
  readonly origin: string | null;
  readonly path: string | null;
  /** WHATWG query spelling, retaining an explicit empty delimiter; selected only on request. */
  readonly query?: string;
  readonly credentials:
    | { readonly start: number; readonly end: number }
    | "ambiguous"
    | null;
}

/**
 * Interpret transport URL syntax once for credential exclusion and recorded-path
 * projection. Never use URL.pathname: it removes observed dot segments.
 * Noncanonical spellings may have parsed credentials but no safe raw span.
 */
export const parseRecordedTransportUrl = (
  value: string,
  options: {
    readonly includeQuery?: boolean;
    /** Recorded request context for credential interpretation, never projected identity. */
    readonly credentialBaseUrl?: string;
  } = {},
): RecordedTransportUrl => {
  const prefix = /^[\x00-\x20]*(?:([A-Za-z][A-Za-z0-9+.-]*):)?\/\//u.exec(
    value,
  );
  const absolute = URL.parse(value);
  const credentialBase =
    options.credentialBaseUrl === undefined
      ? null
      : URL.parse(options.credentialBaseUrl);
  if (credentialBase !== null) {
    // Inherited request authentication is not part of a relative header's text.
    credentialBase.username = "";
    credentialBase.password = "";
  }
  // Resolve references only to recognize credentials (including WHATWG's
  // backslash/control-character spellings), never to supply a projected origin.
  const parsed =
    credentialBase === null
      ? (absolute ?? URL.parse(value, "https://rea.invalid"))
      : URL.parse(value, credentialBase);
  const hasCredentials =
    parsed !== null && (parsed.username !== "" || parsed.password !== "");
  const origin =
    absolute !== null && absolute.origin !== "null" ? absolute.origin : null;
  if (prefix === null)
    return {
      origin,
      path: null,
      credentials: hasCredentials ? "ambiguous" : null,
    };

  const authorityStart = prefix[0].length;
  const protocol =
    parsed?.protocol ?? `${prefix[1]?.toLowerCase() ?? "https"}:`;
  const special = ["ftp:", "file:", "http:", "https:", "ws:", "wss:"].includes(
    protocol,
  );
  let authorityEnd = authorityStart;
  while (
    authorityEnd < value.length &&
    !"/?#".includes(value[authorityEnd]!) &&
    !(special && value[authorityEnd] === "\\")
  )
    authorityEnd += 1;
  const authority = value.slice(authorityStart, authorityEnd);
  const stableAuthority = authority.length > 0 && !/[\t\n\r]/u.test(authority);
  const at = authority.lastIndexOf("@");
  const credentials =
    !stableAuthority && hasCredentials
      ? "ambiguous"
      : at >= 0
        ? { start: authorityStart, end: authorityStart + at + 1 }
        : hasCredentials
          ? "ambiguous"
          : null;
  // Only an explicit, unpadded scheme://authority has a recorded absolute path.
  // Backslashes are authority/path separators for special schemes in WHATWG.
  if (
    origin === null ||
    !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value) ||
    !stableAuthority ||
    (special && value[authorityEnd] === "\\")
  )
    return { origin, path: null, credentials };
  const hash = value.indexOf("#", authorityEnd);
  const question = value.indexOf("?", authorityEnd);
  const hasQuery = question >= 0 && (hash < 0 || question < hash);
  const query =
    options.includeQuery === true
      ? { query: absolute!.search || (hasQuery ? "?" : "") }
      : {};
  if (value[authorityEnd] !== "/")
    return { origin, path: "/", credentials, ...query };
  let pathEnd = authorityEnd;
  while (pathEnd < value.length && !"?#".includes(value[pathEnd]!))
    pathEnd += 1;
  return {
    origin,
    path: value.slice(authorityEnd, pathEnd),
    credentials,
    ...query,
  };
};

/** WHATWG form decoding; native fallback preserves replacement behavior on malformed escapes/UTF-8. */
const formComponent = (raw: string): string => {
  if (!/[%+\uD800-\uDFFF]/u.test(raw)) return raw;
  if (!/[\uD800-\uDFFF]/u.test(raw)) {
    try {
      return decodeURIComponent(raw.replaceAll("+", " "));
    } catch {
      // Malformed escapes and UTF-8 use the native replacement semantics below.
    }
  }
  return new URLSearchParams(`value=${raw}`).get("value") ?? "";
};

/** Separator coordinates shared by name projection and selected-value matching. */
function* queryFields(
  query: string,
): IterableIterator<readonly [number, number, number]> {
  let start = query.startsWith("?") ? 1 : 0;
  let equals = query.indexOf("=", start);
  while (start < query.length) {
    const separator = query.indexOf("&", start);
    const end = separator < 0 ? query.length : separator;
    if (end > start)
      yield [start, equals >= start && equals < end ? equals : end, end];
    start = end + 1;
    if (equals >= 0 && equals < start) equals = query.indexOf("=", start);
  }
}

/** Scan one field at a time; selection avoids decoding unrelated values. */
export function* iterateUrlQueryParameters(
  query: string,
  selected?: ReadonlyMap<string, unknown> | ReadonlySet<string>,
): IterableIterator<[string, string]> {
  for (const [start, nameEnd, end] of queryFields(query)) {
    const name = formComponent(query.slice(start, nameEnd));
    if (selected === undefined || selected.has(name))
      yield [
        name,
        formComponent(nameEnd < end ? query.slice(nameEnd + 1, end) : ""),
      ];
  }
}

/** A single-valued form query: identical decoded repeats agree; conflicting values remain unknown. */
export const singleQueryValues = (
  query: string | undefined,
): ReadonlyMap<string, string> | undefined => {
  const values = new Map<string, string>();
  for (const [name, value] of iterateUrlQueryParameters(query ?? "")) {
    if (values.has(name) && values.get(name) !== value) return undefined;
    values.set(name, value);
  }
  return values;
};

/** WHATWG form-query names, preserving order, repeats and empty names without decoding values. */
export function* parseUrlQueryParameterNames(
  query: string,
): IterableIterator<string> {
  for (const [start, nameEnd] of queryFields(query))
    yield formComponent(query.slice(start, nameEnd));
}

/** Scan a raw path once, retaining only caller-selected coordinates. */
export const recordedPathSegments = (
  path: string,
  indexes: Iterable<number>,
): ReadonlyMap<number, string> => {
  const needed = new Set<number>();
  for (const index of indexes)
    if (Number.isSafeInteger(index) && index >= 0) needed.add(index);
  const result = new Map<number, string>();
  if (needed.size === 0) return result;
  let start = path.indexOf("/");
  if (start < 0) return result;
  start += 1;
  let index = 0;
  while (needed.size > 0) {
    const end = path.indexOf("/", start);
    if (needed.delete(index))
      result.set(index, path.slice(start, end < 0 ? path.length : end));
    if (end < 0) break;
    start = end + 1;
    index += 1;
  }
  return result;
};
