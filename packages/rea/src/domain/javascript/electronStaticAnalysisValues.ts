import * as t from "@babel/types";

import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { ElectronStaticValue } from "./electronStaticAnalysisTypes.js";
import {
  readExactJavaScriptLiteral,
  semanticStaticPropertyKey,
} from "./javascriptAstValues.js";
import { electronMemberPath } from "./javascriptElectronMemberWrites.js";
import { sourceSlice } from "./javascriptStaticAnalysisHelpers.js";
import type { JavaScriptFindingContext } from "./javascriptStaticAnalysisState.js";

/** Resolve a callee only when its root has a proven Electron module identity. */
export const electronCalleePath = (
  callee: t.Node,
  context: JavaScriptFindingContext,
): readonly string[] | undefined => {
  const { root, members } = electronMemberPath(callee);
  if (!members.every((member): member is string => member !== null))
    return undefined;
  const exported = context.electronBindings?.get(root.start ?? -1);
  return exported === undefined ? undefined : [...exported, ...members];
};

/** Preserve one literal value or the exact inert expression. */
export const electronStaticValue = (
  source: string,
  node: t.Node | null | undefined,
): ElectronStaticValue => {
  const literal = literalValue(node);
  return literal.found
    ? { status: "literal", value: literal.value, expression: null }
    : {
        status: "dynamic",
        value: null,
        expression: boundedExpression(source, node),
      };
};

/** Return an actionable expression without evaluating it. */
export const boundedExpression = (
  source: string,
  node: t.Node | null | undefined,
): string => {
  if (node === null || node === undefined) return "[missing-expression]";
  const expression = sourceSlice(source, node).trim();
  return expression === "" ? `[${node.type}]` : expression;
};

type PresentHandlerKind =
  | "inline-function"
  | "identifier"
  | "member-expression"
  | "dynamic-expression";

/** Classify a handler argument while retaining its exact source range. */
export function handlerKind(node: t.Node): PresentHandlerKind;
export function handlerKind(node: null | undefined): "missing";
export function handlerKind(
  node: t.Node | null | undefined,
): PresentHandlerKind | "missing" {
  if (node === null || node === undefined) return "missing";
  if (
    t.isArrowFunctionExpression(node) ||
    t.isFunctionExpression(node) ||
    t.isFunctionDeclaration(node)
  )
    return "inline-function";
  if (t.isIdentifier(node)) return "identifier";
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node))
    return "member-expression";
  return "dynamic-expression";
}

/**
 * Nesting bound for dotted contextBridge member paths. Deeper objects count as
 * one unknown member rather than being enumerated.
 */
export const contextBridgeMemberPathDepth = 8;

/** Collect statically visible dotted keys from one literal contextBridge API object. */
export const collectContextBridgeMembers = (
  node: t.Node | null | undefined,
): {
  readonly status: "object-literal" | "dynamic" | "missing";
  readonly members: readonly string[];
  readonly unknown: number;
} => {
  if (node === null || node === undefined)
    return {
      status: "missing",
      members: [],
      unknown: 0,
    };
  if (!t.isObjectExpression(node))
    return {
      status: "dynamic",
      members: [],
      unknown: 1,
    };
  const state: { members: string[]; unknown: number } = {
    members: [],
    unknown: 0,
  };
  collectMembersAt(node, [], state);
  const members = [...new Set(state.members)].sort(compareUnicodeCodePoints);
  return {
    status: "object-literal",
    members,
    unknown: state.unknown,
  };
};

const collectMembersAt = (
  object: t.ObjectExpression,
  prefix: readonly string[],
  state: { members: string[]; unknown: number },
): void => {
  if (prefix.length >= contextBridgeMemberPathDepth) {
    state.unknown += 1;
    return;
  }
  for (const property of object.properties) {
    if (t.isSpreadElement(property)) {
      state.unknown += 1;
      continue;
    }
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (name === null) {
      state.unknown += 1;
      continue;
    }
    if (
      t.isObjectProperty(property) &&
      !property.computed &&
      !property.shorthand &&
      name === "__proto__"
    )
      continue;
    const segments = [...prefix, name];
    const path = segments.join(".");
    state.members.push(path);
    if (t.isObjectProperty(property) && t.isObjectExpression(property.value))
      collectMembersAt(property.value, segments, state);
  }
};

const literalValue = (
  node: t.Node | null | undefined,
):
  | { readonly found: true; readonly value: string | number | boolean | null }
  | { readonly found: false } => {
  if (node === null || node === undefined) return { found: false };
  const literal = readExactJavaScriptLiteral(node);
  if (literal.found) return literal;
  if (
    t.isUnaryExpression(node, { operator: "-" }) &&
    t.isNumericLiteral(node.argument)
  ) {
    const value = -node.argument.value;
    return Number.isFinite(value) && !Object.is(value, -0)
      ? { found: true, value }
      : { found: false };
  }
  return { found: false };
};
