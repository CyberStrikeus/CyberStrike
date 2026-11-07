import * as t from "@babel/types";

import {
  unwrapJavaScriptExpression,
  semanticStaticPropertyKey,
  semanticFinalObjectStringProperty,
} from "./javascriptAstValues.js";
import { calleeName } from "./javascriptStaticAnalysisHelpers.js";
import type { JavaScriptBindingIndex } from "./javascriptSemanticState.js";
import { createJavaScriptGraphqlScan } from "./javascriptGraphqlOperations.js";

import type {
  JavaScriptRpcEndpoint,
  JavaScriptRpcScan,
} from "./javascriptRpcEndpoint.js";

export type { JavaScriptRpcScan } from "./javascriptRpcEndpoint.js";

// tRPC proxies preserve router and procedure names as property names, so they
// survive identifier minification. Method names follow @trpc/react-query and
// @trpc/tanstack-react-query 11.19 documentation; cache-key helpers such as
// queryKey are excluded because they never issue a request.
const TRPC_HOOK_METHODS: ReadonlySet<string> = new Set([
  "useQuery",
  "useSuspenseQuery",
  "useInfiniteQuery",
  "useSuspenseInfiniteQuery",
  "usePrefetchQuery",
  "usePrefetchInfiniteQuery",
  "useMutation",
  "useSubscription",
  "queryOptions",
  "infiniteQueryOptions",
  "mutationOptions",
  "subscriptionOptions",
]);

// @trpc/client 11.19 clientCallTypeMap methods; common outside tRPC (Apollo,
// database pools, stores), so they need corroborating evidence.
const TRPC_REQUEST_METHODS: ReadonlySet<string> = new Set(["query", "mutate"]);
// @trpc/client 11.19 TRPCSubscriptionObserver callbacks; RxJS observers use
// next/error/complete instead.
const TRPC_SUBSCRIPTION_CALLBACKS: ReadonlySet<string> = new Set([
  "onStarted",
  "onData",
  "onError",
  "onStopped",
  "onComplete",
  "onConnectionStateChange",
]);
// @trpc/client 11.19 client factories (createTRPCProxyClient is the
// deprecated alias of createTRPCClient).
const TRPC_CLIENT_FACTORIES: ReadonlySet<string> = new Set([
  "createTRPCClient",
  "createTRPCProxyClient",
]);
// Built-in HTTP links documented by tRPC 11.19 that carry a `url` option.
const TRPC_URL_LINKS: ReadonlySet<string> = new Set([
  "httpLink",
  "httpBatchLink",
  "httpBatchStreamLink",
  "httpSubscriptionLink",
]);
// Literals retained by @trpc/client 11.19 bundles (`this.name`, the default
// accept header key) or by the conventional transport path.
const TRPC_SOURCE_MARKERS = ["TRPCClientError", "trpc-accept", "/trpc"];

// Browser-owned roots whose methods share tRPC names, such as
// navigator.permissions.query.
const BROWSER_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "window",
  "self",
  "globalThis",
  "document",
  "navigator",
  "location",
  "history",
  "console",
  "performance",
  "screen",
  "top",
  "parent",
  "frames",
]);

const PROCEDURE_SEGMENT = /^[A-Za-z_$][\w$]*$/u;

interface MemberPath {
  readonly root: t.Node;
  /** Non-computed property names from the root outward. */
  readonly properties: readonly string[];
}

/** Read a static member path and the expression it starts from. */
const memberPath = (callee: t.Node): MemberPath | undefined => {
  const reversed: string[] = [];
  let current: t.Node = callee;
  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    const property = semanticStaticPropertyKey(
      current.property,
      current.computed,
    );
    if (property === null || !PROCEDURE_SEGMENT.test(property))
      return undefined;
    reversed.push(property);
    current = current.object;
  }
  return { root: current, properties: reversed.reverse() };
};

const objectKeys = (node: t.Node | undefined): readonly string[] =>
  t.isObjectExpression(node)
    ? node.properties.flatMap((property) => {
        if (!t.isObjectProperty(property) && !t.isObjectMethod(property))
          return [];
        const key = semanticStaticPropertyKey(property.key, property.computed);
        return key === null ? [] : [key];
      })
    : [];

/** Bundlers use `(0, imported.factory)` to call an import without a receiver. */
const rpcFactoryName = (callee: t.Node): string => {
  let current = unwrapJavaScriptExpression(callee).node;
  while (t.isSequenceExpression(current)) {
    const last = current.expressions.at(-1);
    if (last === undefined) return "";
    current = unwrapJavaScriptExpression(last).node;
  }
  return calleeName(current);
};

/** Whether an initializer has the syntax of a documented tRPC client factory. */
export const isJavaScriptRpcClientFactory = (node: t.Node): boolean => {
  const call = unwrapJavaScriptExpression(node).node;
  return (
    (t.isCallExpression(call) || t.isOptionalCallExpression(call)) &&
    TRPC_CLIENT_FACTORIES.has(
      rpcFactoryName(call.callee).split(".").pop() ?? "",
    )
  );
};

/** Recover the literal `url` option passed to a documented tRPC HTTP link. */
const trpcLinkUrl = (
  node: t.CallExpression | t.OptionalCallExpression,
): JavaScriptRpcEndpoint | undefined => {
  const name = rpcFactoryName(node.callee);
  const factory = name.slice(name.lastIndexOf(".") + 1);
  if (!TRPC_URL_LINKS.has(factory)) return undefined;
  const options = node.arguments[0];
  if (!t.isObjectExpression(options)) return undefined;
  const url = semanticFinalObjectStringProperty(options, "url");
  return url === undefined
    ? undefined
    : { value: url, mechanism: `trpc:link:${factory}` };
};

/**
 * Create the per-source scan. Hook and option-factory methods are distinctive.
 * `query`/`mutate` need a root bound to a tRPC client factory, or a tRPC source
 * marker with a router path of at least two segments; `subscribe` needs the
 * marker and a tRPC observer argument. Unshadowed browser globals and `this`
 * roots are excluded; RTK Query `endpoints` exclusions apply only without a
 * recognized client binding. Router segment spelling does not supply identity.
 */
export const createJavaScriptRpcScan = (
  source: string,
  clientRoots: ReadonlySet<t.Node>,
  index: JavaScriptBindingIndex,
): JavaScriptRpcScan => {
  let marker: boolean | undefined;
  const hasMarker = (): boolean =>
    (marker ??= TRPC_SOURCE_MARKERS.some((value) => source.includes(value)));
  const graphql = createJavaScriptGraphqlScan(index);

  const procedure = (
    node: t.CallExpression | t.OptionalCallExpression,
  ): JavaScriptRpcEndpoint | undefined => {
    const path = memberPath(node.callee);
    if (path === undefined || t.isThisExpression(path.root)) return undefined;
    const bound = clientRoots.has(path.root);
    if (
      t.isIdentifier(path.root) &&
      BROWSER_GLOBAL_NAMES.has(path.root.name) &&
      index.bindingForReferenceAt(path.root) === undefined
    )
      return undefined;
    const method = path.properties[path.properties.length - 1];
    const segments = path.properties.slice(0, -1);
    const first = segments[0];
    if (method === undefined || first === undefined) return undefined;
    if (!bound && segments.includes("endpoints")) return undefined;
    const recognized = TRPC_HOOK_METHODS.has(method)
      ? true
      : TRPC_REQUEST_METHODS.has(method)
        ? bound || (segments.length >= 2 && hasMarker())
        : method === "subscribe" &&
          (bound || hasMarker()) &&
          objectKeys(node.arguments[1]).some((key) =>
            TRPC_SUBSCRIPTION_CALLBACKS.has(key),
          );
    return recognized
      ? { value: segments.join("."), mechanism: `trpc:procedure:${method}` }
      : undefined;
  };

  return {
    inspect: (node) => {
      if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
        return trpcLinkUrl(node) ?? procedure(node);
      return graphql.inspect(node);
    },
    finish: graphql.finish,
  };
};
