import * as t from "@babel/types";

import { compositeKey } from "../unicodeCodePointOrder.js";
import type {
  ElectronProtocolFinding,
  ElectronStaticValue,
} from "./electronStaticAnalysisTypes.js";
import {
  boundedExpression,
  electronCalleePath,
  electronStaticValue,
} from "./electronStaticAnalysisValues.js";
import {
  isNullishJavaScriptSyntax,
  staticObjectProperty,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { addLocatedFinding } from "./javascriptStaticAnalysisFindings.js";
import { argumentNode, range } from "./javascriptStaticAnalysisHelpers.js";
import type { JavaScriptFindingContext } from "./javascriptStaticAnalysisState.js";

type Role = ElectronProtocolFinding["role"];
type Session = ElectronProtocolFinding["session"];

/** Electron's `CustomScheme` privileges for `protocol.registerSchemesAsPrivileged`. */
const PRIVILEGE_NAMES = [
  "allowExtensions",
  "allowServiceWorkers",
  "bypassCSP",
  "codeCache",
  "corsEnabled",
  "secure",
  "standard",
  "stream",
  "supportFetchAPI",
] as const;

const HANDLERS = new Set([
  "handle",
  "registerFileProtocol",
  "registerHttpProtocol",
  "registerStringProtocol",
  "registerBufferProtocol",
  "registerStreamProtocol",
]);
const INTERCEPTORS = new Set([
  "interceptFileProtocol",
  "interceptHttpProtocol",
  "interceptStringProtocol",
  "interceptBufferProtocol",
  "interceptStreamProtocol",
]);

/**
 * Inspect custom URL scheme registrations: `app.setAsDefaultProtocolClient`,
 * `protocol.registerSchemesAsPrivileged`, and scheme handlers or interceptors
 * on `protocol` or `session.defaultSession.protocol`.
 */
export const inspectElectronProtocolNode = (
  node: t.Node,
  context: JavaScriptFindingContext,
): void => {
  if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) return;
  const path = electronCalleePath(node.callee, context);
  if (path === undefined) return;
  if (path.length === 2 && path[0] === "app") {
    if (path[1] === "setAsDefaultProtocolClient")
      addProtocol(context, {
        node,
        api: "setAsDefaultProtocolClient",
        role: "os-default-client",
        session: "default-protocol",
        scheme: argumentNode(node.arguments[0]),
      });
    return;
  }
  const target = protocolTarget(path);
  if (target === undefined) return;
  if (target.api === "registerSchemesAsPrivileged") {
    // This global API is exported by the module, not session.protocol.
    if (target.session === "default-protocol")
      inspectPrivilegedSchemes(node, target.session, context);
    return;
  }
  const role: Role | undefined = HANDLERS.has(target.api)
    ? "handler"
    : INTERCEPTORS.has(target.api)
      ? "interceptor"
      : undefined;
  if (role !== undefined && !handlerKnownMissing(node))
    addProtocol(context, {
      node,
      api: target.api,
      role,
      session: target.session,
      scheme: argumentNode(node.arguments[0]),
    });
};

/** Electron requires the callback, so a call without one installs nothing. */
const handlerKnownMissing = (
  node: t.CallExpression | t.OptionalCallExpression,
): boolean => {
  // A spread can supply the callback at runtime.
  if (node.arguments.slice(0, 2).some((value) => t.isSpreadElement(value)))
    return false;
  const handler = typeless(argumentNode(node.arguments[1]));
  return handler === undefined || isNullishJavaScriptSyntax(handler);
};

const protocolTarget = (
  path: readonly string[],
): { readonly session: Session; readonly api: string } | undefined => {
  if (path.length === 2 && path[0] === "protocol" && path[1] !== undefined)
    return { session: "default-protocol", api: path[1] };
  if (
    path.length === 4 &&
    path[0] === "session" &&
    path[1] === "defaultSession" &&
    path[2] === "protocol" &&
    path[3] !== undefined
  )
    return { session: "default-session", api: path[3] };
  return undefined;
};

/** Record one finding per array entry; a non-literal list stays one dynamic finding. */
const inspectPrivilegedSchemes = (
  node: t.CallExpression | t.OptionalCallExpression,
  session: Session,
  context: JavaScriptFindingContext,
): void => {
  // TypeScript assertions such as `[...] as const` do not change the value.
  const list = typeless(argumentNode(node.arguments[0]));
  // Electron converts the argument to `CustomScheme[]`; other syntax registers nothing.
  if (isKnownNonArray(list)) return;
  // Electron converts every entry or throws, so one entry that cannot be a
  // `CustomScheme` means the call registers nothing.
  if (t.isArrayExpression(list) && list.elements.some(isKnownInvalidEntry))
    return;
  const entries = t.isArrayExpression(list) ? list.elements : [list];
  for (const [index, entry] of entries.entries()) {
    const candidate = typeless(entry ?? undefined);
    const scheme = staticObjectProperty(
      candidate,
      "scheme",
      isNullishJavaScriptSyntax,
    );
    addProtocol(context, {
      node,
      located: candidate ?? node,
      entry: index,
      api: "registerSchemesAsPrivileged",
      role: "privileged-scheme",
      session,
      scheme: scheme.status === "explicit" ? scheme.value : candidate,
      privileges: enabledPrivileges(candidate, context),
    });
  }
};

const isKnownNonArray = (node: t.Node | undefined): boolean =>
  t.isObjectExpression(node) ||
  t.isLiteral(node) ||
  t.isFunction(node) ||
  t.isClassExpression(node);

/** A hole, non-object syntax, or an object whose `scheme` is known absent. */
const isKnownInvalidEntry = (
  entry: t.ArrayExpression["elements"][number],
): boolean => {
  if (entry === null) return true;
  // A spread can contribute any entries at runtime.
  if (t.isSpreadElement(entry)) return false;
  const candidate = typeless(entry);
  if (
    t.isLiteral(candidate) ||
    t.isArrayExpression(candidate) ||
    t.isFunction(candidate) ||
    t.isClassExpression(candidate)
  )
    return true;
  if (!t.isObjectExpression(candidate)) return false;
  const scheme = staticObjectProperty(
    candidate,
    "scheme",
    isNullishJavaScriptSyntax,
  );
  return (
    scheme.status === "missing" ||
    (scheme.status === "explicit" &&
      isNullishJavaScriptSyntax(typeless(scheme.value) ?? scheme.value))
  );
};

/**
 * Privilege keys whose effective (last) value is literal `true`; null when the
 * object is not a literal with static keys or a privilege value is not a
 * boolean literal. A later key wins, as at runtime.
 */
const enabledPrivileges = (
  entry: t.Node | undefined,
  context: JavaScriptFindingContext,
): readonly string[] | null => {
  const lookup = staticObjectProperty(
    entry,
    "privileges",
    isNullishJavaScriptSyntax,
  );
  if (lookup.status === "missing") return [];
  const privileges =
    lookup.status === "explicit" ? typeless(lookup.value) : undefined;
  if (!t.isObjectExpression(privileges)) {
    context.accumulator.unknownFindings += 1;
    return null;
  }
  // The shared object rules own spreads, accessors, `__proto__` setters and
  // nullish spreads. Only Electron's privilege names are read, so the work
  // stays linear in the object size.
  const enabled: string[] = [];
  for (const name of PRIVILEGE_NAMES) {
    const lookup = staticObjectProperty(
      privileges,
      name,
      isNullishJavaScriptSyntax,
    );
    if (lookup.status !== "explicit") {
      if (lookup.status === "missing") continue;
      context.accumulator.unknownFindings += 1;
      return null;
    }
    const value = typeless(lookup.value);
    // An unknown value may enable the privilege, so the set is unknown.
    if (!t.isBooleanLiteral(value)) {
      context.accumulator.unknownFindings += 1;
      return null;
    }
    if (value.value) enabled.push(name);
  }
  return enabled.toSorted();
};

interface ProtocolInput {
  readonly node: t.CallExpression | t.OptionalCallExpression;
  /** The source range reported for this finding; defaults to the call. */
  readonly located?: t.Node;
  /** Array position for one of several entries passed to a single call. */
  readonly entry?: number;
  readonly api: string;
  readonly role: Role;
  readonly session: Session;
  readonly scheme: t.Node | null | undefined;
  readonly privileges?: readonly string[] | null;
}

const addProtocol = (
  context: JavaScriptFindingContext,
  input: ProtocolInput,
): void => {
  // An omitted, `undefined` or `null` scheme is known absence, not an unknown.
  const schemeNode = typeless(input.scheme);
  if (schemeNode === undefined || isNullishJavaScriptSyntax(schemeNode)) return;
  const located = input.located ?? input.node;
  const scheme = schemeValue(context, input.scheme, located);
  if (scheme.status === "dynamic") context.accumulator.unknownFindings += 1;
  const finding: ElectronProtocolFinding = {
    api: input.api,
    role: input.role,
    scheme,
    session: input.session,
    enabled_privileges: input.privileges ?? null,
    module_key: null,
    location: range(located),
  };
  addLocatedFinding(context, {
    collection: context.accumulator.protocols,
    key: compositeKey(["electron-protocol", input.api, input.entry ?? null]),
    node: located,
    value: finding,
  });
};

const schemeValue = (
  context: JavaScriptFindingContext,
  scheme: t.Node | null | undefined,
  located: t.Node,
): ElectronStaticValue =>
  scheme === null || scheme === undefined
    ? {
        status: "dynamic",
        value: null,
        expression: boundedExpression(context.source, located),
      }
    : electronStaticValue(context.source, typeless(scheme));

const typeless = (node: t.Node | null | undefined): t.Node | undefined =>
  node === null || node === undefined
    ? undefined
    : unwrapJavaScriptExpression(node).node;
