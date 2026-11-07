import * as t from "@babel/types";
import {
  staticObjectPropertyReader,
  readExactJavaScriptLiteral,
  isObjectPrototypeSetter,
  objectDataPropertyValue,
  semanticStaticPropertyKey,
  semanticWriteSiteTarget,
  semanticWriteTargets,
  runtimeFunctionParameters,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { createSemanticExpressionShapeResolver } from "./javascriptSemanticExpressionShapes.js";
import { createGlobalReferenceReader } from "./javascriptSemanticAmbientWrites.js";
import { javascriptBootstrapAt } from "./javascriptBootstrap.js";
import { ELECTRON_MODULE } from "./javascriptElectronMemberWrites.js";
import {
  indexJavaScriptElectronIdentitySteps,
  type JavaScriptElectronIdentity,
} from "./javascriptSemanticAnalysis.js";
import { semanticArrayIndex } from "./javascriptSemanticPropertyPaths.js";
import { symbolicLogicalRight } from "./javascriptSymbolicControlFlow.js";
import {
  moduleFactory,
  modulePropertyName,
} from "./javascriptStaticAnalysisHelpers.js";
import {
  completeSemanticSteps,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";
import {
  resolveSemanticBindingState,
  semanticResolutionBlocked,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import {
  symbolicCondition,
  symbolicUnion,
  symbolicUnknown,
  symbolicVariants,
  symbolicTruth,
  type SymbolicCondition,
  type SymbolicMetadata,
  type SymbolicValue,
  type SymbolicEnvironment,
  type SymbolicFunction,
} from "./javascriptSymbolicValues.js";

interface PropertyWrite {
  readonly path: readonly string[];
  readonly value: t.Node;
  readonly site: t.Node;
}
interface SymbolicReturnFlow extends SymbolicMetadata {
  readonly values: readonly SymbolicValue[];
  readonly fallsThrough: boolean;
}
interface SymbolicPropertyRead {
  readonly node: t.Node;
  readonly environment: SymbolicEnvironment;
}
interface SymbolicReadBoundary {
  readonly node: t.Node;
  readonly edge: "start" | "end";
}
type SymbolicNamespace = Extract<SymbolicValue, { kind: "namespace" }>;

const emptyEnvironment: SymbolicEnvironment = { values: new Map() };

const containsOwnedReturn = (root: t.Node): boolean => {
  let found = false;
  traverseJavaScriptAst(root, {
    skip: (node) => found || t.isFunction(node) || t.isClass(node),
    enter: (node) => {
      if (t.isReturnStatement(node)) found = true;
    },
  });
  return found;
};

/** Demand-driven substitutions for local bindings, closures and literal module tables. */
export class JavaScriptSymbolicBindings {
  readonly #writes = new Map<string, PropertyWrite[]>();
  readonly #environments = new WeakMap<t.Node, SymbolicEnvironment>();
  readonly #cache = new WeakMap<
    SymbolicEnvironment,
    WeakMap<t.Node, SymbolicValue>
  >();
  readonly #active = new Set<t.Node>();
  readonly #activeFunctions = new Set<t.Function>();
  readonly #exportAliases = new Map<string, string>();
  readonly #moduleBindings = new Set<string>();
  readonly #completedModules = new WeakMap<
    SymbolicEnvironment,
    SymbolicValue
  >();
  readonly #completionGroups = new WeakMap<
    SymbolicValue,
    {
      readonly members: ReadonlySet<SymbolicValue>;
      readonly common: SymbolicNamespace;
    }
  >();
  readonly #propertyActive = new WeakMap<object, Set<string>>();
  readonly #literalPropertyIndex = new WeakMap<
    t.ObjectExpression,
    ReadonlyMap<string, t.ObjectMethod | t.ObjectProperty> | null
  >();
  readonly #mutated = new Set<string>();
  readonly #electronIdentity: JavaScriptElectronIdentity;
  readonly #namespaceOwners = new Map<string, t.Function>();
  readonly #moduleFactories = new WeakSet<t.Function>();
  readonly #unsafeExports = new Set<string>();
  readonly #aliasesByBinding = new Map<string, string[]>();
  readonly #bootstrapTables: Array<{
    readonly tableAliases: ReadonlySet<string>;
    readonly modules: Map<string, SymbolicValue>;
  }> = [];
  #remainingEvaluations = 1_000_000;
  #depth = 0;
  truncated = false;
  unresolved = false;

  constructor(
    readonly state: JavaScriptSemanticAnalysisState,
    program: t.Program,
    electronIdentity = completeSemanticSteps(
      indexJavaScriptElectronIdentitySteps(program, state),
    ),
  ) {
    this.#electronIdentity = electronIdentity;
    const shapes = createSemanticExpressionShapeResolver(state);
    const defineProperty = createGlobalReferenceReader(state, [
      "Object",
      "defineProperty",
    ]);
    this.#indexBindingAliases();
    traverseJavaScriptAst(program, {
      enter: (node) => {
        if (t.isCallExpression(node)) this.#indexBootstrap(node);
      },
    });
    traverseJavaScriptAst(program, {
      enter: (node) => {
        const target = semanticWriteSiteTarget(node);
        if (target !== null) this.#indexWriteSite(target, node);
        if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
          const intrinsic = defineProperty(node.callee);
          if (intrinsic.status === "unrelated") return;
          const [target, key, descriptor] = node.arguments;
          if (
            t.isIdentifier(target) &&
            t.isStringLiteral(key) &&
            descriptor !== undefined
          ) {
            if (intrinsic.status !== "unmodified") {
              const replacement =
                intrinsic.status === "replacement"
                  ? unwrapJavaScriptExpression(intrinsic.value).node
                  : undefined;
              const unchanged =
                (t.isFunctionExpression(replacement) ||
                  t.isArrowFunctionExpression(replacement)) &&
                (t.isBlockStatement(replacement.body)
                  ? replacement.body.body.length === 0
                  : readExactJavaScriptLiteral(replacement.body).found) &&
                runtimeFunctionParameters(replacement).every(
                  (parameter) =>
                    t.isIdentifier(parameter) ||
                    (t.isRestElement(parameter) &&
                      t.isIdentifier(parameter.argument)),
                );
              if (!unchanged) this.#addWrite(target, [key.value], node, node);
              return;
            }
            const properties = staticObjectPropertyReader(
              unwrapJavaScriptExpression(descriptor).node,
              shapes.isNullish,
            );
            const value = properties("value");
            const hasAccessor =
              properties("get").status !== "missing" ||
              properties("set").status !== "missing";
            if (value.status === "explicit" && !hasAccessor)
              this.#addWrite(target, [key.value], value.value, node);
            else if (value.status !== "missing" || hasAccessor)
              // Unknown values, accessor replacements and invalid mixed
              // descriptors cannot preserve an earlier data export.
              this.#addWrite(target, [key.value], node, node);
          }
        }
      },
    });
    for (const table of this.#bootstrapTables)
      this.#invalidateBootstrapTable(table.tableAliases, table.modules);
  }

  /** Whether a function is a recognized bundle module factory, which runs once per module load. */
  isModuleFactory(node: t.Node): boolean {
    return t.isFunction(node) && this.#moduleFactories.has(node);
  }

  environmentAt(node: t.Node): SymbolicEnvironment {
    let current: t.Node | undefined = node;
    while (current) {
      const found = this.#environments.get(current);
      if (found) return found;
      current = this.state.parentsByNode.get(current);
    }
    return emptyEnvironment;
  }

  evaluate(
    input: t.Node | null | undefined,
    environment?: SymbolicEnvironment,
  ): SymbolicValue {
    if (!input) return { kind: "literal", value: undefined };
    if (--this.#remainingEvaluations < 0 || this.#depth >= 128) {
      this.truncated = true;
      return symbolicUnknown("symbolic resource limit");
    }
    const node = unwrapJavaScriptExpression(input).node;
    const env = environment ?? this.environmentAt(node);
    const cache = this.#cache.get(env) ?? new WeakMap<t.Node, SymbolicValue>();
    this.#cache.set(env, cache);
    const cached = cache.get(node);
    if (cached) return cached;
    if (this.#active.has(node)) return symbolicUnknown("cyclic binding");
    this.#active.add(node);
    this.#depth += 1;
    try {
      const value = this.#evaluate(node, env);
      cache.set(node, value);
      return value;
    } finally {
      this.#active.delete(node);
      this.#depth -= 1;
    }
  }

  #withConditions(
    value: SymbolicValue,
    source: SymbolicMetadata,
  ): SymbolicValue {
    const conditions = source.conditions ?? [];
    if (conditions.length === 0 && !source.conditionUnresolved) return value;
    const variants = symbolicVariants(value);
    // Charge the representation expansion before allocating copies. A long
    // sequence of early exits otherwise builds unbounded predicate prefixes.
    for (const variant of variants) {
      const cost =
        1 +
        (conditions.length
          ? conditions.length + (variant.conditions?.length ?? 0)
          : 0);
      if (cost > this.#remainingEvaluations) {
        this.#remainingEvaluations = 0;
        this.truncated = true;
        return symbolicUnknown("symbolic condition resource limit");
      }
      this.#remainingEvaluations -= cost;
    }
    return symbolicUnion(
      variants.map((variant) => ({
        ...variant,
        ...(conditions.length
          ? { conditions: [...(variant.conditions ?? []), ...conditions] }
          : {}),
        ...(source.conditionUnresolved
          ? { conditionUnresolved: true as const }
          : {}),
      })),
    );
  }

  property(
    value: SymbolicValue,
    key: string,
    read?: SymbolicPropertyRead,
  ): SymbolicValue {
    let result: SymbolicValue;
    if (value.kind === "union")
      result = symbolicUnion([
        ...this.#commonProperty(value.values, key, read),
        ...value.values.map((variant) => this.property(variant, key, read)),
      ]);
    else result = this.#property(value, key, read);
    return this.#withConditions(result, value);
  }

  #commonProperty(
    values: readonly SymbolicValue[],
    key: string,
    read?: SymbolicPropertyRead,
  ): readonly SymbolicValue[] {
    const first = values[0];
    const group =
      first === undefined ? undefined : this.#completionGroups.get(first);
    if (group === undefined || group.members.size !== values.length) return [];
    if (values.length > this.#remainingEvaluations) {
      this.truncated = true;
      this.#remainingEvaluations = 0;
      return [];
    }
    this.#remainingEvaluations -= values.length;
    // Only the complete, original partition proves an unconditional fact.
    // Added predicates or a subset of exits cannot borrow this proof.
    if (!values.every((value) => group.members.has(value))) return [];
    const common = this.property(group.common, key, read);
    return common.kind === "unknown" ? [] : [common];
  }

  #property(
    value: SymbolicValue,
    key: string,
    read?: SymbolicPropertyRead,
  ): SymbolicValue {
    const active = this.#propertyActive.get(value) ?? new Set<string>();
    if (active.has(key)) return symbolicUnknown("cyclic property");
    active.add(key);
    this.#propertyActive.set(value, active);
    try {
      return this.#propertyValue(value, key, read);
    } finally {
      active.delete(key);
    }
  }

  #propertyValue(
    value: SymbolicValue,
    key: string,
    read?: SymbolicPropertyRead,
  ): SymbolicValue {
    if (value.kind === "external") {
      const path = [...value.path, key];
      if (
        ELECTRON_MODULE.test(path[0] ?? "") &&
        !this.#electronIdentity.intactExport(path)
      ) {
        return symbolicUnknown("overwritten Electron API member");
      }
      return { kind: "external", path };
    }
    if (value.kind === "record") {
      const property = value.values.get(key);
      if (
        key === "exports" &&
        property?.kind === "namespace" &&
        this.#namespaceOwners.has(property.bindingId)
      ) {
        // Preserve namespace identity for members, not a known runtime value.
        return { ...property, runtimeValueUnknown: true };
      }
      return property ?? symbolicUnknown("missing property");
    }
    if (value.kind === "namespace") {
      if (
        this.#mutated.has(value.bindingId) ||
        this.#unsafeExports.has(`${value.bindingId}:${key}`)
      )
        return symbolicUnknown("ambiguous export writes");
      const available = this.#namespaceWrites(value, read, key);
      if (available === undefined) {
        this.unresolved = true;
        return symbolicUnknown("module export read boundary is unavailable");
      }
      const replacement = available.findLast(
        (write) => write.path.length === 0,
      );
      if (replacement)
        return this.property(
          this.evaluate(replacement.value, value.environment),
          key,
          read,
        );
      const writes = available.filter(
        (w) => w.path.length === 1 && w.path[0] === key,
      );
      const write = writes.at(-1);
      return write
        ? this.evaluate(write.value, value.environment)
        : symbolicUnknown("unresolved module export");
    }
    if (value.kind === "object") {
      let index = this.#literalPropertyIndex.get(value.node);
      if (index === undefined) {
        const properties = new Map<string, t.ObjectMethod | t.ObjectProperty>();
        index = properties;
        for (const property of value.node.properties) {
          const name = t.isSpreadElement(property)
            ? null
            : semanticStaticPropertyKey(property.key, property.computed);
          if (name === null || t.isSpreadElement(property)) {
            index = null;
            break;
          }
          if (isObjectPrototypeSetter(property, name)) continue;
          properties.set(name, property);
        }
        this.#literalPropertyIndex.set(value.node, index);
      }
      if (index !== null) {
        const property = index.get(key);
        if (property !== undefined)
          return this.#objectPropertyValue(property, value.environment);
        if (key === "__proto__") {
          const prototypeSetter = [...value.node.properties]
            .reverse()
            .filter(
              (candidate): candidate is t.ObjectMethod | t.ObjectProperty =>
                !t.isSpreadElement(candidate),
            )
            .find((candidate) => isObjectPrototypeSetter(candidate));
          if (prototypeSetter !== undefined)
            return this.#objectPropertyValue(
              prototypeSetter,
              value.environment,
            );
        }
        return symbolicUnknown("missing property");
      }
      for (const p of [...value.node.properties].reverse()) {
        if (t.isSpreadElement(p)) {
          const spread = this.evaluate(p.argument, value.environment);
          const found = this.property(spread, key, {
            node: p.argument,
            environment: value.environment,
          });
          if (found.kind !== "unknown") return found;
          if (
            this.unknownMembers(spread) > 0 ||
            this.members(spread).includes(key)
          )
            return found;
        } else if (semanticStaticPropertyKey(p.key, p.computed) === key) {
          return this.#objectPropertyValue(p, value.environment);
        } else if (semanticStaticPropertyKey(p.key, p.computed) === null)
          return symbolicUnknown("dynamic property overwrite");
      }
    }
    if (value.kind === "array") {
      const index = semanticArrayIndex(key);
      if (index !== null)
        return value.values[index] ?? symbolicUnknown("missing argument");
    }
    if (value.kind === "iterator" || value.kind === "promise") {
      this.unresolved = true;
      return symbolicUnknown(`${value.kind} members are not modeled`);
    }
    return symbolicUnknown("unresolved property");
  }

  #objectPropertyValue(
    property: t.ObjectMethod | t.ObjectProperty,
    environment: SymbolicEnvironment,
  ): SymbolicValue {
    const value = objectDataPropertyValue(property);
    return value === undefined
      ? symbolicUnknown("accessor property")
      : this.evaluate(value, environment);
  }

  members(
    value: SymbolicValue,
    active = new Set<SymbolicValue>(),
  ): readonly string[] {
    if (active.has(value)) return [];
    active.add(value);
    if (value.kind === "union")
      return [...new Set(value.values.flatMap((v) => this.members(v, active)))];
    if (value.kind === "record") return [...value.values.keys()];
    if (value.kind === "namespace") {
      const available = this.#namespaceWrites(value);
      if (available === undefined) return [];
      const replacement = available.findLast(
        (write) => write.path.length === 0,
      );
      return replacement
        ? this.members(
            this.evaluate(replacement.value, value.environment),
            active,
          )
        : [
            ...new Set(
              available.flatMap((w) => (w.path.length === 1 ? w.path : [])),
            ),
          ];
    }
    if (value.kind !== "object") return [];
    return [
      ...new Set(
        value.node.properties.flatMap((p) =>
          t.isSpreadElement(p)
            ? this.members(this.evaluate(p.argument, value.environment), active)
            : [semanticStaticPropertyKey(p.key, p.computed)].filter(
                (k): k is string =>
                  k !== null && !isObjectPrototypeSetter(p, k),
              ),
        ),
      ),
    ];
  }

  unknownMembers(
    value: SymbolicValue,
    active = new Set<SymbolicValue>(),
  ): number {
    if (active.has(value)) return 1;
    active.add(value);
    if (value.kind === "union")
      return value.values.reduce(
        (sum, v) => sum + this.unknownMembers(v, active),
        0,
      );
    if (value.kind === "record") return 0;
    if (value.kind === "namespace") {
      if (this.#mutated.has(value.bindingId)) return 1;
      const available = this.#namespaceWrites(value);
      if (available === undefined) return 1;
      const replacement = available.findLast(
        (write) => write.path.length === 0,
      );
      return replacement
        ? this.unknownMembers(
            this.evaluate(replacement.value, value.environment),
            active,
          )
        : 0;
    }
    if (value.kind !== "object") return 1;
    return value.node.properties.reduce(
      (sum, p) =>
        sum +
        (t.isSpreadElement(p)
          ? this.unknownMembers(
              this.evaluate(p.argument, value.environment),
              new Set(active),
            )
          : Number(semanticStaticPropertyKey(p.key, p.computed) === null)),
      0,
    );
  }

  /** Calling a generator creates an iterator; advancing it is not modeled. */
  callBody(fn: SymbolicFunction): t.Function["body"] | undefined {
    return fn.node.generator ? undefined : fn.node.body;
  }

  bind(
    fn: SymbolicFunction,
    args: readonly SymbolicValue[],
    invocationNode?: t.Node,
    caller?: SymbolicEnvironment,
  ): SymbolicEnvironment {
    const values = new Map<string, SymbolicValue>();
    runtimeFunctionParameters(fn.node).forEach((param, index) => {
      const target = t.isRestElement(param) ? param.argument : param;
      if (!t.isIdentifier(target)) return;
      const binding = resolveSemanticBindingState(
        this.state,
        target,
        target.name,
      );
      if (binding)
        values.set(
          binding.bindingId,
          t.isRestElement(param)
            ? { kind: "array", values: args.slice(index) }
            : (args[index] ?? symbolicUnknown("runtime parameter")),
        );
    });
    const scopeId =
      this.state.scopeByNode.get(fn.node)?.scopeId ??
      this.state.scopeByNode.get(fn.node.body)?.scopeId;
    return {
      values,
      activation: {},
      parent: fn.environment,
      ...(caller === undefined ? {} : { caller }),
      point: invocationNode ?? fn.node,
      scopeNode: fn.node,
      ...(scopeId === undefined ? {} : { scopeId }),
    };
  }

  arguments(
    node: t.CallExpression | t.OptionalCallExpression,
    env: SymbolicEnvironment,
  ): readonly SymbolicValue[] {
    return node.arguments.flatMap((a) => {
      if (!t.isSpreadElement(a)) return [this.evaluate(a, env)];
      const value = this.evaluate(a.argument, env);
      return value.kind === "array"
        ? value.values
        : [symbolicUnknown("dynamic spread arguments")];
    });
  }

  #evaluate(node: t.Node, env: SymbolicEnvironment): SymbolicValue {
    if (
      t.isStringLiteral(node) ||
      t.isNumericLiteral(node) ||
      t.isBooleanLiteral(node)
    )
      return { kind: "literal", value: node.value };
    if (t.isNullLiteral(node)) return { kind: "literal", value: null };
    if (t.isFunction(node))
      return { kind: "function", node, environment: env, origins: [] };
    if (t.isObjectExpression(node))
      return { kind: "object", node, environment: env };
    if (t.isIdentifier(node)) return this.#identifier(node, env);
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      const key = semanticStaticPropertyKey(node.property, node.computed);
      return key === null
        ? symbolicUnknown("dynamic member")
        : this.property(this.evaluate(node.object, env), key, {
            node,
            environment: env,
          });
    }
    if (t.isSequenceExpression(node))
      return this.evaluate(node.expressions.at(-1), env);
    if (t.isAssignmentExpression(node)) {
      if (node.operator === "=") return this.evaluate(node.right, env);
      if (
        node.operator === "&&=" ||
        node.operator === "||=" ||
        node.operator === "??="
      )
        return this.#logicalValue(
          node.operator === "&&="
            ? "&&"
            : node.operator === "||="
              ? "||"
              : "??",
          node.left,
          node.right,
          env,
          true,
        );
      return symbolicUnknown("compound assignment result");
    }
    if (t.isAwaitExpression(node))
      return this.#awaited(this.evaluate(node.argument, env));
    if (t.isUnaryExpression(node)) {
      const value = this.evaluate(node.argument, env);
      if (node.operator === "void")
        return { kind: "literal", value: undefined };
      const truth = symbolicTruth(value);
      if (node.operator === "!" && truth !== undefined)
        return { kind: "literal", value: !truth };
    }
    if (t.isConditionalExpression(node)) {
      const truth = symbolicTruth(this.evaluate(node.test, env));
      return truth === undefined
        ? symbolicUnion([
            symbolicCondition(this.evaluate(node.consequent, env), {
              node: node.test,
              positive: true,
            }),
            symbolicCondition(this.evaluate(node.alternate, env), {
              node: node.test,
              positive: false,
            }),
          ])
        : this.evaluate(truth ? node.consequent : node.alternate, env);
    }
    if (t.isLogicalExpression(node))
      return this.#logicalValue(node.operator, node.left, node.right, env);
    if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
      return this.#call(node, env);
    return symbolicUnknown(`unsupported ${node.type}`);
  }

  #logicalValue(
    operator: t.LogicalExpression["operator"],
    leftNode: t.Node,
    rightNode: t.Node,
    env: SymbolicEnvironment,
    assignment = false,
  ): SymbolicValue {
    const value = this.evaluate(leftNode, env);
    let left = value;
    if (assignment) {
      // A mutable namespace supplies member identity, not a callable root value.
      // Assignment results must not resolve their own write through that identity.
      const alternatives = symbolicUnion(
        symbolicVariants(value).map((variant) =>
          variant.kind === "namespace" && variant.runtimeValueUnknown
            ? this.#withConditions(
                symbolicUnknown("mutable module exports value"),
                variant,
              )
            : variant,
        ),
      );
      left =
        value.kind === "union"
          ? this.#withConditions(alternatives, value)
          : alternatives;
    }
    const right = symbolicLogicalRight(operator, left);
    if (right !== undefined)
      return right ? this.evaluate(rightNode, env) : left;
    const leftCondition: SymbolicCondition = {
      node: leftNode,
      positive:
        operator === "&&" ? false : operator === "||" ? true : "not-nullish",
    };
    const rightCondition: SymbolicCondition = {
      node: leftNode,
      positive:
        operator === "&&" ? true : operator === "||" ? false : "nullish",
    };
    return symbolicUnion([
      symbolicCondition(left, leftCondition),
      symbolicCondition(this.evaluate(rightNode, env), rightCondition),
    ]);
  }

  #identifier(node: t.Identifier, env: SymbolicEnvironment): SymbolicValue {
    const binding = resolveSemanticBindingState(this.state, node, node.name);
    if (
      !binding &&
      node.name === "undefined" &&
      !semanticResolutionBlocked(this.state, node, node.name)
    )
      return { kind: "literal", value: undefined };
    if (!binding)
      return !semanticResolutionBlocked(this.state, node, node.name) &&
        ["require", "navigator", "String", "Boolean"].includes(node.name)
        ? { kind: "external", path: [node.name] }
        : symbolicUnknown("unbound identifier");
    if (binding.definitions.some((d) => d.kind === "assignment"))
      return symbolicUnknown("reassigned binding");
    // Electron member identity is checked at the selected property. A write
    // to one method must not erase the module origin or unaffected siblings.
    const electronOrigin = this.#electronIdentity.exportPath(node);
    if (electronOrigin === undefined && this.#mutated.has(binding.bindingId))
      return symbolicUnknown("dynamic member writes");
    for (let e: SymbolicEnvironment | undefined = env; e; e = e.parent) {
      const value = e.values.get(binding.bindingId);
      if (value) return value;
    }
    if (electronOrigin === undefined && this.#writes.has(binding.bindingId))
      return symbolicUnknown("overwritten object members");
    const initializer =
      binding.initializers.length === 1 ? binding.initializers[0] : undefined;
    if (!initializer)
      return symbolicUnknown("missing or ambiguous initializer");
    const boundary = this.#readBoundary(binding.scopeId, env, node);
    const point =
      boundary === undefined ? undefined : boundary.node[boundary.edge];
    if (
      !initializer.entryBody &&
      !binding.definitions.every(({ kind }) => kind === "function") &&
      (initializer.node.end == null ||
        point == null ||
        initializer.node.end > point)
    ) {
      this.unresolved = true;
      return symbolicUnknown("initializer not available at this read");
    }
    if (this.state.conditionallySkippedExpressions.has(initializer.node))
      return symbolicUnknown("conditional initializer");
    let value = this.evaluate(initializer.node, env);
    for (const key of initializer.projection) {
      if (key === null) return symbolicUnknown("dynamic destructuring");
      value = this.property(value, String(key), {
        node: initializer.node,
        environment: env,
      });
    }
    return value;
  }

  #readBoundary(
    bindingScopeId: string,
    environment: SymbolicEnvironment,
    readNode: t.Node,
  ): SymbolicReadBoundary | undefined {
    let current: SymbolicEnvironment | undefined = environment;
    let child: SymbolicEnvironment | undefined;
    while (current) {
      if (this.#scopeContains(bindingScopeId, current.scopeId)) {
        const point = child?.point ?? readNode;
        if (current.completedAt !== undefined)
          return { node: current.completedAt, edge: "end" };
        if (current.scopeNode && !this.#nodeWithin(point, current.scopeNode))
          return undefined;
        return { node: point, edge: "start" };
      }
      child = current;
      current = current.parent;
    }
    let outermost = environment;
    while (outermost.parent) outermost = outermost.parent;
    const point = outermost.point ?? environment.point ?? readNode;
    return { node: point, edge: "start" };
  }

  #scopeContains(bindingScopeId: string, environmentScopeId?: string): boolean {
    let scopeId: string | null = bindingScopeId;
    while (scopeId !== null) {
      if (scopeId === environmentScopeId) return true;
      scopeId = this.state.scopesById.get(scopeId)?.parentScopeId ?? null;
    }
    return false;
  }

  #nodeWithin(node: t.Node, ancestor?: t.Node): boolean {
    if (!ancestor) return false;
    let current: t.Node | undefined = node;
    while (current) {
      if (current === ancestor) return true;
      current = this.state.parentsByNode.get(current);
    }
    return false;
  }

  #completedEnvironment(
    environment: SymbolicEnvironment,
    activation: SymbolicEnvironment,
    returnPoint: t.Node,
  ): SymbolicEnvironment | undefined {
    if (environment === activation)
      return { ...environment, completedAt: returnPoint };
    if (environment.parent === undefined) return undefined;
    const parent = this.#completedEnvironment(
      environment.parent,
      activation,
      returnPoint,
    );
    return parent === undefined ? undefined : { ...environment, parent };
  }

  #awaited(value: SymbolicValue): SymbolicValue {
    return symbolicUnion(
      symbolicVariants(value).map((variant) =>
        variant.kind === "promise"
          ? this.#withConditions(this.#awaited(variant.value), variant)
          : variant,
      ),
    );
  }

  #completeReturnedValue(
    value: SymbolicValue,
    activation: SymbolicEnvironment,
    fallbackPoint: t.Node,
    origins: readonly t.Node[],
  ): SymbolicValue {
    if (value.kind === "union")
      return symbolicUnion(
        value.values.map((variant) =>
          this.#completeReturnedValue(
            variant,
            activation,
            fallbackPoint,
            origins,
          ),
        ),
      );
    if (value.kind !== "function" && value.kind !== "promise") return value;
    const { returnPoint, ...returned } = value;
    const point = returnPoint ?? fallbackPoint;
    if (returned.kind === "promise")
      return {
        ...returned,
        value: this.#completeReturnedValue(
          returned.value,
          activation,
          point,
          origins,
        ),
      };
    const environment = this.#completedEnvironment(
      returned.environment,
      activation,
      point,
    );
    return {
      ...returned,
      environment: environment ?? returned.environment,
      origins: [...origins, ...returned.origins],
    };
  }

  #namespaceReadBoundary(
    value: SymbolicNamespace,
    read: SymbolicPropertyRead,
  ): SymbolicReadBoundary | undefined {
    const scopeId = value.environment.scopeId;
    const activation = value.environment.activation;
    if (scopeId === undefined || activation === undefined) return undefined;
    const captured = this.#hasActivation(read.environment, activation);
    // Replaying a factory-owned initializer/spread reads at capture, even
    // when a later closure observes it after the activation completed.
    if (
      captured &&
      this.#owningFunction(read.node) === value.environment.scopeNode
    )
      return { node: read.node, edge: "start" };
    const caller = this.#namespaceCallerBoundary(
      value,
      read.environment,
      activation,
    );
    if (caller !== undefined) return caller;
    if (!captured) return undefined;
    const boundary = this.#readBoundary(scopeId, read.environment, read.node);
    return boundary !== undefined &&
      this.#owningFunction(boundary.node) === value.environment.scopeNode
      ? boundary
      : undefined;
  }

  #hasActivation(
    environment: SymbolicEnvironment,
    activation: object,
  ): boolean {
    for (
      let current: SymbolicEnvironment | undefined = environment;
      current;
      current = current.parent
    ) {
      if (--this.#remainingEvaluations < 0) {
        this.truncated = true;
        return false;
      }
      if (current.activation === activation) return true;
    }
    return false;
  }

  #namespaceCallerBoundary(
    value: SymbolicNamespace,
    environment: SymbolicEnvironment,
    activation: object,
  ): SymbolicReadBoundary | undefined {
    for (
      let current = environment;
      current.caller !== undefined;
      current = current.caller
    ) {
      if (--this.#remainingEvaluations < 0) {
        this.truncated = true;
        return undefined;
      }
      const point = current.point;
      if (
        point !== undefined &&
        this.#owningFunction(point) === value.environment.scopeNode &&
        this.#hasActivation(current.caller, activation)
      )
        return { node: point, edge: "start" };
    }
    return undefined;
  }

  #owningFunction(node: t.Node): t.Function | undefined {
    let current: t.Node | undefined = node;
    while (current !== undefined && !t.isFunction(current))
      current = this.state.parentsByNode.get(current);
    return current;
  }

  #namespaceWrites(
    value: SymbolicNamespace,
    read?: SymbolicPropertyRead,
    selectedKey?: string,
  ): readonly PropertyWrite[] | undefined {
    const writes = this.#writes.get(value.bindingId) ?? [];
    const completedAt = value.environment.completedAt;
    const boundary =
      read === undefined ? undefined : this.#namespaceReadBoundary(value, read);
    if (this.#remainingEvaluations <= 0) {
      this.truncated = true;
      return undefined;
    }
    const sourcePoint = boundary?.node[boundary.edge];
    if (boundary !== undefined && sourcePoint == null) return undefined;
    if (completedAt !== undefined && completedAt.end == null) return undefined;
    if (sourcePoint == null && completedAt === undefined)
      return read === undefined ? writes : undefined;
    // An owned snapshot cannot read beyond either its capture or this exit.
    const point = Math.min(
      sourcePoint ?? Infinity,
      completedAt?.end ?? Infinity,
    );
    const commonThrough = value.environment.commonThrough?.end;
    const changed = new Set<string>();
    if (commonThrough != null) {
      if (writes.length > this.#remainingEvaluations) {
        this.#remainingEvaluations = 0;
        this.truncated = true;
        return undefined;
      }
      this.#remainingEvaluations -= writes.length;
      for (const write of writes) {
        if (write.site.end == null) return undefined;
        if (
          write.site.end > completedAt!.end! &&
          write.site.end <= commonThrough
        ) {
          if (write.path.length === 0) return [];
          changed.add(write.path[0]!);
        }
      }
    }
    return writes.filter(
      (write) =>
        write.site.end != null &&
        write.site.end <= point &&
        (changed.size === 0 ||
          (write.path.length > 0
            ? !changed.has(write.path[0]!)
            : selectedKey !== undefined && !changed.has(selectedKey))),
    );
  }

  #completeNamespace(
    value: SymbolicNamespace,
    point: t.Node,
    commonThrough?: t.Node,
  ): SymbolicNamespace {
    const values = new Map(value.environment.values);
    const environment: SymbolicEnvironment = {
      ...value.environment,
      values,
      completedAt: point,
      ...(commonThrough === undefined ? {} : { commonThrough }),
    };
    const completed: SymbolicNamespace = { ...value, environment };
    // A completed activation owns coherent views of both parameter aliases.
    // Merely copying completedAt loses that proof when `exports` escapes.
    // This map has only the recognized factory's module/exports/loader slots.
    for (const [bindingId, slot] of value.environment.values) {
      if (slot === value) values.set(bindingId, completed);
      else if (
        this.#moduleBindings.has(bindingId) &&
        this.#exportAliases.get(bindingId) === value.bindingId &&
        slot.kind === "record" &&
        slot.values.get("exports") === value
      ) {
        values.set(bindingId, {
          ...slot,
          values: new Map(slot.values).set("exports", completed),
        });
      }
    }
    return completed;
  }

  #moduleExports(value: SymbolicNamespace): SymbolicValue {
    const factory = this.#namespaceOwners.get(value.bindingId);
    if (factory === undefined) return value;
    const cached = this.#completedModules.get(value.environment);
    if (cached !== undefined) return cached;
    if (this.#activeFunctions.has(factory))
      return symbolicUnknown("recursive module completion");
    this.#activeFunctions.add(factory);
    try {
      // Factory return values are ignored by the loader. Each reachable exit
      // still owns a distinct initialization boundary and branch predicates.
      const flow = this.#returnFlow(
        t.isBlockStatement(factory.body) ? factory.body.body : [],
        value.environment,
        (statement) => this.#completeNamespace(value, statement),
      );
      const completed = symbolicUnion([
        ...flow.values,
        ...(flow.fallsThrough
          ? [
              this.#withConditions(
                this.#completeNamespace(value, factory.body),
                flow,
              ),
            ]
          : []),
      ]);
      const variants = symbolicVariants(completed);
      if (
        variants.length > 1 &&
        variants.every(
          (variant) =>
            variant.kind === "namespace" &&
            variant.environment.completedAt?.end != null &&
            !variant.conditionUnresolved,
        )
      ) {
        if (variants.length > this.#remainingEvaluations) {
          this.#remainingEvaluations = 0;
          this.truncated = true;
        } else {
          this.#remainingEvaluations -= variants.length;
          const exits = variants as readonly SymbolicNamespace[];
          let first = exits[0]!.environment.completedAt!;
          let last = first;
          for (const exit of exits) {
            const point = exit.environment.completedAt!;
            if (point.end! < first.end!) first = point;
            if (point.end! > last.end!) last = point;
          }
          const common = this.#completeNamespace(value, first, last);
          const group = { members: new Set(variants), common };
          for (const variant of variants)
            this.#completionGroups.set(variant, group);
        }
      }
      this.#completedModules.set(value.environment, completed);
      return completed;
    } finally {
      this.#activeFunctions.delete(factory);
    }
  }

  #call(
    node: t.CallExpression | t.OptionalCallExpression,
    env: SymbolicEnvironment,
  ): SymbolicValue {
    const callee = this.evaluate(node.callee, env);
    const args = this.arguments(node, env);
    return symbolicUnion(
      symbolicVariants(callee).map((value) => {
        let result: SymbolicValue;
        if (value.kind === "loader") {
          const key = args[0];
          const loaded =
            key?.kind === "literal"
              ? (value.modules.get(String(key.value)) ??
                symbolicUnknown("missing module"))
              : symbolicUnknown("dynamic module");
          result =
            loaded.kind === "namespace" ? this.#moduleExports(loaded) : loaded;
        } else if (
          value.kind === "external" &&
          value.path.join(".") === "require"
        ) {
          const spec = args[0];
          result =
            spec?.kind === "literal" && typeof spec.value === "string"
              ? { kind: "external", path: [spec.value] }
              : symbolicUnknown("dynamic require");
        } else if (
          value.kind !== "function" ||
          this.#activeFunctions.has(value.node)
        ) {
          result = symbolicUnknown("unresolved or recursive call");
        } else if (this.callBody(value) === undefined) {
          // Calling a generator creates an iterator without running its body.
          result = { kind: "iterator" };
        } else {
          this.#activeFunctions.add(value.node);
          try {
            const bound = this.bind(value, args, node, env);
            const returned = t.isBlockStatement(value.node.body)
              ? this.#returns(value.node.body.body, bound)
              : this.evaluate(value.node.body, bound);
            const completed = this.#completeReturnedValue(
              returned,
              bound,
              value.node.body,
              [...value.origins, node],
            );
            // Async calls return a truthy Promise; only await selects its value.
            result = value.node.async
              ? { kind: "promise", value: this.#awaited(completed) }
              : completed;
          } finally {
            this.#activeFunctions.delete(value.node);
          }
        }
        return this.#withConditions(result, value);
      }),
    );
  }

  #returns(
    statements: readonly t.Statement[],
    env: SymbolicEnvironment,
  ): SymbolicValue {
    const flow = this.#returnFlow(statements, env, (statement) => {
      const value = this.evaluate(statement.argument, env);
      return symbolicUnion(
        symbolicVariants(value).map((variant) =>
          variant.kind === "function" || variant.kind === "promise"
            ? { ...variant, returnPoint: statement }
            : variant,
        ),
      );
    });
    return symbolicUnion([
      ...flow.values,
      ...(flow.fallsThrough
        ? [this.#withConditions({ kind: "literal", value: undefined }, flow)]
        : []),
    ]);
  }

  #returnFlow(
    statements: readonly t.Statement[],
    env: SymbolicEnvironment,
    returnedValue: (statement: t.ReturnStatement) => SymbolicValue,
    depth = 0,
  ): SymbolicReturnFlow {
    const possible: SymbolicValue[] = [];
    let unresolvedFallthrough = false;
    const continuationConditions: SymbolicCondition[] = [];
    const guardCurrentPath = (value: SymbolicValue): SymbolicValue =>
      this.#withConditions(value, {
        conditions: continuationConditions,
        ...(unresolvedFallthrough ? { conditionUnresolved: true } : {}),
      });
    for (const statement of statements) {
      if (--this.#remainingEvaluations < 0 || depth >= 128) {
        this.truncated = true;
        return {
          values: [...possible, symbolicUnknown("symbolic resource limit")],
          fallsThrough: false,
        };
      }
      if (t.isThrowStatement(statement))
        return {
          values: [...possible, symbolicUnknown("wrapper exits by throwing")],
          fallsThrough: false,
        };
      if (t.isReturnStatement(statement)) {
        return {
          values: [...possible, guardCurrentPath(returnedValue(statement))],
          fallsThrough: false,
        };
      }
      if (t.isBlockStatement(statement)) {
        const flow = this.#returnFlow(
          statement.body,
          env,
          returnedValue,
          depth + 1,
        );
        possible.push(...flow.values.map(guardCurrentPath));
        if (!flow.fallsThrough)
          return { values: possible, fallsThrough: false };
        continuationConditions.push(...(flow.conditions ?? []));
        unresolvedFallthrough ||= flow.conditionUnresolved === true;
      }
      if (t.isIfStatement(statement)) {
        const truth = symbolicTruth(this.evaluate(statement.test, env));
        const branches =
          truth === undefined
            ? [statement.consequent, statement.alternate]
            : [truth ? statement.consequent : statement.alternate];
        const flows = branches.map((branch) =>
          this.#returnFlow(
            branch ? [branch] : [],
            env,
            returnedValue,
            depth + 1,
          ),
        );
        possible.push(
          ...flows.flatMap((flow, index) =>
            flow.values.map((value) => {
              const guarded = guardCurrentPath(value);
              return truth === undefined
                ? symbolicCondition(guarded, {
                    node: statement.test,
                    positive: index === 0,
                  })
                : guarded;
            }),
          ),
        );
        if (flows.every((flow) => !flow.fallsThrough))
          return { values: possible, fallsThrough: false };
        if (truth !== undefined) {
          continuationConditions.push(...(flows[0]?.conditions ?? []));
          unresolvedFallthrough ||= flows[0]?.conditionUnresolved === true;
        } else {
          const fallthrough = flows.flatMap((flow, index) =>
            flow.fallsThrough ? [{ flow, index }] : [],
          );
          if (
            fallthrough.length === 1 &&
            fallthrough[0]?.flow.values.length === 0
          )
            continuationConditions.push({
              node: statement.test,
              positive: fallthrough[0].index === 0,
            });
          else if (
            fallthrough.length > 0 &&
            (fallthrough.length < flows.length ||
              fallthrough.some(({ flow }) => flow.values.length > 0))
          )
            unresolvedFallthrough = true;
        }
      }
      if (
        t.isLoop(statement) ||
        t.isSwitchStatement(statement) ||
        t.isTryStatement(statement) ||
        t.isLabeledStatement(statement) ||
        t.isWithStatement(statement)
      ) {
        if (containsOwnedReturn(statement)) {
          possible.push(
            symbolicUnknown(
              `unsupported return control flow: ${statement.type}`,
            ),
          );
          unresolvedFallthrough = true;
        }
      }
    }
    return {
      values: possible,
      fallsThrough: true,
      ...(continuationConditions.length
        ? { conditions: continuationConditions }
        : {}),
      ...(unresolvedFallthrough ? { conditionUnresolved: true } : {}),
    };
  }

  #indexBootstrap(call: t.CallExpression): void {
    const bootstrap = javascriptBootstrapAt(call, this.state);
    if (!bootstrap) return;
    const modules = new Map<string, SymbolicValue>();
    const tableAliases = new Set([bootstrap.tableBindingId]);
    const pendingAliases = [bootstrap.tableBindingId];
    while (pendingAliases.length > 0) {
      const source = pendingAliases.pop()!;
      for (const alias of this.#aliasesByBinding.get(source) ?? [])
        if (!tableAliases.has(alias)) {
          tableAliases.add(alias);
          pendingAliases.push(alias);
        }
    }
    for (const property of bootstrap.table.properties) {
      const factory = moduleFactory(property);
      if (!factory) continue;
      this.#moduleFactories.add(factory);
      const moduleKey = modulePropertyName(property);
      const values = new Map<string, SymbolicValue>();
      const environment: SymbolicEnvironment = {
        values,
        activation: {},
        point: factory.body,
        scopeNode: factory,
        ...(this.state.scopeByNode.get(factory)?.scopeId === undefined
          ? {}
          : { scopeId: this.state.scopeByNode.get(factory)!.scopeId }),
      };
      const [first, second, third] = runtimeFunctionParameters(factory);
      const binding = (n: t.Node | undefined) =>
        t.isIdentifier(n)
          ? resolveSemanticBindingState(this.state, n, n.name)?.bindingId
          : undefined;
      const moduleId = binding(first);
      const exportsId = binding(second);
      const loaderId = binding(third);
      const namespaceId = `${String(factory.start)}:exports`;
      this.#namespaceOwners.set(namespaceId, factory);
      const namespace: SymbolicValue = {
        kind: "namespace",
        bindingId: namespaceId,
        environment,
      };
      if (moduleId) {
        values.set(moduleId, {
          kind: "record",
          values: new Map([["exports", namespace]]),
        });
        this.#exportAliases.set(moduleId, namespaceId);
        this.#moduleBindings.add(moduleId);
      }
      if (exportsId) {
        values.set(exportsId, namespace);
        this.#exportAliases.set(exportsId, namespaceId);
      }
      if (loaderId) values.set(loaderId, { kind: "loader", modules });
      this.#environments.set(factory, environment);
      modules.set(moduleKey, namespace);
    }
    this.#bootstrapTables.push({ tableAliases, modules });
  }

  #indexBindingAliases(): void {
    for (const binding of this.state.bindingsById.values()) {
      const initializer = binding.initializers[0];
      if (
        !initializer ||
        initializer.entryBody !== undefined ||
        initializer.projection.length !== 0 ||
        !t.isIdentifier(initializer.node)
      )
        continue;
      const source = resolveSemanticBindingState(
        this.state,
        initializer.node,
        initializer.node.name,
      );
      if (!source) continue;
      const aliases = this.#aliasesByBinding.get(source.bindingId) ?? [];
      aliases.push(binding.bindingId);
      this.#aliasesByBinding.set(source.bindingId, aliases);
    }
  }

  #invalidateBootstrapTable(
    tableAliases: ReadonlySet<string>,
    modules: Map<string, SymbolicValue>,
  ): void {
    let invalidateAll = false;
    const invalidSlots = new Set<string>();
    for (const bindingId of tableAliases) {
      if (this.#mutated.has(bindingId)) invalidateAll = true;
      for (const definition of this.state.bindingsById.get(bindingId)
        ?.definitions ?? [])
        if (definition.kind === "assignment") invalidateAll = true;
      for (const write of this.#writes.get(bindingId) ?? []) {
        if (write.path.length === 0) invalidateAll = true;
        else invalidSlots.add(write.path[0]!);
      }
    }
    if (invalidateAll) modules.clear();
    else for (const key of invalidSlots) modules.delete(key);
  }

  #indexWriteSite(target: t.Node, site: t.Node): void {
    const direct = unwrapJavaScriptExpression(target).node;
    if (
      (t.isIdentifier(direct) || t.isMemberExpression(direct)) &&
      !t.isForOfStatement(site) &&
      !t.isForInStatement(site)
    ) {
      // Retain the operator so stored writes use the same result semantics as
      // inline assignments, rather than treating every write as its RHS.
      this.#indexWrite(direct, site, site);
      return;
    }
    for (const leaf of semanticWriteTargets(target))
      this.#indexWrite(leaf, site, site, false);
  }

  #indexWrite(target: t.Node, value: t.Node, site: t.Node, exact = true): void {
    const path: string[] = [];
    let root = unwrapJavaScriptExpression(target).node;
    let dynamic = !exact;
    while (t.isMemberExpression(root)) {
      const key = semanticStaticPropertyKey(root.property, root.computed);
      if (key === null) dynamic = true;
      else path.unshift(key);
      root = unwrapJavaScriptExpression(root.object).node;
    }
    if (dynamic && t.isIdentifier(root)) {
      const binding = resolveSemanticBindingState(this.state, root, root.name);
      if (binding)
        this.#mutated.add(
          this.#exportAliases.get(binding.bindingId) ?? binding.bindingId,
        );
      return;
    }
    if (t.isIdentifier(root)) this.#addWrite(root, path, value, site);
  }

  #addWrite(
    root: t.Identifier,
    path: readonly string[],
    value: t.Node,
    site: t.Node,
  ): void {
    const binding = resolveSemanticBindingState(this.state, root, root.name);
    if (!binding) return;
    const alias = this.#exportAliases.get(binding.bindingId);
    if (this.#moduleBindings.has(binding.bindingId) && path[0] !== "exports")
      return;
    const key = alias ?? binding.bindingId;
    const selected = this.#moduleBindings.has(binding.bindingId)
      ? path.slice(1)
      : path;
    if (alias) {
      const owner = this.#namespaceOwners.get(alias);
      for (
        let parent = this.state.parentsByNode.get(site);
        parent && parent !== owner;
        parent = this.state.parentsByNode.get(parent)
      ) {
        if (
          t.isFunction(parent) ||
          t.isIfStatement(parent) ||
          t.isConditionalExpression(parent) ||
          t.isLogicalExpression(parent) ||
          t.isLoop(parent) ||
          t.isSwitchCase(parent) ||
          t.isTryStatement(parent)
        ) {
          if (selected.length === 0) this.#mutated.add(key);
          else this.#unsafeExports.add(`${key}:${selected[0] ?? ""}`);
          return;
        }
      }
    }
    const writes = this.#writes.get(key) ?? [];
    writes.push({ path: selected, value, site });
    this.#writes.set(key, writes);
  }
}
