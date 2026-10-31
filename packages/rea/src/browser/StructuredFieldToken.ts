// RFC 9651 sections 4.2.3–4.2.10. Consume complete items, without retaining
// parameter values that the response-declaration projection does not expose.
const token = /[A-Za-z*][A-Za-z0-9!#$%&'*+.^_`|~:/\x2d]*/uy;
const key = /[a-z*][a-z0-9_.*\x2d]*/uy;
const bareItem =
  /(?:[A-Za-z*][A-Za-z0-9!#$%&'*+.^_`|~:/\x2d]*|"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\["\\])*"|-?[0-9]{1,12}\.[0-9]{1,3}|-?[0-9]{1,15}|\?[01]|@-?[0-9]{1,15}|:(?<bytes>[A-Za-z0-9+/]*={0,2}):|%"(?<display>(?:[\x20-\x21\x23-\x24\x26-\x7e]|%[0-9a-f]{2})*)")/uy;

/** Return the exact declared token only if the entire Structured Field Item is valid. */
export const structuredFieldToken = (
  value: string | undefined,
): string | null => {
  if (value === undefined) return null;
  let cursor = 0;
  while (value[cursor] === " ") cursor += 1;
  token.lastIndex = cursor;
  const declared = token.exec(value)?.[0];
  if (declared === undefined) return null;
  cursor = token.lastIndex;
  while (value[cursor] === ";") {
    cursor += 1;
    while (value[cursor] === " ") cursor += 1;
    key.lastIndex = cursor;
    if (key.exec(value) === null) return null;
    cursor = key.lastIndex;
    if (value[cursor] !== "=") continue;
    bareItem.lastIndex = cursor + 1;
    const parameter = bareItem.exec(value);
    if (parameter === null) return null;
    cursor = bareItem.lastIndex;
    const bytes = parameter.groups?.bytes;
    if (bytes !== undefined) {
      const padded = bytes.endsWith("=");
      if (padded ? bytes.length % 4 !== 0 : bytes.length % 4 === 1) return null;
    }
    const display = parameter.groups?.display;
    if (display !== undefined) {
      try {
        // Percent syntax was checked above; this rejects invalid UTF-8 octets.
        decodeURIComponent(display);
      } catch {
        return null;
      }
    }
  }
  while (value[cursor] === " ") cursor += 1;
  return cursor === value.length ? declared : null;
};
