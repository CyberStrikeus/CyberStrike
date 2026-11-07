import { createHash } from "node:crypto";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import * as t from "@babel/types";

import type {
  JavaScriptBundlerRegistration,
  JavaScriptSourceRange,
  JavaScriptStaticAnalysis,
  JavaScriptStaticPathContext,
  JavaScriptStaticStorage,
} from "./javascriptStaticAnalysisTypes.js";
import {
  readExactJavaScriptLiteral,
  semanticStaticPropertyKey,
  semanticStaticPropertyName,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import type { JavaScriptOpenReceiverFact } from "./javascriptSemanticReceiverFacts.js";
import {
  compareUnicodeCodePoints,
  compositeKey,
} from "../unicodeCodePointOrder.js";
import { unexaminedJavaScriptStaticCoverage } from "./javascriptStaticCoverage.js";

/** Explicit result for source text that Babel cannot parse. */
export const failedJavaScriptStaticAnalysis = (): JavaScriptStaticAnalysis => ({
  parse_status: "failed",
  analysis_coverage: {
    ...unexaminedJavaScriptStaticCoverage(
      "JavaScript source could not be parsed.",
    ),
    syntax: { status: "failed", error_count: null },
  },
  parse_error_count: 1,
  visited_ast_nodes: 0,
  references: [],
  endpoints: [],
  storage: [],
  bundler_registrations: [],
  role_paths: [],
  source_map_urls: [],
  vendors: [],
  electron: {
    browser_windows: [],
    context_bridge_apis: [],
    ipc: [],
    sender_validations: [],
    utility_processes: [],
    native_addon_bindings: [],
    protocols: [],
  },
  limitations: [
    "JavaScript source could not be parsed; absence of findings is not evidence of absence.",
    "JavaScript syntax was parsed as data and was never evaluated.",
  ],
});

/** Normalize one Babel call/new argument into the inert node shared by inspectors. */
export const argumentNode = (
  argument:
    | t.Expression
    | t.SpreadElement
    | t.JSXNamespacedName
    | t.ArgumentPlaceholder
    | null
    | undefined,
): t.Node | undefined =>
  argument !== null && t.isNode(argument) ? argument : undefined;

/** Recognize the runtime name for a Webpack/Rspack push call. */
export const chunkRuntime = (call: t.CallExpression): string | undefined => {
  if (
    !t.isMemberExpression(call.callee) &&
    !t.isOptionalMemberExpression(call.callee)
  )
    return undefined;
  if (
    semanticStaticPropertyName(call.callee.property, call.callee.computed) !==
    "push"
  )
    return undefined;
  return findChunkRuntime(call.callee.object);
};

const findChunkRuntime = (node: t.Node): string | undefined => {
  const pending: t.Node[] = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    if (
      t.isIdentifier(current) &&
      /(?:webpack|rspack)Chunk/iu.test(current.name)
    )
      return current.name;
    if (
      t.isMemberExpression(current) ||
      t.isOptionalMemberExpression(current)
    ) {
      const property = semanticStaticPropertyName(
        current.property,
        current.computed,
      );
      if (/(?:webpack|rspack)Chunk/iu.test(property)) return property;
      if (t.isNode(current.object)) pending.push(current.object);
      continue;
    }
    if (t.isAssignmentExpression(current)) {
      pending.push(current.right, current.left);
      continue;
    }
    if (t.isLogicalExpression(current) || t.isBinaryExpression(current)) {
      pending.push(current.right, current.left);
      continue;
    }
    const unwrapped = unwrapJavaScriptExpression(current).node;
    if (unwrapped !== current) pending.push(unwrapped);
  }
  return undefined;
};

/** Return a literal function factory from one module-table property. */
export const moduleFactory = (
  property: t.ObjectMethod | t.ObjectProperty | t.SpreadElement,
):
  | t.FunctionExpression
  | t.ArrowFunctionExpression
  | t.ObjectMethod
  | undefined => {
  if (t.isObjectMethod(property)) return property;
  if (
    t.isObjectProperty(property) &&
    (t.isFunctionExpression(property.value) ||
      t.isArrowFunctionExpression(property.value))
  )
    return property.value;
  return undefined;
};

/** Derive a literal or explicitly computed module key. */
export const modulePropertyName = (
  property: t.ObjectMethod | t.ObjectProperty | t.SpreadElement,
): string => {
  if (!t.isObjectMethod(property) && !t.isObjectProperty(property))
    return `[unknown@${String(property.start ?? -1)}]`;
  const key = semanticStaticPropertyKey(property.key, property.computed);
  if (key !== null) return key;
  return property.computed
    ? `[computed@${String(property.start ?? -1)}]`
    : `[unknown@${String(property.start ?? -1)}]`;
};

/** Collect all unique static literal values from an array. */
export const staticArrayValues = (
  array: t.ArrayExpression,
): {
  readonly values: readonly string[];
  readonly unknown: number;
} => {
  const staticValues = array.elements.flatMap((element) => {
    const value = argumentValue(element);
    return value === undefined ? [] : [value];
  });
  const values = [...new Set(staticValues)].sort(compareUnicodeCodePoints);
  return {
    values,
    unknown: array.elements.length - staticValues.length,
  };
};

/** Classify whether inert path syntax is a module specifier or file expression. */
export type JavaScriptStaticPathIntrinsicQuery = (
  node: t.Node,
  fact?:
    | "resolve"
    | "join"
    | "file-url-to-path"
    | "source-url"
    | "source-directory",
) => boolean;

export const staticPathResolutionContext = (
  node: t.Node,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): JavaScriptStaticPathContext =>
  isFilesystemPathExpression(node, pathIntrinsics)
    ? "filesystem-expression"
    : "module-specifier";

interface StaticPathFact {
  readonly path: string;
  readonly base: "source-directory" | "literal-path" | "unknown";
}

/** Resolve a path string composed only from inert literal syntax. */
export const staticPath = (
  node: t.Node,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): string | undefined => staticPathFact(node, pathIntrinsics)?.path;

/** Parse spelling and its source-directory provenance together at the owning boundary. */
const staticPathFact = (
  raw: t.Node,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): StaticPathFact | undefined => {
  const node = unwrapJavaScriptExpression(raw).node;
  const value = stringValue(node);
  if (value !== undefined) return { path: value, base: "literal-path" };
  if (t.isBinaryExpression(node, { operator: "+" }))
    return staticConcatenation(node, pathIntrinsics);
  if (t.isCallExpression(node) || t.isNewExpression(node))
    return staticCallPath(node, pathIntrinsics);
  return undefined;
};

/** Admit file expressions only when the normalized spelling retains a proven base. */
export const staticFileExpressionPath = (
  node: t.Node,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
):
  | {
      readonly path: string;
      readonly base: "source-directory" | "literal-path";
    }
  | undefined => {
  const fact = staticPathFact(node, pathIntrinsics);
  return fact === undefined || fact.base === "unknown"
    ? undefined
    : { path: fact.path, base: fact.base };
};

/**
 * Concatenate inert text. A leading source directory contributes no text:
 * `__dirname + "/preload.js"` names a file inside it, while text without a
 * leading separator extends the directory's own name and stays unknown.
 */
const staticConcatenation = (
  node: t.BinaryExpression,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): StaticPathFact | undefined => {
  const operands: t.Node[] = [];
  let current: t.Node = node;
  while (t.isBinaryExpression(current, { operator: "+" })) {
    operands.push(current.right);
    current = unwrapJavaScriptExpression(current.left).node;
  }
  const anchored = isDirectoryPath(current, pathIntrinsics);
  if (!anchored) operands.push(current);
  let text = "";
  let literal = true;
  for (const operand of operands.reverse()) {
    const value = staticPathFact(operand, pathIntrinsics);
    if (value === undefined) return undefined;
    text += value.path;
    literal &&= value.base === "literal-path";
  }
  if (!anchored)
    return { path: text, base: literal ? "literal-path" : "unknown" };
  return text.startsWith("/")
    ? {
        path: posix.join(".", text),
        base: literal ? "source-directory" : "unknown",
      }
    : undefined;
};

const staticCallPath = (
  node: t.CallExpression | t.NewExpression,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): StaticPathFact | undefined => {
  if (t.isCallExpression(node) && pathIntrinsics?.(node.callee))
    return staticResolvedPath(node, pathIntrinsics);
  if (
    t.isCallExpression(node) &&
    pathIntrinsics?.(node.callee, "file-url-to-path")
  )
    return staticFileUrlPathFact(node, pathIntrinsics);
  if (!t.isCallExpression(node) || !pathIntrinsics?.(node.callee, "join"))
    return undefined;
  const parts: StaticPathFact[] = [];
  for (const argument of node.arguments) {
    if (isDirectoryPath(argumentNode(argument), pathIntrinsics)) {
      // join never resets at an absolute segment after the source directory.
      parts.push({ path: ".", base: "source-directory" });
      continue;
    }
    const value = t.isNode(argument)
      ? staticPathFact(argument, pathIntrinsics)
      : undefined;
    if (value === undefined) return undefined;
    parts.push(value);
  }
  if (parts.length === 0) return undefined;
  const first = parts.findIndex(({ path }) => path !== "");
  const sourceAnchors = parts.flatMap(({ base }, index) =>
    base === "source-directory" ? [index] : [],
  );
  const base = parts.some(({ base }) => base === "unknown")
    ? "unknown"
    : sourceAnchors.length === 0
      ? "literal-path"
      : sourceAnchors.length === 1 && sourceAnchors[0] === first
        ? "source-directory"
        : "unknown";
  return { path: posix.join(...parts.map(({ path }) => path)), base };
};

/** Normalized path facts from a source-relative file URL expression. */
export interface JavaScriptStaticSourceUrlPath {
  readonly path: string;
  readonly directory: boolean;
}

const staticFileUrlPathFact = (
  node: t.CallExpression | t.NewExpression,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): StaticPathFact | undefined => {
  if (node.arguments.length !== 1) return undefined;
  const rawArgument = argumentNode(node.arguments[0]);
  if (rawArgument === undefined) return undefined;
  const argument = unwrapJavaScriptExpression(rawArgument).node;
  if (t.isNewExpression(argument) && pathIntrinsics?.(argument, "source-url")) {
    const resolved = staticSourceRelativeUrlPath(argument);
    return resolved === undefined
      ? undefined
      : { path: resolved.path, base: "source-directory" };
  }
  const value = staticPath(argument, pathIntrinsics);
  const rawPath = value?.split(/[?#]/u, 1)[0] ?? "";
  if (
    value === undefined ||
    !/^file:/iu.test(value) ||
    value !== value.trim() ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    /%(?:2f|5c)/iu.test(rawPath)
  )
    return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return undefined;
    // Canonical analysis paths use POSIX spelling so results do not depend on
    // the analyzer host. Drive and UNC paths need an explicit target platform.
    const path = fileURLToPath(url, { windows: false });
    return /^\/[a-z]:/iu.test(path)
      ? undefined
      : { path, base: "literal-path" };
  } catch (cause: unknown) {
    void cause;
    return undefined;
  }
};

/** Decode a source-relative URL after the caller proves constructor and base identity. */
export const staticSourceRelativeUrlPath = (
  node: t.NewExpression,
): JavaScriptStaticSourceUrlPath | undefined => {
  const value = stringValue(node.arguments[0]);
  if (
    value === undefined ||
    (value.split(/[?#]/u, 1)[0] ?? "") === "" ||
    value !== value.trim() ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(value) ||
    value.startsWith("//") ||
    /%(?:2e|2f|5c)/iu.test(value.split(/[?#]/u, 1)[0] ?? "")
  )
    return undefined;
  // A sufficiently deep inert anchor preserves any leading parent segments
  // without using this host's cwd or inventing the application's directory.
  const directory = `/${"source/".repeat(value.split("/").length + 1)}`;
  try {
    const resolved = new URL(value, `file://${directory}entry.js`);
    const path = fileURLToPath(resolved, { windows: false });
    if (value.startsWith("/"))
      return { path, directory: resolved.pathname.endsWith("/") };
    const relative = posix.relative(directory, path) || ".";
    // Keep the established explicit source-directory observation spelling.
    return {
      path:
        value.startsWith("./") &&
        relative !== "." &&
        !relative.startsWith("../")
          ? `./${relative}`
          : relative,
      directory: resolved.pathname.endsWith("/"),
    };
  } catch (cause: unknown) {
    // Malformed escapes and non-file URL forms remain unknown.
    void cause;
    return undefined;
  }
};

const staticResolvedPath = (
  node: t.CallExpression | t.NewExpression,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): StaticPathFact | undefined => {
  const parts: string[] = [];
  let base: StaticPathFact["base"] | undefined;
  // Node walks right-to-left and never inspects arguments before its anchor.
  for (let index = node.arguments.length - 1; index >= 0; index -= 1) {
    const argument = node.arguments[index];
    if (isDirectoryPath(argumentNode(argument), pathIntrinsics)) {
      base = "source-directory";
      break;
    }
    const value = t.isNode(argument)
      ? staticPathFact(argument, pathIntrinsics)
      : undefined;
    if (value === undefined || value.base === "unknown") return undefined;
    parts.push(value.path);
    if (value.base === "source-directory" || posix.isAbsolute(value.path)) {
      base = value.base;
      break;
    }
  }
  // Relative-only calls depend on the target process cwd, which is unknown.
  if (base === undefined) return undefined;
  const path = posix.join(...parts.reverse());
  return { path: path === "/" ? path : path.replace(/\/$/u, ""), base };
};

const isFilesystemPathExpression = (
  node: t.Node,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): boolean => {
  node = unwrapJavaScriptExpression(node).node;
  const value = stringValue(node);
  if (value !== undefined) return value.startsWith("/");
  if (isFileIdentity(node) || isDirectoryPath(node, pathIntrinsics))
    return true;
  if (t.isBinaryExpression(node, { operator: "+" }))
    return (
      isFilesystemPathExpression(node.left, pathIntrinsics) ||
      isFilesystemPathExpression(node.right, pathIntrinsics)
    );
  if (t.isCallExpression(node) || t.isNewExpression(node)) {
    if (!t.isCallExpression(node)) return false;
    const native =
      pathIntrinsics?.(node.callee) ||
      pathIntrinsics?.(node.callee, "join") ||
      pathIntrinsics?.(node.callee, "file-url-to-path");
    return (
      native === true && staticCallPath(node, pathIntrinsics) !== undefined
    );
  }
  return false;
};

/** `__dirname` or the dirname of the source file, as a string. */
const isDirectoryPath = (
  node: t.Node | undefined,
  pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery,
): boolean => {
  if (node !== undefined) node = unwrapJavaScriptExpression(node).node;
  return (
    node !== undefined && pathIntrinsics?.(node, "source-directory") === true
  );
};

/** Whether the expression denotes the current module's URL. */
export const isImportMetaUrl = (node: t.Node | undefined): boolean => {
  if (node === undefined) return false;
  const expression = unwrapJavaScriptExpression(node).node;
  if (!t.isMemberExpression(expression)) return false;
  const object = unwrapJavaScriptExpression(expression.object).node;
  return (
    t.isMetaProperty(object) &&
    object.meta.name === "import" &&
    object.property.name === "meta" &&
    semanticStaticPropertyName(expression.property, expression.computed) ===
      "url"
  );
};

const isFileIdentity = (node: t.Node | undefined): boolean => {
  if (node !== undefined) node = unwrapJavaScriptExpression(node).node;
  if (t.isIdentifier(node, { name: "__filename" }) || isImportMetaUrl(node))
    return true;
  if (!t.isCallExpression(node)) return false;
  const name = calleeName(node.callee);
  return (
    (name === "fileURLToPath" || name.endsWith(".fileURLToPath")) &&
    isFileIdentity(argumentNode(node.arguments[0]))
  );
};

const XHR_METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

/** Legacy URL/path shapes that bypass the overloaded lookup exclusions. */
const isRequestUrlOrPathLiteral = (value: string): boolean =>
  /^(?:https?|wss?):\/\//iu.test(value) ||
  value.startsWith("/") ||
  value.startsWith("./") ||
  value.startsWith("../");

/** Explicit request references, classified after receiver-specific exclusions. */
const isRequestUrlReference = (value: string): boolean => {
  if (
    isRequestUrlOrPathLiteral(value) ||
    value.startsWith("?") ||
    value.startsWith("#")
  )
    return true;
  // WHATWG accepts HTTP/WS scheme forms without authority slashes. Parse
  // without a base so bare keys stay ambiguous, and keep the source spelling.
  if (!/^(?:https?|wss?):/iu.test(value)) return false;
  return URL.parse(value) !== null;
};

/**
 * Browsing-context and document `open` take a URL or type first and a target
 * name second. The name is only a spelling, since `parent` or `self` may be a
 * local XHR binding, so it never overrides a literal HTTP method.
 */
const WINDOW_OPEN_CALL =
  /(?:^|\.)(?:window|self|globalThis|top|parent|opener|frames|document)\.open$/u;

/** Node `fs.open` flag strings, which are never request URLs. */
const FS_OPEN_FLAGS = new Set([
  "a",
  "a+",
  "as",
  "as+",
  "ax",
  "ax+",
  "r",
  "r+",
  "rs",
  "rs+",
  "sa",
  "sa+",
  "sr",
  "sr+",
  "w",
  "w+",
  "wx",
  "wx+",
  "xa",
  "xa+",
  "xw",
  "xw+",
]);

/** Reserved browsing-context names (ASCII case-insensitive). */
const BROWSING_CONTEXT_KEYWORDS = new Set([
  "_blank",
  "_parent",
  "_self",
  "_top",
]);

/**
 * Read `XMLHttpRequest.open(method, url)`. `fs.open(path, "r")` and
 * `window.open(url, "_blank")` share the callee name. A literal method must
 * be an HTTP method; with a computed method, the second literal is a URL
 * unless it is provably an fs flag or a browsing-context keyword, or the
 * receiver is spelled as a browsing context or storage. XHR normalizes the standard
 * methods' case; extension methods such as WebDAV `PROPFIND` are
 * conventionally uppercase tokens.
 */
const xhrOpenUrl = (
  name: string,
  methodNode: t.Node | null | undefined,
  urlNode: t.Node | null | undefined,
  receiverFact?: JavaScriptOpenReceiverFact,
): string | undefined => {
  const url = stringValue(urlNode);
  if (url === undefined) return undefined;
  // A lexical fact is stronger than the receiver's spelling. In particular,
  // browser Window and Document globals overload `open` with URL/content APIs.
  if (receiverFact === "window") return undefined;
  const method = stringValue(methodNode);
  // IndexedDB and Cache Storage `open` take a name and a version, so a
  // receiver spelled as storage needs a standard HTTP method literal.
  const storage =
    receiverFact === "local-indexed-db" ||
    receiverFact === "local-cache-storage" ||
    receiverFact === "indexed-db" ||
    receiverFact === "cache-storage" ||
    storageKind(name) !== undefined;
  if (method === undefined)
    return storage ||
      (receiverFact === undefined && WINDOW_OPEN_CALL.test(name)) ||
      FS_OPEN_FLAGS.has(url) ||
      BROWSING_CONTEXT_KEYWORDS.has(url.toLowerCase())
      ? undefined
      : url;
  return XHR_METHODS.has(method.toUpperCase()) ||
    ((!storage ||
      receiverFact === "local-indexed-db" ||
      receiverFact === "local-cache-storage") &&
      /^[A-Z][A-Z-]*$/u.test(method))
    ? url
    : undefined;
};

const KEYED_COLLECTION_CONSTRUCTORS = new Set([
  "FormData",
  "Headers",
  "Map",
  "Set",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
]);

/**
 * Whether a get/delete receiver is spelled as a keyed collection: a
 * constructed Map, Set, Headers, FormData, or URLSearchParams, or a
 * `headers`/`searchParams` property. Spelling alone does not prove the
 * binding, so callers keep URL and path literals as requests.
 */
const isKeyedCollectionReceiver = (callee: t.Node): boolean => {
  callee = unwrapJavaScriptExpression(callee).node;
  if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee))
    return false;
  const receiver = unwrapJavaScriptExpression(callee.object).node;
  if (t.isNewExpression(receiver)) {
    const constructor = unwrapJavaScriptExpression(receiver.callee).node;
    return (
      t.isIdentifier(constructor) &&
      KEYED_COLLECTION_CONSTRUCTORS.has(constructor.name)
    );
  }
  if (
    !t.isMemberExpression(receiver) &&
    !t.isOptionalMemberExpression(receiver)
  )
    return false;
  const property = semanticStaticPropertyName(
    receiver.property,
    receiver.computed,
  );
  return (
    property === "headers" ||
    property === "headersList" ||
    property === "searchParams"
  );
};

/** A literal endpoint shape or an argument whose callee spelling is unproven. */
export interface JavaScriptEndpointArgument {
  readonly kind: "endpoint" | "candidate";
  readonly value: string;
}

/** Classify one literal without treating a generic method name as network identity. */
export const endpointArgument = (
  name: string,
  args: readonly (
    | t.Expression
    | t.SpreadElement
    | t.JSXNamespacedName
    | t.ArgumentPlaceholder
  )[],
  callee: t.Node,
  receiverFact?: JavaScriptOpenReceiverFact,
): JavaScriptEndpointArgument | undefined => {
  const candidate = (
    value: string | undefined,
  ): JavaScriptEndpointArgument | undefined =>
    value === undefined ? undefined : { kind: "candidate", value };
  if (receiverFact === "window") return undefined;
  if (
    name === "fetch" ||
    name.endsWith(".fetch") ||
    name === "WebSocket" ||
    name === "EventSource" ||
    name.endsWith(".EventSource")
  )
    return candidate(stringValue(args[0]));
  if (name.endsWith(".open")) {
    const value = xhrOpenUrl(name, args[0], args[1], receiverFact);
    if (value === undefined) return undefined;
    return { kind: "candidate", value };
  }
  const method = ["get", "post", "put", "patch", "delete", "request"].find(
    (candidate) => name === candidate || name.endsWith(`.${candidate}`),
  );
  if (method !== undefined) {
    const value = stringValue(args[0]);
    // Only get and delete also belong to the keyed-collection APIs, whose
    // keys are header, field, and parameter names rather than URLs or paths.
    // Configuration `get` reads setting keys.
    if (value === undefined) return undefined;
    if (
      (method === "get" || method === "delete") &&
      !isRequestUrlOrPathLiteral(value) &&
      (isKeyedCollectionReceiver(callee) ||
        (method === "get" &&
          (receiverFact === "configuration" ||
            receiverFact === "extension-state")))
    )
      return undefined;
    return { kind: "candidate", value };
  }
  if (name === "sendBeacon" || name.endsWith(".sendBeacon"))
    return candidate(stringValue(args[0]));
  if (name === "loadURL" || name.endsWith(".loadURL")) {
    const value = stringValue(args[0]);
    return value === undefined ? undefined : { kind: "candidate", value };
  }
  return undefined;
};

/** Spelling-only candidate exclusion for overloaded open calls; not API identity. */
const storageKind = (
  name: string,
): JavaScriptStaticStorage["kind"] | undefined => {
  if (name.includes("localStorage.")) return "local-storage";
  if (name.includes("sessionStorage.")) return "session-storage";
  if (name.endsWith("indexedDB.open")) return "indexed-db";
  if (name.endsWith("caches.open")) return "cache-storage";
  return undefined;
};

/** Produce a dotted callee name through type-erased expression wrappers. */
export const calleeName = (node: t.Node): string => {
  node = unwrapJavaScriptExpression(node).node;
  const segments: string[] = [];
  while (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    // Dynamic keys retain their syntax identity instead of inventing a name.
    segments.push(memberPropertyName(node));
    if (!t.isNode(node.object)) break;
    node = unwrapJavaScriptExpression(node.object).node;
  }
  const base = t.isIdentifier(node) ? node.name : "";
  segments.push(base);
  segments.reverse();
  const first = segments.findIndex((segment) => segment !== "");
  return first === -1 ? "" : segments.slice(first).join(".");
};

/** Read a member property only when its syntax commits an exact name. */
const memberPropertyName = (
  node: t.MemberExpression | t.OptionalMemberExpression,
): string =>
  semanticStaticPropertyKey(node.property, node.computed) ??
  (node.computed ? `[computed@${String(node.property.start ?? -1)}]` : "");

/**
 * Return a string literal value without evaluating an expression. A template
 * literal without substitutions denotes the same exact string.
 */
export const stringValue = (
  node: t.Node | null | undefined,
): string | undefined => {
  if (node === null || node === undefined) return undefined;
  const literal = readExactJavaScriptLiteral(node);
  return literal.found && typeof literal.value === "string"
    ? literal.value
    : undefined;
};

/** Return a string or numeric argument literal. */
export const argumentValue = (
  node: t.Node | null | undefined,
): string | undefined =>
  t.isNumericLiteral(node) ? String(node.value) : stringValue(node);

/** Prefix a static argument value when one is available. */
export const prefixedArgument = (
  prefix: string,
  node: t.Node | null | undefined,
): string | undefined => {
  const value = argumentValue(node);
  return value === undefined ? undefined : `${prefix}${value}`;
};

/** Retain the exact source span represented by an AST node. */
export const sourceSlice = (source: string, node: t.Node): string =>
  typeof node.start !== "number" || typeof node.end !== "number"
    ? ""
    : source.slice(node.start, node.end);

/** Convert Babel locations into the stable graph source-range shape. */
export const range = (node: t.Node): JavaScriptSourceRange => ({
  start: {
    line: node.loc?.start.line ?? 1,
    column: node.loc?.start.column ?? 0,
  },
  end: {
    line: node.loc?.end.line ?? node.loc?.start.line ?? 1,
    column: node.loc?.end.column ?? node.loc?.start.column ?? 0,
  },
});

/** Convert exact text offsets into a source range. */
export const rangeForOffsets = (
  source: string,
  start: number,
  end: number,
): JavaScriptSourceRange => ({
  start: pointForOffset(source, start),
  end: pointForOffset(source, end),
});

/** Compare two exact source ranges. */
export const sourceRangesEqual = (
  left: JavaScriptSourceRange | null,
  right: JavaScriptSourceRange,
): boolean =>
  left !== null &&
  left.start.line === right.start.line &&
  left.start.column === right.start.column &&
  left.end.line === right.end.line &&
  left.end.column === right.end.column;

const pointForOffset = (source: string, offset: number) => {
  const before = source.slice(0, offset);
  // Match JavaScript line terminators, treating CRLF as a single newline.
  const lines = before.split(/\r\n|[\n\r\u2028\u2029]/u);
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
};

/** Observe known bundler/framework marker strings without claiming dependency use. */
export const detectVendors = (source: string): string[] =>
  vendorPatterns.flatMap(({ name, patterns }) =>
    patterns.some((pattern) => source.includes(pattern)) ? [name] : [],
  );

/** Commit the static semantic content used to deduplicate registrations. */
export const registrationKey = (
  registration: JavaScriptBundlerRegistration,
): string =>
  // Collision-free tuple: chunk/module keys are variable-length source-derived
  // lists, so NUL-joins would collapse ["a\0b"] with ["a", "b"].
  compositeKey([
    registration.runtime,
    registration.chunk_keys,
    String(registration.unknown_chunk_keys),
    // Equal factory tables can be registered with different runtime callbacks.
    // Both early collection and finalization must retain those recovered facts.
    registration.runtime_require_name,
    registration.runtime_module_cache_status,
    registration.entry_module_keys,
    String(registration.unknown_entry_module_keys),
    registration.async_chunk_keys,
    String(registration.unknown_async_chunk_keys),
    registration.modules.map(({ module_key: key, source_sha256: digest }) => [
      key,
      digest,
    ]),
  ]);

/** Hash exact UTF-8 source text. */
export const sha256Text = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Recognized route-construction call suffixes. */
export const STATIC_ROUTE_CALL_NAMES = [
  "route",
  "addRoute",
  "useRoutes",
  "createBrowserRouter",
  "createHashRouter",
] as const;

const vendorPatterns = [
  { name: "webpack", patterns: ["__webpack_require__", "webpackChunk"] },
  { name: "Rspack", patterns: ["__webpack_require__.f", "rspackChunk"] },
  { name: "Vite", patterns: ["__vite__", "import.meta.hot"] },
  { name: "Rollup", patterns: ["ROLLUP_FILE_URL", "import.meta.ROLLUP"] },
  { name: "esbuild", patterns: ["__commonJS", "__esm"] },
  { name: "React", patterns: ["React.createElement", "react/jsx-runtime"] },
  { name: "Vue", patterns: ["__VUE__", "createApp("] },
  { name: "Next.js", patterns: ["__NEXT_DATA__", "/_next/"] },
  { name: "Angular", patterns: ["ɵɵdefineComponent"] },
  { name: "Svelte", patterns: ["svelte/internal"] },
] as const;
