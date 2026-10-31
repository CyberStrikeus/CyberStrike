import * as t from "@babel/types";
import { runtimeFunctionParameters } from "./javascriptAstValues.js";
import { JavaScriptSymbolicBindings } from "./javascriptSymbolicBindings.js";
import {
  symbolicVariants,
  symbolicTruth,
  symbolicUnknown,
  type SymbolicValue,
  type SymbolicEnvironment,
  type SymbolicFunction,
} from "./javascriptSymbolicValues.js";
import {
  resolveSemanticBindingState,
  semanticResolutionBlocked,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import { semanticIdentifierRole } from "./javascriptSemanticProjection.js";
import type { JavaScriptElectronIdentity } from "./javascriptSemanticAnalysis.js";
import type { JavaScriptAnalysisAccumulator } from "./javascriptStaticAnalysisState.js";
import type {
  ElectronCallPath,
  ElectronCallPathStep,
  ElectronContextBridgeFinding,
  ElectronIpcDescriptor,
  ElectronIpcFinding,
  ElectronStaticValue,
} from "./electronStaticAnalysisTypes.js";
import {
  contextBridgeExposureArguments,
  type JavaScriptContextBridgeExposureArguments,
} from "./javascriptContextBridgeExposure.js";
import {
  boundedExpression,
  contextBridgeMemberPathDepth,
} from "./electronStaticAnalysisValues.js";
import {
  argumentNode,
  range,
  calleeName,
} from "./javascriptStaticAnalysisHelpers.js";
import {
  childNodes,
  traverseJavaScriptValueAst,
  traverseJavaScriptValueAstSteps,
} from "./javascriptSemanticTraversal.js";
import { ipcDescriptor } from "./electronStaticAnalysisIpc.js";
import { symbolicLogicalRight } from "./javascriptSymbolicControlFlow.js";
import {
  ElectronCallPathBlockPrefixes,
  type ElectronStatementFallthrough,
} from "./electronCallPathBlockPrefixes.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { javascriptSourceRangeKey } from "./javascriptSourceCoordinates.js";

const callLabel = (node: t.Node): string =>
  t.isSequenceExpression(node)
    ? callLabel(node.expressions.at(-1) ?? node)
    : calleeName(node) || "local call";

const ipcEndpointKey = (value: ElectronIpcFinding): string =>
  JSON.stringify([
    value.side,
    value.operation,
    value.channel,
    javascriptSourceRangeKey(value.location),
  ]);

/** Duplicate evidence already recorded for one endpoint and call site. */
interface IpcEndpointFacts {
  // A directly observed transmission stays one fact however it is reached.
  observedTransmission: boolean;
  // A bridge path to a directly observed renderer listener is provenance for
  // that source registration, not another registration at the same callsite.
  observedRendererListener: boolean;
  readonly invocations: Set<string>;
  // Call chains of substituted findings, by value and then by final call.
  // Chains can only share a suffix when they end in the same call.
  readonly reached: Map<string, Map<string, ReachedChain[]>>;
}

/** One substituted finding's call chain and the slot holding its record. */
interface ReachedChain {
  calls: readonly string[];
  readonly slot: number;
}

const ipcInvocationKey = (
  location: ElectronIpcFinding["invocation_location"],
): string =>
  location === undefined ? "undefined" : javascriptSourceRangeKey(location);

/** A finding's facts apart from which entry invoked it. */
const ipcValueKey = (value: ElectronIpcFinding): string =>
  JSON.stringify({ ...value, invocation_location: undefined });

/**
 * Whether two call chains end in the same calls, so one entry traced the same
 * physical call sequence with less enclosing context than the other.
 */
const sharesCallSuffix = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  const offset = longer.length - shorter.length;
  return shorter.every((call, index) => longer[offset + index] === call);
};

/**
 * How an identical finding was already reached through the same trailing
 * calls. A path with as much or more enclosing context makes this one a
 * repeat. A shorter path is a nested entry this path invokes, so this path's
 * fuller invocation supersedes its record, while other outer calls through the
 * same sequence stay distinct invocations.
 */
const priorPath = (
  facts: IpcEndpointFacts,
  value: string,
  calls: readonly string[],
): { readonly repeated: boolean; readonly shorter?: ReachedChain } => {
  const byLast = facts.reached.get(value);
  if (byLast === undefined) return { repeated: false };
  // An empty chain is a suffix of every chain.
  const candidates =
    calls.length === 0
      ? [...byLast.values()].flat()
      : [...(byLast.get(calls.at(-1) ?? "") ?? []), ...(byLast.get("") ?? [])];
  let shorter: ReachedChain | undefined;
  for (const prior of candidates) {
    if (!sharesCallSuffix(prior.calls, calls)) continue;
    if (prior.calls.length >= calls.length) return { repeated: true };
    shorter ??= prior;
  }
  return shorter === undefined
    ? { repeated: false }
    : { repeated: false, shorter };
};

/** One physical IPC operation, independent of how its channel was resolved. */
const ipcSiteKey = (
  value: Pick<ElectronIpcFinding, "side" | "operation" | "location">,
): string =>
  JSON.stringify([
    value.side,
    value.operation,
    javascriptSourceRangeKey(value.location),
  ]);

const indexIpcFinding = (
  index: Map<string, IpcEndpointFacts>,
  value: ElectronIpcFinding,
  // A substitution that resolves a directly observed operation inherits its
  // observation, so later paths to that operation stay duplicates.
  observed = value.resolution_basis === undefined,
  reached?: ReachedChain,
): void => {
  const key = ipcEndpointKey(value);
  let facts = index.get(key);
  if (facts === undefined) {
    facts = {
      observedTransmission: false,
      observedRendererListener: false,
      invocations: new Set(),
      reached: new Map(),
    };
    index.set(key, facts);
  }
  facts.observedTransmission ||=
    observed && (value.mode === "send" || value.mode === "invoke");
  facts.observedRendererListener ||=
    observed && value.side === "renderer" && value.mode === "listen";
  facts.invocations.add(ipcInvocationKey(value.invocation_location));
  if (reached !== undefined) {
    const valueKey = ipcValueKey(value);
    const byLast =
      facts.reached.get(valueKey) ?? new Map<string, ReachedChain[]>();
    facts.reached.set(valueKey, byLast);
    const last = reached.calls.at(-1) ?? "";
    const chains = byLast.get(last);
    if (chains === undefined) byLast.set(last, [reached]);
    else chains.push(reached);
  }
};

/** Substituted contextBridge exposures at one exposure call site. */
interface BridgeSite {
  readonly offset: number;
  /** Source of the world id argument, shared by every invocation. */
  readonly worldExpression: string;
  /** One exposure per world and key, the identity direct syntax uses. */
  readonly exposures: Map<string, BridgeExposure>;
  /**
   * A traced invocation reached this site without an unconditional literal
   * key and API, so the site's syntax observation still stands for it.
   */
  unresolved: boolean;
}

/** One exposure and the distinct invocation facts merged into it. */
interface BridgeExposure {
  value: ElectronContextBridgeFinding;
  readonly contributions: Set<string>;
}

const bridgeExposureKey = (value: ElectronContextBridgeFinding): string =>
  JSON.stringify([value.world, value.api_key, value.api_key_expression]);

const bridgeContributionKey = (value: ElectronContextBridgeFinding): string =>
  JSON.stringify([value.world_id, value.members, value.unknown_members]);

/**
 * Exposures of one key at one site from several invocations, or from an
 * invocation and the site's own syntax, describe one API whose object and
 * world are any of theirs: members of every alternative, and the unknown
 * members of the least resolved one, which also absorbs an alternative that
 * restates another's unresolved source.
 */
const mergeBridgeExposures = (
  left: ElectronContextBridgeFinding,
  right: ElectronContextBridgeFinding,
  worldExpression: string,
): ElectronContextBridgeFinding => ({
  ...left,
  world_id:
    JSON.stringify(left.world_id) === JSON.stringify(right.world_id)
      ? left.world_id
      : { status: "dynamic", value: null, expression: worldExpression },
  members: [...new Set([...left.members, ...right.members])].sort(
    compareUnicodeCodePoints,
  ),
  unknown_members: Math.max(left.unknown_members, right.unknown_members),
});

interface PathContext {
  readonly entryNode: t.Node;
  /** Source ranges of the local calls this path made since its entry. */
  readonly calls: string[];
  readonly entry: string;
  readonly entryPath?: readonly string[];
  readonly entryKind: ElectronCallPath["entry_kind"] | null;
  readonly channel: string | null;
  readonly steps: readonly ElectronCallPathStep[];
  readonly conditions: ElectronCallPath["conditions"];
  readonly active: ReadonlySet<t.Function>;
}

/** Substitutes inert wrapper syntax; every emitted path remains a candidate. */
export function* collectElectronWrappedCallPathsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  source: string,
  accumulator: JavaScriptAnalysisAccumulator,
  identity: JavaScriptElectronIdentity,
): Generator<void, readonly ElectronCallPath[]> {
  // Bounds repeated interprocedural expansion independently of bundle bytes.
  // Exhaustion is reported as unknown coverage, never as a negative finding.
  let remainingVisits = 1_000_000;
  const prefixes = new ElectronCallPathBlockPrefixes(
    () => --remainingVisits >= 0,
    state.parentsByNode,
  );
  const resolver = new JavaScriptSymbolicBindings(state, program, identity);
  const paths: ElectronCallPath[] = [];
  const seen = new Set<string>();
  const unconditionalRegistrations = new Set<string>();
  const step = (
    node: t.Node,
    kind: ElectronCallPathStep["kind"],
    label: string,
  ): ElectronCallPathStep => {
    const module = accumulator.moduleRangeIndex.find(node.start);
    return {
      kind,
      label,
      location: range(node),
      module_key: module?.key ?? null,
      module_runtime: module?.runtime ?? null,
    };
  };
  const condition = (
    context: PathContext,
    node: t.Node,
    positive: boolean | "nullish" | "not-nullish" = true,
  ): PathContext => {
    const expression = source
      .slice(node.start ?? 0, node.end ?? 0)
      .slice(0, 512);
    return {
      ...context,
      conditions: [
        ...context.conditions,
        {
          expression:
            positive === "nullish"
              ? `(${expression}) === null || (${expression}) === undefined`
              : positive === "not-nullish"
                ? `(${expression}) !== null && (${expression}) !== undefined`
                : positive
                  ? expression
                  : `!(${expression})`,
          location: range(node),
        },
      ],
    };
  };
  /** A case can be reached by its own selection or by fallthrough from an earlier case. */
  const switchCaseContext = (
    node: t.SwitchStatement,
    index: number,
    context: PathContext,
  ): PathContext => {
    const text = (part: t.Node): string | undefined =>
      part.start == null || part.end == null || part.end - part.start > 512
        ? undefined
        : source.slice(part.start, part.end);
    const discriminant = text(node.discriminant);
    if (discriminant === undefined) {
      accumulator.unknownFindings += 1;
      return context;
    }
    const choices: string[] = [];
    let expressionBytes = 0;
    let defaultBefore = false;
    const compare = (test: t.Expression, operator: "===" | "!==") => {
      // Dynamic case expressions can mutate the evaluated discriminant; do
      // not turn a second source evaluation into an invented predicate.
      if (
        !t.isStringLiteral(test) &&
        !t.isNumericLiteral(test) &&
        !t.isBooleanLiteral(test) &&
        !t.isNullLiteral(test) &&
        !t.isBigIntLiteral(test)
      )
        return undefined;
      const label = text(test);
      return label === undefined
        ? undefined
        : `(${discriminant}) ${operator} (${label})`;
    };
    const append = (output: string[], item: string): boolean => {
      expressionBytes += item.length + 6;
      if (expressionBytes > 512) return false;
      output.push(item);
      return true;
    };
    let fallthrough = false;
    for (let i = 0; i <= index; i += 1) {
      if (--remainingVisits < 0) return context;
      const branch = node.cases[i];
      if (!branch) continue;
      if (i < index && branch.consequent.length > 0) fallthrough = true;
      if (branch.test == null) {
        defaultBefore = true;
        continue;
      }
      const match = compare(branch.test, "===");
      if (match === undefined || !append(choices, match)) {
        accumulator.unknownFindings += 1;
        return context;
      }
    }
    if (defaultBefore) {
      const unmatched: string[] = [];
      for (const branch of node.cases) {
        if (--remainingVisits < 0) return context;
        if (branch.test == null) continue;
        const mismatch = compare(branch.test, "!==");
        if (mismatch === undefined || !append(unmatched, mismatch)) {
          accumulator.unknownFindings += 1;
          return context;
        }
      }
      choices.push(unmatched.length === 0 ? "true" : unmatched.join(" && "));
    }
    // Earlier case bodies may terminate or change state before reaching this
    // case. The selection disjunction is necessary but not a complete path.
    if (fallthrough) accumulator.unknownFindings += 1;
    const expression = choices.map((choice) => `(${choice})`).join(" || ");
    if (expression.length > 512) {
      accumulator.unknownFindings += 1;
      return context;
    }
    if (expression === "") return context;
    return {
      ...context,
      conditions: [
        ...context.conditions,
        { expression, location: range(node) },
      ],
    };
  };
  const sequentialFallthrough = (
    fact: ElectronStatementFallthrough | null,
    env: SymbolicEnvironment,
    context: PathContext,
  ): { readonly continues: boolean; readonly context: PathContext } => {
    if (fact === null) return { continues: true, context };
    if (fact.kind === "exit") return { continues: false, context };
    const truth = symbolicTruth(resolver.evaluate(fact.test, env));
    if (truth !== undefined)
      return (truth ? fact.consequentExits : fact.alternateExits)
        ? { continues: false, context }
        : { continues: true, context };
    if (fact.consequentExits)
      return {
        continues: true,
        context: condition(context, fact.test, false),
      };
    if (fact.alternateExits)
      return {
        continues: true,
        context: condition(context, fact.test),
      };
    return { continues: true, context };
  };
  const metadataContext = (
    context: PathContext,
    value: SymbolicValue,
  ): PathContext | null => {
    if (value.conditionUnresolved) {
      accumulator.unknownFindings += 1;
      return null;
    }
    return (
      value.conditions?.reduce(
        (current, branch) => condition(current, branch.node, branch.positive),
        context,
      ) ?? context
    );
  };
  // Duplicate checks consult only facts at the same endpoint and call site.
  // Scanning every prior fact made bundles with many registrations quadratic.
  let ipcByEndpoint: Map<string, IpcEndpointFacts> | undefined;
  // Direct operations whose channel the syntax pass left unresolved, by site.
  let unresolvedIpcSites: Map<string, number> | undefined;
  // Traced invocation outcomes at IPC sites: the call sites of invocations
  // that supplied a literal channel, or any other outcome.
  const literalInvocationSites = new Map<
    string,
    {
      readonly node: t.Node;
      readonly calls: Set<string>;
      // Literals whose guarded registration has no IPC finding of its own.
      readonly guardedChannels: Set<string>;
    }
  >();
  const openInvocationSites = new Set<string>();
  // Runtime references to each binding: direct call sites, or null when any
  // other reference can invoke it from sites the trace never seeds.
  let directCalls:
    | Map<JavaScriptSemanticBindingState, t.CallExpression[] | null>
    | undefined;
  const directCallsTo = (
    binding: JavaScriptSemanticBindingState,
  ): readonly t.CallExpression[] | null => {
    if (directCalls === undefined) {
      const references = new Map<
        JavaScriptSemanticBindingState,
        t.CallExpression[] | null
      >();
      traverseJavaScriptValueAst(program, state.erasedSyntaxNodes, {
        enter: (node, parent, readAncestors) => {
          if (
            !t.isIdentifier(node) ||
            parent === null ||
            semanticIdentifierRole(node, parent, readAncestors) === null
          )
            return;
          const referenced = resolveSemanticBindingState(
            state,
            node,
            node.name,
          );
          if (referenced === undefined) return;
          const calls = references.get(referenced);
          if (calls === null) return;
          if (!t.isCallExpression(parent) || parent.callee !== node)
            references.set(referenced, null);
          else if (calls === undefined) references.set(referenced, [parent]);
          else calls.push(parent);
        },
      });
      directCalls = references;
    }
    return directCalls.get(binding) ?? [];
  };
  /**
   * Whether every invocation of the function enclosing a node is a direct call
   * whose own invocation chain the trace followed. Seeds start only at literal
   * arguments, so an untraced call site may supply any channel.
   */
  const tracedInvocationsOnly = (
    node: t.Node,
    traced: ReadonlySet<string>,
    active: ReadonlySet<t.Node> = new Set(),
  ): boolean => {
    let fn = state.parentsByNode.get(node);
    while (fn !== undefined && !t.isFunction(fn))
      fn = state.parentsByNode.get(fn);
    // Top-level code runs once with the values the trace evaluated.
    if (fn === undefined) return true;
    if (active.has(fn)) return false;
    const declarator = state.parentsByNode.get(fn);
    const declaration = t.isFunctionDeclaration(fn)
      ? fn
      : t.isVariableDeclarator(declarator) && declarator.init === fn
        ? state.parentsByNode.get(declarator)
        : undefined;
    const owner =
      declaration === undefined
        ? undefined
        : state.parentsByNode.get(declaration);
    // An exported declaration is invoked by importers this file never sees.
    if (
      declaration === undefined ||
      t.isExportNamedDeclaration(owner) ||
      t.isExportDefaultDeclaration(owner)
    )
      return false;
    const id = t.isFunctionDeclaration(fn)
      ? fn.id
      : t.isVariableDeclarator(declarator) && t.isIdentifier(declarator.id)
        ? declarator.id
        : undefined;
    const binding =
      id === undefined || id === null
        ? undefined
        : resolveSemanticBindingState(state, id, id.name);
    const calls = binding === undefined ? null : directCallsTo(binding);
    return (
      calls !== null &&
      calls.length > 0 &&
      calls.every(
        (call) =>
          traced.has(ipcInvocationKey(range(call))) &&
          tracedInvocationsOnly(call, traced, new Set([...active, fn])),
      )
    );
  };
  const ipcAtEndpoint = (): Map<string, IpcEndpointFacts> => {
    if (ipcByEndpoint !== undefined) return ipcByEndpoint;
    ipcByEndpoint = new Map();
    unresolvedIpcSites = new Map();
    for (const [index, { value }] of accumulator.ipc.entries()) {
      indexIpcFinding(ipcByEndpoint, value);
      if (value.resolution_basis === undefined && value.channel === null)
        unresolvedIpcSites.set(ipcSiteKey(value), index);
    }
    return ipcByEndpoint;
  };
  /** The literal channel at an IPC site independent of any invocation. */
  const siteDeterminedChannel = (
    node: t.CallExpression | t.OptionalCallExpression,
  ): string | undefined => {
    const argument = node.arguments[0];
    if (argument === undefined || t.isSpreadElement(argument)) return undefined;
    const variants = symbolicVariants(
      resolver.evaluate(argument, resolver.environmentAt(node)),
    );
    const only = variants.length === 1 ? variants[0] : undefined;
    return only?.kind === "literal" &&
      typeof only.value === "string" &&
      !only.conditions?.length
      ? only.value
      : undefined;
  };
  const activationCaptures = new WeakMap<SymbolicFunction, boolean>();
  /**
   * Whether the handler closes over a binding of a function this trace
   * activated, such as a wrapper parameter or a factory local. Each activation
   * may bind a different value, so such a closure is not one fact the call
   * site determines. Bindings of unactivated scopes, such as module or bundle
   * factory scope, and the handler's own bindings are shared by every trace.
   */
  const capturesActivationBindings = (
    fn: SymbolicFunction,
    context: PathContext,
  ): boolean => {
    const cached = activationCaptures.get(fn);
    if (cached !== undefined) return cached;
    const { captures, traceDependent } = closesOverActivation(fn, context);
    if (!traceDependent) activationCaptures.set(fn, captures);
    return captures;
  };
  /**
   * Whether an activation was called outside every function except bundle
   * module factories, such as a factory call in a module-level initializer.
   * Unless the trace itself makes that call, it ran once per module load and
   * its bindings are shared by every trace.
   */
  const calledAtModuleScope = (env: SymbolicEnvironment): boolean => {
    const call = env.point;
    if (call === undefined || call === env.scopeNode) return false;
    for (
      let current = state.parentsByNode.get(call);
      current;
      current = state.parentsByNode.get(current)
    )
      if (t.isFunction(current) && !resolver.isModuleFactory(current))
        return false;
    return true;
  };
  const closesOverActivation = (
    fn: SymbolicFunction,
    context: PathContext,
  ): { readonly captures: boolean; readonly traceDependent: boolean } => {
    const activated = new Set<t.Node>();
    let traceDependent = false;
    const traced = (call: t.Node): boolean =>
      call === context.entryNode ||
      context.calls.includes(ipcInvocationKey(range(call)));
    for (
      let env: SymbolicEnvironment | undefined = fn.environment;
      env;
      env = env.parent
    )
      if (
        env.activation === undefined ||
        env.scopeNode === undefined ||
        resolver.isModuleFactory(env.scopeNode)
      )
        continue;
      else if (!calledAtModuleScope(env)) activated.add(env.scopeNode);
      else {
        traceDependent = true;
        if (env.point !== undefined && traced(env.point))
          activated.add(env.scopeNode);
      }
    // Scopes from the handler out to the outermost activated function, and
    // whether the function owning an arrow handler's inherited context, such
    // as `this` and `arguments`, lies within them.
    const enclosing: string[] = [];
    let activatedScopes = 0;
    let contextOwnerActivated = false;
    let contextOwnerFound = !t.isArrowFunctionExpression(fn.node);
    for (
      let current = state.parentsByNode.get(fn.node);
      current;
      current = state.parentsByNode.get(current)
    ) {
      const scopeId = state.scopeByNode.get(current)?.scopeId;
      if (scopeId !== undefined) enclosing.push(scopeId);
      if (t.isFunction(current) && !t.isArrowFunctionExpression(current))
        contextOwnerFound = true;
      // An activated arrow inside the owner does not rebind its context.
      if (activated.has(current)) {
        activatedScopes = enclosing.length;
        contextOwnerActivated ||= contextOwnerFound;
      }
    }
    if (activatedScopes === 0) return { captures: false, traceDependent };
    const scopes = new Set(enclosing.slice(0, activatedScopes));
    let captures = false;
    traverseJavaScriptValueAst(fn.node, state.erasedSyntaxNodes, {
      enter: (node, parent, readAncestors) => {
        if (captures) return;
        if (
          t.isThisExpression(node) ||
          t.isSuper(node) ||
          (t.isMetaProperty(node) && node.meta.name === "new")
        ) {
          captures =
            contextOwnerActivated && inheritsFunctionContext(node, fn.node);
          return;
        }
        if (!t.isIdentifier(node)) return;
        if (
          parent !== null &&
          semanticIdentifierRole(node, parent, readAncestors) === null
        )
          return;
        const binding = resolveSemanticBindingState(state, node, node.name);
        captures =
          binding === undefined
            ? (node.name === "arguments" &&
                contextOwnerActivated &&
                inheritsFunctionContext(node, fn.node)) ||
              semanticResolutionBlocked(state, node, node.name)
            : scopes.has(binding.scopeId);
      },
    });
    return { captures, traceDependent };
  };
  /**
   * Whether `this`, `arguments`, `super` or `new.target` at a node belongs to
   * a function enclosing the handler, as it does through arrow functions.
   */
  const inheritsFunctionContext = (node: t.Node, handler: t.Function) => {
    for (
      let current = state.parentsByNode.get(node);
      current;
      current = state.parentsByNode.get(current)
    ) {
      if (t.isFunction(current) && !t.isArrowFunctionExpression(current))
        return false;
      if (current === handler) return t.isArrowFunctionExpression(handler);
    }
    return false;
  };
  /**
   * Whether a registration's handler at an IPC site is this substituted
   * handler independent of any invocation: the same function value in the
   * site's lexical environment that closes over no traced activation's
   * bindings, or no handler argument at all.
   */
  const siteDeterminesHandler = (
    node: t.CallExpression | t.OptionalCallExpression,
    fn: SymbolicFunction | undefined,
    context: PathContext,
  ): boolean => {
    const argument = node.arguments[1];
    if (argument === undefined) return fn === undefined;
    if (fn === undefined || t.isSpreadElement(argument)) return false;
    const variants = symbolicVariants(
      resolver.evaluate(argument, resolver.environmentAt(node)),
    );
    const only = variants.length === 1 ? variants[0] : undefined;
    return (
      only?.kind === "function" &&
      only.node === fn.node &&
      !capturesActivationBindings(fn, context) &&
      !only.conditions?.length
    );
  };
  const hasConditions = (value: SymbolicValue): boolean =>
    symbolicVariants(value).some((variant) => variant.conditions?.length);
  const bridgeSites = new Map<string, BridgeSite>();
  // Sites whose direct syntax already observed every fact substitution could
  // recover: a literal key and an object literal without unknown members.
  let completeBridgeSyntax: Set<string> | undefined;
  const bridgeSiteAt = (
    node: t.CallExpression | t.OptionalCallExpression,
    siteKey: string,
    worldNode: t.Node | undefined,
  ): BridgeSite | undefined => {
    completeBridgeSyntax ??= new Set(
      accumulator.contextBridgeApis.flatMap(({ value }) =>
        value.api_key !== null &&
        value.api_status === "object-literal" &&
        value.unknown_members === 0
          ? [javascriptSourceRangeKey(value.location)]
          : [],
      ),
    );
    if (completeBridgeSyntax.has(siteKey)) return undefined;
    let site = bridgeSites.get(siteKey);
    if (site === undefined) {
      site = {
        offset: node.start ?? -1,
        worldExpression: boundedExpression(source, worldNode),
        exposures: new Map(),
        unresolved: false,
      };
      bridgeSites.set(siteKey, site);
    }
    return site;
  };
  /**
   * Dotted member paths of one exposed API value, bounded like the direct
   * syntax inventory. A nested value is enumerated when it resolves to an
   * unconditional object; other values remain leaf members, as in syntax.
   */
  const bridgeMemberInventory = (
    object: SymbolicValue,
  ): { readonly members: readonly string[]; readonly unknown: number } => {
    const members = new Set<string>();
    let unknown = 0;
    const visit = (value: SymbolicValue, prefix: readonly string[]): void => {
      if (prefix.length >= contextBridgeMemberPathDepth) {
        unknown += 1;
        return;
      }
      unknown += resolver.unknownMembers(value);
      for (const member of resolver.members(value)) {
        if (--remainingVisits < 0) {
          unknown += 1;
          return;
        }
        const path = [...prefix, member];
        members.add(path.join("."));
        for (const variant of symbolicVariants(
          resolver.property(value, member),
        ))
          if (
            (variant.kind === "object" ||
              variant.kind === "record" ||
              variant.kind === "namespace") &&
            !variant.conditions?.length
          )
            visit(variant, path);
        if (remainingVisits < 0) return;
      }
    };
    visit(object, []);
    return {
      members: [...members].sort(compareUnicodeCodePoints),
      unknown,
    };
  };
  function* bridgeMemberFunctions(
    value: SymbolicValue,
    segments: readonly string[] = [],
    active = new Set<SymbolicValue>(),
  ): Generator<{
    readonly name: string;
    readonly path: readonly string[];
    readonly fn: SymbolicFunction;
  }> {
    if (active.has(value)) return;
    if (active.size >= 128) {
      accumulator.unknownFindings += 1;
      accumulator.electronCallPathLimitReached = true;
      return;
    }
    const nested = new Set(active);
    nested.add(value);
    for (const member of [...resolver.members(value)].sort()) {
      if (--remainingVisits < 0) return;
      const path = [...segments, member];
      const name = path.join(".");
      for (const variant of symbolicVariants(
        resolver.property(value, member),
      )) {
        if (variant.kind === "function") yield { name, path, fn: variant };
        else if (resolver.members(variant).length > 0)
          yield* bridgeMemberFunctions(variant, path, nested);
      }
      if (remainingVisits < 0) return;
    }
  }
  const isolatedBridgeCall = (
    node: t.CallExpression | t.OptionalCallExpression,
  ):
    | { readonly env: SymbolicEnvironment; readonly callee: SymbolicValue }
    | undefined => {
    const env = resolver.environmentAt(node);
    const callee = resolver.evaluate(node.callee, env);
    return symbolicVariants(callee).some(
      (callee) =>
        callee.kind === "external" &&
        identity.intactExport(callee.path) &&
        callee.path.slice(1).join(".") ===
          "contextBridge.exposeInIsolatedWorld",
    )
      ? { env, callee }
      : undefined;
  };
  const electronStaticSymbolicValue = (
    value: SymbolicValue | undefined,
    node: t.Node | undefined,
  ): ElectronStaticValue => {
    const variants = value === undefined ? [] : symbolicVariants(value);
    const variant = variants.length === 1 ? variants[0] : undefined;
    if (variant?.kind === "literal" && variant.value !== undefined)
      return {
        status: "literal",
        value: variant.value,
        expression: null,
      };
    return {
      status: "dynamic",
      value: null,
      expression: boundedExpression(source, node),
    };
  };
  const emit = (
    context: PathContext,
    node: t.Node,
    terminal: string,
    channel = context.channel,
  ): void => {
    if (context.entryKind === null) return;
    const path: ElectronCallPath = {
      entry_kind: context.entryKind,
      entry: context.entry,
      ...(context.entryKind !== "bridge-member" ||
      context.entryPath === undefined
        ? {}
        : { entry_path: context.entryPath }),
      channel,
      terminal,
      resolution: "candidate",
      steps: [...context.steps, step(node, "terminal", terminal)],
      conditions: context.conditions,
    };
    const key = JSON.stringify(path);
    if (seen.has(key)) return;
    seen.add(key);
    paths.push(path);
  };
  const functionBody = (
    fn: SymbolicFunction,
    args: readonly SymbolicValue[],
    context: PathContext,
    invocationNode: t.Node,
    caller?: SymbolicEnvironment,
  ): void => {
    const body = resolver.callBody(fn);
    if (body === undefined || context.active.has(fn.node)) return;
    if (fn.conditionUnresolved === true) {
      accumulator.unknownFindings += 1;
      return;
    }
    const name =
      (t.isFunctionExpression(fn.node) || t.isFunctionDeclaration(fn.node)) &&
      fn.node.id
        ? fn.node.id.name
        : "closure";
    walk(body, resolver.bind(fn, args, invocationNode, caller), {
      ...context,
      steps: [
        ...context.steps,
        ...fn.origins.map((n) =>
          step(
            n,
            "factory",
            t.isCallExpression(n) ? callLabel(n.callee) : "factory",
          ),
        ),
        step(fn.node, "function", name),
      ],
      active: new Set([...context.active, fn.node]),
    });
  };
  const ipc = (
    node: t.CallExpression | t.OptionalCallExpression,
    descriptor: ElectronIpcDescriptor,
    args: readonly SymbolicValue[],
    context: PathContext,
    endpoint: string,
    guardedDispatch: boolean,
  ): void => {
    const location = range(node);
    // The site evaluated in its own scope is not an invocation of it.
    const invocationSite =
      context.calls.length > 0
        ? ipcSiteKey({ ...descriptor, location })
        : undefined;
    const open = (): void => {
      if (invocationSite !== undefined) openInvocationSites.add(invocationSite);
    };
    const first = args[0];
    if (first?.kind !== "literal" || typeof first.value !== "string") {
      accumulator.unknownFindings += 1;
      return open();
    }
    const channelContext = metadataContext(context, first);
    if (!channelContext) return open();
    const handlerValue = args[1] ?? symbolicUnknown("missing handler");
    const handlerContext = metadataContext(channelContext, handlerValue);
    if (!handlerContext) return open();
    const channel = first.value;
    const invocationLocation =
      javascriptSourceRangeKey(range(context.entryNode)) ===
      javascriptSourceRangeKey(location)
        ? undefined
        : range(context.entryNode);
    const findingContext = {
      module_key: null,
      location,
      ...(invocationLocation === undefined
        ? {}
        : { invocation_location: invocationLocation }),
    };
    const handlers = symbolicVariants(handlerValue);
    // A channel registration must not acquire one arbitrary handler from a union.
    // Keep the unresolved registration so it still competes with other handlers.
    const fn =
      handlers.length === 1 && handlers[0]?.kind === "function"
        ? handlers[0]
        : undefined;
    const handlerNode = node.arguments[1];
    const finding: ElectronIpcFinding =
      descriptor.mode === "send" || descriptor.mode === "invoke"
        ? {
            ...descriptor,
            channel,
            channel_expression: null,
            handler_kind: null,
            handler_location: null,
            ...findingContext,
          }
        : fn
          ? {
              ...descriptor,
              channel,
              channel_expression: null,
              handler_kind: "inline-function",
              handler_location: range(fn.node),
              ...findingContext,
            }
          : handlerNode
            ? {
                ...descriptor,
                channel,
                channel_expression: null,
                handler_kind: "dynamic-expression",
                handler_location: range(handlerNode),
                ...findingContext,
              }
            : {
                ...descriptor,
                channel,
                channel_expression: null,
                handler_kind: "missing",
                handler_location: null,
                ...findingContext,
              };
    // A fully observed transmission stays one source fact when its callback is
    // traced. Registrations retain invocation identity because handlers compete.
    // An entry nested in another entry's calls traces the same physical call
    // sequence; an identical finding from it adds no invocation.
    const perInvocationHandler =
      fn !== undefined && capturesActivationBindings(fn, context);
    const recorded = ipcAtEndpoint().get(ipcEndpointKey(finding));
    const valueKey = ipcValueKey({
      ...finding,
      resolution_basis: "wrapper-substitution",
    });
    // A closure over this invocation's bindings is its own handler, even when
    // another entry already traced the same calls.
    const prior =
      recorded === undefined || perInvocationHandler
        ? undefined
        : priorPath(recorded, valueKey, context.calls);
    const duplicate =
      recorded !== undefined &&
      (recorded.observedTransmission ||
        (context.entryKind === "bridge-member" &&
          recorded.observedRendererListener) ||
        recorded.invocations.has(ipcInvocationKey(invocationLocation)) ||
        prior?.repeated === true);
    const findingGuarded =
      context.conditions.length > 0 || hasConditions(first) || guardedDispatch;
    // Registry facts do not establish every bridge entry's reachability. Only
    // this exact entry and provenance trace can discharge its guarded copy.
    const registrationKey =
      descriptor.side === "main"
        ? JSON.stringify([
            endpoint,
            channel,
            location,
            range(context.entryNode),
            context.entryKind,
            context.entry,
            context.entryPath,
            context.steps,
          ])
        : undefined;
    if (!findingGuarded && registrationKey !== undefined)
      unconditionalRegistrations.add(registrationKey);
    // A guarded registration keeps its predicate on the call path instead of
    // becoming an IPC finding, so the site carries its channel to pairing.
    const guardedOnly =
      findingGuarded &&
      (registrationKey === undefined ||
        !unconditionalRegistrations.has(registrationKey));
    if (invocationSite !== undefined) {
      let traced = literalInvocationSites.get(invocationSite);
      if (traced === undefined) {
        traced = { node, calls: new Set(), guardedChannels: new Set() };
        literalInvocationSites.set(invocationSite, traced);
      }
      for (const call of context.calls) traced.calls.add(call);
      if (guardedOnly) traced.guardedChannels.add(channel);
    }
    if (!duplicate && !findingGuarded) {
      const value: ElectronIpcFinding = {
        ...finding,
        resolution_basis: "wrapper-substitution",
      };
      const shorter = prior?.shorter;
      if (shorter !== undefined && recorded !== undefined) {
        // This path invokes the sequence a nested entry traced alone, so its
        // fuller invocation takes over that record instead of adding another.
        accumulator.ipc[shorter.slot] = { offset: node.start ?? -1, value };
        shorter.calls = context.calls;
        recorded.invocations.add(ipcInvocationKey(invocationLocation));
      } else {
        // A finding the site itself determines, such as one whose channel is a
        // local constant, is the same physical operation the syntax pass left
        // unresolved, so it resolves that observation. A channel or handler from
        // an invocation argument is one candidate; other callers may pass
        // values this pass never sees.
        const site = ipcSiteKey(value);
        const observed = unresolvedIpcSites?.get(site);
        const unresolved =
          observed !== undefined &&
          siteDeterminedChannel(node) === channel &&
          (descriptor.mode === "send" ||
            descriptor.mode === "invoke" ||
            siteDeterminesHandler(node, fn, context))
            ? observed
            : undefined;
        const slot = unresolved ?? accumulator.ipc.length;
        if (unresolved === undefined)
          accumulator.ipc.push({ offset: node.start ?? -1, value });
        else {
          accumulator.ipc[unresolved] = { offset: node.start ?? -1, value };
          unresolvedIpcSites?.delete(site);
          // The syntax pass counted this channel as unknown; it is now known.
          accumulator.unknownFindings = Math.max(
            0,
            accumulator.unknownFindings - 1,
          );
        }
        indexIpcFinding(
          ipcAtEndpoint(),
          value,
          unresolved !== undefined,
          // Its call chain can never deduplicate a later path.
          perInvocationHandler ? undefined : { calls: context.calls, slot },
        );
        if (descriptor.mode !== "send" && descriptor.mode !== "invoke" && !fn)
          accumulator.unknownFindings += 1;
      }
    } else if (guardedOnly) {
      accumulator.unknownFindings += 1;
      // A guarded registration is a path candidate even when its callback has
      // no observable body. Keep its predicate instead of promoting it to an
      // unconditional IPC fact or dropping the registration entirely.
      if (descriptor.side === "main")
        emit(
          {
            ...channelContext,
            entryKind: channelContext.entryKind ?? "ipc-handler",
            entry: channelContext.entry || channel,
          },
          node,
          endpoint,
          channel,
        );
    }
    if (descriptor.mode === "send" || descriptor.mode === "invoke") {
      emit(channelContext, node, endpoint, channel);
      return;
    }
    if (
      descriptor.side === "renderer" &&
      descriptor.mode === "listen" &&
      context.entryKind === "bridge-member"
    )
      emit(channelContext, node, endpoint, channel);
    if (descriptor.side === "main" && fn)
      functionBody(
        fn,
        [
          { kind: "external", path: ["ipc-event"] },
          symbolicUnknown("IPC payload"),
        ],
        {
          ...handlerContext,
          entryKind: "ipc-handler",
          entry: channel,
          channel,
          steps: [...context.steps, step(node, "ipc", endpoint)],
        },
        node,
      );
  };
  const bridge = (
    node: t.CallExpression | t.OptionalCallExpression,
    exposure: JavaScriptContextBridgeExposureArguments<SymbolicValue>,
    context: PathContext,
    guardedDispatch: boolean,
  ): void => {
    const location = range(node);
    const worldNode =
      exposure.worldIdIndex === null
        ? undefined
        : argumentNode(node.arguments[exposure.worldIdIndex]);
    // Absent when complete direct syntax leaves substitution nothing to add.
    const site = bridgeSiteAt(
      node,
      javascriptSourceRangeKey(location),
      worldNode,
    );
    // The site evaluated in its own scope is not an invocation; a traced call
    // that leaves this exposure unresolved keeps the syntax observation.
    const unresolved = (): void => {
      if (site !== undefined && context.calls.length > 0)
        site.unresolved = true;
    };
    const key = exposure.apiKey;
    const object = exposure.api;
    const worldValue =
      exposure.worldId === null
        ? null
        : (exposure.worldId ?? symbolicUnknown("missing world id"));
    const worldContext =
      worldValue === null ? context : metadataContext(context, worldValue);
    if (!worldContext) return unresolved();
    const worldId =
      worldValue === null
        ? null
        : electronStaticSymbolicValue(worldValue, worldNode);
    if (worldId?.status === "dynamic") accumulator.unknownFindings += 1;
    if (key?.kind !== "literal" || typeof key.value !== "string" || !object) {
      accumulator.unknownFindings += 1;
      return unresolved();
    }
    const keyContext = metadataContext(worldContext, key);
    if (!keyContext || !metadataContext(keyContext, object))
      return unresolved();
    // This report shape has no predicate field, so a guarded world or object
    // cannot be recorded as an unconditional exposure fact.
    const guardedWorld = worldValue !== null && hasConditions(worldValue);
    const guardedKey = hasConditions(key);
    const guardedObject = hasConditions(object);
    const guarded =
      context.conditions.length > 0 ||
      guardedWorld ||
      guardedKey ||
      guardedObject ||
      guardedDispatch;
    if (guarded) {
      accumulator.unknownFindings += 1;
      unresolved();
    } else if (site !== undefined) {
      // Each invocation binds its own key and object, so one helper's exposure
      // call contributes a separate API per key it is invoked with.
      const inventory = bridgeMemberInventory(object);
      const finding: ElectronContextBridgeFinding = {
        world: exposure.world,
        world_id: worldId,
        api_key: key.value,
        api_key_expression: null,
        api_status: "dynamic",
        resolution_basis: "wrapper-substitution",
        members: inventory.members,
        unknown_members: inventory.unknown,
        module_key: null,
        location,
      };
      const identity = bridgeExposureKey(finding);
      const contribution = bridgeContributionKey(finding);
      const prior = site.exposures.get(identity);
      if (prior === undefined)
        site.exposures.set(identity, {
          value: finding,
          contributions: new Set([contribution]),
        });
      else if (!prior.contributions.has(contribution)) {
        prior.contributions.add(contribution);
        const merged = mergeBridgeExposures(
          prior.value,
          finding,
          site.worldExpression,
        );
        if (
          merged.world_id?.status === "dynamic" &&
          prior.value.world_id?.status === "literal" &&
          worldId?.status === "literal"
        )
          accumulator.unknownFindings += 1;
        prior.value = merged;
      }
    }
    for (const { name, path, fn } of bridgeMemberFunctions(object)) {
      const memberContext = metadataContext(keyContext, fn);
      if (!memberContext) continue;
      const entry = `${key.value}.${name}`;
      functionBody(
        fn,
        runtimeFunctionParameters(fn.node).map(() =>
          symbolicUnknown("public API argument"),
        ),
        {
          ...memberContext,
          entryNode: node,
          calls: [],
          entryKind: "bridge-member",
          entry,
          entryPath: [key.value, ...path],
          channel: null,
          steps: [step(node, "exposure", entry)],
          active: new Set(),
        },
        node,
      );
    }
  };
  const call = (
    node: t.CallExpression | t.OptionalCallExpression,
    env: SymbolicEnvironment,
    context: PathContext,
    evaluatedCallee?: SymbolicValue,
  ): void => {
    const value = evaluatedCallee ?? resolver.evaluate(node.callee, env);
    const args = resolver.arguments(node, env);
    for (const callee of symbolicVariants(value)) {
      const branchContext = metadataContext(context, callee);
      if (!branchContext) continue;
      if (callee.kind === "function") {
        functionBody(
          callee,
          args,
          {
            ...branchContext,
            calls: [...branchContext.calls, ipcInvocationKey(range(node))],
            steps: [
              ...branchContext.steps,
              step(node, "call", callLabel(node.callee)),
            ],
          },
          node,
          env,
        );
      } else if (callee.kind === "external") {
        const path = callee.path;
        const endpoint = path.join(".");
        if (identity.intactExport(path)) {
          const descriptor = ipcDescriptor(path.slice(1));
          const exposure =
            path.length === 3 && path[1] === "contextBridge"
              ? contextBridgeExposureArguments(path[2] ?? "", args)
              : undefined;
          if (exposure)
            bridge(node, exposure, branchContext, hasConditions(callee));
          else if (descriptor)
            ipc(
              node,
              descriptor,
              args,
              branchContext,
              endpoint,
              hasConditions(callee),
            );
          else if (path[1] === "clipboard") emit(branchContext, node, endpoint);
        } else if (
          (path[0] === "navigator" && path[1] === "clipboard") ||
          (path[0] === "ipc-event" && path[1] === "sender")
        )
          emit(branchContext, node, endpoint);
      }
    }
  };
  /**
   * Replace each site's syntax observation with the exposures its invocations
   * resolved. One a traced invocation left unresolved still stands for that
   * invocation; when it names a resolved key, it is that exposure's
   * unresolved alternative.
   */
  function recordBridgeExposures(): void {
    if (bridgeSites.size === 0) return;
    const sites = new Map(bridgeSites);
    const resolved = (site: BridgeSite) =>
      [...site.exposures.values()].map(({ value }) => ({
        offset: site.offset,
        value,
      }));
    const findings = accumulator.contextBridgeApis.flatMap((entry) => {
      const siteKey = javascriptSourceRangeKey(entry.value.location);
      const site = sites.get(siteKey);
      if (site === undefined) return [entry];
      sites.delete(siteKey);
      if (site.exposures.size === 0) return [entry];
      if (!site.unresolved) return resolved(site);
      const same = site.exposures.get(bridgeExposureKey(entry.value));
      if (same === undefined) return [entry, ...resolved(site)];
      same.value = mergeBridgeExposures(
        same.value,
        entry.value,
        site.worldExpression,
      );
      return resolved(site);
    });
    // Exposures direct syntax did not identify follow in source order.
    for (const site of [...sites.values()].sort((a, b) => a.offset - b.offset))
      for (const finding of resolved(site)) findings.push(finding);
    accumulator.contextBridgeApis.length = 0;
    for (const finding of findings) accumulator.contextBridgeApis.push(finding);
  }
  function walk(
    node: t.Node,
    env: SymbolicEnvironment,
    context: PathContext,
  ): void {
    if (state.erasedSyntaxNodes.has(node)) return;
    if (--remainingVisits < 0 || t.isFunction(node) || t.isClass(node)) return;
    if (t.isBlockStatement(node)) {
      let next = context;
      for (const statement of node.body) {
        walk(statement, env, next);
        if (remainingVisits < 0) return;
        const fallthrough = sequentialFallthrough(
          prefixes.statement(statement, node) ?? null,
          env,
          next,
        );
        if (!fallthrough.continues) break;
        next = fallthrough.context;
      }
      return;
    }
    if (t.isIfStatement(node) || t.isConditionalExpression(node)) {
      const truth = symbolicTruth(resolver.evaluate(node.test, env));
      if (truth !== false)
        walk(
          node.consequent,
          env,
          truth === undefined ? condition(context, node.test) : context,
        );
      if (truth !== true && node.alternate)
        walk(
          node.alternate,
          env,
          truth === undefined ? condition(context, node.test, false) : context,
        );
      return;
    }
    if (t.isLogicalExpression(node)) {
      walk(node.left, env, context);
      const right = symbolicLogicalRight(
        node.operator,
        resolver.evaluate(node.left, env),
      );
      if (right === false) return;
      walk(
        node.right,
        env,
        right === undefined
          ? condition(
              context,
              node.left,
              node.operator === "??" ? "nullish" : node.operator === "&&",
            )
          : context,
      );
      return;
    }
    if (t.isSwitchStatement(node)) {
      walk(node.discriminant, env, context);
      for (let index = 0; index < node.cases.length; index += 1) {
        if (remainingVisits < 0) return;
        const branch = node.cases[index]!;
        if (branch.test) walk(branch.test, env, context);
        if (remainingVisits < 0) return;
        const branchContext = switchCaseContext(node, index, context);
        for (const statement of branch.consequent) {
          if (remainingVisits < 0) return;
          walk(statement, env, branchContext);
        }
      }
      return;
    }
    if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
      call(node, env, context);
    for (const child of childNodes(node)) {
      if (remainingVisits < 0) return;
      walk(child, env, context);
    }
  }
  let prefixVisits = 0;
  function* seed(
    node: t.CallExpression | t.OptionalCallExpression,
  ): Generator<void, void> {
    if (remainingVisits < 0) return;
    const isolatedSeed = t.isStringLiteral(node.arguments[0])
      ? undefined
      : isolatedBridgeCall(node);
    if (!t.isStringLiteral(node.arguments[0]) && isolatedSeed === undefined)
      return;
    const env = isolatedSeed?.env ?? resolver.environmentAt(node);
    let context: PathContext = {
      entryNode: node,
      calls: [],
      entry: "",
      entryKind: null,
      channel: null,
      steps: [],
      conditions: [],
      active: new Set(),
    };
    for (
      let child: t.Node = node, parent = state.parentsByNode.get(child);
      parent && !t.isFunction(parent);
      child = parent, parent = state.parentsByNode.get(child)
    ) {
      if (--remainingVisits < 0) return;
      if (++prefixVisits % 1024 === 0) yield;
      if (t.isIfStatement(parent) || t.isConditionalExpression(parent)) {
        if (child === parent.test) continue;
        const truth = symbolicTruth(resolver.evaluate(parent.test, env));
        const positive = child === parent.consequent;
        if (truth !== undefined && truth !== positive) return;
        if (truth === undefined)
          context = condition(context, parent.test, positive);
      } else if (t.isSwitchCase(parent) && child !== parent.test) {
        const owner = state.parentsByNode.get(parent);
        if (owner && t.isSwitchStatement(owner)) {
          let index = 0;
          while (index < owner.cases.length && owner.cases[index] !== parent) {
            if (--remainingVisits < 0) return;
            index += 1;
          }
          if (index < owner.cases.length)
            context = switchCaseContext(owner, index, context);
          else accumulator.unknownFindings += 1;
        } else accumulator.unknownFindings += 1;
      } else if (t.isLogicalExpression(parent) && child === parent.right) {
        const right = symbolicLogicalRight(
          parent.operator,
          resolver.evaluate(parent.left, env),
        );
        if (right === false) return;
        if (right === undefined)
          context = condition(
            context,
            parent.left,
            parent.operator === "??" ? "nullish" : parent.operator === "&&",
          );
      } else if (t.isBlockStatement(parent)) {
        const prefix = yield* prefixes.before(parent, child);
        if (remainingVisits < 0) return;
        if (prefix !== undefined) {
          for (const entry of prefix.entries) {
            if (entry.position >= prefix.before) break;
            if (--remainingVisits < 0) return;
            if (++prefixVisits % 1024 === 0) yield;
            const fallthrough = sequentialFallthrough(entry.fact, env, context);
            if (!fallthrough.continues) return;
            context = fallthrough.context;
          }
        }
      }
    }
    call(node, env, context, isolatedSeed?.callee);
  }
  // The shared walker supplies one bounded batch at a time. Prefix work must
  // run outside its synchronous callback so cancellation can interrupt a large
  // block index or a genuinely long sequence of contextual branch facts.
  const seeds: (t.CallExpression | t.OptionalCallExpression)[] = [];
  const traversal = traverseJavaScriptValueAstSteps(
    program,
    state.erasedSyntaxNodes,
    {
      enter: (node) => {
        if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
          seeds.push(node);
      },
    },
  );
  try {
    for (;;) {
      const batch = traversal.next();
      for (const node of seeds) {
        yield* seed(node);
        if (remainingVisits < 0) break;
      }
      seeds.length = 0;
      if (batch.done || remainingVisits < 0) break;
      yield;
    }
  } finally {
    traversal.return();
  }
  recordBridgeExposures();
  if (remainingVisits < 0 || resolver.truncated) {
    accumulator.unknownFindings += 1;
    accumulator.electronCallPathLimitReached = true;
  } else
    // A dynamic site's channels are enumerated only when the complete trace
    // reached it with literal channels, no other invocation outcome, and no
    // way to invoke its wrapper from sites the trace does not seed.
    for (const [site, index] of unresolvedIpcSites ?? []) {
      const entry = accumulator.ipc[index];
      const traced = literalInvocationSites.get(site);
      if (
        entry?.value.channel === null &&
        traced !== undefined &&
        !openInvocationSites.has(site) &&
        tracedInvocationsOnly(traced.node, traced.calls)
      )
        accumulator.ipc[index] = {
          ...entry,
          value: {
            ...entry.value,
            invocation_channels: "literal",
            ...(traced.guardedChannels.size === 0
              ? {}
              : {
                  guarded_invocation_channels: [...traced.guardedChannels].sort(
                    compareUnicodeCodePoints,
                  ),
                }),
          },
        };
    }
  if (resolver.unresolved) accumulator.unknownFindings += 1;
  return paths;
}
