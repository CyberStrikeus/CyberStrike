import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isDeepStrictEqual } from "node:util";

import {
  parseDshCordisDocument,
  serializeDshDocument,
  editDshDocument,
  dshClientRegistrationEntry,
} from "./DshCordisPatch.js";
import {
  editHermesConfigurationYaml,
  parseHermesConfigurationYaml,
  stringifyHermesConfigurationYaml,
} from "./HermesConfigurationYaml.js";
import {
  applyEdits,
  createScanner,
  format as formatJson,
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Edit,
  type Node,
  type ParseError,
  type SyntaxKind,
} from "jsonc-parser";
import { z } from "zod";

import { err, ok, type Result } from "../domain/result.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import type { SetupClient } from "./SupportedClients.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

export type ClientConfigurationFormat = NonNullable<SetupClient["format"]>;
type ClientServersKey = "mcp_servers" | "mcpServers" | "mcp" | "servers";

/**
 * Registration entry dialect. OpenCode V2 reads V1 `mcp.<name>` entries, but a
 * document already using the native `mcp.servers` table takes native entries.
 */
export type ClientRegistrationDialect =
  | ClientConfigurationFormat
  | "opencode_v2";

/** Validated client document and its server table, preserving unrelated settings. */
export interface ClientConfigurationDocument {
  readonly document: Record<string, unknown>;
  /** Server table that registrations are written to. */
  readonly servers: Record<string, unknown>;
  /** Key path of `servers` in `document`. */
  readonly serversPath: readonly string[];
  readonly dialect: ClientRegistrationDialect;
  /** Member holding explicit environment overrides in a server registration. */
  readonly environmentKey: "env" | "environment";
  /**
   * OpenCode V1 server members beside a native V2 `mcp.servers` table. OpenCode
   * still loads them, and a native entry with the same name takes precedence.
   */
  readonly legacyServers: Record<string, unknown>;
}

/** Admit source mappings without Zod's record clone dropping caller keys. */
export const clientConfigurationRecordSchema = z
  .custom<Record<string, unknown>>((value) => {
    if (typeof value !== "object" || value === null) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  })
  .transform((value) => Object.fromEntries(Object.entries(value)));

/** Compare parsed configuration values without depending on parser prototypes. */
export const clientConfigurationValuesEqual = (
  left: unknown,
  right: unknown,
): boolean =>
  isDeepStrictEqual(
    normalizeConfigurationValue(left),
    normalizeConfigurationValue(right),
  );

const normalizeConfigurationValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeConfigurationValue);
  if (typeof value !== "object" || value === null || value instanceof Date)
    return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
      .map(([key, nested]) => [key, normalizeConfigurationValue(nested)]),
  );
};

/** Return the top-level object used for MCP server registrations by a client. */
export const clientConfigurationServersKey = (
  format: ClientConfigurationFormat,
): ClientServersKey => {
  switch (format) {
    case "toml":
    case "grok":
    case "hermes":
      return "mcp_servers";
    case "opencode":
    case "zcode":
      return "mcp";
    case "vscode":
      return "servers";
    default:
      return "mcpServers";
  }
};

/**
 * Whether raw configuration text holds no settings to preserve. Some clients
 * create a zero-byte config file before any server is added.
 */
const isEmptyClientConfigurationText = (text: string): boolean =>
  text.replace(/^\uFEFF/, "").trim() === "";

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/**
 * Parse client TOML with TOML 1.0's signed 64-bit integer contract. Integers
 * beyond JavaScript's safe range stay exact as bigint; values outside Int64,
 * which Codex rejects, are malformed.
 */
const parseClientToml = (text: string): Record<string, unknown> => {
  const parsed = parseToml(text, { integersAsBigInt: "asNeeded" });
  const pending: unknown[] = [parsed];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (typeof value === "bigint") {
      if (value < INT64_MIN || value > INT64_MAX)
        throw new SyntaxError(
          `Invalid TOML document: integer ${String(value)} is outside the signed 64-bit range`,
        );
    } else if (
      typeof value === "object" &&
      value !== null &&
      !(value instanceof Date)
    )
      // Large documents can exceed argument limits, so do not spread.
      for (const nested of Object.values(value)) pending.push(nested);
  }
  return parsed;
};

const parseDocument = (
  text: string,
  format: ClientConfigurationFormat,
): Record<string, unknown> => {
  if (format === "toml" || format === "grok")
    return requireObject(parseClientToml(text), "The configuration root");
  // Pi loads `mcp.json` with a strict `JSON.parse` and no BOM tolerance, so
  // comments, trailing commas, a BOM, or an empty existing file must be
  // rejected instead of registering into a document the client cannot load.
  // Kimi also reads mcp.json with JSON.parse and an empty-file fallback.
  if (format === "pi" || format === "kimi") {
    if (format === "kimi" && text.trim().length === 0) return {};
    return requireObject(JSON.parse(text), "The configuration root");
  }
  // An empty file, which some clients create before any server is added,
  // holds no settings to preserve.
  if (isEmptyClientConfigurationText(text)) return {};
  // Hermes stores MCP servers in `mcp_servers` inside a YAML document.
  if (format === "hermes")
    return requireObject(
      parseHermesConfigurationYaml(text),
      "The configuration root",
    );
  // ZCode loads nonempty native files with strict JSON.parse.
  if (format === "zcode")
    return requireObject(JSON.parse(text), "The configuration root");
  // Claude Code loads `.claude.json` with strict JSON.parse after a UTF-8 BOM,
  // so comments and trailing commas it rejects must not be admitted as JSONC.
  if (format === "claude_code")
    return requireObject(
      JSON.parse(text.replace(/^\uFEFF/, "")),
      "The configuration root",
    );
  const errors: ParseError[] = [];
  // Accept a UTF-8 BOM without shifting diagnostics or editing the original text.
  const jsonText = text.startsWith("\uFEFF") ? ` ${text.slice(1)}` : text;
  const root = parseTree(jsonText, errors, { allowTrailingComma: true });
  const firstError = errors[0];
  if (firstError !== undefined)
    throw new SyntaxError(
      `Invalid JSON/JSONC at offset ${firstError.offset}: ${printParseErrorCode(firstError.error)}`,
    );
  return requireObject(
    root === undefined ? undefined : getNodeValue(root),
    "The configuration root",
  );
};

/** A parsed configuration whose structure, not its syntax, cannot hold MCP servers. */
export class ClientConfigurationShapeError extends TypeError {}

/** Validate source mappings and copy their own properties without rewriting values. */
const requireObject = (
  value: unknown,
  description: string,
): Record<string, unknown> => {
  const parsed = clientConfigurationRecordSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ClientConfigurationShapeError(`${description} must be an object`, {
    cause: parsed.error,
  });
};

/** ZCode reads the same-scope fallback as strict JSON with a mcpServers table. */
export const parseZcodeFallbackConfiguration = (
  text: string,
): ClientConfigurationDocument => {
  const document = requireObject(JSON.parse(text), "ZCode fallback root");
  return {
    document,
    servers:
      document.mcpServers === undefined
        ? {}
        : requireObject(document.mcpServers, "ZCode fallback mcpServers"),
    serversPath: ["mcpServers"],
    dialect: "zcode_fallback",
    environmentKey: "env",
    legacyServers: {},
  };
};

/** Members of OpenCode V2's `mcp` object that are not server names. */
const OPENCODE_V2_MCP_SETTINGS = new Set(["servers", "timeout"]);

/** Parse a client document and reject malformed roots or MCP server tables. */
export const parseClientConfiguration = (
  text: string,
  format: ClientConfigurationFormat | undefined,
): ClientConfigurationDocument => {
  if (format === undefined || format === "unsupported")
    throw new TypeError("client does not have a supported MCP config format");
  // DeepSeek Harness stores a Cordis patch list, not a server table.
  if (format === "zcode_fallback") return parseZcodeFallbackConfiguration(text);
  if (format === "dsh") return parseDshCordisDocument(text);
  const document = parseDocument(text, format);
  const environmentKey = format === "opencode" ? "environment" : "env";
  const serversKey = clientConfigurationServersKey(format);
  const value = document[serversKey];
  const servers =
    value === undefined ? {} : requireObject(value, `"${serversKey}"`);
  // ZCode reads stdio servers from the nested `mcp.servers` table of
  // `~/.zcode/cli/config.json`; entries carry `command`, `args`, and `env`.
  if (format === "zcode") {
    const nested = servers.servers;
    return {
      document,
      servers:
        nested === undefined
          ? {}
          : requireObject(nested, `"${serversKey}.servers"`),
      serversPath: [serversKey, "servers"],
      dialect: format,
      environmentKey,
      legacyServers: {},
    };
  }
  const native = servers.servers;
  // A V1 server named `servers` has a string `type` discriminator; the V2
  // table may instead hold a server object named `type`.
  if (
    format !== "opencode" ||
    native === undefined ||
    (typeof native === "object" &&
      native !== null &&
      "type" in native &&
      typeof native.type === "string")
  )
    return {
      document,
      servers,
      serversPath: [serversKey],
      dialect: format,
      environmentKey,
      legacyServers: {},
    };
  return {
    document,
    servers: requireObject(native, `"${serversKey}.servers"`),
    serversPath: [serversKey, "servers"],
    dialect: "opencode_v2",
    environmentKey,
    legacyServers: Object.fromEntries(
      Object.entries(servers).filter(
        ([name]) => !OPENCODE_V2_MCP_SETTINGS.has(name),
      ),
    ),
  };
};

/** The registration a client loads for `name`, including OpenCode V1 entries. */
export const effectiveClientServer = (
  parsed: ClientConfigurationDocument,
  name: string,
): unknown => {
  const native = Object.hasOwn(parsed.servers, name);
  const value = native
    ? parsed.servers[name]
    : Object.hasOwn(parsed.legacyServers, name)
      ? parsed.legacyServers[name]
      : undefined;
  if (
    (parsed.dialect !== "opencode" && parsed.dialect !== "opencode_v2") ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  )
    return value;
  const { enabled, ...registration } = value as Record<string, unknown>;
  // OpenCode migrates legacy activation before merging layers. An enabled V1
  // fragment must override inherited disabled:true; native V2 ignores enabled.
  return (parsed.dialect === "opencode" || !native) &&
    typeof enabled === "boolean"
    ? { ...registration, disabled: !enabled }
    : registration;
};

/**
 * Return `parsed.document` with `servers` at its server table. A legacy OpenCode
 * V1 member named in `removeLegacy` is removed beside a native V2 table.
 */
export const withClientServers = (
  parsed: ClientConfigurationDocument,
  servers: Record<string, unknown>,
  removeLegacy?: string,
): Record<string, unknown> => {
  // The Harness patch list upserts or removes by entry id, not by table.
  if (parsed.dialect === "dsh")
    return Object.hasOwn(servers, PRODUCT_IDENTITY.mcpServerKey)
      ? editDshDocument(
          parsed,
          clientConfigurationRecordSchema.parse(
            servers[PRODUCT_IDENTITY.mcpServerKey],
          ),
        )
      : editDshDocument(parsed);
  const [key = "", nested] = parsed.serversPath;
  if (nested === undefined) return { ...parsed.document, [key]: servers };
  // A fresh document may not hold the outer table yet (for example a new
  // ZCode `config.json` without an `mcp` object), so treat absence as empty.
  const outerValue = parsed.document[key];
  const outer =
    outerValue === undefined
      ? {}
      : clientConfigurationRecordSchema.parse(outerValue);
  if (
    parsed.dialect === "opencode_v2" &&
    removeLegacy !== undefined &&
    !OPENCODE_V2_MCP_SETTINGS.has(removeLegacy)
  )
    delete outer[removeLegacy];
  return { ...parsed.document, [key]: { ...outer, [nested]: servers } };
};

/** Read the value at a key path, or `undefined` when any member is absent. */
const valueAt = (
  document: Record<string, unknown>,
  path: readonly string[],
): unknown => {
  let current: unknown = document;
  for (const key of path) {
    const object = clientConfigurationRecordSchema.safeParse(current);
    if (!object.success || !Object.hasOwn(object.data, key)) return undefined;
    current = object.data[key];
  }
  return current;
};

type TomlStringMode = "none" | "ml-basic" | "ml-literal";

const TOML_BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  e: "\u001b",
  '"': '"',
  "\\": "\\",
};

/** A `[table]` or `[[array]]` header outside strings, with decoded key segments. */
interface TomlTableHeader {
  readonly path: readonly string[];
}

const skipHorizontalSpace = (line: string, index: number): number => {
  let next = index;
  while (line[next] === " " || line[next] === "\t") next += 1;
  return next;
};

const decodeBasicEscape = (
  line: string,
  slash: number,
): { readonly value: string; readonly next: number } | undefined => {
  const escape = line[slash + 1];
  if (escape === undefined) return undefined;
  const simple = TOML_BASIC_ESCAPES[escape];
  if (simple !== undefined) return { value: simple, next: slash + 2 };
  // smol-toml accepts `\xHH` even though TOML 1.0 does not.
  if (escape === "x") {
    const hex = line.slice(slash + 2, slash + 4);
    if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) return undefined;
    return {
      value: String.fromCodePoint(Number.parseInt(hex, 16)),
      next: slash + 4,
    };
  }
  if (escape !== "u" && escape !== "U") return undefined;
  const length = escape === "u" ? 4 : 8;
  const hex = line.slice(slash + 2, slash + 2 + length);
  if (!new RegExp(`^[0-9A-Fa-f]{${String(length)}}$`, "u").test(hex))
    return undefined;
  const code = Number.parseInt(hex, 16);
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return undefined;
  return { value: String.fromCodePoint(code), next: slash + 2 + length };
};

/** Read one single-line quoted key. Multiline quotes are not a header key. */
const parseQuotedKey = (
  line: string,
  start: number,
): { readonly value: string; readonly next: number } | undefined => {
  const quote = line[start];
  if (
    (quote !== '"' && quote !== "'") ||
    line.startsWith(quote === '"' ? '"""' : "'''", start)
  )
    return undefined;
  if (quote === "'") {
    const end = line.indexOf("'", start + 1);
    if (end < 0 || line.slice(start + 1, end).includes("\n")) return undefined;
    return { value: line.slice(start + 1, end), next: end + 1 };
  }
  let value = "";
  let index = start + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === "\n" || char === "\r") return undefined;
    if (char === '"') return { value, next: index + 1 };
    if (char !== "\\") {
      value += char ?? "";
      index += 1;
      continue;
    }
    const decoded = decodeBasicEscape(line, index);
    if (decoded === undefined) return undefined;
    value += decoded.value;
    index = decoded.next;
  }
  return undefined;
};

const parseBareKey = (
  line: string,
  start: number,
): { readonly value: string; readonly next: number } | undefined => {
  let index = start;
  while (/[A-Za-z0-9_-]/u.test(line[index] ?? "")) index += 1;
  if (index === start) return undefined;
  return { value: line.slice(start, index), next: index };
};

/**
 * Parse a table header. Quoted segments stay one key, so `mcp_servers."rea.env"`
 * is not the dotted path `mcp_servers.rea.env`.
 */
const parseTomlTableHeader = (line: string): TomlTableHeader | undefined => {
  let index = skipHorizontalSpace(line, 0);
  const array = line.startsWith("[[", index);
  if (!array && line[index] !== "[") return undefined;
  index += array ? 2 : 1;
  const path: string[] = [];
  for (;;) {
    index = skipHorizontalSpace(line, index);
    const key =
      line[index] === '"' || line[index] === "'"
        ? parseQuotedKey(line, index)
        : parseBareKey(line, index);
    if (key === undefined) return undefined;
    path.push(key.value);
    index = skipHorizontalSpace(line, key.next);
    if (line[index] !== ".") break;
    index += 1;
  }
  const close = array ? "]]" : "]";
  if (!line.startsWith(close, index)) return undefined;
  index = skipHorizontalSpace(line, index + close.length);
  if (index < line.length && line[index] !== "#") return undefined;
  return { path };
};

/**
 * String state after one physical line, starting at `start`. A multiline
 * closer does not end the scan: `""", """` closes one string and opens another.
 */
const tomlStringModeAfter = (
  line: string,
  mode: TomlStringMode,
  start = 0,
): TomlStringMode => {
  if (mode === "ml-basic" || mode === "ml-literal") {
    const delimiter = mode === "ml-basic" ? '"""' : "'''";
    const closed = closeMultiline(line, start, delimiter, mode === "ml-basic");
    if (closed === undefined) return mode;
    return tomlStringModeAfter(line, "none", closed);
  }
  let index = start;
  while (index < line.length) {
    if (line[index] === "#") return "none";
    if (line.startsWith('"""', index)) {
      const closed = closeMultiline(line, index + 3, '"""', true);
      if (closed === undefined) return "ml-basic";
      index = closed;
      continue;
    }
    if (line.startsWith("'''", index)) {
      const closed = closeMultiline(line, index + 3, "'''", false);
      if (closed === undefined) return "ml-literal";
      index = closed;
      continue;
    }
    const quote = line[index];
    if (quote === '"' || quote === "'") {
      const quoted = parseQuotedKey(line, index);
      if (quoted === undefined) return "none";
      index = quoted.next;
      continue;
    }
    index += 1;
  }
  return "none";
};

/** Index after a multiline delimiter, or undefined when this line does not close it. */
const closeMultiline = (
  line: string,
  start: number,
  delimiter: '"""' | "'''",
  escapes: boolean,
): number | undefined => {
  let index = start;
  while (index < line.length) {
    if (escapes && line[index] === "\\") {
      if (line[index + 1] === undefined) return undefined;
      index += 2;
      continue;
    }
    if (line.startsWith(delimiter, index)) {
      // One or two quotes before the closer belong to the string: """keep""""
      let end = index + delimiter.length;
      const quote = delimiter[0];
      let extra = 0;
      while (extra < 2 && line[end] === quote) {
        extra += 1;
        end += 1;
      }
      return end;
    }
    index += 1;
  }
  return undefined;
};

const isBlankOrComment = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed === "" || trimmed.startsWith("#");
};

const looksLikeTomlHeader = (line: string): boolean =>
  line.trimStart().startsWith("[");

/** `mcp_servers.<server>` and tables nested under it, compared by key segment. */
const isTomlServerTable = (
  path: readonly string[],
  serverKey: string,
): boolean => path[0] === "mcp_servers" && path[1] === serverKey;

const parseKeyPath = (
  text: string,
  start: number,
):
  | { readonly segments: readonly string[]; readonly next: number }
  | undefined => {
  const segments: string[] = [];
  let index = start;
  for (;;) {
    index = skipHorizontalSpace(text, index);
    const current = text[index];
    if (current === undefined || current === "\n" || current === "\r")
      return undefined;
    const key =
      current === '"' || current === "'"
        ? parseQuotedKey(text, index)
        : parseBareKey(text, index);
    if (key === undefined) return undefined;
    segments.push(key.value);
    index = skipHorizontalSpace(text, key.next);
    if (text[index] !== ".") return { segments, next: index };
    index += 1;
  }
};

const parseAssignment = (
  line: string,
):
  | { readonly segments: readonly string[]; readonly equals: number }
  | undefined => {
  const key = parseKeyPath(line, 0);
  if (key === undefined) return undefined;
  const equals = skipHorizontalSpace(line, key.next);
  if (line[equals] !== "=") return undefined;
  return { segments: key.segments, equals };
};

const skipWsAndComments = (text: string, start: number): number => {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    return index;
  }
  return index;
};

/** Index after one TOML value. Containers and multiline strings may cross lines. */
const endOfTomlValue = (text: string, start: number): number => {
  const index = skipWsAndComments(text, start);
  if (index >= text.length) return index;
  if (text.startsWith('"""', index)) {
    const closed = closeMultiline(text, index + 3, '"""', true);
    return closed ?? text.length;
  }
  if (text.startsWith("'''", index)) {
    const closed = closeMultiline(text, index + 3, "'''", false);
    return closed ?? text.length;
  }
  const quote = text[index];
  if (quote === '"' || quote === "'") {
    const quoted = parseQuotedKey(text, index);
    return quoted === undefined ? text.length : quoted.next;
  }
  if (quote === "{" || quote === "[") return endOfContainer(text, index);
  let cursor = index;
  while (cursor < text.length) {
    const char = text[cursor];
    if (
      char === "\n" ||
      char === "#" ||
      char === "," ||
      char === "}" ||
      char === "]"
    )
      break;
    cursor += 1;
  }
  return cursor;
};

const endOfContainer = (text: string, open: number): number => {
  const closers: string[] = [text[open] === "{" ? "}" : "]"];
  let index = open + 1;
  while (index < text.length && closers.length > 0) {
    if (text.startsWith('"""', index)) {
      const closed = closeMultiline(text, index + 3, '"""', true);
      if (closed === undefined) return text.length;
      index = closed;
      continue;
    }
    if (text.startsWith("'''", index)) {
      const closed = closeMultiline(text, index + 3, "'''", false);
      if (closed === undefined) return text.length;
      index = closed;
      continue;
    }
    const quote = text[index];
    if (quote === '"' || quote === "'") {
      const quoted = parseQuotedKey(text, index);
      if (quoted === undefined) return text.length;
      index = quoted.next;
      continue;
    }
    if (quote === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (quote === "{" || quote === "[") {
      closers.push(quote === "{" ? "}" : "]");
      index += 1;
      continue;
    }
    if (quote === closers[closers.length - 1]) {
      closers.pop();
      index += 1;
      continue;
    }
    index += 1;
  }
  return index;
};

/** TOML basic string. JSON leaves U+007F raw, which TOML rejects. */
const tomlBasicString = (value: string): string =>
  JSON.stringify(value).replaceAll("\u007f", "\\u007f");

const tomlInlineKey = (key: string): string =>
  /^[A-Za-z0-9_-]+$/u.test(key) ? key : tomlBasicString(key);

const tomlInlineValue = (value: unknown): string => {
  if (typeof value === "string") return tomlBasicString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value))
    return `[${value.map((item) => tomlInlineValue(item)).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const body = Object.entries(value)
      .map(
        ([key, nested]) => `${tomlInlineKey(key)} = ${tomlInlineValue(nested)}`,
      )
      .join(", ");
    return `{ ${body} }`;
  }
  return '""';
};

interface InlinePair {
  readonly leading: string;
  readonly text: string;
  readonly drop: boolean;
}

const readTrivia = (
  text: string,
  start: number,
  limit: number,
): { readonly text: string; readonly next: number } => {
  let index = start;
  while (index < limit) {
    const char = text[index];
    if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === ","
    ) {
      index += 1;
      continue;
    }
    if (char === "#") {
      while (index < limit && text[index] !== "\n") index += 1;
      continue;
    }
    break;
  }
  return { text: text.slice(start, index), next: index };
};

const commasOutsideComments = (trivia: string): string =>
  trivia
    .split("\n")
    .map((part) => {
      const comment = part.indexOf("#");
      if (comment < 0) return part.replaceAll(",", "");
      return `${part.slice(0, comment).replaceAll(",", "")}${part.slice(comment)}`;
    })
    .join("\n");

const hasSeparatorComma = (trivia: string): boolean =>
  trivia.split("\n").some((part) => {
    const comment = part.indexOf("#");
    const code = comment < 0 ? part : part.slice(0, comment);
    return code.includes(",");
  });

/**
 * Replace or remove `serverKey` inside one `{ ... }` table. A closed inline
 * table cannot later grow a `[mcp_servers.rea]` header.
 */
const editInlineServerTable = (
  table: string,
  serverKey: string,
  entry: unknown,
):
  | { readonly text: string; readonly comments: readonly string[] }
  | undefined => {
  if (!table.startsWith("{")) return undefined;
  const end = endOfContainer(table, 0);
  if (table[end - 1] !== "}") return undefined;
  const pairs: InlinePair[] = [];
  const comments: string[] = [];
  let index = 1;
  let trailing = "";
  while (index < end - 1) {
    const trivia = readTrivia(table, index, end - 1);
    if (trivia.next >= end - 1) {
      trailing = trivia.text;
      break;
    }
    const key = parseKeyPath(table, trivia.next);
    if (key === undefined) return undefined;
    const equals = skipWsAndComments(table, key.next);
    if (table[equals] !== "=") return undefined;
    const valueEnd = endOfTomlValue(table, equals + 1);
    if (valueEnd > end - 1) return undefined;
    const pairText = table.slice(trivia.next, valueEnd);
    const drop = key.segments[0] === serverKey;
    if (drop)
      for (const comment of tomlCommentLines(pairText)) comments.push(comment);
    pairs.push({
      leading: trivia.text,
      text: pairText,
      drop,
    });
    index = valueEnd;
  }
  const insertion =
    entry === undefined
      ? undefined
      : `${tomlInlineKey(serverKey)} = ${tomlInlineValue(entry)}`;
  if (insertion === undefined && pairs.every((pair) => !pair.drop))
    return { text: table, comments };
  return { text: rebuildInlineTable(pairs, trailing, insertion), comments };
};

const rebuildInlineTable = (
  pairs: readonly InlinePair[],
  trailing: string,
  insertion: string | undefined,
): string => rebuildDelimitedEntries(pairs, trailing, insertion, "{", "}");

/**
 * Rebuild `{ ... }` or `[ ... ]` after dropping entries. An empty container
 * keeps comment trivia; a table with no comments stays `{}`.
 */
const rebuildDelimitedEntries = (
  pairs: readonly InlinePair[],
  trailing: string,
  insertion: string | undefined,
  open: "{" | "[",
  close: "}" | "]",
): string => {
  const parts: string[] = [open];
  let emitted = false;
  // A comma already emitted in a dropped pair's comment trivia.
  let separatorPending = false;
  for (const pair of pairs) {
    if (pair.drop) {
      if (!pair.leading.includes("#")) continue;
      // A separator already emitted must not be repeated for the next field.
      const dropped: string =
        !emitted || separatorPending
          ? commasOutsideComments(pair.leading)
          : pair.leading;
      parts.push(dropped);
      separatorPending = separatorPending || hasSeparatorComma(dropped);
      continue;
    }
    const kept = emitted ? pair.leading : commasOutsideComments(pair.leading);
    parts.push(separatorPending ? commasOutsideComments(kept) : kept);
    if (emitted && !separatorPending && !pair.leading.includes(","))
      parts.push(", ");
    separatorPending = false;
    parts.push(pair.text);
    emitted = true;
  }
  if (insertion !== undefined) {
    if (!(emitted && separatorPending)) parts.push(emitted ? ", " : " ");
    parts.push(insertion);
    emitted = true;
  }
  if (!emitted) {
    const retained = `${parts.slice(1).join("")}${commasOutsideComments(trailing)}`;
    return retained.includes("#")
      ? `${open}${retained}${close}`
      : `${open}${close}`;
  }
  const tail = commasOutsideComments(trailing);
  parts.push(tail);
  if (tail === "" && open === "{") parts.push(" ");
  parts.push(close);
  return parts.join("");
};

/**
 * Decoded TOML string, or undefined when the token is not a string.
 * The document parser accepts multiline basic and literal strings.
 */
const tomlStringValue = (text: string): string | undefined => {
  try {
    const value = parseClientToml(`value = ${text}`)["value"];
    return typeof value === "string" ? value : undefined;
  } catch (cause: unknown) {
    void cause;
    return undefined;
  }
};

/**
 * Array text with `serverKey` removed. `""` means the assignment itself can
 * be deleted. Undefined when the array cannot be edited safely.
 */
const tomlArrayWithoutString = (
  array: string,
  serverKey: string,
): string | undefined => {
  if (!array.startsWith("[")) return undefined;
  const end = endOfContainer(array, 0);
  if (end !== array.length || array[end - 1] !== "]") return undefined;
  const pairs: InlinePair[] = [];
  let index = 1;
  let trailing = "";
  while (index < end - 1) {
    const trivia = readTrivia(array, index, end - 1);
    if (trivia.next >= end - 1) {
      trailing = trivia.text;
      break;
    }
    const valueEnd = endOfTomlValue(array, trivia.next);
    if (valueEnd > end - 1) return undefined;
    const text = array.slice(trivia.next, valueEnd);
    pairs.push({
      leading: trivia.text,
      text,
      drop: tomlStringValue(text) === serverKey,
    });
    index = valueEnd;
  }
  if (pairs.every((pair) => !pair.drop)) return array;
  const rebuilt = rebuildDelimitedEntries(pairs, trailing, undefined, "[", "]");
  return rebuilt === "[]" ? "" : rebuilt;
};

type DisabledServerListEdit =
  | { readonly kind: "ignore" }
  | { readonly kind: "keep" }
  | { readonly kind: "delete"; readonly comment: string | undefined }
  | { readonly kind: "replace"; readonly text: string };

interface DisabledServerListInput {
  readonly text: string;
  readonly lineStart: number;
  readonly valueOffset: number;
  readonly valueEnd: number;
  readonly statementEnd: number;
  readonly tablePath: readonly string[];
  readonly segments: readonly string[];
  readonly serverKey: string;
  readonly entry: unknown;
}

/** Drop `serverKey` from a root `disabled_mcp_servers` array while installing. */
const disabledServerListEdit = (
  input: DisabledServerListInput,
): DisabledServerListEdit => {
  if (
    input.entry === undefined ||
    input.tablePath.length !== 0 ||
    input.segments.length !== 1 ||
    input.segments[0] !== "disabled_mcp_servers"
  )
    return { kind: "ignore" };
  const open = skipWsAndComments(input.text, input.valueOffset);
  if (input.text[open] !== "[") return { kind: "ignore" };
  const arrayText = input.text.slice(open, input.valueEnd);
  const edited = tomlArrayWithoutString(arrayText, input.serverKey);
  if (edited === undefined || edited === arrayText) return { kind: "keep" };
  if (edited === "") {
    const suffix = input.text.slice(input.valueEnd, input.statementEnd);
    const hash = suffix.indexOf("#");
    return {
      kind: "delete",
      comment: hash < 0 ? undefined : suffix.slice(hash),
    };
  }
  return {
    kind: "replace",
    text: `${input.text.slice(input.lineStart, open)}${edited}${input.text.slice(input.valueEnd, input.statementEnd)}`,
  };
};

/** Lines that replace a disabled-server assignment, or undefined to leave it. */
const disabledServerListLines = (
  edit: DisabledServerListEdit,
  lines: readonly string[],
  lineIndex: number,
  endLine: number,
): readonly string[] | undefined => {
  switch (edit.kind) {
    case "ignore":
      return undefined;
    case "keep":
      return lines.slice(lineIndex, endLine + 1);
    case "replace":
      return edit.text.split("\n");
    case "delete":
      return edit.comment === undefined ? [] : [edit.comment];
    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
};

/** Strip terminal LF without rescanning internal blank-line runs. */
const withoutTrailingLineFeeds = (text: string): string => {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
  return text.slice(0, end);
};

/** Retain comment trivia from removed code without promoting string contents. */
const tomlCommentLines = (text: string): readonly string[] => {
  const comments: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('"""', index) || text.startsWith("'''", index)) {
      const basic = text[index] === '"';
      index =
        closeMultiline(text, index + 3, basic ? '"""' : "'''", basic) ??
        text.length;
    } else if (text[index] === '"' || text[index] === "'") {
      index = parseQuotedKey(text, index)?.next ?? text.length;
    } else if (text[index] === "#") {
      const end = text.indexOf("\n", index);
      comments.push(text.slice(index, end < 0 ? text.length : end));
      index = end < 0 ? text.length : end + 1;
    } else index += 1;
  }
  return comments;
};

/**
 * Replace REA's TOML server tables and assignments. Every comment line stays
 * where it was, including comments before, inside, and after REA's own table;
 * inline comments on replaced code become standalone comment lines.
 * Only blank lines that separated a removed table go with it. Text inside
 * strings is not treated as a header. Only Grok Build reads the root
 * `disabled_mcp_servers` list that registration also edits.
 */
const upsertTomlServerSection = (
  originalText: string,
  serverKey: string,
  entry: unknown,
  format: "toml" | "grok",
): string => {
  // smol-toml accepts a leading BOM. Leave it in place or the first header is missed.
  const bom = originalText.startsWith("\uFEFF");
  const source = bom ? originalText.slice(1) : originalText;
  // Keep a preceding \r on each line. Rewriting \r\n in the whole file would
  // change string values. A file whose every break is CRLF gets a CRLF section.
  const crlf =
    source.includes("\r\n") && !source.replaceAll("\r\n", "").includes("\n");
  const text = source;
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }
  const kept: string[] = [];
  // Blank lines held until the next statement shows whether they belong to a
  // removed REA table. Comments are user text and are never held.
  const pending: string[] = [];
  let skipping = false;
  let inlineServerTable = false;
  let mode: TomlStringMode = "none";
  let tablePath: readonly string[] = [];
  const discardPending = (): void => {
    pending.length = 0;
  };
  // Document line counts must not become engine-limited argument counts.
  const appendLines = (lines: readonly string[]): void => {
    for (const line of lines) kept.push(line);
  };
  const flushPending = (): void => {
    appendLines(pending);
    pending.length = 0;
  };
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const physical = lines[lineIndex] ?? "";
    const line = physical.endsWith("\r") ? physical.slice(0, -1) : physical;
    if (mode !== "none") {
      mode = tomlStringModeAfter(line, mode);
      if (skipping) discardPending();
      else kept.push(physical);
      lineIndex += 1;
      continue;
    }
    const header = parseTomlTableHeader(line);
    if (header !== undefined) {
      tablePath = header.path;
      if (isTomlServerTable(header.path, serverKey)) {
        discardPending();
        appendLines(tomlCommentLines(physical));
        skipping = true;
        lineIndex += 1;
        continue;
      }
      skipping = false;
      flushPending();
      kept.push(physical);
      lineIndex += 1;
      continue;
    }
    const assignment = parseAssignment(line);
    if (assignment !== undefined) {
      const lineStart = lineStarts[lineIndex] ?? 0;
      const valueOffset = lineStart + assignment.equals + 1;
      const valueEnd = endOfTomlValue(text, valueOffset);
      let statementEnd = valueEnd;
      while (statementEnd < text.length && text[statementEnd] !== "\n")
        statementEnd += 1;
      const lastOffset = Math.max(statementEnd - 1, lineStart);
      let endLine = lineIndex;
      // Statements advance through the source; only inspect their own lines.
      while (
        endLine + 1 < lineStarts.length &&
        (lineStarts[endLine + 1] ?? 0) <= lastOffset
      )
        endLine += 1;
      if (skipping) {
        discardPending();
        appendLines(tomlCommentLines(text.slice(lineStart, statementEnd)));
        lineIndex = endLine + 1;
        mode = "none";
        continue;
      }
      const disabledLines =
        format === "grok"
          ? disabledServerListLines(
              disabledServerListEdit({
                text,
                lineStart,
                valueOffset,
                valueEnd,
                statementEnd,
                tablePath,
                segments: assignment.segments,
                serverKey,
                entry,
              }),
              lines,
              lineIndex,
              endLine,
            )
          : undefined;
      if (disabledLines !== undefined) {
        flushPending();
        appendLines(disabledLines);
        lineIndex = endLine + 1;
        mode = "none";
        continue;
      }
      const absolute = [...tablePath, ...assignment.segments];
      const open = skipWsAndComments(text, valueOffset);
      const closesServerTable =
        absolute.length === 1 &&
        absolute[0] === "mcp_servers" &&
        text[open] === "{";
      if (closesServerTable || isTomlServerTable(absolute, serverKey)) {
        if (closesServerTable) {
          flushPending();
          const edited = editInlineServerTable(
            text.slice(open, valueEnd),
            serverKey,
            entry,
          );
          const prefix = text.slice(lineStart, open);
          const suffix = text.slice(valueEnd, statementEnd);
          const replacement =
            edited === undefined
              ? text.slice(lineStart, statementEnd)
              : `${prefix}${edited.text}${suffix}`;
          appendLines(replacement.split("\n"));
          // TOML 1.0 inline tables cannot gain standalone comments between
          // their fields. Retain removed value comments after the assignment.
          if (edited !== undefined) appendLines(edited.comments);
          inlineServerTable = true;
        } else {
          discardPending();
          appendLines(tomlCommentLines(text.slice(lineStart, statementEnd)));
        }
      } else {
        flushPending();
        for (let index = lineIndex; index <= endLine; index += 1)
          kept.push(lines[index] ?? "");
      }
      lineIndex = endLine + 1;
      mode = "none";
      continue;
    }
    if (isBlankOrComment(line)) {
      if (line.trimStart().startsWith("#")) {
        flushPending();
        kept.push(physical);
      } else pending.push(physical);
      lineIndex += 1;
      continue;
    }
    mode = tomlStringModeAfter(line, "none");
    if (skipping) {
      if (looksLikeTomlHeader(line)) {
        flushPending();
        skipping = false;
        tablePath = ["\0"];
        kept.push(physical);
      } else discardPending();
    } else {
      flushPending();
      kept.push(physical);
    }
    lineIndex += 1;
  }
  if (!skipping) flushPending();
  let body = kept.join("\n");
  // The last kept CRLF line has no following LF from the join.
  if (body.endsWith("\r")) body += "\n";
  if (entry !== undefined && !inlineServerTable) {
    let fragment = withoutTrailingLineFeeds(
      stringifyToml({ mcp_servers: { [serverKey]: entry } }),
    );
    if (crlf) fragment = fragment.replaceAll("\n", "\r\n");
    const nl = crlf ? "\r\n" : "\n";
    const endedWithNewline = body.endsWith("\n");
    const base = withoutTrailingLineFeeds(body);
    const trimmed =
      endedWithNewline && base.endsWith("\r") ? base.slice(0, -1) : base;
    body =
      trimmed.length === 0
        ? `${fragment}${nl}`
        : `${trimmed}${nl}${nl}${fragment}${nl}`;
  }
  // Removing a final table also drops the file's last line break.
  if (originalText.endsWith("\n") && !body.endsWith("\n"))
    body += originalText.endsWith("\r\n") ? "\r\n" : "\n";
  return bom ? `\uFEFF${body}` : body;
};

const tomlServerEntry = (
  document: Record<string, unknown>,
  serverKey: string,
): unknown => {
  const servers = clientConfigurationRecordSchema.safeParse(
    document.mcp_servers,
  );
  if (!servers.success || !Object.hasOwn(servers.data, serverKey))
    return undefined;
  return servers.data[serverKey];
};

/** Whether Grok Build's root disable list names `serverKey`. */
const grokServerListedDisabled = (
  document: Record<string, unknown>,
  serverKey: string,
): boolean =>
  Array.isArray(document.disabled_mcp_servers) &&
  document.disabled_mcp_servers.includes(serverKey);

/**
 * OMP's user `disabledServers` denylist hides a server by name regardless of
 * its entry, so a listed REA registration is not loaded.
 */
export const OMP_DISABLED_SERVERS_KEY = "disabledServers";

/** Whether OMP's root `disabledServers` denylist names `serverKey`. */
const ompServerListedDisabled = (
  document: Record<string, unknown>,
  serverKey: string,
): boolean => {
  const listed = document[OMP_DISABLED_SERVERS_KEY];
  return Array.isArray(listed) && listed.includes(serverKey);
};

/** OMP's user `enabledServers` allowlist overrides an entry's `enabled: false`. */
const OMP_ENABLED_SERVERS_KEY = "enabledServers";

/**
 * Whether OMP's allowlist forces `serverKey` on despite its entry's
 * `enabled: false`. The `disabledServers` denylist still wins over it.
 */
export const clientServerForcedEnabled = (
  parsed: ClientConfigurationDocument,
  serverKey: string,
): boolean => {
  if (parsed.dialect !== "omp") return false;
  const listed = parsed.document[OMP_ENABLED_SERVERS_KEY];
  return Array.isArray(listed) && listed.includes(serverKey);
};

/** Whether a client's own disable list suppresses `serverKey`. */
export const clientServerListedDisabled = (
  parsed: ClientConfigurationDocument,
  serverKey: string,
): boolean =>
  (parsed.dialect === "grok" &&
    grokServerListedDisabled(parsed.document, serverKey)) ||
  (parsed.dialect === "omp" &&
    ompServerListedDisabled(parsed.document, serverKey));

/** Keep an existing Grok document intact aside from the REA server tables. */
const serializeGrokConfiguration = (
  document: Record<string, unknown>,
  originalText: string | undefined,
): string => {
  const entry = tomlServerEntry(document, PRODUCT_IDENTITY.mcpServerKey);
  if (originalText === undefined) return stringifyToml(document);
  return upsertTomlServerSection(
    originalText,
    PRODUCT_IDENTITY.mcpServerKey,
    entry,
    "grok",
  );
};

/** Removing the last server leaves an empty table, which equals an absent one. */
const withoutEmptyServerTable = (
  document: Record<string, unknown>,
): Record<string, unknown> => {
  const servers = clientConfigurationRecordSchema.safeParse(
    document.mcp_servers,
  );
  if (!servers.success || Object.keys(servers.data).length > 0) return document;
  const { mcp_servers: empty, ...rest } = document;
  void empty;
  return rest;
};

/**
 * Keep an existing Codex document intact aside from the REA server tables.
 * An edit that would change any other parsed value falls back to a full
 * rewrite, which keeps every value but not comments or spelling.
 */
const serializeCodexConfiguration = (
  document: Record<string, unknown>,
  originalText: string | undefined,
): string => {
  if (
    originalText === undefined ||
    isEmptyClientConfigurationText(originalText)
  )
    return stringifyToml(document);
  const edited = upsertTomlServerSection(
    originalText,
    PRODUCT_IDENTITY.mcpServerKey,
    tomlServerEntry(document, PRODUCT_IDENTITY.mcpServerKey),
    "toml",
  );
  return tomlTextHolds(edited, document) ? edited : stringifyToml(document);
};

const tomlTextHolds = (
  text: string,
  document: Record<string, unknown>,
): boolean => {
  try {
    return clientConfigurationValuesEqual(
      withoutEmptyServerTable(
        clientConfigurationRecordSchema.parse(parseClientToml(text)),
      ),
      withoutEmptyServerTable(document),
    );
  } catch (cause: unknown) {
    // An unparsable edit is rejected in favor of the full rewrite.
    void cause;
    return false;
  }
};

// jsonc-parser declares SyntaxKind as an ambient const enum, so keep its token
// code local and type-checked as in the JSON scanner used by IDA diagnostics.
const JSON_COMMA = 5 satisfies SyntaxKind;

/** Find the next non-trivia JSONC token at or after `offset`. */
const nextJsoncToken = (
  text: string,
  offset: number,
): { readonly kind: SyntaxKind; readonly offset: number } => {
  const scanner = createScanner(text, true);
  scanner.setPosition(offset);
  const kind = scanner.scan();
  return { kind, offset: scanner.getTokenOffset() };
};

const isJsonMember = (property: Node, key: string): boolean =>
  property.children?.length === 2 && property.children[0]?.value === key;

/**
 * The property a client reads for `key`. `JSON.parse` and JSONC `parse` keep
 * the last duplicate member, while jsonc-parser's `findNodeAtLocation` and
 * `modify` select the first, so JSON text edits locate members only here.
 */
const effectiveJsonProperty = (object: Node, key: string): Node | undefined =>
  object.children?.findLast((property) => isJsonMember(property, key));

/** The object a client reads at `path`, following the effective members. */
const effectiveJsonObject = (
  root: Node | undefined,
  path: readonly string[],
): Node | undefined => {
  let node = root;
  for (const key of path) {
    if (node?.type !== "object") return undefined;
    node = effectiveJsonProperty(node, key)?.children?.[1];
  }
  return node?.type === "object" ? node : undefined;
};

/**
 * Earlier members of one server name repeated in the tables a client reads,
 * in document order. Parsing keeps only the last member, as clients do.
 */
export interface ShadowedClientServers {
  readonly servers: readonly unknown[];
  /** Repeats among OpenCode V1 members beside a native V2 table. */
  readonly legacyServers: readonly unknown[];
}

const NO_SHADOWED_SERVERS: ShadowedClientServers = Object.freeze({
  servers: [],
  legacyServers: [],
});

// Token codes follow the pinned jsonc-parser scanner, as JSON_COMMA does.
const JSON_STRING = 10 satisfies SyntaxKind;
const JSON_EOF = 17 satisfies SyntaxKind;

/** A conservative duplicate check using the parser's own string decoder. */
const hasRepeatedJsonString = (text: string, name: string): boolean => {
  const scanner = createScanner(text, true);
  let matches = 0;
  for (let token = scanner.scan(); token !== JSON_EOF; token = scanner.scan()) {
    if (token === JSON_STRING && scanner.getTokenValue() === name) {
      matches += 1;
      if (matches === 2) return true;
    }
  }
  return false;
};

/** Values of the earlier members named `name` in `object`. */
const shadowedJsonMembers = (
  object: Node | undefined,
  name: string,
): readonly unknown[] =>
  (object?.children ?? [])
    .filter((property) => isJsonMember(property, name))
    .slice(0, -1)
    .map((property): unknown => {
      const value = property.children?.[1];
      return value === undefined ? undefined : getNodeValue(value);
    });

/**
 * Earlier members of `name` that removing its effective entry would make
 * effective, so a removal decision must cover them too. Locating them needs a
 * syntax tree of the whole document, which is built only when the name's
 * string token occurs more than once.
 */
export const shadowedClientServers = (
  text: string,
  parsed: ClientConfigurationDocument,
  name: string,
): ShadowedClientServers => {
  // TOML rejects repeated keys, Hermes parses YAML with unique keys, and the
  // Harness owner edits REA's entry by id rather than through a server table.
  if (
    parsed.dialect === "toml" ||
    parsed.dialect === "grok" ||
    parsed.dialect === "hermes" ||
    parsed.dialect === "dsh" ||
    !hasRepeatedJsonString(text, name)
  )
    return NO_SHADOWED_SERVERS;
  const root = parseTree(text, [], { allowTrailingComma: true });
  return {
    servers: shadowedJsonMembers(
      effectiveJsonObject(root, parsed.serversPath),
      name,
    ),
    legacyServers:
      parsed.dialect === "opencode_v2" && !OPENCODE_V2_MCP_SETTINGS.has(name)
        ? shadowedJsonMembers(
            effectiveJsonObject(root, parsed.serversPath.slice(0, 1)),
            name,
          )
        : [],
  };
};

/** Apply one edit and format the lines it touched, as `modify` does. */
const applyFormattedJsonEdit = (text: string, edit: Edit): string => {
  const edited = applyEdits(text, [edit]);
  let begin = edit.offset;
  let end = edit.offset + edit.content.length;
  if (edit.length === 0) {
    while (begin > 0 && !"\r\n".includes(edited.charAt(begin - 1))) begin -= 1;
    while (end < edited.length && !"\r\n".includes(edited.charAt(end)))
      end += 1;
  }
  return applyEdits(
    edited,
    formatJson(
      edited,
      { offset: begin, length: end - begin },
      { insertSpaces: true, tabSize: 2, eol: "\n", keepLines: false },
    ),
  );
};

/** Remove selected member spans and only the separators needed by kept members. */
const deleteJsonMembers = (
  text: string,
  object: Node,
  properties: readonly Node[],
): string => {
  const siblings = object.children ?? [];
  const removed = new Set(properties);
  const anyKept = siblings.some((member) => !removed.has(member));
  const edits: Edit[] = [];
  let earlierKept = false;
  for (const [index, member] of siblings.entries()) {
    if (removed.has(member))
      edits.push({ offset: member.offset, length: member.length, content: "" });
    else earlierKept = true;
    const separator = nextJsoncToken(text, member.offset + member.length);
    const next = siblings[index + 1];
    if (separator.kind !== JSON_COMMA && next !== undefined)
      throw new TypeError("JSON property separator was not found");
    // Keep the separator before the next retained member, matching the
    // existing single-member deletion rule. JSONC may retain a trailing comma.
    const keepSeparator =
      next === undefined ? anyKept : earlierKept && !removed.has(next);
    if (separator.kind === JSON_COMMA && !keepSeparator)
      edits.push({ offset: separator.offset, length: 1, content: "" });
  }
  return applyEdits(text, edits);
};

/** A JSON edit refused because it would activate a shadowed duplicate member. */
export interface ClientConfigurationShadowedMember {
  readonly kind: "shadowed_member";
  /** Key path of the effective member whose removal was refused. */
  readonly path: readonly string[];
}

/**
 * Set or delete the member a client reads at `path`, keeping every byte
 * outside that member. Shadowed duplicates stay in place, and deleting a
 * member that shadows one is refused so the earlier member never becomes
 * active, unless the caller has established removal authority for that path.
 */
const editJsonMember = (
  text: string,
  path: readonly string[],
  value: unknown,
  removeShadowedMembers: boolean,
): Result<string, ClientConfigurationShadowedMember> => {
  let object = parseTree(text, [], { allowTrailingComma: true });
  for (const [index, key] of path.entries()) {
    if (object?.type !== "object")
      throw new TypeError("JSON edit parent is not an object");
    const property = effectiveJsonProperty(object, key);
    const member = property?.children?.[1];
    if (property === undefined || member === undefined) {
      if (value === undefined) return ok(text);
      const content = `${JSON.stringify(key)}: ${JSON.stringify(
        path
          .slice(index + 1)
          .reduceRight<unknown>((nested, name) => ({ [name]: nested }), value),
      )}`;
      const previous = object.children?.at(-1);
      return ok(
        applyFormattedJsonEdit(
          text,
          previous === undefined
            ? { offset: object.offset + 1, length: 0, content }
            : {
                offset: previous.offset + previous.length,
                length: 0,
                content: `,${content}`,
              },
        ),
      );
    }
    if (index < path.length - 1) {
      object = member;
      continue;
    }
    if (value !== undefined)
      return ok(
        applyFormattedJsonEdit(text, {
          offset: member.offset,
          length: member.length,
          content: JSON.stringify(value),
        }),
      );
    if (
      object.children?.some(
        (sibling) => sibling !== property && isJsonMember(sibling, key),
      )
    )
      return removeShadowedMembers
        ? ok(
            deleteJsonMembers(
              text,
              object,
              (object.children ?? []).filter((sibling) =>
                isJsonMember(sibling, key),
              ),
            ),
          )
        : err({ kind: "shadowed_member", path });
    return ok(deleteJsonMembers(text, object, [property]));
  }
  throw new TypeError("JSON edit path is empty");
};

/** Edit authority beyond the members a client reads. */
export interface ClientConfigurationEditOptions {
  /**
   * Exact deleted paths whose repeated members the caller may remove.
   * Uninstall must establish ownership of every shadowed member; setup may
   * grant replacement authority for an explicitly superseded registration.
   */
  readonly removeShadowedMembersAt?: readonly (readonly string[])[];
}

/**
 * Serialize a validated client document, retaining JSONC and TOML comments.
 * JSON edits fail only when they would activate a shadowed duplicate member.
 */
export const serializeClientConfiguration = (
  document: Record<string, unknown>,
  format: ClientConfigurationFormat | undefined,
  originalText?: string,
  editedPaths?: readonly (readonly string[])[],
  options: ClientConfigurationEditOptions = {},
): Result<string, ClientConfigurationShadowedMember> => {
  if (format === undefined || format === "unsupported")
    throw new TypeError("client does not have a supported MCP config format");
  if (format === "toml")
    return ok(serializeCodexConfiguration(document, originalText));
  if (format === "grok")
    return ok(serializeGrokConfiguration(document, originalText));
  if (format === "hermes")
    return ok(serializeHermesConfiguration(document, originalText));
  if (format === "dsh") return ok(serializeDshDocument(document));
  // An empty original holds no comments or settings to preserve. Writing a
  // fresh document also keeps a lone BOM from shifting past the closing brace.
  if (
    originalText === undefined ||
    isEmptyClientConfigurationText(originalText) ||
    editedPaths === undefined
  )
    return ok(`${JSON.stringify(document, null, 2)}\n`);
  let text = originalText;
  for (const path of editedPaths) {
    const edited = editJsonMember(
      text,
      path,
      valueAt(document, path),
      options.removeShadowedMembersAt?.some(
        (allowed) =>
          allowed.length === path.length &&
          allowed.every((key, index) => key === path[index]),
      ) ?? false,
    );
    if (!edited.ok) return edited;
    text = edited.value;
  }
  return ok(text);
};

/** Key path of a named registration in the server table. */
export const clientServerPath = (
  parsed: ClientConfigurationDocument,
  name: string,
): string[] => [...parsed.serversPath, name];

/** Key path of a present OpenCode V1 entry beside a native V2 table. */
export const legacyClientServerPath = (
  parsed: ClientConfigurationDocument,
  name: string,
): string[] | undefined =>
  Object.hasOwn(parsed.legacyServers, name)
    ? [parsed.serversPath[0] ?? "mcp", name]
    : undefined;

/**
 * Keep an existing Hermes `config.yaml` intact aside from the REA server entry.
 * Hermes config files carry user comments and unrelated settings, so the rea
 * entry is upserted into the parsed YAML document (which retains formatting and
 * comments) rather than re-serializing the whole object.
 */
const serializeHermesConfiguration = (
  document: Record<string, unknown>,
  originalText: string | undefined,
): string => {
  if (
    originalText === undefined ||
    isEmptyClientConfigurationText(originalText)
  )
    return stringifyHermesConfigurationYaml(document);
  const serversKey = clientConfigurationServersKey("hermes");
  const servers = document[serversKey];
  const entry =
    typeof servers === "object" && servers !== null
      ? (servers as Record<string, unknown>)[PRODUCT_IDENTITY.mcpServerKey]
      : undefined;
  return editHermesConfigurationYaml(
    originalText,
    [serversKey, PRODUCT_IDENTITY.mcpServerKey],
    entry,
  );
};

/** Build the stdio entry shape expected by one client's configuration dialect. */
export const clientRegistrationEntry = (
  format: ClientRegistrationDialect,
  command: readonly string[],
  environment: Readonly<Record<string, string>>,
): Record<string, unknown> => {
  const [executable = "rea", ...args] = command;
  switch (format) {
    case "opencode":
      return {
        type: "local",
        command: [...command],
        enabled: true,
        ...(Object.keys(environment).length === 0
          ? {}
          : { environment: { ...environment } }),
      };
    case "kimi":
      // Kimi infers stdio from command; it uses `transport`, not `type`.
      return {
        command: executable,
        args,
        ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
      };
    case "opencode_v2":
      // Override lower-priority disabled flags when refreshing a V2 registration.
      return {
        type: "local",
        command: [...command],
        disabled: false,
        ...(Object.keys(environment).length === 0
          ? {}
          : { environment: { ...environment } }),
      };
    case "vscode":
    case "omp":
    case "pi":
      return {
        type: "stdio",
        command: executable,
        args,
        ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
      };
    case "copilot_cli":
      return {
        type: "stdio",
        command: executable,
        args,
        tools: ["*"],
        ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
      };
    case "commandcode":
      return {
        transport: "stdio",
        enabled: true,
        command: executable,
        args,
        ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
      };
    case "dsh":
      return dshClientRegistrationEntry(command, environment);
    case "hermes":
      // Hermes reads stdio servers from `mcp_servers.<name>` and connects them
      // unless `enabled` is false, so the entry states it explicitly.
      return {
        command: executable,
        args,
        ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
        enabled: true,
      };
    default:
      return {
        command: executable,
        args,
        ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
      };
  }
};

/** Parse one Gemini policy at its source boundary before consolidating scopes. */
export const parseGeminiMcpPolicy = (parsed: ClientConfigurationDocument) =>
  z
    .object({
      allowed: z.array(z.string()).optional(),
      excluded: z.array(z.string()).optional(),
    })
    .passthrough()
    .parse(parsed.document.mcp ?? {});

/** One server-name comparison for the exclusion, intersection and membership rules below. */
const normalizeGeminiServerName = (name: string): string =>
  name.toLowerCase().trim();

/** Gemini consolidates excludes by union and allowlists by normalized intersection. */
export const geminiServerPolicyBlock = (
  policies: readonly ReturnType<typeof parseGeminiMcpPolicy>[],
  serverKey: string,
): string | undefined => {
  // Hand-authored settings cannot be assumed to spell the product key exactly,
  // so every rule compares normalized names. Testing the consolidated list
  // against the raw key instead would make the outcome depend on which policy
  // supplied the spelling that survived the intersection.
  const key = normalizeGeminiServerName(serverKey);
  if (
    policies.some(({ excluded }) =>
      excluded?.some((name) => normalizeGeminiServerName(name) === key),
    )
  )
    return `Gemini mcp.excluded blocks ${serverKey}. Review the selected settings policies before rerunning setup.`;
  const allowlists = policies.flatMap(({ allowed }) =>
    allowed === undefined ? [] : [allowed],
  );
  const allowed = allowlists.reduce<string[] | undefined>(
    (previous, current) => {
      if (previous === undefined) return current;
      const normalized = new Set(current.map(normalizeGeminiServerName));
      return previous.filter((name) =>
        normalized.has(normalizeGeminiServerName(name)),
      );
    },
    undefined,
  );
  // Gemini's manager applies the consolidated allowlist only when nonempty.
  if (
    allowed !== undefined &&
    allowed.length > 0 &&
    !allowed.some((name) => normalizeGeminiServerName(name) === key)
  )
    return `Gemini mcp.allowed does not include ${serverKey}. Review the selected settings policies before rerunning setup.`;
  return undefined;
};
