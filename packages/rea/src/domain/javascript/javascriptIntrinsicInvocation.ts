import * as t from "@babel/types";

import type { JavaScriptIntrinsicInvocation } from "./javascriptElectronMemberWrites.js";
import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";

export type JavaScriptArrayIterationProof = (
  array: t.ArrayExpression,
) => boolean;

const unknownArrayIteration: JavaScriptArrayIterationProof = () => false;

/** Expand literal array spreads only when their native iterator is proven. */
export const expandJavaScriptInvocationArguments = (
  arguments_: readonly t.CallExpression["arguments"][number][],
  nativeArrayIteration: JavaScriptArrayIterationProof = unknownArrayIteration,
): t.CallExpression["arguments"] => {
  const expanded: t.CallExpression["arguments"] = [];
  const pending = [...arguments_].reverse();
  while (pending.length > 0) {
    const argument = pending.pop();
    if (argument === undefined) break;
    const array = t.isSpreadElement(argument)
      ? unwrapJavaScriptExpression(argument.argument).node
      : undefined;
    if (
      t.isArrayExpression(array) &&
      nativeArrayIteration(array) &&
      array.elements.every(
        (element) => t.isExpression(element) || t.isSpreadElement(element),
      )
    )
      for (let index = array.elements.length - 1; index >= 0; index -= 1) {
        const element = array.elements[index];
        if (element !== null && element !== undefined) pending.push(element);
      }
    else expanded.push(argument);
  }
  return expanded;
};

const arrayArguments = (
  node: t.Node | undefined,
  nativeArrayIteration: JavaScriptArrayIterationProof,
) => {
  const array =
    node === undefined ? undefined : unwrapJavaScriptExpression(node).node;
  if (
    !t.isArrayExpression(array) ||
    array.elements.some((element) => element === null)
  )
    return undefined;
  const expanded = expandJavaScriptInvocationArguments(
    array.elements.filter(
      (element): element is t.Expression | t.SpreadElement => element !== null,
    ),
    nativeArrayIteration,
  );
  return expanded.every((element) => t.isExpression(element))
    ? expanded.filter((element): element is t.Expression =>
        t.isExpression(element),
      )
    : undefined;
};

const invocationArguments = (
  method: "call" | "apply",
  arguments_: JavaScriptIntrinsicInvocation["arguments"],
  nativeArrayIteration: JavaScriptArrayIterationProof,
) =>
  t.isSpreadElement(arguments_?.[0])
    ? undefined
    : method === "apply"
      ? arrayArguments(arguments_?.[1], nativeArrayIteration)
      : arguments_?.slice(1);

/** Positional state needed only by generic Function.call/apply invocation. */
export interface JavaScriptSourceInvocationContext {
  readonly receiver: t.Node | undefined;
  readonly receiverUnknown?: boolean;
  readonly arguments: JavaScriptIntrinsicInvocation["arguments"];
}

/** Only these generic function members consume a callable receiver. */
export const javaScriptGenericInvocationMethod = (
  callee: t.Node,
): "call" | "apply" | undefined => {
  const expression = unwrapJavaScriptExpression(callee).node;
  const method =
    t.isMemberExpression(expression) || t.isOptionalMemberExpression(expression)
      ? semanticStaticPropertyKey(expression.property, expression.computed)
      : undefined;
  return method === "call" || method === "apply" ? method : undefined;
};

/** A member call supplies its receiver; a captured/comma callable does not. */
export const javaScriptSourceInvocationContext = (
  node: t.CallExpression | t.OptionalCallExpression,
  nativeArrayIteration: JavaScriptArrayIterationProof = unknownArrayIteration,
): JavaScriptSourceInvocationContext => {
  const callee = unwrapJavaScriptExpression(node.callee).node;
  return {
    receiver:
      t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)
        ? callee.object
        : undefined,
    arguments: expandJavaScriptInvocationArguments(
      node.arguments,
      nativeArrayIteration,
    ),
  };
};

/** Select one generic function receiver without evaluating function arguments. */
export const resolveJavaScriptGenericInvocation = (
  method: "call" | "apply",
  context: JavaScriptSourceInvocationContext,
  nativeArrayIteration: JavaScriptArrayIterationProof = unknownArrayIteration,
):
  | {
      readonly callable: t.Expression;
      readonly context: JavaScriptSourceInvocationContext;
    }
  | undefined =>
  !t.isExpression(context.receiver)
    ? undefined
    : {
        callable: context.receiver,
        context: {
          receiver: context.arguments?.[0],
          ...(context.arguments === undefined ||
          t.isSpreadElement(context.arguments[0])
            ? { receiverUnknown: true }
            : {}),
          arguments: invocationArguments(
            method,
            context.arguments,
            nativeArrayIteration,
          ),
        },
      };

/**
 * Normalize known invocation syntax once, retaining bound argument prefixes.
 * Binding a function alone is not a write; only its eventual call is examined.
 */
export const resolveJavaScriptIntrinsicInvocation = (
  node: t.CallExpression | t.OptionalCallExpression,
  intrinsicPath: (node: t.Node) => readonly string[] | undefined,
  boundIntrinsic: (node: t.Node) => JavaScriptIntrinsicInvocation | undefined,
  intrinsicReadChanged: (node: t.Node, path: readonly string[]) => boolean,
  nativeArrayIteration: JavaScriptArrayIterationProof = unknownArrayIteration,
): JavaScriptIntrinsicInvocation | undefined => {
  const visited = new Set<t.Node>();
  let callee: t.Node = node.callee;
  let arguments_: JavaScriptIntrinsicInvocation["arguments"] =
    expandJavaScriptInvocationArguments(node.arguments, nativeArrayIteration);
  let receiver: t.Node | undefined;
  let explicitReceiver = false;
  for (;;) {
    callee = unwrapJavaScriptExpression(callee).node;
    if (t.isSequenceExpression(callee)) {
      const finalExpression = callee.expressions.at(-1);
      if (finalExpression === undefined) return undefined;
      // The comma operator returns the final value without its member receiver.
      // Keep that lost receiver explicit so intrinsic call/apply stays unknown.
      explicitReceiver = true;
      callee = finalExpression;
      continue;
    }
    if (visited.has(callee)) return undefined;
    visited.add(callee);
    let path = intrinsicPath(callee);
    if (path !== undefined && intrinsicReadChanged(callee, path))
      return { kind: "opaque", path, arguments: undefined };
    if (path === undefined) {
      if (
        t.isMemberExpression(callee) ||
        t.isOptionalMemberExpression(callee)
      ) {
        const method = semanticStaticPropertyKey(
          callee.property,
          callee.computed,
        );
        if (method === "call" || method === "apply") {
          const bound = boundIntrinsic(callee.object);
          // Caller-selected native loaders share Function.prototype authority.
          const callablePath = bound?.path ?? intrinsicPath(callee.object);
          if (
            callablePath !== undefined &&
            intrinsicReadChanged(callee, [...callablePath, method])
          )
            return { kind: "opaque", path: callablePath, arguments: undefined };
          receiver = arguments_?.[0];
          explicitReceiver = true;
          callee = callee.object;
          arguments_ = invocationArguments(
            method,
            arguments_,
            nativeArrayIteration,
          );
          continue;
        }
      }
      const bound = boundIntrinsic(callee);
      if (bound === undefined) return undefined;
      if (bound.kind === "opaque") return bound;
      path = bound.path;
      receiver = bound.receiver;
      explicitReceiver = true;
      arguments_ =
        bound.arguments === undefined
          ? undefined
          : [...bound.arguments, ...(arguments_ ?? [])];
    }
    const method = path.length > 3 ? path.at(-1) : undefined;
    if (method === "call" || method === "apply") {
      // These properties hold generic function values. Their receiver selects
      // the callable; property-chain depth does not consume more arguments.
      const callable: t.Node | undefined = explicitReceiver
        ? receiver
        : t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)
          ? callee.object
          : undefined;
      const selected = resolveJavaScriptGenericInvocation(
        method,
        {
          receiver: callable,
          arguments: arguments_,
        },
        nativeArrayIteration,
      );
      if (selected === undefined)
        return { kind: "opaque", path, arguments: undefined };
      callee = selected.callable;
      receiver = selected.context.receiver;
      explicitReceiver = true;
      arguments_ = selected.context.arguments;
      continue;
    }
    if (path.join(".") === "intrinsic.Reflect.apply") {
      const callable = arguments_?.[0];
      if (!t.isExpression(callable)) return undefined;
      callee = callable;
      receiver = arguments_?.[1];
      explicitReceiver = true;
      arguments_ = arrayArguments(arguments_?.[2], nativeArrayIteration);
      continue;
    }
    return {
      kind: "known",
      path,
      arguments: arguments_,
      ...(receiver === undefined ? {} : { receiver }),
    };
  }
};
