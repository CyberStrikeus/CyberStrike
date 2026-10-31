import {
  inspectSignatureSchema,
  type InspectSignature,
} from "../../domain/native/nativeInspection.js";

/**
 * Parse bounded `codesign -d --verbose=4` diagnostics, which Apple emits on
 * stderr. codesign echoes the executable path and signing identifier
 * verbatim, and an ad hoc identifier derives from the file name, so either
 * can contain line breaks and text that resembles other fields. The path is
 * removed by its exact value from `executablePaths`, and the identifier runs
 * to the `Format=` field that codesign prints after it.
 */
export const parseCodeSignature = (
  output: string,
  unsigned: boolean,
  executablePaths: readonly string[] = [],
): Omit<InspectSignature, "provenance"> => {
  const { identifier, fields } = splitEchoedValues(output, executablePaths);
  const values = new Map<string, string>();
  const authorities: string[] = [];
  const cdhashes: string[] = [];
  for (const line of fields.split(/\r?\n/u)) {
    if (line.startsWith("CodeDirectory ")) {
      values.set("CodeDirectory", line.slice("CodeDirectory ".length));
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "Authority") authorities.push(value);
    else if (key === "CDHash") cdhashes.push(value);
    else values.set(key, value);
  }
  const parsed = inspectSignatureSchema.omit({ provenance: true }).parse({
    signed: !unsigned,
    identifier: identifier ?? null,
    team_identifier: nullableCodeSignValue(values.get("TeamIdentifier")),
    format: values.get("Format") ?? null,
    cdhashes,
    hash_algorithms: splitAlgorithms(values.get("Hash choices")),
    authorities,
    designated_requirement: values.get("designated") ?? null,
    entitlements: null,
    timestamp: values.get("Timestamp") ?? null,
    hardened_runtime: parseRuntime(values.get("CodeDirectory")),
    limitations: unsigned ? ["Artifact is not signed."] : [],
  });
  return parsed;
};

/**
 * Separate the echoed executable path and signing identifier, which codesign
 * prints first, from the fields that follow them.
 */
const splitEchoedValues = (
  text: string,
  executablePaths: readonly string[],
): { readonly identifier: string | undefined; readonly fields: string } => {
  let rest = text;
  // Frame the exact source path before interpreting record separators. A CRLF
  // inside that path or the signing identifier is payload, not a line ending.
  let newline: string | undefined;
  for (const path of executablePaths) {
    const prefix = `Executable=${path}`;
    if (!text.startsWith(prefix)) continue;
    const separator = /^\r?\n/u.exec(text.slice(prefix.length))?.[0];
    if (separator === undefined) continue;
    newline = separator;
    rest = text.slice(prefix.length + separator.length);
    break;
  }
  if (rest === text && text.startsWith("Executable=")) {
    const identifierLine = text.indexOf("\nIdentifier=");
    rest = identifierLine < 0 ? text : text.slice(identifierLine + 1);
  }
  if (!rest.startsWith("Identifier="))
    return { identifier: undefined, fields: rest };
  // Later fields come from the signature itself, so the last `Format=` line
  // is the one codesign printed after the identifier.
  const format = rest.lastIndexOf("\nFormat=");
  // Without an exact path, use the producer-owned Format record's terminator.
  // Looking inside Identifier instead would confuse literal CRLF payload with
  // record framing, or strip a literal trailing CR from an LF-delimited value.
  if (newline === undefined && format >= 0)
    newline = /\r?\n/u.exec(rest.slice(format + 1))?.[0];
  const boundary = format >= 0 ? format : rest.indexOf("\n");
  const crlf = newline === undefined || newline === "\r\n";
  const end =
    boundary < 0
      ? rest.length
      : boundary - (crlf && rest[boundary - 1] === "\r" ? 1 : 0);
  return {
    identifier: rest.slice("Identifier=".length, end),
    fields: rest.slice(end),
  };
};

const nullableCodeSignValue = (value: string | undefined): string | null =>
  value === undefined || value === "not set" ? null : value;

const splitAlgorithms = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(/[,+\s]+/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

const parseRuntime = (value: string | undefined): boolean | null => {
  if (value === undefined) return null;
  const flags = /(?:^|\s)flags=[^(]*\(([^)]*)\)/u.exec(value)?.[1];
  if (flags === undefined) return null;
  return flags.split(",").some((flag) => flag.trim() === "runtime");
};
