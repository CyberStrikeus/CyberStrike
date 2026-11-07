import * as t from "@babel/types";

import {
  runtimeFunctionParameters,
  semanticStaticPropertyKey,
} from "./javascriptAstValues.js";
import type { JavaScriptSemanticBindingState } from "./javascriptSemanticState.js";

/** Calling-convention roles bound once from one bundler factory's parameters. */
export interface JavaScriptBundlerFactoryRoles {
  /** The parameter bound to the module object. */
  readonly module: t.Identifier | undefined;
  /** Every parameter binding whose entry value is `module.exports`. */
  readonly exports: readonly t.Identifier[];
  /** The parameter bound to the bundler loader (`__webpack_require__`). */
  readonly loader: t.Identifier | undefined;
  /**
   * Default expressions of role parameters and of `{exports: alias}` targets.
   * The convention always supplies the module, its exports object and the
   * loader, so these never run and yield no facts.
   */
  readonly unusedDefaults: ReadonlySet<t.Node>;
  /**
   * False when a role parameter uses a pattern whose bindings cannot be
   * matched exactly, such as a rest element or a computed or nested key.
   * Facts read through the roles are then incomplete, not absent.
   */
  readonly exact: boolean;
}

type FactoryRole = "module" | "exports" | "loader";

/** Positional factory roles of a recognized bundler runtime. */
const roleOrder = (runtime: string): readonly FactoryRole[] =>
  runtime === "esbuild-commonjs"
    ? ["exports", "module"]
    : runtime.startsWith("esbuild-")
      ? []
      : ["module", "exports", "loader"];

/** Bind a factory's role parameters by position, never by spelling. */
export const javascriptBundlerFactoryRoles = (
  factory: t.Function,
  runtime: string,
): JavaScriptBundlerFactoryRoles => {
  const parameters = runtimeFunctionParameters(factory);
  const roles: {
    module: t.Identifier | undefined;
    exports: t.Identifier[];
    loader: t.Identifier | undefined;
  } = { module: undefined, exports: [], loader: undefined };
  const unusedDefaults = new Set<t.Node>();
  let exact = true;
  const bindingIdentifier = (node: t.Node): t.Identifier | undefined => {
    if (t.isIdentifier(node)) return node;
    if (t.isAssignmentPattern(node) && t.isIdentifier(node.left)) {
      unusedDefaults.add(node.right);
      return node.left;
    }
    return undefined;
  };
  for (const [index, role] of roleOrder(runtime).entries()) {
    const parameter = parameters[index];
    if (parameter === undefined) break;
    // A rest element collects this and every later argument into an array.
    if (t.isRestElement(parameter)) {
      exact = false;
      break;
    }
    // The convention always supplies every role argument, so a role
    // parameter's default is dead code whatever its binding pattern.
    const pattern = t.isAssignmentPattern(parameter)
      ? parameter.left
      : parameter;
    if (t.isAssignmentPattern(parameter)) unusedDefaults.add(parameter.right);
    // Loader consumers resolve its calls through the binding's own value
    // facts, which cannot yet discount a default the convention never runs.
    if (
      t.isIdentifier(pattern) &&
      (role !== "loader" || pattern === parameter)
    ) {
      // A repeated simple parameter name binds its last argument.
      if (boundLater(parameters, index, pattern.name)) continue;
      if (role === "exports") roles.exports.push(pattern);
      else roles[role] = pattern;
      continue;
    }
    if (role === "module" && t.isObjectPattern(pattern)) {
      if (!moduleExportsAliases(pattern, bindingIdentifier, roles.exports))
        exact = false;
      continue;
    }
    exact = false;
  }
  return { ...roles, unusedDefaults, exact };
};

/** `{exports: alias}` binds `module.exports`; other static keys cannot reach it. */
const moduleExportsAliases = (
  pattern: t.ObjectPattern,
  bindingIdentifier: (node: t.Node) => t.Identifier | undefined,
  output: t.Identifier[],
): boolean => {
  for (const property of pattern.properties) {
    // A shallow rest copy keeps the `exports` property's object.
    if (t.isRestElement(property)) return false;
    const key = semanticStaticPropertyKey(property.key, property.computed);
    if (key === null) return false;
    if (key !== "exports") continue;
    const alias = bindingIdentifier(property.value);
    if (alias === undefined) return false;
    output.push(alias);
  }
  return true;
};

const boundLater = (
  parameters: t.Function["params"],
  index: number,
  name: string,
): boolean =>
  parameters
    .slice(index + 1)
    .some((parameter) =>
      Object.hasOwn(t.getBindingIdentifiers(parameter), name),
    );

/**
 * A role parameter's binding facts at entry. A default the convention never
 * runs is not a possible value, so write ordering must not see it either.
 */
export const withoutUnusedFactoryDefaults = (
  binding: JavaScriptSemanticBindingState,
  roles: Pick<JavaScriptBundlerFactoryRoles, "unusedDefaults">,
): JavaScriptSemanticBindingState => {
  const unused = ({
    node,
    assignment,
  }: JavaScriptSemanticBindingState["referenceInitializers"][number]) =>
    assignment !== true && roles.unusedDefaults.has(node);
  return binding.referenceInitializers.some(unused)
    ? {
        ...binding,
        referenceInitializers: binding.referenceInitializers.filter(
          (initializer) => !unused(initializer),
        ),
      }
    : binding;
};
