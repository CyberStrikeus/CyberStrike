import * as t from "@babel/types";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
import type { JsonValue } from "../jsonValue.js";
import { JAVASCRIPT_STATIC_FACT_BYTES } from "./javascriptAnalysisResourceControls.js";
import {
  semanticMemberChain,
  isObjectPrototypeSetter,
  semanticStaticPropertyName,
  staticJavaScriptTruthiness,
  semanticStaticPropertyKey,
  javaScriptExpressionWrapperTarget,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  calleeName,
  range as sourceRange,
  STATIC_ROUTE_CALL_NAMES,
  stringValue,
} from "./javascriptStaticAnalysisHelpers.js";
import { traverseJavaScriptValueAstSteps } from "./javascriptSemanticTraversal.js";
import {
  semanticStableInitializer,
  type JavaScriptBindingIndex,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import {
  semanticCopiedReferencePath,
  semanticReferenceSourcesInactive,
} from "./javascriptSemanticReferenceSources.js";
import {
  semanticAliasSelectionChoices,
  type SemanticAliasSelectionPath,
} from "./javascriptSemanticAliasSelections.js";
import { semanticProjectedSourcesAtRead } from "./javascriptSemanticProjectedSources.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import {
  semanticObjectPropertyReferences,
  semanticArrayPropertyReferences,
  type JavaScriptSemanticObjectReference,
} from "./javascriptSemanticObjectReferences.js";
import { classifyNextAppRoutePath, routePath } from "./javascriptRoutePaths.js";
import type {
  JavaScriptRouteCandidate,
  JavaScriptRouteSegment,
  JavaScriptRouteSourceFacts,
} from "./javascriptRouteFacts.js";

// Copy the parser interface into the JSON fact representation at its owner.
const range = (node: t.Node): JavaScriptRouteSegment["location"] => {
  const value = sourceRange(node);
  return { start: { ...value.start }, end: { ...value.end } };
};

type Mechanism = JavaScriptRouteCandidate["mechanism"];
type LegacyRoute = {
  node: t.Node;
  value: string;
  mechanism: string;
  /** Set when only the property name, not a router record, suggests a route. */
  interpretation?: "candidate";
};
interface SegmentLink {
  readonly previous: SegmentLink | null;
  readonly segment: JavaScriptRouteSegment;
  readonly inferred: boolean;
}
interface Ancestry {
  readonly node: t.Node;
  readonly previous: Ancestry | undefined;
}
interface Frame {
  readonly node: t.Node;
  readonly parent: SegmentLink | null | undefined;
  readonly ancestry?: Ancestry;
  readonly fallback?: { key: string; node: t.Node };
}
// Callable bodies execute separately. Recognized navigation owns structured
// destination data; unrelated containers retain their independent values.
const isRouteValueBoundary = (node: t.Node, structured: boolean): boolean =>
  t.isFunction(node) ||
  t.isClass(node) ||
  (!structured && (t.isArrayExpression(node) || t.isObjectExpression(node)));
interface DynamicRouteValueOwner {
  readonly node: t.Node;
  readonly navigation: boolean;
  readonly structured: boolean;
  reported: boolean;
}
interface SelectedRouteTarget {
  readonly values: t.Node[] | null;
  readonly visited: WeakMap<
    t.Node,
    Map<SemanticAliasSelectionPath, Set<number>>
  >;
}
interface SelectedRouteValue {
  readonly kind: "value";
  readonly node: t.Node;
  readonly projection: SemanticAliasSelectionPath;
  readonly depth: number;
  readonly target: SelectedRouteTarget;
}
interface SelectedRouteLookup {
  readonly kind: "lookup";
  readonly node: t.Node;
  readonly receiver: t.ObjectExpression | t.ArrayExpression;
  readonly key: ReturnType<typeof semanticAliasSelectionChoices>[number];
  readonly projection: SemanticAliasSelectionPath;
  readonly depth: number;
  readonly target: SelectedRouteTarget;
}
type RouteSelectionWork =
  | SelectedRouteValue
  | SelectedRouteLookup
  | {
      readonly kind: "finish";
      readonly lookup: SelectedRouteLookup;
      readonly key: string;
      readonly values: t.Node[];
    };
interface Fields {
  readonly values: ReadonlyMap<string, t.ObjectProperty>;
  readonly unknownKeys: boolean;
  readonly dynamicNames: ReadonlySet<string>;
}
const structuredCalls = new Set([
  "useRoutes",
  "createBrowserRouter",
  "createHashRouter",
  "defineRoutes",
  "createRoutes",
]);
const navigationCalls = new Set([
  "push",
  "replace",
  "prefetch",
  "navigate",
  "href",
]);
const navigationReceivers = new Set([
  "router",
  "$router",
  "history",
  "location",
]);
const navigationRecognition = (
  name: string,
  receiver: string,
): boolean | undefined =>
  navigationCalls.has(name)
    ? (name !== "push" && name !== "replace") ||
      navigationReceivers.has(receiver)
    : undefined;
const localNavigationFields = new Set(["pathname", "query", "search", "hash"]);
const nextNames = new Set(["TURBOPACK", "webpackChunk_N_E", "__NEXT_DATA__"]);
const isRouteChildKey = (key: string, typed: boolean): boolean =>
  typed ? !key.startsWith("_") && !key.startsWith("$") : key === "children";
const isRouteSegmentKey = (key: string | undefined): boolean =>
  key === "path" || key === "route" || key === "_$";
interface RouteRecordShape {
  readonly typed: boolean;
  readonly hasPath: boolean;
  readonly hasChildren: boolean;
  readonly hasView: boolean;
  readonly hasIndex: boolean;
}
/** Read the static keys that identify a router record. */
const routeRecordShape = (node: t.ObjectExpression): RouteRecordShape => {
  let typed = false,
    hasPath = false,
    hasChildren = false,
    hasView = false,
    hasIndex = false;
  for (const property of node.properties) {
    if (!t.isObjectProperty(property)) continue;
    const key = semanticStaticPropertyName(property.key, property.computed);
    typed ||= key === "_$";
    hasPath ||= key === "path" || key === "route";
    hasChildren ||= key === "children";
    hasView ||= key === "element" || key === "Component" || key === "component";
    hasIndex ||= key === "index";
  }
  return { typed, hasPath, hasChildren, hasView, hasIndex };
};
/** A path-bearing record that also names a view, children, or typed route. */
const isRouterRecord = (shape: RouteRecordShape): boolean =>
  shape.typed || shape.hasView || shape.hasChildren;
/** Follow data-bearing edges, not references used only to select or describe it. */
const isNavigationDataEdge = (node: t.Node, parent: t.Node | null): boolean => {
  if (parent === null) return true;
  if (
    t.isCallExpression(parent) ||
    t.isOptionalCallExpression(parent) ||
    t.isNewExpression(parent)
  )
    return node !== parent.callee;
  if (t.isTaggedTemplateExpression(parent)) return node !== parent.tag;
  if (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent))
    return false;
  if (t.isConditionalExpression(parent)) {
    if (node === parent.test) return false;
    const truthiness = staticJavaScriptTruthiness(parent.test);
    return (
      truthiness === undefined ||
      node === (truthiness ? parent.consequent : parent.alternate)
    );
  }
  if (t.isUnaryExpression(parent)) return false;
  if (t.isBinaryExpression(parent)) return parent.operator === "+";
  if (t.isLogicalExpression(parent)) {
    const left = unwrapJavaScriptExpression(parent.left).node;
    const truthiness = staticJavaScriptTruthiness(left);
    // A falsy && result cannot be a rooted path or structured route value.
    if (parent.operator === "&&")
      return node === parent.right && truthiness !== false;
    if (parent.operator === "||")
      return node === parent.left || truthiness !== true;
    return (
      node === parent.left || truthiness === undefined || t.isNullLiteral(left)
    );
  }
  if (t.isSequenceExpression(parent)) return node === parent.expressions.at(-1);
  if (t.isObjectProperty(parent)) return node === parent.value;
  return true;
};
/** Shared syntax owner; both consumers borrow their existing AST walk and lexical index. */
export class JavaScriptRouteScan {
  readonly #result: JavaScriptRouteSourceFacts = {
    candidates: [],
    unresolved: [],
    capacity: null,
  };
  readonly #calls: {
    node: t.CallExpression | t.OptionalCallExpression;
    typed: boolean;
    namedParent?: boolean;
  }[] = [];
  readonly #navigationValues = new WeakMap<
    t.Node,
    {
      readonly value: t.Node | undefined;
      readonly pathname: t.Node | undefined;
      readonly occurrence: t.Node | undefined;
    }
  >();
  readonly #automaticRoots = new Map<t.ObjectExpression, boolean>();
  readonly #claimed = {
    ordinary: new WeakSet<t.Node>(),
    typed: new WeakSet<t.Node>(),
  };
  readonly #rejected = new WeakSet<t.Node>();
  readonly #seen = new Set<string>();
  readonly #nextPaths: { value: string; node: t.Node; computed: boolean }[] =
    [];
  readonly #literalPaths: { value: string; node: t.Node }[] = [];
  readonly #propertyValues = new WeakSet<t.Node>();
  readonly #dynamicValues = new WeakMap<t.Node, DynamicRouteValueOwner>();
  readonly #expressionParents = new WeakMap<t.Node, t.Node>();
  readonly #fieldsCache = new WeakMap<t.ObjectExpression, Fields>();
  // One key scan per object, however many path or route properties it repeats.
  readonly #shapeCache = new WeakMap<t.ObjectExpression, RouteRecordShape>();
  readonly #routeParents = new WeakMap<
    t.ObjectExpression,
    t.ObjectExpression | null
  >();
  readonly #routeChildren: t.ObjectExpression[] = [];
  #nextRuntime = false;
  #factBytes: number;
  #workBytes = 0;

  private constructor(
    private readonly index: JavaScriptBindingIndex,
    readonly onLegacyRoute?: (fact: LegacyRoute) => void,
    readonly factByteBudget = JAVASCRIPT_STATIC_FACT_BYTES,
  ) {
    this.#factBytes = jsonValueByteLength({
      candidates: [],
      unresolved: [],
      capacity: {
        kind: "route-work-or-facts",
        limit_bytes: factByteBudget,
        accounted_fact_bytes: factByteBudget,
        accounted_work_bytes: factByteBudget,
      },
    });
    if (
      !Number.isSafeInteger(factByteBudget) ||
      factByteBudget < this.#factBytes
    )
      throw new RangeError(
        "Route accounting budget must fit its coverage metadata",
      );
  }

  /** Establish navigation data ownership before either adapter interprets syntax. */
  static *createSteps(
    root: t.Node,
    index: JavaScriptBindingIndex,
    onLegacyRoute?: (fact: LegacyRoute) => void,
    factByteBudget = JAVASCRIPT_STATIC_FACT_BYTES,
  ): Generator<void, JavaScriptRouteScan> {
    const scan = new JavaScriptRouteScan(index, onLegacyRoute, factByteBudget);
    yield* scan.#prepareNavigationSteps(root);
    return scan;
  }

  *#prepareNavigationSteps(root: t.Node): Generator<void> {
    const requests: { node: t.Node; site: t.Node }[] = [];
    const remember = (node: t.Node, site: t.Node): void => {
      const value = unwrapJavaScriptExpression(node).node;
      if (stringValue(value) !== undefined || isRouteValueBoundary(value, true))
        return;
      if (this.#queue(node)) requests.push({ node, site });
    };
    yield* traverseJavaScriptValueAstSteps(
      root,
      this.index.bindings.erasedSyntaxNodes,
      {
        skip: () => this.#result.capacity !== null,
        enter: (node) => {
          if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
            const parts = calleeName(node.callee).split(".");
            if (
              navigationRecognition(parts.at(-1)!, parts.at(-2) ?? "") !== true
            )
              return;
            const first = node.arguments[0];
            if (
              first !== undefined &&
              !t.isSpreadElement(first) &&
              !t.isArgumentPlaceholder(first)
            )
              remember(first, node);
          } else if (
            t.isObjectProperty(node) &&
            semanticStaticPropertyName(node.key, node.computed) === "href"
          )
            remember(node.value, node);
        },
      },
    );
    if (requests.length === 0 || this.#result.capacity !== null) return;
    yield* this.index.indexMemberMutationFactsSteps();
    for (const { node, site } of requests) {
      yield;
      if (this.#result.capacity !== null) return;
      const value = this.#resolve(node, site, this.index);
      const field =
        value !== undefined && t.isObjectExpression(value)
          ? this.#fields(value).values.get("pathname")?.value
          : undefined;
      const pathname =
        field === undefined
          ? undefined
          : this.#resolve(field, site, this.index);
      this.#navigationValues.set(node, {
        value,
        pathname,
        occurrence:
          value !== unwrapJavaScriptExpression(node).node
            ? node
            : field !== undefined &&
                pathname !== unwrapJavaScriptExpression(field).node
              ? field
              : undefined,
      });
    }
    // Structural data references share one bounded ownership closure. A source
    // initializer can serve many use sites; freshness remains per request above.
    const pending: t.Node[] = [];
    const seen = new WeakSet<t.Node>();
    const nonValueReferences = new WeakSet<t.Node>();
    const admit = (node: t.Node): void => {
      if (
        seen.has(node) ||
        isRouteValueBoundary(node, true) ||
        !this.#queue(node)
      )
        return;
      seen.add(node);
      pending.push(node);
    };
    for (const request of requests) admit(request.node);
    while (pending.length > 0 && this.#result.capacity === null) {
      yield;
      const value = pending.pop()!;
      const owner: DynamicRouteValueOwner = {
        node: value,
        navigation: true,
        structured: true,
        reported: true,
      };
      yield* traverseJavaScriptValueAstSteps(
        value,
        this.index.bindings.erasedSyntaxNodes,
        {
          skip: (node) =>
            this.#result.capacity !== null ||
            isRouteValueBoundary(node, true) ||
            seen.has(node),
          enter: (node, parent) => {
            if (node !== value) {
              if (!this.#queue(node)) return;
              seen.add(node);
            }
            this.#dynamicValues.set(node, owner);
            let overwritten = false;
            if (
              t.isObjectProperty(node) &&
              !isObjectPrototypeSetter(node) &&
              t.isObjectExpression(parent)
            ) {
              const key = semanticStaticPropertyKey(node.key, node.computed);
              if (key !== null) {
                const fields = this.#fields(parent);
                const effective = fields.values.get(key);
                // Unknown spreads/keys may preserve earlier data. Only a known
                // final slot or method proves that this reference was discarded.
                overwritten =
                  fields.dynamicNames.has(key) ||
                  (effective !== undefined && effective !== node);
              }
            }
            const nonValue =
              overwritten ||
              t.isTSType(node) ||
              !isNavigationDataEdge(node, parent) ||
              (parent !== null && nonValueReferences.has(parent));
            if (nonValue) nonValueReferences.add(node);
            if (
              !nonValue &&
              (t.isMemberExpression(node) || t.isOptionalMemberExpression(node))
            ) {
              for (const selected of this.#memberValues(node)) admit(selected);
            }
            if (
              nonValue ||
              !t.isIdentifier(node) ||
              (parent !== null && !t.isReferenced(node, parent))
            )
              return;
            const declared = this.index.bindingForReferenceAt(node);
            if (declared === undefined) return;
            for (const sources of [
              declared.initializers,
              declared.referenceInitializers,
            ])
              for (const source of sources)
                if (!this.#queue(source.node)) return;
            // Different reads may select different values; unresolved order
            // retains its possible sources instead of becoming absence.
            const binding = semanticBindingAtRead(
              declared,
              node,
              this.index.bindings.parentsByNode,
            ).binding;
            for (const initializers of [
              binding.initializers,
              binding.referenceInitializers,
            ])
              for (const initializer of initializers) {
                if (
                  semanticReferenceSourcesInactive(
                    initializer,
                    this.index.bindings,
                  )
                )
                  continue;
                for (const selected of this.#initializerValues(initializer))
                  admit(selected);
              }
          },
        },
      );
    }
  }

  inspect(node: t.Node, parent: t.Node | null): void {
    if (this.index.bindings.erasedSyntaxNodes.has(node)) return;
    const expressionParent =
      parent === null ? null : (this.#expressionParents.get(parent) ?? parent);
    if (
      expressionParent !== null &&
      javaScriptExpressionWrapperTarget(node) !== undefined &&
      this.#queue(node)
    )
      this.#expressionParents.set(node, expressionParent);
    const owner = parent === null ? undefined : this.#dynamicValues.get(parent);
    if (
      owner !== undefined &&
      !isRouteValueBoundary(node, owner.structured) &&
      !this.#dynamicValues.has(node) &&
      this.#queue(node)
    )
      this.#dynamicValues.set(node, owner);
    // Legacy projections receive the same owned literal observations even when the new facet is full.
    if (t.isObjectProperty(node)) {
      this.#property(node, parent);
      return;
    }
    if (
      t.isCallExpression(node) ||
      t.isOptionalCallExpression(node) ||
      t.isNewExpression(node)
    ) {
      this.#call(node);
      return;
    }
    if (this.#result.capacity !== null) return;
    if (
      t.isAssignmentExpression(node) &&
      t.isMemberExpression(node.left) &&
      isRouteSegmentKey(
        semanticStaticPropertyName(node.left.property, node.left.computed),
      )
    ) {
      this.#propertyValues.add(node.right);
      if (stringValue(node.right) === undefined)
        this.#ownDynamicValue(node.right, false);
    }
    if (!this.#nextRuntime && t.isIdentifier(node) && nextNames.has(node.name))
      this.#nextRuntime = true;
    if (t.isStringLiteral(node) || t.isTemplateLiteral(node)) {
      const dynamic = this.#dynamicValues.get(node);
      if (dynamic !== undefined) {
        const fragment =
          stringValue(node) ??
          (t.isTemplateLiteral(node)
            ? (node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw)
            : undefined);
        // A rooted fragment establishes a dynamic navigation observation, not
        // a whole route. Unrelated array.push(value) calls add no route noise.
        if (
          dynamic.navigation &&
          !dynamic.reported &&
          fragment !== undefined &&
          routePath(fragment, { navigation: true }) !== undefined
        ) {
          dynamic.reported = true;
          this.#unknown(
            "navigation-target",
            dynamic.node,
            "The navigation target is dynamic; literal fragments do not establish a complete path.",
          );
        }
        return;
      }
      const value = stringValue(node);
      if (value === undefined) return;
      const reference =
        expressionParent !== null &&
        (t.isImportDeclaration(expressionParent) ||
          t.isExportNamedDeclaration(expressionParent) ||
          t.isExportAllDeclaration(expressionParent) ||
          t.isImportExpression(expressionParent) ||
          t.isCallExpression(expressionParent) ||
          t.isOptionalCallExpression(expressionParent) ||
          t.isNewExpression(expressionParent));
      const next = classifyNextAppRoutePath(
        value,
        reference
          ? { kind: "source-reference" }
          : { kind: "source-literal", runtime: "unknown" },
      );
      const computed =
        (t.isBinaryExpression(expressionParent) &&
          expressionParent.operator === "+") ||
        (t.isTemplateLiteral(expressionParent) &&
          expressionParent.expressions.length > 0);
      if (next !== undefined && this.#queue(node, value))
        this.#nextPaths.push({
          value,
          node,
          computed,
        });
      if (
        !computed &&
        !reference &&
        next === undefined &&
        !this.#propertyValues.has(node) &&
        routePath(value) !== undefined &&
        this.#queue(node, value)
      )
        this.#literalPaths.push({ value, node });
    } else if (t.isObjectExpression(node)) this.#object(node);
  }

  #property(node: t.ObjectProperty, parent: t.Node | null): void {
    const name = semanticStaticPropertyName(node.key, node.computed);
    if (name === "path" || name === "route") {
      const value = stringValue(node.value);
      if (value !== undefined)
        this.onLegacyRoute?.({
          node,
          value,
          mechanism: `property:${name}`,
          // A path key alone also names data records such as patch operations.
          ...(t.isObjectExpression(parent) &&
          isRouterRecord(this.#shape(parent))
            ? {}
            : { interpretation: "candidate" }),
        });
    }
    if (this.#result.capacity === null && isRouteSegmentKey(name))
      this.#propertyValues.add(unwrapJavaScriptExpression(node.value).node);
    if (
      this.#result.capacity === null &&
      isRouteSegmentKey(name) &&
      !this.#dynamicValues.has(node) &&
      !this.#dynamicValues.has(node.value) &&
      stringValue(node.value) === undefined
    )
      this.#ownDynamicValue(node.value, false);
    if (
      this.#result.capacity === null &&
      name === "href" &&
      !this.#dynamicValues.has(node)
    )
      this.#navigation(node.value);
  }

  #call(
    node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  ): void {
    const fullName = calleeName(node.callee),
      parts = fullName.split("."),
      name = parts.at(-1)!;
    const first = node.arguments[0];
    const legacy = STATIC_ROUTE_CALL_NAMES.some(
      (candidate) => candidate === name,
    );
    if (legacy && first !== undefined) {
      const value = stringValue(first);
      if (value !== undefined)
        this.onLegacyRoute?.({ node, value, mechanism: `call:${fullName}` });
    }
    if (this.#result.capacity !== null || t.isNewExpression(node)) return;
    if (structuredCalls.has(name)) {
      if (this.#queue(node))
        this.#calls.push({
          node,
          typed: name === "defineRoutes" || name === "createRoutes",
        });
      return;
    }
    if (
      first === undefined ||
      t.isSpreadElement(first) ||
      t.isArgumentPlaceholder(first)
    )
      return;
    const recognized = navigationRecognition(name, parts.at(-2) ?? "");
    if (recognized === true) this.#navigation(first);
    else if (recognized === false) {
      // Method spelling alone does not make array/string data a destination.
      const value = this.#resolve(first, undefined, this.index);
      if (value !== undefined) this.#propertyValues.add(value);
    }
    if (name === "addRoute" && node.arguments.length === 2) {
      // This overload can name a parent rather than a URL. Resolve its record
      // only after the shared binding index is complete.
      this.#ownDynamicValue(first, false);
      this.#propertyValues.add(unwrapJavaScriptExpression(first).node);
      if (this.#queue(node))
        this.#calls.push({ node, typed: false, namedParent: true });
      return;
    }
    if (name === "route" || name === "addRoute") this.#registeredPath(first);
  }

  #registeredPath(first: t.Node): void {
    this.#propertyValues.add(unwrapJavaScriptExpression(first).node);
    if (stringValue(first) === undefined) this.#ownDynamicValue(first, false);
    const value = stringValue(first),
      path =
        value === undefined ? undefined : routePath(value, { relative: true });
    if (path !== undefined)
      this.#emit(
        path,
        "router-call",
        [{ value: value!, location: range(first), origin: "literal" }],
        first,
        !value!.startsWith("/"),
      );
    else
      this.#unknown(
        "router-call",
        first,
        "The registered path is not a supported literal.",
      );
  }

  #shape(node: t.ObjectExpression): RouteRecordShape {
    const cached = this.#shapeCache.get(node);
    if (cached !== undefined) return cached;
    const shape = routeRecordShape(node);
    this.#shapeCache.set(node, shape);
    return shape;
  }

  #object(node: t.ObjectExpression): void {
    // Structured navigation owns these data containers before either automatic
    // roots or parent edges are discovered. Callable bodies are already outside
    // that ownership at the traversal boundary.
    if (this.#dynamicValues.has(node) || this.#result.capacity !== null) return;
    const { typed, hasPath, hasChildren, hasView, hasIndex } =
      this.#shape(node);
    // Only router children establish path ancestry. Ordinary object wrappers
    // can contain routes without contributing URL segments.
    if (!typed && hasChildren && this.#queue(node))
      this.#routeChildren.push(node);
    if (
      (typed || (hasView && (hasPath || hasChildren || hasIndex))) &&
      this.#queue(node)
    )
      this.#automaticRoots.set(node, typed);
  }

  *finishSteps(): Generator<void, JavaScriptRouteSourceFacts> {
    const index = this.index;
    if (this.#result.capacity !== null) return this.#result;
    for (const { value, node, computed } of this.#nextPaths) {
      yield;
      if (this.#result.capacity !== null) return this.#result;
      const next = classifyNextAppRoutePath(value, {
        kind: "source-literal",
        runtime: this.#nextRuntime ? "next" : "unknown",
      });
      if (computed) {
        this.#unknown(
          "next-app-chunk",
          node,
          "The module filename is part of a computed expression; a complete page path remains unknown.",
        );
      } else if (next?.kind === "unknown")
        this.#unknown("next-app-chunk", node, next.reason);
      else if (next?.kind === "known")
        this.#emit(
          next.path,
          "next-app-chunk",
          [{ value, location: range(node), origin: "next-app-path" }],
          node,
          false,
        );
    }
    if (
      this.#calls.length > 0 ||
      this.#automaticRoots.size > 0 ||
      this.#routeChildren.length > 0
    )
      yield* index.indexMemberMutationFactsSteps();
    yield* this.#indexRouteParents(index);
    for (const call of this.#calls) {
      if (this.#result.capacity !== null) break;
      yield;
      const first = call.node.arguments[call.namedParent === true ? 1 : 0];
      if (
        first === undefined ||
        t.isSpreadElement(first) ||
        t.isArgumentPlaceholder(first)
      ) {
        this.#unknown(
          call.typed ? "typed-route-tree" : "nested-route-object",
          call.node,
          "The route configuration is unavailable.",
        );
        continue;
      }
      if (call.namedParent === true) {
        const record = this.#resolve(first, call.node, index);
        if (record !== undefined && t.isFunction(record)) {
          this.#registeredPath(call.node.arguments[0]!);
        } else {
          this.#claimConfiguration(first, index, false);
          this.#unknown(
            "router-call",
            call.node,
            "The named parent route does not establish a static URL ancestry.",
          );
          yield* this.#walk(first, call.node, false, index, {
            unknownParent: true,
          });
        }
        continue;
      }
      this.#claimConfiguration(first, index, call.typed);
      yield* this.#walk(first, call.node, call.typed, index);
    }
    for (const [node, typed] of this.#automaticRoots) {
      if (this.#result.capacity !== null) break;
      yield;
      const claimed = this.#claimed[typed ? "typed" : "ordinary"];
      const ancestry = new Set<t.ObjectExpression>([node]);
      let root = node,
        owned = claimed.has(root) || this.#rejected.has(root);
      while (!owned && !typed) {
        const parent = this.#routeParents.get(root);
        if (parent === undefined) break;
        if (parent === null || ancestry.has(parent)) {
          this.#unknown(
            "nested-route-object",
            root,
            "Multiple or cyclic parents leave the inferred route ancestry unknown.",
          );
          owned = true;
          break;
        }
        ancestry.add(parent);
        root = parent;
        owned = claimed.has(root) || this.#rejected.has(root);
      }
      if (!owned) {
        this.#unknown(
          typed ? "typed-route-tree" : "nested-route-object",
          root,
          "The routing root is inferred from configuration syntax without a bound route-builder call.",
        );
        this.#claimConfiguration(root, index, typed);
        yield* this.#walk(root, root, typed, index, { inferredRoot: true });
      }
    }
    const roots = new Set(
      this.#result.candidates
        .map(({ path }) => path.split("/")[1])
        .filter(Boolean),
    );
    for (const literal of this.#literalPaths) {
      if (this.#result.capacity !== null) break;
      yield;
      // Alias initializers may have been visited before their registration.
      // Decide generic-constant admission only after all specific owners finish.
      if (this.#propertyValues.has(literal.node)) continue;
      const path = routePath(literal.value, { navigation: true });
      if (path === undefined) continue;
      // These remain inferred candidates. The inventory owner additionally binds them to app roots across sources.
      if (this.#nextRuntime || roots.has(path.split("/")[1]!))
        this.#emit(
          path,
          "route-string-constant",
          [
            {
              value: literal.value,
              location: range(literal.node),
              origin: "literal",
            },
          ],
          literal.node,
          true,
        );
    }
    return this.#result;
  }

  *#indexRouteParents(index: JavaScriptBindingIndex): Generator<void> {
    for (const parent of this.#routeChildren) {
      const value = this.#fields(parent).values.get("children")?.value;
      if (value === undefined) continue;
      const pending: t.Node[] = [value],
        seen = new Set<t.Node>();
      while (pending.length > 0 && this.#result.capacity === null) {
        yield;
        const raw = pending.pop()!,
          node = this.#resolve(raw, parent, index);
        if (
          node === undefined ||
          (!t.isArrayExpression(node) && !t.isObjectExpression(node))
        ) {
          if (this.#claimConfiguration(raw, index, false, true))
            this.#unknown(
              "nested-route-object",
              raw,
              "The child configuration cannot establish stable route ancestry.",
            );
          continue;
        }
        if (seen.has(node)) continue;
        seen.add(node);
        if (t.isArrayExpression(node)) {
          for (const child of node.elements)
            if (child !== null && this.#queue(child)) pending.push(child);
        } else {
          const previous = this.#routeParents.get(node);
          this.#routeParents.set(
            node,
            previous === undefined || previous === parent ? parent : null,
          );
        }
      }
    }
  }

  #ownDynamicValue(
    node: t.Node,
    navigation: boolean,
    reported = false,
    structured = false,
  ): void {
    // Leaf references have no descendants to suppress.
    if (
      !t.isIdentifier(node) &&
      !isRouteValueBoundary(node, structured) &&
      this.#queue(node)
    )
      this.#dynamicValues.set(node, { node, navigation, reported, structured });
  }

  #navigation(node: t.Node): void {
    const prepared = this.#navigationValues.get(node);
    const unwrapped =
      prepared === undefined
        ? unwrapJavaScriptExpression(node).node
        : prepared.value;
    if (unwrapped === undefined) {
      this.#unknown(
        "navigation-target",
        node,
        "The navigation destination may be dynamic, mutated, projected or cyclic.",
      );
      return;
    }
    const pathnameObject = t.isObjectExpression(unwrapped);
    let destination = unwrapped;
    if (pathnameObject) {
      const fields = this.#fields(unwrapped);
      let local = !fields.unknownKeys && fields.dynamicNames.size === 0;
      for (const key of fields.values.keys())
        if (!localNavigationFields.has(key)) {
          local = false;
          break;
        }
      const pathname = fields.values.get("pathname");
      if (local && pathname !== undefined)
        destination = prepared?.pathname ?? pathname.value;
      // The destination owns its query/search/hash data, including href-like
      // properties. Callable bodies remain independent syntax contexts.
      this.#ownDynamicValue(node, true, true, true);
    }
    destination = unwrapJavaScriptExpression(destination).node;
    const value = stringValue(destination);
    if (value === undefined) {
      this.#unknown(
        "navigation-target",
        node,
        "The recognized navigation destination is not a supported literal.",
      );
      if (!pathnameObject) this.#ownDynamicValue(node, true, true, true);
      return;
    }
    const path = routePath(value, { navigation: !pathnameObject });
    if (path !== undefined)
      this.#emit(
        path,
        "navigation-target",
        [{ value, location: range(destination), origin: "literal" }],
        prepared?.occurrence ?? destination,
        true,
      );
    else if (
      pathnameObject ||
      (!value.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/iu.test(value))
    )
      this.#unknown(
        "navigation-target",
        node,
        "The relative or unsupported navigation literal cannot establish a rooted path without runtime context.",
      );
  }

  #fields(node: t.ObjectExpression): Fields {
    const cached = this.#fieldsCache.get(node);
    if (cached !== undefined) return cached;
    const values = new Map<string, t.ObjectProperty>(),
      dynamicNames = new Set<string>();
    let unknownKeys = false;
    for (const property of node.properties) {
      if (!this.#queue(property)) {
        unknownKeys = true;
        break;
      }
      if (t.isSpreadElement(property)) {
        values.clear();
        dynamicNames.clear();
        unknownKeys = true;
        continue;
      }
      if (t.isObjectProperty(property) && isObjectPrototypeSetter(property)) {
        // Inheritance may supply an unresolved lookup, but cannot replace an
        // explicit own slot, including a computed or shorthand __proto__.
        unknownKeys = true;
        continue;
      }
      const key = semanticStaticPropertyKey(property.key, property.computed);
      if (key === null) {
        values.clear();
        dynamicNames.clear();
        unknownKeys = true;
      } else if (t.isObjectProperty(property)) {
        values.set(key, property);
        dynamicNames.delete(key);
      } else {
        values.delete(key);
        dynamicNames.add(key);
      }
    }
    const parsed = { values, dynamicNames, unknownKeys };
    this.#fieldsCache.set(node, parsed);
    return parsed;
  }

  #resolve(
    node: t.Node,
    site: t.Node | undefined,
    index: JavaScriptBindingIndex,
  ): t.Node | undefined {
    const seen = new Set<t.Node>();
    for (;;) {
      node = unwrapJavaScriptExpression(node).node;
      if (!t.isIdentifier(node)) return node;
      if (seen.has(node) || !this.#queue(node)) return;
      seen.add(node);
      const binding = index.bindingForReferenceAt(node);
      if (binding === undefined) return;
      const read = semanticBindingAtRead(
        binding,
        node,
        index.bindings.parentsByNode,
      );
      if (!read.hasDefiniteInitializer) return;
      const initializer = semanticStableInitializer(
        read.binding,
        index.bindings,
      );
      if (
        initializer === undefined ||
        initializer.projection.length !== 0 ||
        (site !== undefined && index.referenceMayHaveChangedAt(site, node))
      )
        return;
      node = initializer.node;
    }
  }

  /** Select members without admitting their entire receiver as navigation data. */
  *#memberValues(
    node: t.MemberExpression | t.OptionalMemberExpression,
    mechanism: Mechanism = "navigation-target",
  ): Generator<t.Node> {
    const chain = semanticMemberChain(node, (part) => this.#queue(part));
    if (chain === undefined || !t.isIdentifier(chain.root)) return;
    const binding = this.index.bindingForReferenceAt(chain.root);
    if (binding === undefined) return;
    // Admit possible source expansion before the semantic owner allocates its
    // selected-source list. Repeated reads share cached object field parsing.
    for (const sources of [binding.initializers, binding.referenceInitializers])
      for (const source of sources) if (!this.#queue(source.node)) return;
    for (const write of binding.memberWrites) {
      if (!this.#queue(write.node ?? node)) return;
      for (const source of write.assignedSources ?? [])
        if (!this.#queue(source.node)) return;
    }
    // Value flow excludes proven replacements; lifetime identity eligibility
    // would keep them and incorrectly hide otherwise independent routes.
    const sources = semanticProjectedSourcesAtRead(
      binding,
      chain.root,
      chain.members,
      this.index.bindings,
      false,
      node,
    );
    for (const source of sources ?? [])
      yield* this.#selectedValues(source.node, source.path, mechanism);
  }

  /** Follow copied data slots without claiming their excluded source siblings. */
  *#initializerValues(
    initializer: JavaScriptSemanticBindingState["referenceInitializers"][number],
    mechanism: Mechanism = "navigation-target",
  ): Generator<t.Node> {
    const projection = semanticCopiedReferencePath(initializer, [], "escape");
    if (projection === null) return;
    yield* this.#selectedValues(initializer.node, projection, mechanism);
  }

  /** Member reads and copied initializers share the same selected-slot walk. */
  *#selectedValues(
    source: t.Node,
    projection: SemanticAliasSelectionPath,
    mechanism: Mechanism,
  ): Generator<t.Node> {
    if (!this.#queue(source)) return;
    const pending: RouteSelectionWork[] = [
      {
        kind: "value",
        node: source,
        projection,
        depth: 0,
        target: { values: null, visited: new WeakMap() },
      },
    ];
    // A lookup stays active only while evaluating its returned references.
    // The caller's remaining members run after that value has been obtained.
    const active = new WeakMap<t.Node, Set<string>>();
    while (pending.length > 0 && this.#result.capacity === null) {
      const work = pending.pop()!;
      if (work.kind === "finish") {
        const { lookup } = work;
        active.get(lookup.receiver)?.delete(work.key);
        for (const value of work.values)
          if (
            !this.#retainSelection(
              pending,
              value,
              lookup.projection,
              lookup.depth + 1,
              lookup.target,
            )
          )
            return;
        continue;
      }
      const { node, projection, depth, target } = work;
      if (work.kind === "value") {
        const paths =
          target.visited.get(node) ??
          new Map<SemanticAliasSelectionPath, Set<number>>();
        const depths = paths.get(projection) ?? new Set<number>();
        if (depths.has(depth)) continue;
        depths.add(depth);
        paths.set(projection, depths);
        target.visited.set(node, paths);
        if (depth === projection.length) {
          if (target.values === null) yield node;
          else target.values.push(node);
          continue;
        }
        const selected = this.#resolve(node, undefined, this.index);
        if (selected === undefined) continue;
        if (!t.isObjectExpression(selected) && !t.isArrayExpression(selected)) {
          for (const branch of this.#selectionBranches(selected))
            if (
              !this.#retainSelection(pending, branch, projection, depth, target)
            )
              return;
          continue;
        }
        for (const key of semanticAliasSelectionChoices(projection[depth]!)) {
          if (!this.#queue(node)) return;
          pending.push({
            kind: "lookup",
            node,
            receiver: selected,
            key,
            projection,
            depth,
            target,
          });
        }
        continue;
      }
      const key = JSON.stringify(work.key);
      const keys = active.get(work.receiver) ?? new Set<string>();
      if (keys.has(key)) {
        this.#unknown(
          mechanism,
          node,
          "A cyclic selected-value lookup cannot establish its possible data sources.",
        );
        continue;
      }
      keys.add(key);
      active.set(work.receiver, keys);
      const values: t.Node[] = [];
      const returned: SelectedRouteTarget = {
        values,
        visited: new WeakMap(),
      };
      pending.push({ kind: "finish", lookup: work, key, values });
      for (const reference of this.#selectedReferences(
        work.receiver,
        work.key,
      )) {
        if (reference.widenedGetterResult === true)
          this.#unknown(
            mechanism,
            node,
            "An incomplete getter selection, including cyclic expansion, cannot establish its complete data sources.",
          );
        if (
          !this.#retainSelection(
            pending,
            // The reference owner identifies the allocation directly; a
            // declaration identifier here is not a read before initialization.
            reference.ownerInitializer ?? reference.node,
            reference.path,
            0,
            returned,
          )
        )
          return;
      }
    }
  }

  #selectionBranches(node: t.Node): readonly t.Node[] {
    const branches = t.isConditionalExpression(node)
      ? [node.consequent, node.alternate]
      : t.isLogicalExpression(node)
        ? [node.left, node.right]
        : t.isSequenceExpression(node)
          ? node.expressions
          : t.isAssignmentExpression(node)
            ? [node.right]
            : [];
    return branches.filter((branch) => isNavigationDataEdge(branch, node));
  }

  #selectedReferences(
    node: t.ObjectExpression | t.ArrayExpression,
    key: SelectedRouteLookup["key"],
  ): readonly JavaScriptSemanticObjectReference[] {
    // Admit the literal before canonical owners allocate their indexed results.
    if (t.isObjectExpression(node)) {
      this.#fields(node);
      return this.#result.capacity === null
        ? semanticObjectPropertyReferences(node, [key], this.index.bindings)
        : [];
    }
    for (const element of node.elements)
      if (element !== null && !this.#queue(element)) return [];
    return semanticArrayPropertyReferences(node, [key]);
  }

  #retainSelection(
    pending: RouteSelectionWork[],
    node: t.Node,
    projection: SemanticAliasSelectionPath,
    depth: number,
    target: SelectedRouteTarget,
  ): boolean {
    if (!this.#queue(node)) return false;
    pending.push({ kind: "value", node, projection, depth, target });
    return true;
  }

  /** Ownership is per interpretation; return whether inferred roots were found. */
  #claimConfiguration(
    root: t.Node,
    index: JavaScriptBindingIndex,
    typed: boolean,
    rejected = false,
  ): boolean {
    let inferredRoots = false;
    const pending: { node: t.Node; typed: boolean }[] = [],
      visited = rejected
        ? { ordinary: new WeakSet<t.Node>(), typed: new WeakSet<t.Node>() }
        : this.#claimed;
    const admit = (
      raw: t.Node | null | undefined,
      interpretation: boolean,
    ): void => {
      if (raw == null) return;
      const node = unwrapJavaScriptExpression(raw).node;
      if (
        !(
          t.isObjectExpression(node) ||
          t.isArrayExpression(node) ||
          t.isIdentifier(node) ||
          t.isMemberExpression(node) ||
          t.isOptionalMemberExpression(node) ||
          t.isConditionalExpression(node) ||
          t.isLogicalExpression(node) ||
          t.isSequenceExpression(node) ||
          t.isAssignmentExpression(node) ||
          t.isSpreadElement(node) ||
          t.isCallExpression(node) ||
          t.isOptionalCallExpression(node)
        )
      )
        return;
      // Invalid selected data must not reappear through an independent syntax
      // interpretation. Reuse the classifier that discovered those roots.
      if (
        rejected &&
        t.isObjectExpression(node) &&
        this.#automaticRoots.get(node) === true
      )
        interpretation = true;
      const claimed = visited[interpretation ? "typed" : "ordinary"];
      if (!claimed.has(node) && this.#queue(node)) {
        claimed.add(node);
        if (t.isObjectExpression(node) && this.#automaticRoots.has(node))
          inferredRoots = true;
        if (rejected) this.#rejected.add(node);
        pending.push({ node, typed: interpretation });
      }
    };
    admit(root, typed);
    while (pending.length > 0 && this.#result.capacity === null) {
      const { node, typed } = pending.pop()!;
      if (t.isIdentifier(node)) {
        const binding = index.bindingForReferenceAt(node);
        // All source initializers belong to this binding, even when mutation,
        // conditional execution or projection prevents trusting a current value.
        for (const sources of [
          binding?.initializers ?? [],
          binding?.referenceInitializers ?? [],
        ])
          for (const value of sources)
            for (const selected of this.#initializerValues(
              value,
              typed ? "typed-route-tree" : "nested-route-object",
            ))
              admit(selected, typed);
      } else if (t.isObjectExpression(node)) {
        for (const property of node.properties) {
          if (t.isObjectProperty(property)) {
            const key = semanticStaticPropertyKey(
              property.key,
              property.computed,
            );
            // Owning a route does not own the component/loader inputs it uses.
            // Follow the same route relationships consumed by the route walker.
            if (key === null || isRouteChildKey(key, typed))
              admit(property.value, typed);
          } else if (t.isSpreadElement(property))
            admit(property.argument, typed);
        }
      } else if (t.isArrayExpression(node))
        for (const child of node.elements) admit(child, typed);
      else if (
        t.isMemberExpression(node) ||
        t.isOptionalMemberExpression(node)
      ) {
        for (const selected of this.#memberValues(
          node,
          typed ? "typed-route-tree" : "nested-route-object",
        ))
          admit(selected, typed);
      } else if (t.isConditionalExpression(node)) {
        admit(node.consequent, typed);
        admit(node.alternate, typed);
      } else if (t.isLogicalExpression(node)) {
        admit(node.left, typed);
        admit(node.right, typed);
      } else if (t.isSequenceExpression(node))
        for (const child of node.expressions) admit(child, typed);
      else if (t.isAssignmentExpression(node)) admit(node.right, typed);
      else if (t.isSpreadElement(node)) admit(node.argument, typed);
      else if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
        for (const child of node.arguments) admit(child, typed);
    }
    return inferredRoots;
  }

  *#walk(
    root: t.Node,
    site: t.Node,
    typed: boolean,
    index: JavaScriptBindingIndex,
    options: { inferredRoot?: boolean; unknownParent?: boolean } = {},
  ): Generator<void> {
    const mechanism = typed ? "typed-route-tree" : "nested-route-object",
      frames: Frame[] = [];
    // null is the known URL root; undefined retains an unknown ancestry.
    // An absolute literal can re-establish a known root below either state.
    this.#frame(frames, {
      node: root,
      parent: options.unknownParent === true ? undefined : null,
    });
    while (frames.length > 0 && this.#result.capacity === null) {
      yield;
      const frame = frames.pop()!,
        node = this.#resolve(frame.node, site, index);
      if (node === undefined) {
        this.#claimConfiguration(frame.node, index, typed, true);
        this.#unknown(
          mechanism,
          frame.node,
          "The route configuration may be dynamic, mutated, projected or cyclic.",
        );
        continue;
      }
      let cyclic = false;
      for (
        let parent = frame.ancestry;
        parent !== undefined;
        parent = parent.previous
      )
        if (parent.node === node) {
          cyclic = true;
          break;
        }
      if (cyclic) {
        this.#unknown(
          mechanism,
          frame.node,
          "A cyclic route relationship cannot establish a finite whole path.",
        );
        continue;
      }
      const ancestry = { node, previous: frame.ancestry };
      if (t.isArrayExpression(node)) {
        for (
          let at = node.elements.length - 1;
          at >= 0 && this.#result.capacity === null;
          at--
        ) {
          const child = node.elements[at];
          if (child !== null && child !== undefined)
            this.#frame(frames, {
              node: child,
              parent: frame.parent,
              ancestry,
            });
        }
        continue;
      }
      if (!t.isObjectExpression(node)) {
        this.#claimConfiguration(frame.node, index, typed, true);
        this.#unknown(
          mechanism,
          node,
          "A route configuration is not a static object or array.",
        );
        continue;
      }
      const fields = this.#fields(node);
      if (this.#result.capacity !== null) break;
      const own = fields.values,
        property =
          own.get(typed ? "_$" : "path") ??
          (typed ? undefined : own.get("route"));
      const uncertain =
        fields.unknownKeys ||
        [...fields.dynamicNames].some(
          (key) =>
            typed ||
            key === "path" ||
            key === "route" ||
            key === "children" ||
            key === "index",
        );
      if (uncertain) {
        this.#unknown(
          mechanism,
          node,
          "Spread, computed keys or accessors leave route fields partially unknown.",
        );
      }
      let link = uncertain && property === undefined ? undefined : frame.parent,
        emit = property !== undefined;
      if (property !== undefined) {
        const literal = this.#resolve(property.value, site, index);
        if (literal !== undefined) this.#propertyValues.add(literal);
        const value = literal === undefined ? undefined : stringValue(literal);
        if (
          value === undefined ||
          (value !== "" && routePath(value, { relative: true }) === undefined)
        ) {
          this.#unknown(
            mechanism,
            property.value,
            "The parent segment is unknown; descendant full paths are not inferred.",
          );
          link = undefined;
          emit = false;
        } else if (value.startsWith("/") || link !== undefined) {
          link = {
            previous: value.startsWith("/") ? null : link!,
            segment: {
              value,
              location: range(literal!),
              origin: "literal",
            },
            inferred: false,
          };
        } else emit = false;
      } else if (
        typed &&
        frame.fallback !== undefined &&
        !uncertain &&
        link !== undefined
      ) {
        link = {
          previous: link,
          segment: {
            value: frame.fallback.key,
            location: range(frame.fallback.node),
            origin: "property-name",
          },
          inferred: true,
        };
        emit = true;
      } else if (!typed) {
        const flag = own.get("index")?.value;
        const value =
          flag === undefined ? undefined : this.#resolve(flag, site, index);
        emit = t.isBooleanLiteral(value) && value.value;
        if (flag !== undefined && !t.isBooleanLiteral(value))
          this.#unknown(
            mechanism,
            flag,
            "The index-route flag is not a known boolean at this use.",
          );
      }
      if (emit && link !== undefined) {
        const segments: JavaScriptRouteSegment[] = [];
        let inferred = options.inferredRoot ?? false;
        for (let part = link; part !== null; part = part.previous) {
          segments.push(part.segment);
          inferred ||= part.inferred;
        }
        segments.reverse();
        const minimumBytes = segments.reduce(
          (bytes, segment) => bytes + Buffer.byteLength(segment.value) + 1,
          0,
        );
        if (minimumBytes > this.#remaining()) {
          this.#capacity();
          break;
        }
        let path = "";
        for (const { value } of segments) {
          if (value === "") continue;
          path =
            path === ""
              ? value.startsWith("/")
                ? value
                : `/${value}`
              : `${path}${path.endsWith("/") ? "" : "/"}${value}`;
        }
        this.#emit(
          path || "/",
          mechanism,
          segments,
          property?.value ?? node,
          inferred,
        );
      }
      if (typed) {
        const entries = [...own.entries()];
        for (
          let at = entries.length - 1;
          at >= 0 && this.#result.capacity === null;
          at--
        ) {
          const [key, child] = entries[at]!;
          if (!isRouteChildKey(key, true)) continue;
          this.#frame(frames, {
            node: child.value,
            parent: link,
            ancestry,
            fallback: { key, node: child.key },
          });
        }
      } else {
        const children = own.get("children");
        if (children !== undefined)
          this.#frame(frames, { node: children.value, parent: link, ancestry });
      }
    }
  }

  #unknown(mechanism: Mechanism, node: t.Node, reason: string): void {
    const fact = { mechanism, location: range(node), reason };
    if (this.#reserve("fact", fact)) this.#result.unresolved.push(fact);
  }
  #emit(
    path: string,
    mechanism: Mechanism,
    segments: JavaScriptRouteSegment[],
    node: t.Node,
    inferred: boolean,
  ): void {
    if (this.#result.capacity !== null) return;
    if (Buffer.byteLength(path) > this.#remaining()) {
      this.#capacity();
      return;
    }
    const fact: JavaScriptRouteCandidate = {
      path,
      mechanism,
      segments,
      location: range(node),
      confidence: inferred ? "low" : "medium",
      derivation: inferred
        ? "inferred"
        : segments.length === 1 && segments[0]!.value === path
          ? "literal"
          : "joined",
    };
    const key = JSON.stringify([path, mechanism, node.start, node.end]);
    if (this.#seen.has(key)) return;
    if (this.#reserve("fact", fact)) {
      this.#seen.add(key);
      this.#result.candidates.push(fact);
    }
  }
  #remaining(): number {
    return this.factByteBudget - this.#factBytes - this.#workBytes;
  }
  #capacity(): void {
    this.#result.capacity ??= {
      kind: "route-work-or-facts",
      limit_bytes: this.factByteBudget,
      accounted_fact_bytes: this.#factBytes,
      accounted_work_bytes: this.#workBytes,
    };
  }
  #reserve(kind: "fact" | "work", value: JsonValue): boolean {
    if (this.#result.capacity !== null) return false;
    const bytes = jsonValueByteLength(value, this.#remaining()) + 1;
    if (bytes > this.#remaining()) {
      this.#capacity();
      return false;
    }
    if (kind === "fact") this.#factBytes += bytes;
    else this.#workBytes += bytes;
    return true;
  }
  #queue(node: t.Node, value: string | null = null): boolean {
    return this.#reserve("work", { location: range(node), value });
  }
  #frame(frames: Frame[], frame: Frame): void {
    if (this.#queue(frame.node)) frames.push(frame);
  }
}
