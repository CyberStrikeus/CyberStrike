import type { Result } from "../domain/result.js";

const GHIDRA_JAVA_PROPERTIES_CODES = [
  "trailing_escape",
  "malformed_unicode_escape",
] as const;

/** Stable identity for a Java properties escape that invalidates the file. */
export type GhidraJavaPropertiesCode =
  (typeof GHIDRA_JAVA_PROPERTIES_CODES)[number];

/** Parse Java Properties.load(InputStream) syntax from its ISO-8859-1 text. */
export const parseGhidraJavaProperties = (
  content: string,
): Result<ReadonlyMap<string, string>, GhidraJavaPropertiesCode> => {
  const values = new Map<string, string>();
  for (const line of logicalPropertyLines(content)) {
    let start = 0;
    while (isPropertyWhitespace(line[start])) start += 1;
    if (start === line.length || line[start] === "#" || line[start] === "!")
      continue;
    let end = start;
    let escaped = false;
    while (end < line.length) {
      const character = line[end];
      if (
        !escaped &&
        (character === "=" ||
          character === ":" ||
          isPropertyWhitespace(character))
      )
        break;
      if (character === "\\") escaped = !escaped;
      else escaped = false;
      end += 1;
    }
    let valueStart = end;
    while (isPropertyWhitespace(line[valueStart])) valueStart += 1;
    if (line[valueStart] === "=" || line[valueStart] === ":") valueStart += 1;
    while (isPropertyWhitespace(line[valueStart])) valueStart += 1;
    const key = decodePropertyEscapes(line.slice(start, end));
    if (!key.ok) return key;
    const value = decodePropertyEscapes(line.slice(valueStart));
    if (!value.ok) return value;
    values.set(key.value, value.value);
  }
  return { ok: true, value: values };
};

const isPropertyWhitespace = (value: string | undefined): boolean =>
  value === " " || value === "\t" || value === "\f";

/** Join odd-backslash continuations while stripping leading continuation space. */
function* logicalPropertyLines(content: string): Generator<string> {
  let physicalStart = 0;
  let logical = "";
  let continuing = false;
  while (physicalStart <= content.length) {
    let physicalEnd = physicalStart;
    while (
      physicalEnd < content.length &&
      content[physicalEnd] !== "\n" &&
      content[physicalEnd] !== "\r"
    )
      physicalEnd += 1;
    let line = content.slice(physicalStart, physicalEnd);
    let leading = 0;
    while (isPropertyWhitespace(line[leading])) leading += 1;
    const comment =
      !continuing && (line[leading] === "#" || line[leading] === "!");
    if (continuing) line = line.slice(leading);
    let continued = false;
    if (!comment) {
      let slashes = 0;
      for (
        let index = line.length - 1;
        index >= 0 && line[index] === "\\";
        index -= 1
      )
        slashes += 1;
      continued = slashes % 2 === 1;
      logical += continued ? line.slice(0, -1) : line;
    }
    if (!continued) {
      yield logical;
      logical = "";
    }
    continuing = continued;
    if (physicalEnd === content.length) break;
    physicalStart =
      content[physicalEnd] === "\r" && content[physicalEnd + 1] === "\n"
        ? physicalEnd + 2
        : physicalEnd + 1;
  }
  // Properties.load still consumes the accumulated line when EOF follows a
  // continuation marker; the marker itself was already removed above.
  if (continuing) yield logical;
}

const decodePropertyEscapes = (
  value: string,
): Result<string, GhidraJavaPropertiesCode> => {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined) return { ok: false, error: "trailing_escape" };
    if (escaped === "t") result += "\t";
    else if (escaped === "n") result += "\n";
    else if (escaped === "r") result += "\r";
    else if (escaped === "f") result += "\f";
    else if (escaped === "u") {
      const digits = value.slice(index + 1, index + 5);
      if (digits.length !== 4 || !/^[0-9a-f]{4}$/iu.test(digits))
        return {
          ok: false,
          error: "malformed_unicode_escape",
        };
      result += String.fromCharCode(Number.parseInt(digits, 16));
      index += 4;
    } else result += escaped;
  }
  return { ok: true, value: result };
};
