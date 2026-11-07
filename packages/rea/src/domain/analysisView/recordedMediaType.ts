const MEDIA_TYPE_ESSENCE =
  /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;

const JSON_LIKE_TEXT = new Set(["text/plain", "text/markdown"]);

/** Lowercase type/subtype without parameters; malformed essences are unknown. */
export const mediaTypeEssence = (reported: string): string | null => {
  const separator = reported.indexOf(";");
  let start = 0;
  let end = separator < 0 ? reported.length : separator;
  // HTTP OWS is SP/HTAB. Scan from both ends so malformed internal runs of
  // whitespace cannot cause repeated trailing-regex searches.
  while (start < end && (reported[start] === " " || reported[start] === "\t"))
    start += 1;
  while (
    end > start &&
    (reported[end - 1] === " " || reported[end - 1] === "\t")
  )
    end -= 1;
  const essence = reported.slice(start, end);
  // Validate ASCII tokens before case folding can turn Unicode into ASCII.
  return MEDIA_TYPE_ESSENCE.test(essence) ? essence.toLowerCase() : null;
};

/** `application/json` or `application/*+json`; a `+json` suffix on another type is not JSON here. */
export const isJson = (essence: string | null): boolean =>
  essence === "application/json" ||
  (essence !== null &&
    essence.startsWith("application/") &&
    essence.endsWith("+json"));

/** JSON, `+json`, `text/plain` or `text/markdown`: the content types a replay parses as JSON. */
export const isJsonLike = (essence: string | null): boolean =>
  isJson(essence) || (essence !== null && JSON_LIKE_TEXT.has(essence));
